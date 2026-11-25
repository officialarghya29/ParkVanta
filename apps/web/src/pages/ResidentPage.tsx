import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Car,
  Check,
  Copy,
  Download,
  ExternalLink,
  Plus,
  QrCode,
  Search,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Spinner,
  Stat,
  statusTone,
} from "../components/ui";
import { useEventStream } from "../hooks/useEventStream";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { formatDateTime, toDateTimeLocal, titleCase } from "../lib/format";
import type { ApproveResponse, Availability, Invitation, Page } from "../lib/types";

const schema = z.object({
  visitor_name: z.string().min(2, "Enter the visitor's name"),
  visitor_phone: z.string().optional(),
  vehicle_registration: z.string().optional(),
  vehicle_category: z.enum(["FOUR_WHEELER", "TWO_WHEELER", "EV", "OVERSIZED"]),
  visitor_type: z.enum([
    "GUEST",
    "DELIVERY",
    "CAB",
    "MAINTENANCE",
    "SERVICE_TECHNICIAN",
    "BUSINESS",
    "EMERGENCY",
  ]),
  purpose: z.string().optional(),
  expected_arrival: z.string().min(1, "Select an arrival time"),
  expected_departure: z.string().min(1, "Select a departure time"),
});

type FormValues = z.infer<typeof schema>;

function defaults(): FormValues {
  const arrival = new Date(Date.now() + 30 * 60_000);
  const departure = new Date(arrival.getTime() + 2 * 60 * 60_000);
  return {
    visitor_name: "",
    visitor_phone: "",
    vehicle_registration: "",
    vehicle_category: "FOUR_WHEELER",
    visitor_type: "GUEST",
    purpose: "",
    expected_arrival: toDateTimeLocal(arrival),
    expected_departure: toDateTimeLocal(departure),
  };
}

function QrImage({ value, visitorName }: { value: string; visitorName: string }) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(value, {
      margin: 2,
      width: 360,
      color: { dark: "#18181b", light: "#ffffff" },
    }).then((url) => {
      if (live) setSource(url);
    });
    return () => {
      live = false;
    };
  }, [value]);

  function download() {
    if (!source) return;
    const link = document.createElement("a");
    link.href = source;
    link.download = `parkvanta-pass-${visitorName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "qr"}.png`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-xl border border-border bg-white p-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {source ? (
          <img src={source} alt="Visitor QR pass" className="h-44 w-44" />
        ) : (
          <div className="h-44 w-44 animate-pulse rounded-lg bg-surface-subtle" />
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={download} disabled={!source} className="w-full">
        <Download className="h-3.5 w-3.5" /> Download QR PNG
      </Button>
    </div>
  );
}

const STATUS_FILTERS = ["ALL", "PENDING", "APPROVED", "COMPLETED"] as const;

export function ResidentPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<ApproveResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: () => api<Page<Invitation>>("/invitations?limit=50"),
  });

  const availability = useQuery({
    queryKey: ["availability", user?.property_id],
    queryFn: () => api<Availability>(`/parking/availability?property_id=${user?.property_id}`),
  });

  const live = useEventStream(user?.property_id, () => {
    void queryClient.invalidateQueries({ queryKey: ["invitations"] });
    void queryClient.invalidateQueries({ queryKey: ["availability"] });
  });

  const createInvitation = useMutation({
    mutationFn: (values: FormValues) =>
      api<Invitation>("/invitations", {
        method: "POST",
        json: {
          ...values,
          visitor_phone: values.visitor_phone || null,
          vehicle_registration: values.vehicle_registration || null,
          purpose: values.purpose || null,
          expected_arrival: new Date(values.expected_arrival).toISOString(),
          expected_departure: new Date(values.expected_departure).toISOString(),
        },
      }),
    onSuccess: () => {
      form.reset(defaults());
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
  });

  const approve = useMutation({
    mutationFn: (invitationId: string) =>
      api<ApproveResponse>(`/invitations/${invitationId}/approve`, { method: "POST" }),
    onSuccess: (response) => {
      setIssued(response);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  const reject = useMutation({
    mutationFn: (invitationId: string) =>
      api<Invitation>(`/invitations/${invitationId}/reject`, {
        method: "POST",
        json: { reason: "Rejected by resident" },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["invitations"] }),
  });

  const cancel = useMutation({
    mutationFn: (invitationId: string) =>
      api<Invitation>(`/invitations/${invitationId}/cancel`, {
        method: "POST",
        json: { reason: "Cancelled by resident" },
      }),
    onSuccess: () => {
      setIssued(null);
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  const items = invitations.data?.items ?? [];
  const activePasses = items.filter((item) => item.status === "APPROVED").length;
  const pending = items.filter((item) => item.status === "PENDING").length;
  const filteredItems = items.filter((item) => {
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        item.visitor_name.toLowerCase().includes(q) ||
        (item.vehicle_registration ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const passUrl = issued ? `${window.location.origin}/pass/${issued.pass_token}` : "";

  async function copyLink() {
    if (!passUrl) return;
    await navigator.clipboard.writeText(passUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const mutationError = createInvitation.error ?? approve.error ?? reject.error ?? cancel.error;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Resident portal"
        title={`Welcome back, ${user?.full_name.split(" ")[0]}`}
        description="Create visitor invitations, issue single-use QR passes, and track assigned parking bays."
        actions={
          <Badge tone={live ? "teal" : "slate"} dot>
            {live ? "Live updates connected" : "Apartment access verified"}
          </Badge>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Visitor bays free"
          value={availability.data?.available ?? "—"}
          suffix="slots"
          accent="teal"
          icon={<Car className="h-4 w-4" />}
        />
        <Stat label="Active passes" value={activePasses} icon={<QrCode className="h-4 w-4" />} />
        <Stat
          label="Awaiting approval"
          value={pending}
          accent={pending ? "amber" : undefined}
          icon={<CalendarClock className="h-4 w-4" />}
        />
      </div>

      {(mutationError as Error | null) ? <ErrorNote message={(mutationError as Error).message} /> : null}

      {issued ? (
        <Card className="overflow-hidden border-accent/30">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-accent-soft/60 px-6 py-4">
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">
                Pass issued · share with visitor
              </p>
              <p className="mt-0.5 text-lg font-semibold text-ink">{issued.invitation.visitor_name}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setIssued(null)} aria-label="Dismiss pass">
              <X className="h-4 w-4" /> Dismiss
            </Button>
          </div>
          <div className="grid gap-6 p-6 md:grid-cols-[200px_1fr]">
            <div className="mx-auto md:mx-0">
              <QrImage value={passUrl} visitorName={issued.invitation.visitor_name} />
            </div>
            <div className="flex flex-col justify-between space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] font-medium text-ink-subtle">Assigned bay</p>
                  <p className="mt-0.5 text-base font-semibold text-ink">
                    {issued.parking_slot_code ?? "Pedestrian"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-ink-subtle">Expires</p>
                  <p className="mt-0.5 text-sm font-medium text-ink">
                    {formatDateTime(issued.pass_expires_at)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-ink-subtle">Vehicle</p>
                  <p className="mt-0.5 text-sm font-medium text-ink">
                    {issued.invitation.vehicle_registration ?? "No vehicle"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-ink-subtle">Visit type</p>
                  <p className="mt-0.5 text-sm font-medium text-ink">
                    {titleCase(issued.invitation.visitor_type)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-subtle p-2.5">
                <p
                  data-testid="pass-url"
                  className="min-w-0 flex-1 truncate px-1.5 font-mono text-xs text-ink-muted"
                >
                  {passUrl}
                </p>
                <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <a href={passUrl} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-3.5 w-3.5" /> Open pass
                  </Button>
                </a>
              </div>

              <p className="text-xs text-ink-subtle">
                The pass token is displayed once. Only its SHA-256 hash is persisted, and a single gate
                authorization consumes it.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card className="h-fit p-6">
          <SectionTitle
            title="New visitor invitation"
            caption="Parking is reserved automatically upon approval when a vehicle is included."
          />
          <form
            className="mt-5 grid gap-4 sm:grid-cols-2"
            onSubmit={form.handleSubmit((values) => createInvitation.mutate(values))}
          >
            <div className="sm:col-span-2">
              <Field label="Visitor name" error={form.formState.errors.visitor_name?.message} required>
                <Input
                  data-testid="visitor-name"
                  placeholder="Rahul Sharma"
                  {...form.register("visitor_name")}
                />
              </Field>
            </div>
            <Field label="Mobile" hint="optional">
              <Input placeholder="9876543210" {...form.register("visitor_phone")} />
            </Field>
            <Field label="Visitor type">
              <Select {...form.register("visitor_type")}>
                <option value="GUEST">Personal guest</option>
                <option value="DELIVERY">Delivery</option>
                <option value="CAB">Cab</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="SERVICE_TECHNICIAN">Service technician</option>
                <option value="BUSINESS">Business visitor</option>
                <option value="EMERGENCY">Emergency</option>
              </Select>
            </Field>
            <Field label="Vehicle number" hint="optional">
              <Input
                data-testid="vehicle-registration"
                placeholder="KA01AB1234"
                {...form.register("vehicle_registration")}
              />
            </Field>
            <Field label="Vehicle class">
              <Select {...form.register("vehicle_category")}>
                <option value="FOUR_WHEELER">Four wheeler</option>
                <option value="TWO_WHEELER">Two wheeler</option>
                <option value="EV">EV</option>
                <option value="OVERSIZED">Oversized</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Purpose" hint="optional">
                <Input placeholder="Family visit" {...form.register("purpose")} />
              </Field>
            </div>
            <Field label="Expected arrival" required>
              <Input type="datetime-local" {...form.register("expected_arrival")} />
            </Field>
            <Field label="Expected departure" required>
              <Input type="datetime-local" {...form.register("expected_departure")} />
            </Field>
            <div className="sm:col-span-2 pt-1">
              <Button
                data-testid="create-invitation"
                type="submit"
                className="w-full"
                disabled={createInvitation.isPending}
              >
                <Plus className="h-4 w-4" />
                {createInvitation.isPending ? "Creating…" : "Create invitation"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <SectionTitle title="Visitor history" caption="Newest invitations first" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search visitor or plate"
                  aria-label="Search visitor or plate"
                  className="h-8 w-44 pl-8 text-xs"
                />
              </div>
              <div className="flex rounded-lg border border-border bg-surface-subtle p-0.5">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setStatusFilter(filter)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                      statusFilter === filter
                        ? "bg-white text-ink shadow-xs"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {filter === "ALL" ? "All" : titleCase(filter)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {invitations.isLoading ? <Spinner label="Loading invitations" /> : null}
            {!invitations.isLoading && filteredItems.length === 0 ? (
              <EmptyState
                title={items.length === 0 ? "No invitations yet" : "No matching invitations"}
                body={
                  items.length === 0
                    ? "Create your first visitor invitation using the form."
                    : "Adjust your search or status filter."
                }
              />
            ) : null}

            {filteredItems.length > 0 ? (
              <div className="divide-y divide-border">
                {filteredItems.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{invitation.visitor_name}</p>
                        <Badge tone={statusTone(invitation.status)} dot>
                          {invitation.status}
                        </Badge>
                      </div>
                      <p className="font-mono text-xs text-ink-muted">
                        {invitation.vehicle_registration ?? "Pedestrian"} ·{" "}
                        {titleCase(invitation.visitor_type)}
                        {invitation.parking_slot_code
                          ? ` · Slot ${invitation.parking_slot_code}${invitation.parking_zone ? ` (${invitation.parking_zone})` : ""}`
                          : ""}
                      </p>
                      <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
                        <CalendarClock className="h-3.5 w-3.5 text-ink-subtle" />
                        {formatDateTime(invitation.expected_arrival)} →{" "}
                        {formatDateTime(invitation.expected_departure)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {invitation.status === "PENDING" ? (
                        <>
                          <Button
                            data-testid="approve-invitation"
                            size="sm"
                            onClick={() => approve.mutate(invitation.id)}
                            disabled={approve.isPending}
                          >
                            <QrCode className="h-3.5 w-3.5" /> Approve & issue
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => reject.mutate(invitation.id)}
                            disabled={reject.isPending}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                      {invitation.status === "APPROVED" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => cancel.mutate(invitation.id)}
                          disabled={cancel.isPending}
                        >
                          Cancel & release slot
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

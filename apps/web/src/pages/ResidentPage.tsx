import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  EmptyState,
  ErrorNote,
  Field,
  Input,
  MetricCell,
  MetricStrip,
  PageHeader,
  SegmentedTabs,
  Select,
  Spinner,
  StudioPane,
  StudioPaneHeader,
  statusTone,
} from "../components/ui";
import { useEventStream } from "../hooks/useEventStream";
import { api } from "../lib/api";
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
      color: { dark: "#111827", light: "#ffffff" },
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
      <div className="rounded-xl border border-line bg-surface p-2.5 shadow-xs">
        {source ? (
          <img src={source} alt="Visitor QR pass" className="h-40 w-40" />
        ) : (
          <div className="h-40 w-40 animate-pulse rounded-lg bg-surface-subtle" />
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={download} disabled={!source} className="w-full">
        <Download className="h-3.5 w-3.5" />
        Download QR PNG
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

  const passUrl = issued ? `${window.location.origin}/pass/${issued.pass_token}` : "";

  async function copyLink() {
    if (!passUrl) return;
    await navigator.clipboard.writeText(passUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const items = invitations.data?.items ?? [];
  const filteredItems = items.filter((item) => {
    const matchesStatus = statusFilter === "ALL" || item.status === statusFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      item.visitor_name.toLowerCase().includes(query) ||
      (item.vehicle_registration ?? "").toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });

  const pending = items.filter((item) => item.status === "PENDING").length;
  const activePasses = items.filter((item) => item.status === "APPROVED").length;
  const totalAvailable = availability.data?.available ?? 0;

  const mutationError =
    createInvitation.error ?? approve.error ?? reject.error ?? cancel.error ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Resident Pass Studio"
        title="Visitor invitations & parking passes"
        description="Schedule visitor arrivals, automatically hold community guest bays, and distribute cryptographic QR credentials."
        action={
          <Badge tone={live ? "ok" : "neutral"} dot>
            {live ? "Live updates" : "Synced"}
          </Badge>
        }
      />

      {/* Compact Horizontal Summary Strip */}
      <MetricStrip className="sm:grid-cols-3 xl:grid-cols-3">
        <MetricCell
          label="Available visitor bays"
          value={totalAvailable}
          tone={totalAvailable > 0 ? "ok" : "warn"}
          sub={
            availability.data
              ? Object.entries(availability.data.by_category)
                  .map(([cat, counts]) => `${titleCase(cat)}: ${counts.AVAILABLE ?? 0}`)
                  .join(" · ") || "No bays configured"
              : "Checking bay pool"
          }
        />
        <MetricCell
          label="Active passes"
          value={activePasses}
          tone="accent"
          sub="Approved for gate entry"
        />
        <MetricCell
          label="Awaiting approval"
          value={pending}
          tone={pending ? "warn" : "neutral"}
          sub="Needs QR issuance"
        />
      </MetricStrip>

      {(mutationError as Error | null) ? (
        <ErrorNote message={(mutationError as Error).message} />
      ) : null}

      {/* Issued Pass Spotlight Studio */}
      {issued ? (
        <StudioPane className="border-accent-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-accent-soft/60 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <Badge tone="accent" dot>
                Pass issued
              </Badge>
              <span className="text-sm font-semibold text-ink">
                {issued.invitation.visitor_name}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIssued(null)}
              aria-label="Dismiss pass"
            >
              <X className="h-4 w-4" />
              Dismiss
            </Button>
          </div>

          <div className="grid gap-6 p-5 md:grid-cols-[200px_1fr]">
            <div className="studio-stage flex items-center justify-center rounded-xl border border-line p-4">
              <QrImage value={passUrl} visitorName={issued.invitation.visitor_name} />
            </div>

            <div className="flex flex-col justify-between gap-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border border-line bg-surface-subtle px-3 py-2.5">
                  <p className="text-[11px] font-medium text-ink-subtle">Assigned bay</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
                    {issued.parking_slot_code ?? "Pedestrian"}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-surface-subtle px-3 py-2.5">
                  <p className="text-[11px] font-medium text-ink-subtle">Expires</p>
                  <p className="mt-0.5 text-xs font-medium text-ink">
                    {formatDateTime(issued.pass_expires_at)}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-surface-subtle px-3 py-2.5">
                  <p className="text-[11px] font-medium text-ink-subtle">Vehicle</p>
                  <p className="mt-0.5 font-mono text-xs font-medium text-ink">
                    {issued.invitation.vehicle_registration ?? "No vehicle"}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-surface-subtle px-3 py-2.5">
                  <p className="text-[11px] font-medium text-ink-subtle">Visit type</p>
                  <p className="mt-0.5 text-xs font-medium text-ink">
                    {titleCase(issued.invitation.visitor_type)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-subtle p-2">
                  <p
                    data-testid="pass-url"
                    className="min-w-0 flex-1 truncate px-2 font-mono text-xs text-ink-muted"
                  >
                    {passUrl}
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
                    {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  <a href={passUrl} target="_blank" rel="noreferrer">
                    <Button variant="subtle" size="sm">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open pass
                    </Button>
                  </a>
                </div>
                <p className="text-xs text-ink-subtle">
                  This single-use link contains the cryptographic pass token. Gate clearance
                  consumes the token and links the bay occupancy record.
                </p>
              </div>
            </div>
          </div>
        </StudioPane>
      ) : null}

      {/* 2-Pane Pass Builder + Invitations Table */}
      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        {/* Left Pass Builder Workbench */}
        <StudioPane className="h-fit">
          <StudioPaneHeader
            title="New visitor pass"
            subtitle="Reserve bay capacity on approval"
          />
          <form
            className="divide-y divide-line"
            onSubmit={form.handleSubmit((values) => createInvitation.mutate(values))}
          >
            <div className="space-y-3.5 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                1. Visitor identity
              </p>
              <Field
                label="Visitor name"
                error={form.formState.errors.visitor_name?.message}
              >
                <Input
                  data-testid="visitor-name"
                  placeholder="Rahul Sharma"
                  {...form.register("visitor_name")}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Mobile" hint="Optional">
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
              </div>
              <Field label="Purpose" hint="Optional">
                <Input placeholder="Family visit" {...form.register("purpose")} />
              </Field>
            </div>

            <div className="space-y-3.5 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                2. Vehicle & bay class
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vehicle number" hint="Optional">
                  <Input
                    data-testid="vehicle-registration"
                    placeholder="KA01AB1234"
                    className="font-mono uppercase"
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
              </div>
            </div>

            <div className="space-y-3.5 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                3. Visit window
              </p>
              <Field label="Expected arrival">
                <Input type="datetime-local" {...form.register("expected_arrival")} />
              </Field>
              <Field label="Expected departure">
                <Input type="datetime-local" {...form.register("expected_departure")} />
              </Field>
            </div>

            <div className="bg-surface-subtle px-5 py-4">
              <Button
                data-testid="create-invitation"
                type="submit"
                className="w-full"
                disabled={createInvitation.isPending}
              >
                <Plus className="h-4 w-4" />
                {createInvitation.isPending ? "Creating invitation…" : "Create invitation"}
              </Button>
            </div>
          </form>
        </StudioPane>

        {/* Right Invitations Table Ledger */}
        <StudioPane className="min-w-0">
          <StudioPaneHeader
            title="Invitation ledger"
            subtitle="Newest visitor requests first"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search visitor or plate"
                    aria-label="Search visitor or plate"
                    className="h-8 w-44 pl-8 text-xs"
                  />
                </div>
                <SegmentedTabs
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={STATUS_FILTERS.map((f) => ({
                    value: f,
                    label: f === "ALL" ? "All" : titleCase(f),
                  }))}
                />
              </div>
            }
          />

          <div className="overflow-x-auto">
            {invitations.isLoading ? (
              <div className="p-6">
                <Spinner label="Loading invitations…" />
              </div>
            ) : !filteredItems.length ? (
              <div className="p-6">
                <EmptyState
                  title={items.length === 0 ? "No invitations yet" : "No matching invitations"}
                  body={
                    items.length === 0
                      ? "Create your first visitor invitation in the pass builder on the left."
                      : "Adjust your search or status filter."
                  }
                />
              </div>
            ) : (
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    <th className="px-5 py-2.5">Visitor</th>
                    <th className="py-2.5 pr-4">Vehicle & Bay</th>
                    <th className="py-2.5 pr-4">Schedule</th>
                    <th className="py-2.5 pr-4">Status</th>
                    <th className="py-2.5 pr-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredItems.map((invitation) => (
                    <tr key={invitation.id} className="hover:bg-surface-subtle/60">
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-ink">{invitation.visitor_name}</p>
                        <p className="mt-0.5 text-xs text-ink-subtle">
                          {titleCase(invitation.visitor_type)}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4">
                        <p className="font-mono text-xs font-medium text-ink">
                          {invitation.vehicle_registration ?? "Pedestrian"}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-subtle">
                          {invitation.parking_slot_code
                            ? `Slot ${invitation.parking_slot_code}${invitation.parking_zone ? ` (${invitation.parking_zone})` : ""}`
                            : "No bay"}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4 text-xs text-ink-muted tabular">
                        <p>{formatDateTime(invitation.expected_arrival)}</p>
                        <p className="text-ink-subtle">
                          to {formatDateTime(invitation.expected_departure)}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4">
                        <Badge tone={statusTone(invitation.status)} dot>
                          {invitation.status}
                        </Badge>
                      </td>
                      <td className="py-3.5 pr-5 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          {invitation.status === "PENDING" ? (
                            <>
                              <Button
                                data-testid="approve-invitation"
                                size="sm"
                                onClick={() => approve.mutate(invitation.id)}
                                disabled={approve.isPending}
                              >
                                <QrCode className="h-3.5 w-3.5" />
                                Approve & issue
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </StudioPane>
      </div>
    </div>
  );
}

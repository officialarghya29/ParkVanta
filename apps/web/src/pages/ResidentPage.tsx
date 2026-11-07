import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Car, Check, Copy, ExternalLink, Plus, QrCode, X } from "lucide-react";
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
  SectionTitle,
  Select,
  Spinner,
  Stat,
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

function QrImage({ value }: { value: string }) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(value, {
      margin: 1,
      width: 360,
      color: { dark: "#061018", light: "#ffffff" },
    }).then((url) => {
      if (live) setSource(url);
    });
    return () => {
      live = false;
    };
  }, [value]);

  return source ? (
    <img src={source} alt="Visitor QR pass" className="h-56 w-56 rounded-xl bg-white p-2" />
  ) : (
    <div className="h-56 w-56 animate-pulse rounded-xl bg-white/10" />
  );
}

export function ResidentPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<ApproveResponse | null>(null);
  const [copied, setCopied] = useState(false);

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
  const passUrl = issued ? `${window.location.origin}/pass/${issued.pass_token}` : "";

  async function copyLink() {
    if (!passUrl) return;
    await navigator.clipboard.writeText(passUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const mutationError = createInvitation.error ?? approve.error ?? reject.error ?? cancel.error;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.24em] text-teal-bright uppercase">
            Resident control
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">
            Good to see you, {user?.full_name.split(" ")[0]}.
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Issue a visitor pass, approve access, and see exactly where the vehicle will park.
          </p>
        </div>
        <Badge tone={live ? "teal" : "slate"}>
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-teal-bright" : "bg-slate-500"}`} />
          {live ? "Live updates on" : "Apartment access verified"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Visitor bays free" value={availability.data?.available ?? "—"} suffix="slots" accent="teal" />
        <Stat label="Active passes" value={activePasses} />
        <Stat label="Awaiting approval" value={pending} accent={pending ? "amber" : undefined} />
      </div>

      {(mutationError as Error | null) ? <ErrorNote message={(mutationError as Error).message} /> : null}

      {issued ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-6 py-4">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-teal-bright uppercase">
                Pass issued · show to the guard
              </p>
              <p className="mt-1 text-lg font-semibold text-white">{issued.invitation.visitor_name}</p>
            </div>
            <Button variant="ghost" onClick={() => setIssued(null)} aria-label="Dismiss pass">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-6 p-6 md:grid-cols-[auto_1fr]">
            <div className="mx-auto md:mx-0">
              <QrImage value={passUrl} />
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">Slot</p>
                  <p className="mt-1 text-lg text-white">{issued.parking_slot_code ?? "No vehicle"}</p>
                </div>
                <div>
                  <p className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">Expires</p>
                  <p className="mt-1 text-white">{formatDateTime(issued.pass_expires_at)}</p>
                </div>
                <div>
                  <p className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">Vehicle</p>
                  <p className="mt-1 text-white">
                    {issued.invitation.vehicle_registration ?? "Pedestrian visitor"}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">Type</p>
                  <p className="mt-1 text-white">{titleCase(issued.invitation.visitor_type)}</p>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-abyss-soft/70 p-3">
                <p data-testid="pass-url" className="truncate font-mono text-[11px] text-slate-400">
                  {passUrl}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={copyLink}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy pass link"}
                </Button>
                <a href={passUrl} target="_blank" rel="noreferrer">
                  <Button variant="ghost">
                    <ExternalLink className="h-4 w-4" /> Open visitor view
                  </Button>
                </a>
              </div>
              <p className="text-xs text-slate-500">
                The token is shown once. Only its SHA-256 hash is stored, and a single scan consumes it.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="p-6">
          <SectionTitle
            title="Issue a visitor pass"
            caption="Parking is reserved automatically on approval when a vehicle is attached."
          />
          <form
            className="mt-5 grid gap-4 sm:grid-cols-2"
            onSubmit={form.handleSubmit((values) => createInvitation.mutate(values))}
          >
            <Field label="Visitor name" error={form.formState.errors.visitor_name?.message}>
              <Input
                data-testid="visitor-name"
                placeholder="Rahul Sharma"
                {...form.register("visitor_name")}
              />
            </Field>
            <Field label="Mobile" hint="optional">
              <Input placeholder="9876543210" {...form.register("visitor_phone")} />
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
            <Field label="Purpose" hint="optional">
              <Input placeholder="Family visit" {...form.register("purpose")} />
            </Field>
            <Field label="Expected arrival">
              <Input type="datetime-local" {...form.register("expected_arrival")} />
            </Field>
            <Field label="Expected departure">
              <Input type="datetime-local" {...form.register("expected_departure")} />
            </Field>
            <div className="sm:col-span-2">
              <Button
                data-testid="create-invitation"
                type="submit"
                className="w-full sm:w-auto"
                disabled={createInvitation.isPending}
              >
                <Plus className="h-4 w-4" />
                {createInvitation.isPending ? "Creating…" : "Create invitation"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-6">
          <SectionTitle title="Visitor history" caption="Newest first" />
          <div className="mt-5 space-y-3">
            {invitations.isLoading ? <Spinner /> : null}
            {!invitations.isLoading && items.length === 0 ? (
              <EmptyState title="No visitors yet" body="Create your first invitation to see it here." />
            ) : null}
            {items.map((invitation) => (
              <div
                key={invitation.id}
                className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{invitation.visitor_name}</p>
                    <p className="font-mono text-[11px] tracking-wide text-slate-500">
                      {invitation.vehicle_registration ?? "No vehicle"} ·{" "}
                      {titleCase(invitation.visitor_type)}
                    </p>
                  </div>
                  <Badge tone={statusTone(invitation.status)}>{invitation.status}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                  <CalendarClock className="h-3.5 w-3.5 text-teal/70" />
                  {formatDateTime(invitation.expected_arrival)} →{" "}
                  {formatDateTime(invitation.expected_departure)}
                </div>
                {invitation.parking_slot_code ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-teal-bright">
                    <Car className="h-3.5 w-3.5" />
                    Slot {invitation.parking_slot_code}
                    {invitation.parking_zone ? ` · ${invitation.parking_zone}` : ""}
                  </p>
                ) : null}
                {invitation.status === "PENDING" ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      data-testid="approve-invitation"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => approve.mutate(invitation.id)}
                      disabled={approve.isPending}
                    >
                      <QrCode className="h-3.5 w-3.5" /> Approve & issue
                    </Button>
                    <Button
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => reject.mutate(invitation.id)}
                      disabled={reject.isPending}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
                {invitation.status === "APPROVED" ? (
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => cancel.mutate(invitation.id)}
                      disabled={cancel.isPending}
                    >
                      Cancel & release slot
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

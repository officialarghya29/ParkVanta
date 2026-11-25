import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Car, Gauge, ShieldCheck } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  Spinner,
  Stat,
  statusTone,
} from "../components/ui";
import { useEventStream } from "../hooks/useEventStream";
import { api } from "../lib/api";
import { formatDateTime, formatTime, titleCase } from "../lib/format";
import type {
  GateEvent,
  OverstayRow,
  Overview,
  Page,
  Property,
  Reservation,
  Slot,
  TrendPoint,
  UtilizationRow,
} from "../lib/types";

const SLOT_TONE: Record<string, string> = {
  AVAILABLE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  RESERVED: "border-amber-200 bg-amber-50 text-amber-800",
  OCCUPIED: "border-sky-200 bg-sky-50 text-sky-800",
  BLOCKED: "border-red-200 bg-red-50 text-red-800",
  MAINTENANCE: "border-border bg-surface-subtle text-ink-muted",
};

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const properties = useQuery({
    queryKey: ["properties"],
    queryFn: () => api<Property[]>("/properties"),
  });
  const propertyId = user?.property_id ?? properties.data?.[0]?.id;
  const property = properties.data?.find((item) => item.id === propertyId);

  const live = useEventStream(propertyId, () => {
    void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    void queryClient.invalidateQueries({ queryKey: ["slots"] });
    void queryClient.invalidateQueries({ queryKey: ["reservations"] });
    void queryClient.invalidateQueries({ queryKey: ["gate"] });
  });

  const overview = useQuery({
    queryKey: ["analytics", "overview", propertyId],
    queryFn: () => api<Overview>(`/analytics/overview?property_id=${propertyId}`),
    enabled: Boolean(propertyId),
    refetchInterval: live ? 60_000 : 20_000,
  });
  const utilization = useQuery({
    queryKey: ["analytics", "utilization", propertyId],
    queryFn: () =>
      api<UtilizationRow[]>(`/analytics/parking-utilization?property_id=${propertyId}`),
    enabled: Boolean(propertyId),
  });
  const trends = useQuery({
    queryKey: ["analytics", "trends", propertyId],
    queryFn: () => api<TrendPoint[]>(`/analytics/visitor-trends?property_id=${propertyId}&days=14`),
    enabled: Boolean(propertyId),
  });
  const slots = useQuery({
    queryKey: ["slots", propertyId],
    queryFn: () => api<Page<Slot>>(`/parking/slots?property_id=${propertyId}&limit=200`),
    enabled: Boolean(propertyId),
  });
  const reservations = useQuery({
    queryKey: ["reservations", propertyId],
    queryFn: () =>
      api<Page<Reservation>>(
        `/parking/reservations?property_id=${propertyId}&status=ACTIVE&limit=8`,
      ),
    enabled: Boolean(propertyId),
  });
  const overstays = useQuery({
    queryKey: ["analytics", "overstays", propertyId],
    queryFn: () => api<OverstayRow[]>(`/analytics/overstays?property_id=${propertyId}`),
    enabled: Boolean(propertyId),
  });
  const activity = useQuery({
    queryKey: ["gate", "recent"],
    queryFn: () => api<GateEvent[]>("/gate/recent-activity?limit=8"),
    refetchInterval: live ? 60_000 : 20_000,
  });

  if (!propertyId) {
    return (
      <Card className="p-8">
        <SectionTitle
          title="No property assigned"
          caption="Platform owner accounts need an explicit property context for operations."
        />
      </Card>
    );
  }

  const data = overview.data;
  const chartData = (trends.data ?? []).map((point) => ({
    ...point,
    label: new Date(point.day).toLocaleDateString(undefined, { day: "2-digit", month: "short" }),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations overview"
        title={property?.name ?? "Society operations"}
        description={
          [property?.address_line, property?.city].filter(Boolean).join(", ") ||
          "Live parking allocation and gate telemetry"
        }
        actions={
          <Badge tone={live ? "teal" : "slate"} dot>
            {live ? "Live telemetry" : "Refreshing every 20s"}
          </Badge>
        }
      />

      {overview.isLoading ? <Spinner label="Loading operational telemetry" /> : null}

      {data ? (
        <div data-testid="overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total capacity" value={data.total_slots} suffix="slots" />
          <Stat label="Available" value={data.available_slots} accent="teal" />
          <Stat label="Occupied" value={data.occupied_slots} />
          <Stat
            label="Utilisation"
            value={data.utilization_percent}
            suffix="%"
            accent={data.utilization_percent > 85 ? "red" : "teal"}
          />
          <Stat label="Visitors inside" value={data.visitors_inside} />
          <Stat label="Active reservations" value={data.active_reservations} accent="amber" />
          <Stat label="Invitations today" value={data.total_visitors_today} />
          <Stat
            label="Overstays"
            value={data.overstays}
            accent={data.overstays ? "red" : undefined}
          />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-6">
          <SectionTitle
            title="Visitor traffic"
            caption="Invitations vs. confirmed entries · last 14 days"
            action={<Gauge className="h-4 w-4 text-ink-subtle" />}
          />
          <div className="mt-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="invitations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f766e" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="entries" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e4e4e7" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e4e4e7",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "#18181b",
                    boxShadow: "0 4px 12px rgba(16, 24, 40, 0.08)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="invitations"
                  stroke="#0f766e"
                  fill="url(#invitations)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="entries"
                  stroke="#2563eb"
                  fill="url(#entries)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle title="Utilisation by zone" caption="Reserved + occupied vs. zone capacity" />
          <div className="mt-5 space-y-4">
            {utilization.data?.length ? (
              utilization.data.map((row) => (
                <div key={row.category}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <Car className="h-3.5 w-3.5 text-accent" />
                      {titleCase(row.category)}
                    </span>
                    <span className="tabular font-mono text-xs text-ink-muted">
                      {row.reserved + row.occupied}/{row.total} ({row.utilization_percent}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-subtle">
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${Math.min(row.utilization_percent, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No parking zones yet" />
            )}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <SectionTitle
          title="Parking bay map"
          caption={`${slots.data?.total ?? 0} bays · authoritative PostgreSQL state`}
          action={
            <div className="flex flex-wrap gap-1.5">
              {["AVAILABLE", "RESERVED", "OCCUPIED", "BLOCKED"].map((status) => (
                <Badge key={status} tone={statusTone(status)} dot>
                  {status}
                </Badge>
              ))}
            </div>
          }
        />
        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10">
          {slots.data?.items.map((slot) => (
            <div
              key={slot.id}
              className={`rounded-lg border px-2 py-2.5 text-center font-mono text-xs font-medium ${SLOT_TONE[slot.status] ?? SLOT_TONE.MAINTENANCE}`}
              title={`${titleCase(slot.category)} · ${slot.vehicle_category}`}
            >
              {slot.code}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <SectionTitle title="Active reservations" caption="Bay held, entry not yet confirmed" />
          <div className="mt-4 space-y-2.5">
            {reservations.data?.items.length ? (
              reservations.data.items.map((reservation) => (
                <div
                  key={reservation.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle/50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{reservation.visitor_name}</p>
                    <p className="font-mono text-xs text-ink-muted">
                      {reservation.slot_code} · until {formatDateTime(reservation.reserved_until)}
                    </p>
                  </div>
                  <Badge tone={statusTone(reservation.status)}>{reservation.status}</Badge>
                </div>
              ))
            ) : (
              <EmptyState title="No active reservations" />
            )}
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle
            title="Overstay watch"
            caption="Past expected departure and still inside"
            action={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          />
          <div className="mt-4 space-y-2.5">
            {overstays.data?.length ? (
              overstays.data.map((row) => (
                <div
                  key={row.occupancy_id}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
                >
                  <p className="text-sm font-semibold text-amber-950">
                    {row.visitor_name} · {row.slot_code ?? "—"}
                  </p>
                  <p className="font-mono text-xs text-amber-800">
                    {row.overdue_minutes} minutes past departure
                    {row.vehicle_registration ? ` · ${row.vehicle_registration}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <EmptyState title="Everyone is on time" />
            )}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <SectionTitle
            title="Recent gate activity"
            caption="Every decision is recorded atomically in the audit trail"
          />
          <ShieldCheck className="h-4 w-4 text-accent" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle/70 text-[11px] font-semibold tracking-wider text-ink-subtle uppercase">
                <th className="px-6 py-3">Time</th>
                <th className="py-3 pr-4">Visitor</th>
                <th className="py-3 pr-4">Direction</th>
                <th className="py-3 pr-4">Decision</th>
                <th className="py-3 pr-4">Guard</th>
                <th className="py-3 pr-6">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activity.data?.map((event) => (
                <tr key={event.id} className="hover:bg-surface-subtle/40">
                  <td className="px-6 py-3 font-mono text-xs text-ink-muted">
                    {formatTime(event.created_at)}
                  </td>
                  <td className="py-3 pr-4 font-medium text-ink">{event.visitor_name ?? "—"}</td>
                  <td className="py-3 pr-4 text-ink-muted">{titleCase(event.direction)}</td>
                  <td className="py-3 pr-4">
                    <Badge tone={statusTone(event.decision)}>{titleCase(event.decision)}</Badge>
                  </td>
                  <td className="py-3 pr-4 text-ink-muted">{event.guard_name}</td>
                  <td className="py-3 pr-6 text-xs text-ink-muted">{event.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!activity.data?.length ? (
            <div className="p-6">
              <EmptyState title="No gate activity yet" />
            </div>
          ) : null}
        </div>
      </Card>

      <p className="flex items-center gap-2 text-xs text-ink-subtle">
        <Activity className="h-3.5 w-3.5" />
        Metrics are computed from PostgreSQL; realtime stream events are advisory only.
      </p>
    </div>
  );
}

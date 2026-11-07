import { useQuery } from "@tanstack/react-query";
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
  SectionTitle,
  Spinner,
  Stat,
  statusTone,
} from "../components/ui";
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
  AVAILABLE: "border-teal/40 bg-teal/10 text-teal-bright",
  RESERVED: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  OCCUPIED: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  BLOCKED: "border-red-400/30 bg-red-500/10 text-red-200",
  MAINTENANCE: "border-white/20 bg-white/5 text-slate-300",
};

export function AdminPage() {
  const { user } = useAuth();
  const properties = useQuery({
    queryKey: ["properties"],
    queryFn: () => api<Property[]>("/properties"),
  });
  const propertyId = user?.property_id ?? properties.data?.[0]?.id;
  const property = properties.data?.find((item) => item.id === propertyId);

  const overview = useQuery({
    queryKey: ["analytics", "overview", propertyId],
    queryFn: () => api<Overview>(`/analytics/overview?property_id=${propertyId}`),
    enabled: Boolean(propertyId),
    refetchInterval: 20_000,
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
    refetchInterval: 20_000,
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.24em] text-teal-bright uppercase">
            Operations control
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">{property?.name ?? "Society"}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {[property?.address_line, property?.city].filter(Boolean).join(", ") ||
              "Live parking and gate telemetry"}
          </p>
        </div>
        <Badge tone="teal">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-bright" />
          Refreshing every 20s
        </Badge>
      </div>

      {overview.isLoading ? <Spinner label="Loading operational telemetry" /> : null}

      {data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            caption="Invitations, confirmed entries and exits · last 14 days"
            action={<Gauge className="h-4 w-4 text-teal/70" />}
          />
          <div className="mt-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="invitations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2ee6c8" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#2ee6c8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="entries" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#0a1220",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Area type="monotone" dataKey="invitations" stroke="#2ee6c8" fill="url(#invitations)" strokeWidth={2} />
                <Area type="monotone" dataKey="entries" stroke="#60a5fa" fill="url(#entries)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle title="Utilisation by zone" caption="Reserved + occupied / capacity" />
          <div className="mt-5 space-y-4">
            {utilization.data?.length ? (
              utilization.data.map((row) => (
                <div key={row.category}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-200">
                      <Car className="h-3.5 w-3.5 text-teal/70" />
                      {titleCase(row.category)}
                    </span>
                    <span className="tabular font-mono text-xs text-slate-400">
                      {row.reserved + row.occupied}/{row.total}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-teal to-teal-bright"
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
          title="Parking map"
          caption={`${slots.data?.total ?? 0} slots · live database state`}
          action={
            <div className="flex flex-wrap gap-2">
              {["AVAILABLE", "RESERVED", "OCCUPIED", "BLOCKED"].map((status) => (
                <Badge key={status} tone={statusTone(status)}>
                  {status}
                </Badge>
              ))}
            </div>
          }
        />
        <div className="mt-5 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10">
          {slots.data?.items.map((slot) => (
            <div
              key={slot.id}
              className={`rounded-lg border px-2 py-3 text-center font-mono text-[11px] ${SLOT_TONE[slot.status] ?? SLOT_TONE.MAINTENANCE}`}
              title={`${titleCase(slot.category)} · ${slot.vehicle_category}`}
            >
              {slot.code}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <SectionTitle title="Active reservations" caption="Slot held, entry not yet confirmed" />
          <div className="mt-4 space-y-3">
            {reservations.data?.items.length ? (
              reservations.data.items.map((reservation) => (
                <div
                  key={reservation.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
                >
                  <div>
                    <p className="text-sm text-white">{reservation.visitor_name}</p>
                    <p className="font-mono text-[11px] text-slate-500">
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
            caption="Past expected departure, still inside"
            action={<AlertTriangle className="h-4 w-4 text-amber-300" />}
          />
          <div className="mt-4 space-y-3">
            {overstays.data?.length ? (
              overstays.data.map((row) => (
                <div
                  key={row.occupancy_id}
                  className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3"
                >
                  <p className="text-sm text-white">
                    {row.visitor_name} · {row.slot_code ?? "—"}
                  </p>
                  <p className="font-mono text-[11px] text-amber-200/80">
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

      <Card className="p-6">
        <SectionTitle
          title="Gate activity"
          caption="Every decision is written to the audit trail"
          action={<ShieldCheck className="h-4 w-4 text-teal/70" />}
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">
                <th className="py-2 pr-4 font-normal">Time</th>
                <th className="py-2 pr-4 font-normal">Visitor</th>
                <th className="py-2 pr-4 font-normal">Direction</th>
                <th className="py-2 pr-4 font-normal">Decision</th>
                <th className="py-2 pr-4 font-normal">Guard</th>
                <th className="py-2 font-normal">Reason</th>
              </tr>
            </thead>
            <tbody>
              {activity.data?.map((event) => (
                <tr key={event.id} className="border-b border-white/[0.04] text-slate-300">
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-500">
                    {formatTime(event.created_at)}
                  </td>
                  <td className="py-2.5 pr-4">{event.visitor_name ?? "—"}</td>
                  <td className="py-2.5 pr-4">{titleCase(event.direction)}</td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={statusTone(event.decision)}>{titleCase(event.decision)}</Badge>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-400">{event.guard_name}</td>
                  <td className="py-2.5 text-xs text-slate-500">{event.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!activity.data?.length ? <EmptyState title="No gate activity yet" /> : null}
        </div>
      </Card>

      <p className="flex items-center gap-2 text-[11px] text-slate-600">
        <Activity className="h-3.5 w-3.5" />
        Metrics are computed from PostgreSQL; realtime pushes are advisory only.
      </p>
    </div>
  );
}

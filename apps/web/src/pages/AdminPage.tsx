import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Car, ShieldCheck } from "lucide-react";
import { useState } from "react";
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
  EmptyState,
  MetricCell,
  MetricStrip,
  PageHeader,
  SegmentedTabs,
  Spinner,
  StudioPane,
  StudioPaneHeader,
  statusTone,
} from "../components/ui";
import { useEventStream } from "../hooks/useEventStream";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
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

const SLOT_TILE_STYLE: Record<string, string> = {
  AVAILABLE: "border-ok-border bg-ok-soft/65 text-ok",
  RESERVED: "border-warn-border bg-warn-soft/75 text-warn",
  OCCUPIED: "border-accent-border bg-accent-soft text-accent",
  BLOCKED: "border-bad-border bg-bad-soft text-bad",
  MAINTENANCE: "border-line bg-surface-subtle text-ink-muted",
};

const BAY_FILTERS = ["ALL", "AVAILABLE", "RESERVED", "OCCUPIED", "BLOCKED"] as const;

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [bayFilter, setBayFilter] = useState<(typeof BAY_FILTERS)[number]>("ALL");

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
      <StudioPane className="p-8">
        <EmptyState
          title="No property assigned"
          body="Platform owner accounts need an explicit property context for operations."
        />
      </StudioPane>
    );
  }

  const data = overview.data;
  const chartData = (trends.data ?? []).map((point) => ({
    ...point,
    label: new Date(point.day).toLocaleDateString(undefined, { day: "2-digit", month: "short" }),
  }));

  const allSlots = slots.data?.items ?? [];
  const filteredSlots =
    bayFilter === "ALL" ? allSlots : allSlots.filter((slot) => slot.status === bayFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Society Operations"
        title={property?.name ?? "Operations workbench"}
        description={
          [property?.address_line, property?.city].filter(Boolean).join(", ") ||
          "Authoritative parking bay ledger and live security gate telemetry"
        }
        action={
          <Badge tone={live ? "ok" : "neutral"} dot>
            {live ? "Live telemetry" : "Refreshing every 20s"}
          </Badge>
        }
      />

      {overview.isLoading ? <Spinner label="Loading operational telemetry…" /> : null}

      {data ? (
        <MetricStrip data-testid="overview">
          <MetricCell label="Total capacity" value={data.total_slots} sub="Managed bays" />
          <MetricCell label="Available" value={data.available_slots} tone="ok" sub="Ready to assign" />
          <MetricCell label="Occupied" value={data.occupied_slots} tone="accent" sub="Vehicles parked" />
          <MetricCell
            label="Utilisation"
            value={`${data.utilization_percent}%`}
            tone={data.utilization_percent > 85 ? "bad" : "ok"}
            sub="Held + occupied"
          />
          <MetricCell label="Visitors inside" value={data.visitors_inside} sub="Active entries" />
          <MetricCell
            label="Active reservations"
            value={data.active_reservations}
            tone="warn"
            sub="Awaiting arrival"
          />
          <MetricCell label="Invitations today" value={data.total_visitors_today} sub="Scheduled" />
          <MetricCell
            label="Overstays"
            value={data.overstays}
            tone={data.overstays ? "bad" : "neutral"}
            sub={data.overstays ? "Needs follow-up" : "All on schedule"}
          />
        </MetricStrip>
      ) : null}

      {/* Main Studio Split: Primary Canvas + Right Inspector */}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {/* Interactive Parking Bay Matrix */}
          <StudioPane>
            <StudioPaneHeader
              title="Parking bay matrix"
              subtitle={`${slots.data?.total ?? 0} bays · authoritative PostgreSQL state`}
              action={
                <SegmentedTabs
                  value={bayFilter}
                  onChange={setBayFilter}
                  options={BAY_FILTERS.map((status) => ({
                    value: status,
                    label: status === "ALL" ? "All" : titleCase(status),
                    count:
                      status === "ALL"
                        ? allSlots.length
                        : allSlots.filter((s) => s.status === status).length,
                  }))}
                />
              }
            />
            <div className="p-5">
              {filteredSlots.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                  {filteredSlots.map((slot) => (
                    <div
                      key={slot.id}
                      title={`${slot.code} · ${titleCase(slot.category)} · ${titleCase(slot.vehicle_category)} · ${slot.status}`}
                      className={cn(
                        "flex flex-col items-center justify-center rounded-lg border px-2 py-2.5 text-center transition",
                        SLOT_TILE_STYLE[slot.status] ?? SLOT_TILE_STYLE.MAINTENANCE,
                      )}
                    >
                      <span className="font-mono text-xs font-semibold">{slot.code}</span>
                      <span className="mt-0.5 text-[10px] font-medium opacity-80">
                        {slot.status === "AVAILABLE"
                          ? "Open"
                          : slot.status === "OCCUPIED"
                            ? "In use"
                            : titleCase(slot.status)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No bays match this filter"
                  body="Select another slot state above to inspect all community bays."
                />
              )}
            </div>
          </StudioPane>

          {/* 14-Day Traffic Chart */}
          <StudioPane>
            <StudioPaneHeader
              title="Visitor traffic"
              subtitle="Invitations issued vs. confirmed entries · last 14 days"
              action={
                <div className="flex items-center gap-3 text-[11px] font-medium text-ink-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-accent" />
                    Invitations
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-ok" />
                    Confirmed entries
                  </span>
                </div>
              }
            />
            <div className="p-5">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="#e4e6eb" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#6b7280", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#6b7280", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e4e6eb",
                        borderRadius: 10,
                        fontSize: 12,
                        color: "#111827",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="invitations"
                      stroke="#1d4ed8"
                      fill="#eff6ff"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="entries"
                      stroke="#047857"
                      fill="#ecfdf5"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </StudioPane>

          {/* Gate Activity Flat Ledger */}
          <StudioPane>
            <StudioPaneHeader
              title="Recent gate activity"
              subtitle="Atomic authorization & exit events"
              action={<ShieldCheck className="h-4 w-4 text-accent" />}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    <th className="px-5 py-2.5">Time</th>
                    <th className="py-2.5 pr-4">Visitor</th>
                    <th className="py-2.5 pr-4">Direction</th>
                    <th className="py-2.5 pr-4">Decision</th>
                    <th className="py-2.5 pr-4">Guard</th>
                    <th className="py-2.5 pr-5">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {activity.data?.map((event) => (
                    <tr key={event.id} className="hover:bg-surface-subtle/60">
                      <td className="px-5 py-3 font-mono text-xs text-ink-muted tabular">
                        {formatTime(event.created_at)}
                      </td>
                      <td className="py-3 pr-4 font-medium text-ink">
                        {event.visitor_name ?? "—"}
                      </td>
                      <td className="py-3 pr-4 text-xs font-medium text-ink-muted">
                        {titleCase(event.direction)}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={statusTone(event.decision)}>
                          {titleCase(event.decision)}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs text-ink-muted">{event.guard_name}</td>
                      <td className="py-3 pr-5 text-xs text-ink-subtle">
                        {event.reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!activity.data?.length ? (
                <div className="p-5">
                  <EmptyState title="No gate activity yet" />
                </div>
              ) : null}
            </div>
          </StudioPane>
        </div>

        {/* Right Contextual Inspector Rail */}
        <div className="space-y-6">
          <StudioPane>
            <StudioPaneHeader
              title="Overstay watch"
              subtitle="Past expected departure inside"
              action={
                <AlertTriangle
                  className={cn(
                    "h-4 w-4",
                    overstays.data?.length ? "text-bad" : "text-ink-subtle",
                  )}
                />
              }
            />
            <div className="p-4 space-y-2.5">
              {overstays.data?.length ? (
                overstays.data.map((row) => (
                  <div
                    key={row.occupancy_id}
                    className="rounded-lg border border-bad-border bg-bad-soft px-3.5 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink">{row.visitor_name}</p>
                      <span className="font-mono text-[11px] font-semibold text-bad">
                        +{row.overdue_minutes}m
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                      Bay {row.slot_code ?? "—"}
                      {row.vehicle_registration ? ` · ${row.vehicle_registration}` : ""}
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState title="Everyone is on time" />
              )}
            </div>
          </StudioPane>

          <StudioPane>
            <StudioPaneHeader
              title="Zone utilisation"
              subtitle="Reserved + occupied vs. capacity"
            />
            <div className="space-y-4 p-4">
              {utilization.data?.length ? (
                utilization.data.map((row) => (
                  <div key={row.category}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-ink">
                        <Car className="h-3.5 w-3.5 text-accent" />
                        {titleCase(row.category)}
                      </span>
                      <span className="font-mono text-[11px] text-ink-muted tabular">
                        {row.reserved + row.occupied}/{row.total} ({row.utilization_percent}%)
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
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
          </StudioPane>

          <StudioPane>
            <StudioPaneHeader
              title="Active reservations"
              subtitle="Bay held awaiting entry"
            />
            <div className="divide-y divide-line">
              {reservations.data?.items.length ? (
                reservations.data.items.map((reservation) => (
                  <div
                    key={reservation.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink">
                        {reservation.visitor_name}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-subtle">
                        {reservation.slot_code} · until {formatDateTime(reservation.reserved_until)}
                      </p>
                    </div>
                    <Badge tone={statusTone(reservation.status)}>{reservation.status}</Badge>
                  </div>
                ))
              ) : (
                <div className="p-4">
                  <EmptyState title="No active reservations" />
                </div>
              )}
            </div>
          </StudioPane>
        </div>
      </div>

      <p className="flex items-center gap-2 text-xs text-ink-subtle">
        <Activity className="h-3.5 w-3.5" />
        Metrics are computed from PostgreSQL; realtime stream events are advisory only.
      </p>
    </div>
  );
}

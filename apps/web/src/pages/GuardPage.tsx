import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  DoorOpen,
  LogOut,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  Select,
  Spinner,
  StudioPane,
  StudioPaneHeader,
  SuccessNote,
  statusTone,
} from "../components/ui";
import { useEventStream } from "../hooks/useEventStream";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { extractPassToken, formatDateTime, formatTime, titleCase } from "../lib/format";
import {
  cacheActiveVisitors,
  chunkActions,
  enqueue,
  getDeviceId,
  newClientEventId,
  readCachedVisitors,
  readQueue,
  removeQueued,
} from "../lib/offlineQueue";
import type {
  ActiveVisitor,
  ConfirmEntry,
  EntryAuthorization,
  GateEvent,
  OfflineReconcileResponse,
  VerifyResponse,
} from "../lib/types";

const scannerId = "parkvanta-qr-scanner";

export function GuardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [plate, setPlate] = useState("");
  const [verdict, setVerdict] = useState<VerifyResponse | null>(null);
  const [authorization, setAuthorization] = useState<EntryAuthorization | null>(null);
  const [entryResult, setEntryResult] = useState<ConfirmEntry | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideDirection, setOverrideDirection] = useState("ENTRY");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [cachedActive, setCachedActive] = useState<ActiveVisitor[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const flushing = useRef(false);
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);

  const live = useEventStream(user?.property_id, () => {
    void queryClient.invalidateQueries({ queryKey: ["gate"] });
  });

  const active = useQuery({
    queryKey: ["gate", "active"],
    queryFn: () => api<ActiveVisitor[]>("/gate/active-visitors"),
    enabled: online,
    refetchInterval: online ? (live ? 60_000 : 15_000) : false,
  });

  const recent = useQuery({
    queryKey: ["gate", "recent"],
    queryFn: () => api<GateEvent[]>("/gate/recent-activity?limit=8"),
    enabled: online,
    refetchInterval: online ? (live ? 60_000 : 15_000) : false,
  });

  const flushQueue = useCallback(async () => {
    const queue = await readQueue();
    if (!queue.length || !user?.property_id || flushing.current) return;
    flushing.current = true;
    setSyncing(true);
    try {
      let applied = 0;
      let duplicates = 0;
      let rejected = 0;
      const rejectionReasons: string[] = [];
      for (const batch of chunkActions(queue)) {
        const response = await api<OfflineReconcileResponse>("/gate/offline/reconcile", {
          method: "POST",
          json: { property_id: user.property_id, device_id: getDeviceId(), actions: batch },
        });
        applied += response.applied;
        duplicates += response.duplicates;
        rejected += response.rejected;
        for (const result of response.results) {
          if (result.status === "rejected") {
            rejectionReasons.push(
              `${result.action}: ${result.message ?? result.code ?? "rejected"}`,
            );
          }
        }
      }
      await removeQueued(queue.map((item) => item.client_event_id));
      setPendingCount((await readQueue()).length);
      const rejectedNote = [...new Set(rejectionReasons)].slice(0, 2).join("; ");
      setSyncMessage(
        rejected
          ? `Synced ${applied} · ${duplicates} duplicate · ${rejected} rejected${
              rejectedNote ? ` — ${rejectedNote}` : ""
            }`
          : `Synced ${applied} offline action(s)${
              duplicates ? ` · ${duplicates} already applied` : ""
            }`,
      );
      void queryClient.invalidateQueries({ queryKey: ["gate"] });
    } catch (error) {
      setSyncMessage(`Sync failed — actions retained. ${(error as Error).message}`);
    } finally {
      flushing.current = false;
      setSyncing(false);
    }
  }, [queryClient, user?.property_id]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine) {
      void readQueue().then((queue) => {
        if (queue.length) void flushQueue();
      });
    }
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flushQueue]);

  useEffect(() => {
    let mounted = true;
    void readCachedVisitors().then((cached) => {
      if (mounted) setCachedActive(cached);
    });
    void readQueue().then((queue) => {
      if (mounted) setPendingCount(queue.length);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (active.data) {
      setCachedActive(active.data);
      void cacheActiveVisitors(active.data);
    }
  }, [active.data]);

  useEffect(() => {
    return () => {
      void scannerRef.current?.stop().catch(() => undefined);
    };
  }, []);

  const verify = useMutation({
    mutationFn: () =>
      api<VerifyResponse>("/qr/verify", {
        method: "POST",
        json: { token: extractPassToken(token), plate_number: plate || null },
      }),
    onSuccess: (response) => {
      setVerdict(response);
      setAuthorization(null);
      setEntryResult(null);
    },
    onError: (error) => setScanError((error as Error).message),
  });

  const authorize = useMutation({
    mutationFn: () =>
      api<EntryAuthorization>("/gate/entry/authorize", {
        method: "POST",
        json: { token: extractPassToken(token), plate_number: plate || null },
      }),
    onSuccess: (response) => {
      setAuthorization(response);
      void queryClient.invalidateQueries({ queryKey: ["gate"] });
    },
  });

  const confirmEntry = useMutation({
    mutationFn: (invitationId: string) =>
      api<ConfirmEntry>("/gate/entry/confirm", {
        method: "POST",
        json: { invitation_id: invitationId },
      }),
    onSuccess: (response, invitationId) => {
      if (response.slot_code) {
        const enteredVisitor: ActiveVisitor = {
          invitation_id: invitationId,
          visitor_name: verdict?.visitor_name ?? authorization?.visitor_name ?? "Visitor",
          vehicle_registration: verdict?.vehicle_registration ?? null,
          slot_code: response.slot_code,
          zone_name: verdict?.parking_zone ?? null,
          entered_at: response.entered_at ?? new Date().toISOString(),
          expected_departure: verdict?.pass_expires_at ?? new Date().toISOString(),
          overstay: false,
        };
        queryClient.setQueryData<ActiveVisitor[]>(["gate", "active"], (previous) => {
          const current = previous ?? [];
          if (current.some((item) => item.invitation_id === invitationId)) return current;
          return [enteredVisitor, ...current];
        });
        setCachedActive((previous) => {
          if (previous.some((item) => item.invitation_id === invitationId)) return previous;
          const next = [enteredVisitor, ...previous];
          void cacheActiveVisitors(next);
          return next;
        });
      }
      setEntryResult(response);
      void queryClient.invalidateQueries({ queryKey: ["gate"] });
    },
  });

  const confirmExit = useMutation({
    mutationFn: (invitationId: string) =>
      api("/gate/exit/confirm", { method: "POST", json: { invitation_id: invitationId } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["gate"] }),
  });

  const override = useMutation({
    mutationFn: () =>
      api("/gate/manual-override", {
        method: "POST",
        json: {
          reason: overrideReason,
          direction: overrideDirection,
          plate_number: plate || null,
        },
      }),
    onSuccess: () => {
      setOverrideReason("");
      void queryClient.invalidateQueries({ queryKey: ["gate"] });
    },
  });

  async function startScanner() {
    setScanError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(scannerId);
      scannerRef.current = {
        stop: async () => {
          try {
            await scanner.stop();
            scanner.clear();
          } catch {
            // Already stopped.
          }
        },
      };
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (decoded) => {
          setToken(extractPassToken(decoded));
          setScanning(false);
          void scannerRef.current?.stop();
        },
        () => undefined,
      );
      setScanning(true);
    } catch {
      setScanError("Camera unavailable. Paste the pass token or URL instead.");
      setScanning(false);
    }
  }

  async function stopScanner() {
    await scannerRef.current?.stop();
    scannerRef.current = null;
    setScanning(false);
  }

  const error =
    verify.error ??
    authorize.error ??
    confirmEntry.error ??
    confirmExit.error ??
    override.error;
  const activeVisitors = active.data ?? (online ? [] : cachedActive);

  async function requestExit(visitor: ActiveVisitor) {
    if (!online) {
      try {
        await enqueue({
          client_event_id: newClientEventId(),
          action: "EXIT_CONFIRM",
          invitation_id: visitor.invitation_id,
          recorded_at: new Date().toISOString(),
        });
      } catch (err) {
        setSyncMessage(
          `Could not store the exit on this device. ${
            err instanceof Error ? err.message : "Device storage is unavailable."
          }`,
        );
        return;
      }
      setPendingCount((await readQueue()).length);
      setCachedActive((previous) =>
        previous.filter((item) => item.invitation_id !== visitor.invitation_id),
      );
      queryClient.setQueryData<ActiveVisitor[]>(["gate", "active"], (previous) =>
        previous?.filter((item) => item.invitation_id !== visitor.invitation_id),
      );
      setSyncMessage(
        "Exit queued in durable device storage. It reconciles automatically when the connection returns.",
      );
      return;
    }
    confirmExit.mutate(visitor.invitation_id);
  }

  async function queueManualOverride() {
    try {
      await enqueue({
        client_event_id: newClientEventId(),
        action: "MANUAL_OVERRIDE",
        reason: overrideReason,
        direction: overrideDirection as "ENTRY" | "EXIT",
        plate_number: plate || undefined,
        invitation_id: verdict?.invitation_id ?? undefined,
        recorded_at: new Date().toISOString(),
      });
    } catch (err) {
      setSyncMessage(
        `Could not store the override on this device. ${
          err instanceof Error ? err.message : "Device storage is unavailable."
        }`,
      );
      return;
    }
    setPendingCount((await readQueue()).length);
    setOverrideReason("");
    setSyncMessage("Manual override queued for reconciliation.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Security Checkpoint"
        title="Gate clearance desk"
        description="Verify single-use QR credentials, authorize barrier entry, and release community bays on exit."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={live ? "ok" : "neutral"} dot>
              {live ? "Live stream" : "Polling"}
            </Badge>
            <Badge tone={activeVisitors.some((visitor) => visitor.overstay) ? "warn" : "accent"} dot>
              {activeVisitors.length} vehicle{activeVisitors.length === 1 ? "" : "s"} inside
            </Badge>
          </div>
        }
      />

      {!online || pendingCount > 0 ? (
        <div
          data-testid="offline-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-border bg-warn-soft px-4 py-3"
        >
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div>
              <p className="text-sm font-medium text-ink">
                {online
                  ? `${pendingCount} gate action(s) awaiting sync`
                  : "Offline mode · cached gate state"}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Entry authorization requires network access. Exit confirmations and audited
                overrides queue safely in IndexedDB on this device.
              </p>
            </div>
          </div>
          {online && pendingCount > 0 ? (
            <Button
              data-testid="offline-sync"
              variant="secondary"
              size="sm"
              onClick={() => void flushQueue()}
              disabled={syncing}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {syncMessage ? (
        <p data-testid="offline-sync-result" className="text-xs font-medium text-ink-muted">
          {syncMessage}
        </p>
      ) : null}

      {/* Compact Horizontal Telemetry Strip */}
      <MetricStrip className="sm:grid-cols-3 xl:grid-cols-3">
        <MetricCell
          label="Inside now"
          value={activeVisitors.length}
          tone="accent"
          sub="Active vehicles on site"
        />
        <MetricCell
          label="Overstays"
          value={activeVisitors.filter((visitor) => visitor.overstay).length}
          tone={activeVisitors.some((visitor) => visitor.overstay) ? "warn" : "neutral"}
          sub="Past expected departure"
        />
        <MetricCell
          label="Logged actions"
          value={recent.data?.length ?? 0}
          sub="Recent gate ledger"
        />
      </MetricStrip>

      {/* Main 2-Pane Gate Workbench */}
      <div className="grid gap-6 xl:grid-cols-[440px_1fr]">
        {/* Left Entry Clearance Console */}
        <StudioPane className="h-fit">
          <StudioPaneHeader
            title="1. Scan or verify pass"
            subtitle="Camera QR scan, URL paste, or token"
          />

          <div className="space-y-4 p-5">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label="Pass token or URL">
                  <Input
                    data-testid="guard-token"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Paste the visitor pass link or token"
                    className="font-mono text-xs"
                  />
                </Field>
              </div>
              <Button
                variant="secondary"
                size="md"
                onClick={scanning ? () => void stopScanner() : () => void startScanner()}
              >
                <Camera className="h-4 w-4" />
                {scanning ? "Stop" : "Scan"}
              </Button>
            </div>

            {scanning ? (
              <div
                id={scannerId}
                className="overflow-hidden rounded-xl border border-line bg-surface-subtle"
              />
            ) : (
              <div id={scannerId} className="hidden" />
            )}

            {scanError ? <ErrorNote message={scanError} /> : null}

            <Field label="Observed vehicle plate" hint="Optional verification">
              <Input
                value={plate}
                onChange={(event) => setPlate(event.target.value.toUpperCase())}
                placeholder="KA01AB1234"
                className="font-mono uppercase"
              />
            </Field>

            <Button
              data-testid="guard-verify"
              className="w-full"
              onClick={() => {
                setVerdict(null);
                verify.mutate();
              }}
              disabled={!token || verify.isPending || !online}
            >
              <ScanLine className="h-4 w-4" />
              {verify.isPending ? "Verifying…" : "Verify pass"}
            </Button>

            {!online ? (
              <p className="rounded-lg border border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn">
                Entry verification requires network connectivity. Cached reads, exit confirmations,
                and audited overrides remain available offline.
              </p>
            ) : null}

            {error ? <ErrorNote message={(error as Error).message} /> : null}

            {/* Step 2 & 3 Verdict + Authorize + Confirm */}
            {verdict && verdict.reason_code ? (
              <div
                data-testid="verdict"
                className={cn(
                  "rounded-xl border p-4",
                  verdict.allowed
                    ? "border-ok-border bg-ok-soft/60"
                    : "border-bad-border bg-bad-soft/60",
                )}
              >
                <div className="flex items-start gap-3">
                  {verdict.allowed ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-bad" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                      {verdict.reason_code}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">{verdict.message}</p>
                    <div className="mt-3 grid gap-x-4 gap-y-1.5 text-xs text-ink-muted sm:grid-cols-2">
                      <span>
                        Visitor:{" "}
                        <strong className="font-medium text-ink">
                          {verdict.visitor_name ?? "—"}
                        </strong>
                      </span>
                      <span>
                        Vehicle:{" "}
                        <strong className="font-mono font-medium text-ink">
                          {verdict.vehicle_registration ?? "—"}
                        </strong>
                      </span>
                      <span>
                        Slot:{" "}
                        <strong className="font-mono font-medium text-ink">
                          {verdict.parking_slot_code ?? "—"}
                        </strong>
                      </span>
                      <span>
                        Expires:{" "}
                        <strong className="font-medium text-ink">
                          {formatDateTime(verdict.pass_expires_at)}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                {verdict.allowed && verdict.invitation_id ? (
                  <div className="mt-4 space-y-2.5 border-t border-ok-border pt-3.5">
                    {!authorization ? (
                      <Button
                        data-testid="guard-authorize"
                        className="w-full"
                        onClick={() => authorize.mutate()}
                        disabled={authorize.isPending}
                      >
                        <DoorOpen className="h-4 w-4" />
                        {authorize.isPending ? "Authorizing…" : "Authorize entry"}
                      </Button>
                    ) : (
                      <>
                        <SuccessNote
                          message={`Entry authorized at ${formatTime(authorization.authorized_at)}. Confirm physical entry below.`}
                        />
                        {!entryResult ? (
                          <Button
                            data-testid="guard-confirm-entry"
                            className="w-full"
                            variant="secondary"
                            onClick={() => confirmEntry.mutate(authorization.invitation_id)}
                            disabled={confirmEntry.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Confirm vehicle entered
                          </Button>
                        ) : (
                          <div className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink">
                            {entryResult.slot_code
                              ? `Slot ${entryResult.slot_code} is now ${entryResult.slot_status}.`
                              : "Pedestrian entry confirmed."}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </StudioPane>

        {/* Right Active Vehicles Table + Override */}
        <div className="min-w-0 space-y-6">
          <StudioPane>
            <StudioPaneHeader
              title="Vehicles inside"
              subtitle="Confirm exit to release the reserved parking bay"
              action={
                <Badge tone="neutral" className="font-mono tabular">
                  {activeVisitors.length} active
                </Badge>
              }
            />

            <div className="overflow-x-auto">
              {active.isLoading && activeVisitors.length === 0 ? (
                <div className="p-6">
                  <Spinner label="Loading vehicles inside…" />
                </div>
              ) : activeVisitors.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No vehicles inside"
                    body="Confirmed entries appear here until exit is recorded."
                  />
                </div>
              ) : (
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                      <th className="px-5 py-2.5">Visitor</th>
                      <th className="py-2.5 pr-4">Plate & Bay</th>
                      <th className="py-2.5 pr-4">Expected departure</th>
                      <th className="py-2.5 pr-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {activeVisitors.map((visitor) => (
                      <tr key={visitor.invitation_id} className="hover:bg-surface-subtle/60">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-ink">{visitor.visitor_name}</span>
                            {visitor.overstay ? <Badge tone="warn">Overstay</Badge> : null}
                          </div>
                        </td>
                        <td className="py-3.5 pr-4 font-mono text-xs text-ink-muted">
                          {visitor.vehicle_registration ?? "—"} · Slot {visitor.slot_code ?? "—"}
                        </td>
                        <td className="py-3.5 pr-4 text-xs text-ink-muted tabular">
                          {formatTime(visitor.expected_departure)}
                        </td>
                        <td className="py-3.5 pr-5 text-right">
                          <Button
                            data-testid="guard-exit"
                            variant="secondary"
                            size="sm"
                            onClick={() => void requestExit(visitor)}
                            disabled={confirmExit.isPending}
                          >
                            <LogOut className="h-3.5 w-3.5" />
                            Confirm exit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </StudioPane>

          {/* Manual Override Workbench */}
          <StudioPane>
            <StudioPaneHeader
              title="Manual override"
              subtitle="For verified exceptions only — permanently audited"
              action={
                <Badge tone="warn">
                  <ShieldAlert className="h-3 w-3" />
                  Audited
                </Badge>
              }
            />
            <div className="space-y-4 p-5">
              <Field label="Reason" hint="Minimum 10 characters">
                <Input
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="Resident confirmed by intercom"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <Field label="Direction">
                  <Select
                    value={overrideDirection}
                    onChange={(event) => setOverrideDirection(event.target.value)}
                  >
                    <option value="ENTRY">Entry</option>
                    <option value="EXIT">Exit</option>
                  </Select>
                </Field>
                <div className="flex items-end">
                  <Button
                    variant="danger"
                    className="w-full"
                    disabled={overrideReason.trim().length < 10 || override.isPending}
                    onClick={() => {
                      if (!online) {
                        void queueManualOverride();
                        return;
                      }
                      override.mutate();
                    }}
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Record override
                  </Button>
                </div>
              </div>
              {override.isSuccess ? (
                <SuccessNote message="Override recorded in the audit trail." />
              ) : null}
            </div>
          </StudioPane>
        </div>
      </div>

      {/* Bottom Gate Activity Ledger */}
      <StudioPane>
        <StudioPaneHeader
          title="Recent gate activity"
          subtitle="Newest clearance decisions first"
        />
        <div className="overflow-x-auto">
          {recent.isLoading ? (
            <div className="p-6">
              <Spinner label="Loading recent gate logs…" />
            </div>
          ) : !recent.data?.length ? (
            <div className="p-6">
              <EmptyState title="No gate activity recorded yet" />
            </div>
          ) : (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  <th className="px-5 py-2.5">Time</th>
                  <th className="py-2.5 pr-4">Visitor</th>
                  <th className="py-2.5 pr-4">Direction</th>
                  <th className="py-2.5 pr-4">Decision</th>
                  <th className="py-2.5 pr-5">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.data.map((event) => (
                  <tr key={event.id} className="hover:bg-surface-subtle/60">
                    <td className="px-5 py-3 font-mono text-xs text-ink-muted tabular">
                      {formatTime(event.created_at)}
                    </td>
                    <td className="py-3 pr-4 font-medium text-ink">
                      {event.visitor_name ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-xs text-ink-muted">
                      {titleCase(event.direction)}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={statusTone(event.decision)}>
                        {titleCase(event.decision)}
                      </Badge>
                    </td>
                    <td className="py-3 pr-5 text-xs text-ink-subtle">{event.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </StudioPane>
    </div>
  );
}

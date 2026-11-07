import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  DoorOpen,
  LogOut,
  ScanLine,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { useAuth } from "../auth/AuthContext";
import { useEventStream } from "../hooks/useEventStream";
import { api } from "../lib/api";
import { extractPassToken, formatDateTime, formatTime, titleCase } from "../lib/format";
import type {
  ActiveVisitor,
  ConfirmEntry,
  EntryAuthorization,
  GateEvent,
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
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);

  const live = useEventStream(user?.property_id, () => {
    void queryClient.invalidateQueries({ queryKey: ["gate"] });
  });

  const active = useQuery({
    queryKey: ["gate", "active"],
    queryFn: () => api<ActiveVisitor[]>("/gate/active-visitors"),
    refetchInterval: live ? 60_000 : 15_000,
  });
  const recent = useQuery({
    queryKey: ["gate", "recent"],
    queryFn: () => api<GateEvent[]>("/gate/recent-activity?limit=8"),
    refetchInterval: live ? 60_000 : 15_000,
  });

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
    onSuccess: (response) => {
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

  const error = verify.error ?? authorize.error ?? confirmEntry.error ?? confirmExit.error;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.24em] text-teal-bright uppercase">
            Gate console
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Verify. Authorize. Release.</h1>
          <p className="mt-1 text-sm text-slate-400">
            Scanning verifies the pass. Entry is only granted after an explicit authorization.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={live ? "teal" : "slate"}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-teal-bright" : "bg-slate-500"}`} />
            {live ? "Live" : "Polling"}
          </Badge>
          <Badge tone={active.data?.some((visitor) => visitor.overstay) ? "amber" : "teal"}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {active.data?.length ?? 0} vehicles inside
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Inside now" value={active.data?.length ?? "—"} accent="teal" />
        <Stat
          label="Overstays"
          value={active.data?.filter((visitor) => visitor.overstay).length ?? 0}
          accent="amber"
        />
        <Stat label="Logged actions" value={recent.data?.length ?? 0} suffix="recent" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="p-6">
          <SectionTitle title="Scan a visitor pass" caption="Camera, paste, or type the token" />
          <div className="mt-5 space-y-4">
            <div className="flex gap-2">
              <Field label="Pass token or URL">
                <Input
                  data-testid="guard-token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste the visitor link or token"
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button
                  variant="secondary"
                  onClick={scanning ? stopScanner : startScanner}
                  className="whitespace-nowrap"
                >
                  <Camera className="h-4 w-4" />
                  {scanning ? "Stop" : "Scan"}
                </Button>
              </div>
            </div>
            <div id={scannerId} className={scanning ? "scan-frame overflow-hidden rounded-xl" : "hidden"} />
            {scanError ? <ErrorNote message={scanError} /> : null}

            <Field label="Vehicle plate at gate" hint="optional, checked against the invitation">
              <Input
                value={plate}
                onChange={(event) => setPlate(event.target.value.toUpperCase())}
                placeholder="KA01AB1234"
              />
            </Field>

            <Button
              data-testid="guard-verify"
              className="w-full"
              onClick={() => {
                setVerdict(null);
                verify.mutate();
              }}
              disabled={!token || verify.isPending}
            >
              <ScanLine className="h-4 w-4" />
              {verify.isPending ? "Verifying…" : "Verify pass"}
            </Button>

            {error ? <ErrorNote message={(error as Error).message} /> : null}

            {verdict && verdict.reason_code ? (
              <div
                data-testid="verdict"
                className={`rounded-2xl border p-5 ${
                  verdict.allowed
                    ? "border-teal/30 bg-teal/[0.07]"
                    : "border-red-400/30 bg-red-500/[0.06]"
                }`}
              >
                <div className="flex items-start gap-3">
                  {verdict.allowed ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-teal-bright" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 text-red-300" />
                  )}
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-slate-400">
                      {verdict.reason_code}
                    </p>
                    <p className="mt-1 font-medium text-white">{verdict.message}</p>
                    <div className="mt-3 grid gap-x-6 gap-y-2 text-xs text-slate-300 sm:grid-cols-2">
                      <span>Visitor: {verdict.visitor_name ?? "—"}</span>
                      <span>Vehicle: {verdict.vehicle_registration ?? "—"}</span>
                      <span>Slot: {verdict.parking_slot_code ?? "—"}</span>
                      <span>Expires: {formatDateTime(verdict.pass_expires_at)}</span>
                    </div>
                  </div>
                </div>

                {verdict.allowed && verdict.invitation_id ? (
                  <div className="mt-4 space-y-2">
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
                        <div className="rounded-xl border border-teal/30 bg-teal/10 px-4 py-3 text-sm text-teal-bright">
                          Entry authorized at {formatTime(authorization.authorized_at)}. Gate control is
                          separate from authorization.
                        </div>
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
                          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
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
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionTitle title="Vehicles inside" caption="Confirm exit to release the slot" />
            <div className="mt-4 space-y-3">
              {active.isLoading ? <Spinner /> : null}
              {!active.isLoading && (active.data?.length ?? 0) === 0 ? (
                <EmptyState title="No vehicles inside" body="Confirmed entries appear here." />
              ) : null}
              {active.data?.map((visitor) => (
                <div
                  key={visitor.invitation_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"
                >
                  <div>
                    <p className="font-medium text-white">{visitor.visitor_name}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {visitor.vehicle_registration ?? "—"} · Slot {visitor.slot_code ?? "—"}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Clock className="h-3 w-3" /> due {formatTime(visitor.expected_departure)}
                      {visitor.overstay ? (
                        <Badge tone="amber" className="ml-2">
                          overstay
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    data-testid="guard-exit"
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => confirmExit.mutate(visitor.invitation_id)}
                    disabled={confirmExit.isPending}
                  >
                    <LogOut className="h-3.5 w-3.5" /> Confirm exit
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle
              title="Manual override"
              caption="For verified exceptions only — recorded permanently"
              action={
                <Badge tone="amber">
                  <ShieldAlert className="h-3 w-3" /> audited
                </Badge>
              }
            />
            <div className="mt-4 space-y-3">
              <Field label="Reason" hint="minimum 10 characters">
                <Input
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="Resident confirmed by intercom"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
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
                    onClick={() => override.mutate()}
                  >
                    <AlertTriangle className="h-4 w-4" /> Record
                  </Button>
                </div>
              </div>
              {override.isSuccess ? (
                <p className="text-xs text-teal-bright">Override recorded in the audit trail.</p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-6">
        <SectionTitle title="Recent gate activity" caption="Newest first" />
        <div className="mt-4 overflow-x-auto">
          {recent.isLoading ? <Spinner /> : null}
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">
                <th className="py-2 pr-4 font-normal">Time</th>
                <th className="py-2 pr-4 font-normal">Visitor</th>
                <th className="py-2 pr-4 font-normal">Direction</th>
                <th className="py-2 pr-4 font-normal">Decision</th>
                <th className="py-2 font-normal">Reason</th>
              </tr>
            </thead>
            <tbody>
              {recent.data?.map((event) => (
                <tr key={event.id} className="border-b border-white/[0.04] text-slate-300">
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-500">
                    {formatTime(event.created_at)}
                  </td>
                  <td className="py-2.5 pr-4">{event.visitor_name ?? "—"}</td>
                  <td className="py-2.5 pr-4">{titleCase(event.direction)}</td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={statusTone(event.decision)}>{titleCase(event.decision)}</Badge>
                  </td>
                  <td className="py-2.5 text-xs text-slate-500">{event.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

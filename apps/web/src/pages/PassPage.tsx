import { useQuery } from "@tanstack/react-query";
import { Building2, Car, Clock, MapPin, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Brand } from "../components/AppShell";
import { Badge, Card, ErrorNote, Spinner, statusTone } from "../components/ui";
import { api } from "../lib/api";
import { formatDateTime, titleCase } from "../lib/format";
import type { PassView } from "../lib/types";

export function PassPage() {
  const { token = "" } = useParams();
  const [qr, setQr] = useState<string | null>(null);

  const pass = useQuery({
    queryKey: ["public-pass", token],
    queryFn: () => api<PassView>(`/qr/pass/${token}`),
    retry: false,
  });

  useEffect(() => {
    void QRCode.toDataURL(window.location.href, {
      margin: 1,
      width: 420,
      color: { dark: "#061018", light: "#ffffff" },
    }).then(setQr);
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-xl px-5 py-8">
      <div className="flex items-center justify-between">
        <Brand />
        <Badge tone="slate">Visitor pass</Badge>
      </div>

      {pass.isLoading ? <Spinner label="Loading your pass" /> : null}
      {pass.error ? (
        <div className="mt-8 space-y-4">
          <ErrorNote message="This pass link is invalid or has been removed." />
          <p className="text-sm text-slate-500">
            Ask your host to reissue the invitation, or contact the society gate.
          </p>
        </div>
      ) : null}

      {pass.data ? (
        <div className="mt-6 space-y-5">
          <Card className="overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-6 py-5">
              <div>
                <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 uppercase">
                  Entry pass
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-white">{pass.data.visitor_name}</h1>
                <p className="mt-1 text-sm text-slate-400">
                  {titleCase(pass.data.visitor_type)} visit
                </p>
              </div>
              <Badge tone={statusTone(pass.data.status)}>{pass.data.status}</Badge>
            </div>

            <div className="flex flex-col items-center gap-4 px-6 py-8">
              {qr ? (
                <img
                  src={qr}
                  alt="Entry QR code"
                  className="h-64 w-64 rounded-2xl bg-white p-3 shadow-[0_0_60px_-20px_rgba(46,230,200,0.7)]"
                />
              ) : (
                <div className="h-64 w-64 animate-pulse rounded-2xl bg-white/10" />
              )}
              <p className="max-w-xs text-center font-mono text-[10px] leading-relaxed tracking-[0.08em] text-slate-500 uppercase">
                Show this code at the gate. One scan only.
              </p>
            </div>

            <div className="grid gap-4 border-t border-white/[0.07] px-6 py-5 sm:grid-cols-2">
              <Detail
                icon={<Building2 className="h-4 w-4" />}
                label="Society"
                value={pass.data.property_name}
                hint={pass.data.property_address}
              />
              <Detail
                icon={<MapPin className="h-4 w-4" />}
                label="Parking"
                value={pass.data.parking_slot_code ? `Slot ${pass.data.parking_slot_code}` : "Not required"}
                hint={pass.data.parking_zone ?? "Follow gate instructions"}
              />
              <Detail
                icon={<Car className="h-4 w-4" />}
                label="Vehicle"
                value={pass.data.vehicle_registration ?? "Pedestrian visitor"}
              />
              <Detail
                icon={<Clock className="h-4 w-4" />}
                label="Valid until"
                value={formatDateTime(pass.data.pass_expires_at)}
                hint={`Arrive after ${formatDateTime(pass.data.expected_arrival)}`}
              />
            </div>
          </Card>

          <div className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 text-xs text-slate-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal/70" />
            <p>
              This pass does not contain your personal details. The gate validates it server-side against
              the resident's approval, the visit window and the assigned parking slot.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Detail({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-teal/70">{icon}</span>
      <div>
        <p className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">{label}</p>
        <p className="mt-0.5 text-sm text-white">{value}</p>
        {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

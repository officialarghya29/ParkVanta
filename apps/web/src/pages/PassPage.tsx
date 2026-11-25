import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Car,
  Check,
  Clock,
  Copy,
  Download,
  MapPin,
  Printer,
  ShieldCheck,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Brand } from "../components/AppShell";
import { Badge, Button, Card, ErrorNote, Spinner, statusTone } from "../components/ui";
import { api } from "../lib/api";
import { formatDateTime, titleCase } from "../lib/format";
import type { PassView } from "../lib/types";

export function PassPage() {
  const { token = "" } = useParams();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pass = useQuery({
    queryKey: ["public-pass", token],
    queryFn: () => api<PassView>(`/qr/pass/${token}`),
    retry: false,
  });

  useEffect(() => {
    void QRCode.toDataURL(window.location.href, {
      margin: 2,
      width: 440,
      color: { dark: "#18181b", light: "#ffffff" },
    }).then(setQr);
  }, []);

  function downloadQr() {
    if (!qr) return;
    const link = document.createElement("a");
    link.href = qr;
    link.download = `parkvanta-pass-${pass.data?.visitor_name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "qr"}.png`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="no-print flex items-center justify-between">
          <Brand />
          <Badge tone="slate">Digital Visitor Pass</Badge>
        </div>

        {pass.isLoading ? (
          <Card className="mt-6 p-8">
            <Spinner label="Loading visitor pass…" />
          </Card>
        ) : null}

        {pass.error ? (
          <Card className="mt-6 p-6 space-y-3">
            <ErrorNote message="This pass link is invalid or has been removed." />
            <p className="text-sm text-ink-muted">
              Ask your host to issue a new invitation, or check with the society security desk.
            </p>
          </Card>
        ) : null}

        {pass.data ? (
          <div className="mt-6 space-y-4">
            <Card className="print-card overflow-hidden">
              {/* Credential Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-white px-6 py-5">
                <div>
                  <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">
                    Authorized entry credential
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
                    {pass.data.visitor_name}
                  </h1>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {titleCase(pass.data.visitor_type)} visit
                  </p>
                </div>
                <Badge tone={statusTone(pass.data.status)} dot>
                  {pass.data.status}
                </Badge>
              </div>

              {/* Studio QR & Details Split */}
              <div className="grid md:grid-cols-[260px_1fr]">
                <div className="flex flex-col items-center justify-center border-b border-border bg-surface-subtle/70 p-6 md:border-r md:border-b-0">
                  <div className="rounded-xl border border-border bg-white p-3 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
                    {qr ? (
                      <img
                        data-testid="pass-qr"
                        src={qr}
                        alt="Visitor entry QR code"
                        className="h-48 w-48"
                      />
                    ) : (
                      <div className="h-48 w-48 animate-pulse rounded-lg bg-surface-subtle" />
                    )}
                  </div>
                  <p className="mt-3 text-center font-mono text-[10px] font-medium tracking-wider text-ink-subtle uppercase">
                    Single-use gate scan
                  </p>
                  <div className="no-print mt-4 flex w-full flex-col gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={downloadQr}
                      disabled={!qr}
                    >
                      <Download className="h-3.5 w-3.5" /> Download QR PNG
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? "Copied" : "Copy"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => window.print()}>
                        <Printer className="h-3.5 w-3.5" /> Print
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between p-6">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Detail
                      icon={<Building2 className="h-4 w-4" />}
                      label="Society"
                      value={pass.data.property_name}
                      hint={pass.data.property_address || undefined}
                    />
                    <Detail
                      icon={<MapPin className="h-4 w-4" />}
                      label="Assigned bay"
                      value={
                        pass.data.parking_slot_code
                          ? `Slot ${pass.data.parking_slot_code}`
                          : "No bay required"
                      }
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

                  <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-border bg-surface-subtle/60 p-3.5 text-xs leading-relaxed text-ink-muted">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <p>
                      This QR contains no personal data. Gate security verifies it server-side against
                      resident approval, visit window, and reserved bay state.
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        ) : null}
      </div>
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
    <div className="flex gap-2.5">
      <span className="mt-0.5 text-accent">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-ink-subtle">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

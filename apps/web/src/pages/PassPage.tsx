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
import { useParams } from "react-router-dom";
import { Brand } from "../components/AppShell";
import {
  Badge,
  Button,
  ErrorNote,
  KeyValueRow,
  Spinner,
  StudioPane,
  StudioPaneHeader,
  statusTone,
} from "../components/ui";
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
      color: { dark: "#111827", light: "#ffffff" },
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
    <div className="min-h-screen bg-canvas">
      {/* Studio Top Utility Bar */}
      <header className="border-b border-line bg-surface print-hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Brand />
            <span className="hidden h-4 w-px bg-line sm:inline-block" />
            <span className="hidden text-xs font-medium text-ink-subtle sm:inline">
              Visitor Gate Credential
            </span>
          </div>

          {pass.data ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={copyLink}>
                {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copied" : "Copy link"}</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => window.print()} className="hidden sm:inline-flex">
                <Printer className="h-3.5 w-3.5" />
                <span>Print</span>
              </Button>
              <Button size="sm" onClick={downloadQr} disabled={!qr}>
                <Download className="h-3.5 w-3.5" />
                <span>Download QR PNG</span>
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {pass.isLoading ? (
          <StudioPane className="flex min-h-[360px] items-center justify-center">
            <Spinner label="Loading visitor pass…" />
          </StudioPane>
        ) : pass.error ? (
          <StudioPane className="mx-auto max-w-lg p-6">
            <ErrorNote
              message={
                pass.error instanceof Error
                  ? pass.error.message
                  : "This pass link is invalid or has been revoked."
              }
            />
          </StudioPane>
        ) : pass.data ? (
          <div className="grid overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-[1.15fr_1fr]">
            {/* Left Studio Stage with QR Credential */}
            <div className="studio-stage flex flex-col items-center justify-center border-b border-line p-8 sm:p-12 lg:border-b-0 lg:border-r">
              <div className="w-full max-w-[300px] rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
                <div className="flex items-center justify-between gap-2 pb-4">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    Entry QR
                  </span>
                  <Badge tone={statusTone(pass.data.pass_status ?? pass.data.status)} dot>
                    {pass.data.pass_status ?? pass.data.status}
                  </Badge>
                </div>

                <div className="scan-frame mx-auto inline-flex items-center justify-center rounded-xl border border-line bg-surface p-3">
                  {qr ? (
                    <img
                      data-testid="pass-qr"
                      src={qr}
                      alt={`Gate entry QR pass for ${pass.data.visitor_name}`}
                      className="h-52 w-52 rounded-lg"
                    />
                  ) : (
                    <div className="flex h-52 w-52 items-center justify-center">
                      <Spinner label="Rendering QR…" />
                    </div>
                  )}
                </div>

                <div className="mt-4 border-t border-line pt-3">
                  <p className="text-base font-semibold tracking-tight text-ink">
                    {pass.data.visitor_name}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {titleCase(pass.data.visitor_type)} visit
                  </p>
                </div>
              </div>

              <p className="mt-4 text-center text-xs text-ink-subtle print-hidden">
                Present this QR code to the security desk upon arrival.
              </p>
            </div>

            {/* Right Specification Inspector */}
            <div className="flex flex-col justify-between bg-surface">
              <div>
                <StudioPaneHeader
                  title="Credential Specification"
                  subtitle="Cryptographically signed entry authorization"
                  action={
                    <Badge tone={statusTone(pass.data.status)}>{pass.data.status}</Badge>
                  }
                />

                <div className="divide-y divide-line px-5 py-2">
                  <KeyValueRow
                    label="Society"
                    value={
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-ink-subtle" />
                        <span>{pass.data.property_name}</span>
                      </span>
                    }
                  />
                  {pass.data.property_address ? (
                    <KeyValueRow label="Address" value={pass.data.property_address} />
                  ) : null}
                  <KeyValueRow
                    label="Parking bay"
                    value={
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-ink-subtle" />
                        <span>
                          {pass.data.parking_slot_code
                            ? `Slot ${pass.data.parking_slot_code}${pass.data.parking_zone ? ` (${pass.data.parking_zone})` : ""}`
                            : "No bay required"}
                        </span>
                      </span>
                    }
                  />
                  <KeyValueRow
                    label="Vehicle"
                    mono
                    value={
                      <span className="inline-flex items-center gap-1.5">
                        <Car className="h-3.5 w-3.5 text-ink-subtle" />
                        <span>{pass.data.vehicle_registration ?? "Pedestrian visitor"}</span>
                      </span>
                    }
                  />
                  <KeyValueRow
                    label="Expected arrival"
                    value={formatDateTime(pass.data.expected_arrival)}
                  />
                  <KeyValueRow
                    label="Expected departure"
                    value={formatDateTime(pass.data.expected_departure)}
                  />
                  <KeyValueRow
                    label="Pass expires"
                    value={
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-ink-subtle" />
                        <span>{formatDateTime(pass.data.pass_expires_at)}</span>
                      </span>
                    }
                  />
                </div>
              </div>

              <div className="border-t border-line bg-surface-subtle px-5 py-4">
                <div className="flex items-start gap-2.5 text-xs text-ink-muted">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <p>
                    Valid for single entry during the scheduled arrival window. Guards verify the
                    token signature and release the reserved parking bay on exit.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

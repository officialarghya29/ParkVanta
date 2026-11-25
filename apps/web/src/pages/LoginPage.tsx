import { ArrowRight, KeyRound, QrCode, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { homeRouteFor, useAuth } from "../auth/AuthContext";
import { Brand } from "../components/AppShell";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { cn } from "../lib/cn";

const DEMO_MODE = import.meta.env.DEV;
const DEMO_PASSWORD = "ParkVanta@2026";
const DEMO_ACCOUNTS = [
  { email: "resident@skyline.dev", label: "Resident", detail: "Issue & approve visitor passes", icon: QrCode },
  { email: "guard@skyline.dev", label: "Gate guard", detail: "Scan passes & release bays", icon: ShieldCheck },
  { email: "admin@skyline.dev", label: "Society admin", detail: "Manage inventory & audit log", icon: Users },
];

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEMO_MODE ? "resident@skyline.dev" : "");
  const [password, setPassword] = useState(DEMO_MODE ? DEMO_PASSWORD : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await signIn(email, password);
      navigate(homeRouteFor(user.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-3 text-xs">
            <span className="hidden text-ink-subtle sm:inline">Moving into a society?</span>
            <Link
              to="/register"
              className="rounded-full border border-line-strong bg-surface px-3.5 py-1.5 font-medium text-ink transition hover:bg-surface-subtle"
            >
              Claim resident unit
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6">
        <div className="grid w-full overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-[1.15fr_1fr]">
          {/* Left Studio Form Pane */}
          <div className="p-6 sm:p-10">
            <div className="max-w-md">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                Workspace Sign In
              </p>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">
                Sign in to ParkVanta
              </h1>
              <p className="mt-1.5 text-sm text-ink-muted">
                Access your resident pass studio, security gate desk, or society management console.
              </p>

              <form onSubmit={submit} className="mt-7 space-y-4">
                <Field label="Email address">
                  <Input
                    data-testid="login-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@community.org"
                  />
                </Field>

                <Field label="Password">
                  <Input
                    data-testid="login-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>

                {error ? <ErrorNote message={error} /> : null}

                <div className="flex items-center justify-between pt-1">
                  <Link
                    to="/forgot-password"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-accent"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Forgot password?
                  </Link>
                  <Button data-testid="login-submit" type="submit" size="lg" disabled={busy}>
                    <span>{busy ? "Signing in…" : "Continue"}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </div>
          </div>

          {/* Right Editorial & Role Context Pane */}
          <div className="flex flex-col justify-between border-t border-line bg-surface-subtle p-6 sm:p-10 lg:border-l lg:border-t-0">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                {DEMO_MODE ? "Development Role Presets" : "Unified Community Access"}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {DEMO_MODE
                  ? `Select a seeded Skyline Heights workspace account (password: ${DEMO_PASSWORD}).`
                  : "Every role shares one real-time parking ledger—from resident QR generation to offline-resilient gate clearance."}
              </p>

              {DEMO_MODE ? (
                <div className="mt-5 space-y-2">
                  {DEMO_ACCOUNTS.map((account) => {
                    const Icon = account.icon;
                    const selected = email === account.email;
                    return (
                      <button
                        key={account.email}
                        type="button"
                        onClick={() => {
                          setEmail(account.email);
                          setPassword(DEMO_PASSWORD);
                          setError(null);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition",
                          selected
                            ? "border-accent bg-surface ring-1 ring-accent/25"
                            : "border-line bg-surface hover:border-line-strong",
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                            selected
                              ? "bg-accent text-white"
                              : "bg-surface-subtle text-ink-muted",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-ink">{account.label}</span>
                            <span className="truncate font-mono text-[11px] text-ink-subtle">
                              {account.email}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-ink-subtle">{account.detail}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <dl className="mt-6 space-y-3 border-t border-line pt-5 text-xs">
                  <div className="flex items-start gap-2.5">
                    <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <div>
                      <dt className="font-semibold text-ink">Resident Pass Studio</dt>
                      <dd className="text-ink-subtle">Instant visitor QR credentials with bay allocation.</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <div>
                      <dt className="font-semibold text-ink">Resilient Gate Desk</dt>
                      <dd className="text-ink-subtle">Cryptographic verification with offline exit reconciliation.</dd>
                    </div>
                  </div>
                </dl>
              )}
            </div>

            <div className="mt-8 border-t border-line pt-4 text-[11px] text-ink-subtle">
              HttpOnly session cookie authentication · Tenant-isolated society ledgers
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

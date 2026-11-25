import { ArrowRight, CheckCircle2, Lock, QrCode, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { homeRouteFor, useAuth } from "../auth/AuthContext";
import { Brand } from "../components/AppShell";
import { Button, Card, ErrorNote, Field, Input } from "../components/ui";

const DEMO_MODE = import.meta.env.DEV;
const DEMO_PASSWORD = "ParkVanta@2026";
const DEMO_ACCOUNTS = [
  { email: "resident@skyline.dev", label: "Resident", detail: "Invite and approve visitors" },
  { email: "guard@skyline.dev", label: "Gate guard", detail: "Scan, authorize, release" },
  { email: "admin@skyline.dev", label: "Society admin", detail: "Operations & inventory" },
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
    setBusy(true);
    setError(null);
    try {
      const user = await signIn(email, password);
      navigate(homeRouteFor(user.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_0.95fr]">
      <div className="hidden flex-col justify-between border-r border-border bg-white p-12 lg:flex">
        <Brand />

        <div className="max-w-lg">
          <p className="text-xs font-semibold tracking-wider text-accent uppercase">
            Residential Gate & Parking Ledger
          </p>
          <h1 className="mt-4 text-4xl leading-[1.15] font-semibold tracking-tight text-ink">
            Every visitor verified.
            <br />
            Every bay accounted for.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
            Single-use QR entry passes, transactional parking slot reservation, and an auditable
            gate console built for residential societies.
          </p>

          <div className="mt-8 space-y-3 border-t border-border pt-6">
            {[
              {
                icon: QrCode,
                title: "Single-use capability passes",
                detail: "256-bit CSPRNG tokens hashed at rest and consumed once at the gate.",
              },
              {
                icon: Lock,
                title: "Conflict-free bay allocation",
                detail: "Row-level database locks guarantee two vehicles never claim one slot.",
              },
              {
                icon: CheckCircle2,
                title: "Offline-resilient gate queue",
                detail: "Exits and audited overrides queue safely and reconcile once back online.",
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subtle text-accent">
                  <item.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">{item.title}</p>
                  <p className="text-xs leading-relaxed text-ink-muted">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-ink-subtle">
          <ShieldCheck className="h-4 w-4 text-accent" />
          Argon2id authentication · rotating refresh tokens · tenant-scoped queries
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-7 lg:hidden">
            <Brand />
          </div>

          <Card className="p-7">
            <p className="text-xs font-semibold tracking-wider text-accent uppercase">Sign in</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">
              Access your ParkVanta workspace
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Sign in with the credentials issued by your society administrator.
            </p>

            <form className="mt-6 space-y-4" onSubmit={submit}>
              <Field label="Email address" required>
                <Input
                  data-testid="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@society.org"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field label="Password" required>
                <Input
                  data-testid="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>
              {error ? <ErrorNote message={error} /> : null}
              <Button data-testid="login-submit" type="submit" className="w-full" disabled={busy}>
                {busy ? "Verifying…" : "Sign in"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          </Card>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
            <Link to="/forgot-password" className="font-medium text-ink-muted hover:text-ink">
              Forgot password?
            </Link>
            <Link to="/register" className="font-medium text-accent hover:text-accent-hover">
              Register with society join code
            </Link>
          </div>

          {DEMO_MODE ? (
            <Card className="mt-5 p-4">
              <p className="text-[11px] font-semibold tracking-wider text-ink-subtle uppercase">
                Development seed · password {DEMO_PASSWORD}
              </p>
              <div className="mt-2.5 grid gap-1.5">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface-subtle/60 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/50"
                  >
                    <span>
                      <span className="block text-xs font-medium text-ink">{account.label}</span>
                      <span className="block text-[11px] text-ink-muted">{account.detail}</span>
                    </span>
                    <span className="font-mono text-[10px] font-semibold text-accent">FILL</span>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

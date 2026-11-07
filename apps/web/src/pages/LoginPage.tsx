import { ArrowRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { homeRouteFor, useAuth } from "../auth/AuthContext";
import { Brand } from "../components/AppShell";
import { Button, Card, ErrorNote, Field, Input } from "../components/ui";

const DEMO_PASSWORD = "ParkVanta@2026";
const DEMO_ACCOUNTS = [
  { email: "resident@skyline.dev", label: "Resident", detail: "Invite and approve visitors" },
  { email: "guard@skyline.dev", label: "Gate guard", detail: "Scan, authorize, release" },
  { email: "admin@skyline.dev", label: "Society admin", detail: "Live operations view" },
];

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("resident@skyline.dev");
  const [password, setPassword] = useState(DEMO_PASSWORD);
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
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-12 lg:flex">
        <Brand />
        <div className="max-w-xl">
          <p className="font-mono text-[11px] tracking-[0.3em] text-teal-bright uppercase">
            Smart access · Smarter parking
          </p>
          <h1 className="mt-6 text-5xl leading-[1.05] font-semibold text-white">
            Every visitor verified.
            <br />
            Every slot accounted for.
          </h1>
          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-slate-400">
            Single-use QR passes, transactional slot allocation, and a gate console a guard can run in
            seconds. Built for residential societies that treat parking as infrastructure, not paperwork.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4 border-t border-white/[0.08] pt-6">
            {[
              ["Single-use", "hashed QR pass"],
              ["Lock-safe", "SKIP LOCKED allocation"],
              ["Audited", "every gate decision"],
            ].map(([title, detail]) => (
              <div key={title}>
                <p className="text-sm text-white">{title}</p>
                <p className="mt-1 font-mono text-[10px] tracking-[0.1em] text-slate-500 uppercase">
                  {detail}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <ShieldCheck className="h-4 w-4 text-teal/70" />
          Argon2id · rotating refresh tokens · tenant-scoped queries
        </div>
        <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-teal/10 blur-3xl" />
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <Card className="p-7">
            <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 uppercase">Gate access</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Sign in to ParkVanta</h2>
            <p className="mt-1 text-sm text-slate-500">
              Accounts are issued by your society administrator.
            </p>

            <form className="mt-6 space-y-4" onSubmit={submit}>
              <Field label="Email">
                <Input
                  data-testid="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field label="Password">
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
                {busy ? "Verifying…" : "Enter control room"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          </Card>

          <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="font-mono text-[10px] tracking-[0.16em] text-slate-500 uppercase">
              Demo society · password {DEMO_PASSWORD}
            </p>
            <div className="mt-3 grid gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] px-3 py-2 text-left transition-colors hover:border-teal/40 hover:bg-white/[0.04]"
                >
                  <span>
                    <span className="block text-sm text-slate-200">{account.label}</span>
                    <span className="block text-[11px] text-slate-500">{account.detail}</span>
                  </span>
                  <span className="font-mono text-[10px] text-teal-bright">USE</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

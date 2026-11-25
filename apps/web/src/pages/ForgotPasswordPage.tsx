import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Brand } from "../components/AppShell";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot-password", { method: "POST", json: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
        <div className="w-full rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            Account Recovery
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">Reset your password</h1>

          {sent ? (
            <div className="mt-5 space-y-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ok-soft text-ok">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <p className="text-sm leading-relaxed text-ink-muted">
                If an active account exists for <strong className="text-ink">{email}</strong>, a
                single-use reset link has been dispatched.
              </p>
              <Link
                to="/login"
                className="inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-xs font-medium text-ink hover:bg-surface-subtle"
              >
                Return to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <p className="text-sm text-ink-muted">
                Enter your registered email address and we will issue a password reset token.
              </p>
              <Field label="Email address">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@community.org"
                />
              </Field>
              {error ? <ErrorNote message={error} /> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                <Mail className="h-4 w-4" />
                {busy ? "Sending link…" : "Send reset link"}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Brand } from "../components/AppShell";
import { Button, Card, ErrorNote, Field, Input } from "../components/ui";
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
      setError(err instanceof Error ? err.message : "Could not request a reset link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <Brand />
        </div>
        <Card className="p-7">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <MailCheck className="h-5 w-5" />
              </div>
              <h1 className="mt-4 text-xl font-semibold text-ink">Check your inbox</h1>
              <p className="mt-2 text-sm text-ink-muted">
                If an account exists for <span className="font-medium text-ink">{email}</span>, a
                single-use reset link is on its way. It expires in 30 minutes.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold tracking-wider text-accent uppercase">Account recovery</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">Reset your password</h1>
              <p className="mt-1 text-sm text-ink-muted">
                We will email a single-use reset link to the address on your account.
              </p>
              <form className="mt-5 space-y-4" onSubmit={submit}>
                <Field label="Email address" required>
                  <Input
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                  />
                </Field>
                {error ? <ErrorNote message={error} /> : null}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Requesting…" : "Email reset link"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
            </>
          )}
          <div className="mt-6 border-t border-border pt-4 text-xs">
            <Link to="/login" className="inline-flex items-center gap-1 font-medium text-ink-muted hover:text-ink">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

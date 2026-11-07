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
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <Brand />
        </div>
        <Card className="p-7">
          {sent ? (
            <div className="text-center">
              <MailCheck className="mx-auto h-10 w-10 text-teal-bright" />
              <h1 className="mt-4 text-2xl font-semibold text-white">Check your inbox</h1>
              <p className="mt-2 text-sm text-slate-400">
                If an account exists for {email}, a reset link is on its way. The link expires in 30
                minutes.
              </p>
            </div>
          ) : (
            <>
              <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 uppercase">Account recovery</p>
              <h1 className="mt-2 text-2xl font-semibold text-white">Reset your password</h1>
              <p className="mt-1 text-sm text-slate-500">
                We will email a single-use link to the address on your account.
              </p>
              <form className="mt-6 space-y-4" onSubmit={submit}>
                <Field label="Email">
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
          <div className="mt-6 border-t border-white/[0.08] pt-4 text-xs">
            <Link to="/login" className="inline-flex items-center gap-1 text-slate-400 hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

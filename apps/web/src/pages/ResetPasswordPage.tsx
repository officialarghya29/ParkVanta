import { ArrowLeft, CheckCircle2, Lock } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Brand } from "../components/AppShell";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        json: { token, new_password: password },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
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
            Security Update
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            Choose a new password
          </h1>

          {done ? (
            <div className="mt-5 space-y-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ok-soft text-ok">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <p className="text-sm text-ink-muted">
                Your password has been updated. Sign in with your new credentials.
              </p>
              <Link
                to="/login"
                className="inline-flex h-9 items-center rounded-full bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Continue to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-4">
              <Field label="Reset token">
                <Input
                  required
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="New password" hint="Minimum 10 characters">
                <Input
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  required
                  minLength={10}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>
              {error ? <ErrorNote message={error} /> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                <Lock className="h-4 w-4" />
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

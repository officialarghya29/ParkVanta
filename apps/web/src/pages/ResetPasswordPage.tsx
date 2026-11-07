import { ArrowRight, CheckCircle2, KeyRound } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Brand } from "../components/AppShell";
import { Button, Card, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
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
      setError(err instanceof Error ? err.message : "Could not reset the password");
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
          {done ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-teal-bright" />
              <h1 className="mt-4 text-2xl font-semibold text-white">Password updated</h1>
              <p className="mt-2 text-sm text-slate-400">
                All existing sessions were revoked. Sign in with your new password.
              </p>
              <Link to="/login" className="mt-6 inline-flex w-full">
                <Button className="w-full">
                  Sign in <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 uppercase">Account recovery</p>
              <h1 className="mt-2 text-2xl font-semibold text-white">Choose a new password</h1>
              {!token ? (
                <div className="mt-4">
                  <ErrorNote message="This link is missing its reset token. Request a new link." />
                </div>
              ) : (
                <form className="mt-6 space-y-4" onSubmit={submit}>
                  <Field label="New password" hint="letters and digits">
                    <Input
                      required
                      type="password"
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Confirm password">
                    <Input
                      required
                      type="password"
                      minLength={8}
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  {error ? <ErrorNote message={error} /> : null}
                  <Button type="submit" className="w-full" disabled={busy}>
                    <KeyRound className="h-4 w-4" />
                    {busy ? "Updating…" : "Update password"}
                  </Button>
                </form>
              )}
            </>
          )}
          <div className="mt-6 border-t border-white/[0.08] pt-4 text-xs">
            <Link to="/forgot-password" className="text-slate-400 hover:text-white">
              Request a new reset link
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

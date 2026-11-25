import { ArrowLeft, ArrowRight, Building2, CheckCircle2, KeyRound } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Brand } from "../components/AppShell";
import { Button, Card, ErrorNote, Field, Input, Select } from "../components/ui";
import { api } from "../lib/api";
import type { JoinProperty, User } from "../lib/types";

const EMPTY_FORM = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  confirm: "",
  apartment_id: "",
};

export function RegisterPage() {
  const [code, setCode] = useState("");
  const [join, setJoin] = useState<JoinProperty | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<User | null>(null);

  async function findSociety(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const property = await api<JoinProperty>(
        `/public/join/${encodeURIComponent(code.trim().toUpperCase())}`,
      );
      setJoin(property);
      setForm((current) => ({
        ...current,
        apartment_id: property.apartments[0]?.id ?? "",
      }));
    } catch (err) {
      setJoin(null);
      setError(err instanceof Error ? err.message : "Could not resolve that join code");
    } finally {
      setBusy(false);
    }
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    if (!join) return;
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api<User>("/auth/register", {
        method: "POST",
        json: {
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          phone: form.phone.trim() || null,
          property_id: join.property_id,
          apartment_id: form.apartment_id,
          join_code: code.trim().toUpperCase(),
        },
      });
      setCreated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <AuthFrame>
        <Card className="p-7 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-ink">Account created</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {created.full_name}, your account is awaiting verification by the{" "}
            <span className="font-medium text-ink">{join?.name}</span> society administrator. You can
            sign in now; visitor invitations unlock after verification.
          </p>
          <Link to="/login" className="mt-6 inline-flex w-full">
            <Button className="w-full">
              Go to sign in <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </Card>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <Card className="p-7">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">Resident onboarding</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">Join your society</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Enter the 16-character join code provided by your society management office.
        </p>

        <form className="mt-5 space-y-3.5" onSubmit={findSociety}>
          <Field label="Society join code" hint="16 characters" required>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="A1B2C3D4E5F60718"
              autoComplete="off"
              className="font-mono uppercase"
              required
              minLength={16}
              maxLength={16}
            />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
            <KeyRound className="h-4 w-4" />
            {busy && !join ? "Looking up…" : join ? "Look up another society" : "Find society"}
          </Button>
        </form>

        {error ? (
          <div className="mt-4">
            <ErrorNote message={error} />
          </div>
        ) : null}

        {join ? (
          <form className="mt-6 space-y-4 border-t border-border pt-5" onSubmit={register}>
            <div className="rounded-lg border border-accent-border bg-accent-soft/60 p-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Building2 className="h-4 w-4 text-accent" />
                {join.name}
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">
                {[join.address_line, join.city, join.state].filter(Boolean).join(", ") ||
                  "Address not listed"}
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-accent">
                {join.apartments.length} apartments available to claim
              </p>
            </div>

            {join.apartments.length === 0 ? (
              <ErrorNote message="This society has no apartments registered yet. Contact the society office." />
            ) : (
              <>
                <Field label="Apartment" required>
                  <Select
                    required
                    value={form.apartment_id}
                    onChange={(event) => setForm({ ...form, apartment_id: event.target.value })}
                  >
                    {join.apartments.map((apartment) => (
                      <option key={apartment.id} value={apartment.id}>
                        {apartment.tower_name ? `${apartment.tower_name} · ` : ""}
                        {apartment.number}
                        {apartment.floor !== null ? ` · Floor ${apartment.floor}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Full name" required>
                  <Input
                    required
                    value={form.full_name}
                    onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                    autoComplete="name"
                  />
                </Field>
                <Field label="Email address" required>
                  <Input
                    required
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    autoComplete="email"
                  />
                </Field>
                <Field label="Phone" hint="optional">
                  <Input
                    value={form.phone}
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    autoComplete="tel"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Password" hint="letters & digits" required>
                    <Input
                      required
                      type="password"
                      minLength={8}
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Confirm password" required>
                    <Input
                      required
                      type="password"
                      minLength={8}
                      value={form.confirm}
                      onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Creating account…" : "Create resident account"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </form>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-xs">
          <Link to="/login" className="inline-flex items-center gap-1 font-medium text-ink-muted hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>
          <Link to="/forgot-password" className="font-medium text-ink-muted hover:text-ink">
            Forgot password?
          </Link>
        </div>
      </Card>
    </AuthFrame>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <Brand />
        </div>
        {children}
      </div>
    </div>
  );
}

import { ArrowLeft, Building2, CheckCircle2, KeyRound } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Brand } from "../components/AppShell";
import { Badge, Button, ErrorNote, Field, Input, Select } from "../components/ui";
import { api } from "../lib/api";
import type { JoinProperty, User } from "../lib/types";

export function RegisterPage() {
  const [code, setCode] = useState("");
  const [join, setJoin] = useState<JoinProperty | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    apartment_id: "",
    password: "",
    confirm: "",
  });
  const [created, setCreated] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookupJoinCode(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
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

      <main className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-10 sm:px-6">
        <div className="w-full overflow-hidden rounded-2xl border border-line bg-surface">
          {/* Step Progress Strip */}
          <div className="flex items-center justify-between border-b border-line bg-surface-subtle px-6 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                Resident Onboarding
              </p>
              <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-ink">
                Claim your society residence
              </h1>
            </div>
            <div className="flex items-center gap-2 text-xs font-medium">
              <Badge tone={!join ? "accent" : "ok"}>1. Join code</Badge>
              <span className="text-ink-subtle">/</span>
              <Badge tone={created ? "ok" : join ? "accent" : "neutral"}>2. Unit & account</Badge>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            {created ? (
              <div className="space-y-4 py-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ok-soft text-ok">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold text-ink">Registration submitted</h2>
                <p className="text-sm leading-relaxed text-ink-muted">
                  Your account for <strong className="text-ink">{created.email}</strong> has been created
                  and linked to <strong className="text-ink">{join?.name}</strong>. Once your society
                  administrator verifies your unit, you can sign in and issue visitor passes.
                </p>
                <div className="pt-2">
                  <Link
                    to="/login"
                    className="inline-flex h-9 items-center rounded-full bg-accent px-5 text-sm font-medium text-white transition hover:bg-accent-hover"
                  >
                    Return to sign in
                  </Link>
                </div>
              </div>
            ) : !join ? (
              <form onSubmit={lookupJoinCode} className="max-w-md space-y-4">
                <p className="text-sm text-ink-muted">
                  Enter the society join code provided by your management office or welcome notice.
                </p>
                <Field label="Society join code" hint="Case-insensitive">
                  <Input
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="e.g. SKYLINE2026"
                    className="font-mono uppercase tracking-wider"
                  />
                </Field>
                {error ? <ErrorNote message={error} /> : null}
                <Button type="submit" disabled={busy}>
                  <KeyRound className="h-4 w-4" />
                  {busy ? "Checking code…" : "Verify join code"}
                </Button>
              </form>
            ) : (
              <form onSubmit={register} className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-subtle px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">{join.name}</p>
                      <p className="text-xs text-ink-subtle">
                        {join.address_line}, {join.city}, {join.state}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setJoin(null);
                      setError(null);
                    }}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    Change code
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full name">
                    <Input
                      required
                      value={form.full_name}
                      onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                      placeholder="Aarav Sharma"
                    />
                  </Field>
                  <Field label="Email address">
                    <Input
                      type="email"
                      required
                      value={form.email}
                      onChange={(event) => setForm({ ...form, email: event.target.value })}
                      placeholder="aarav@example.com"
                    />
                  </Field>
                  <Field label="Phone" hint="Optional">
                    <Input
                      value={form.phone}
                      onChange={(event) => setForm({ ...form, phone: event.target.value })}
                      placeholder="+91 98765 43210"
                    />
                  </Field>
                  <Field label="Apartment unit">
                    <Select
                      value={form.apartment_id}
                      onChange={(event) => setForm({ ...form, apartment_id: event.target.value })}
                    >
                      {join.apartments.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.tower_name ? `${unit.tower_name} · ` : ""}Unit {unit.number}
                          {unit.floor !== null ? ` (Floor ${unit.floor})` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Password">
                    <Input
                      type="password"
                      required
                      minLength={10}
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                    />
                  </Field>
                  <Field label="Confirm password">
                    <Input
                      type="password"
                      required
                      minLength={10}
                      value={form.confirm}
                      onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                    />
                  </Field>
                </div>

                {error ? <ErrorNote message={error} /> : null}

                <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
                  <Button type="submit" size="lg" disabled={busy}>
                    {busy ? "Creating account…" : "Create resident account"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

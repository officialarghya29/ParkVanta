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
      const property = await api<JoinProperty>(`/public/join/${encodeURIComponent(code.trim().toUpperCase())}`);
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
          <CheckCircle2 className="mx-auto h-10 w-10 text-teal-bright" />
          <h1 className="mt-4 text-2xl font-semibold text-white">Account created</h1>
          <p className="mt-2 text-sm text-slate-400">
            {created.full_name}, your account is waiting for verification by the {join?.name} society
            administrator. You can sign in now; visitor invitations unlock after verification.
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
        <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 uppercase">Resident access</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Join your society</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ask your society office for the resident join code.
        </p>

        <form className="mt-6 space-y-4" onSubmit={findSociety}>
          <Field label="Society join code" hint="16 characters">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="A1B2C3D4E5F60718"
              autoComplete="off"
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

        {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}

        {join ? (
          <form className="mt-6 space-y-4 border-t border-white/[0.08] pt-6" onSubmit={register}>
            <div className="rounded-xl border border-teal/20 bg-teal/5 p-4">
              <div className="flex items-center gap-2 text-sm text-white">
                <Building2 className="h-4 w-4 text-teal-bright" />
                {join.name}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {[join.address_line, join.city, join.state].filter(Boolean).join(", ") || "Address not listed"}
              </p>
              <p className="mt-2 font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                {join.apartments.length} apartments available to claim
              </p>
            </div>

            {join.apartments.length === 0 ? (
              <ErrorNote message="This society has no apartments registered yet. Contact the society office." />
            ) : (
              <>
                <Field label="Apartment">
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
                <Field label="Full name">
                  <Input
                    required
                    value={form.full_name}
                    onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                    autoComplete="name"
                  />
                </Field>
                <Field label="Email">
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
                <Field label="Password" hint="letters and digits">
                  <Input
                    required
                    type="password"
                    minLength={8}
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirm password">
                  <Input
                    required
                    type="password"
                    minLength={8}
                    value={form.confirm}
                    onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Creating account…" : "Create resident account"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </form>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t border-white/[0.08] pt-4 text-xs">
          <Link to="/login" className="inline-flex items-center gap-1 text-slate-400 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Sign in
          </Link>
          <Link to="/forgot-password" className="text-slate-400 hover:text-white">
            Forgot password?
          </Link>
        </div>
      </Card>
    </AuthFrame>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <Brand />
        </div>
        {children}
      </div>
    </div>
  );
}

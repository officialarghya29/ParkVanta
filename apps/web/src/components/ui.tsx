import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-teal text-white hover:bg-[#13b7a5] shadow-[0_10px_30px_-12px_rgba(22,163,148,0.9)] disabled:bg-teal/40",
    secondary:
      "border border-white/15 bg-white/5 text-slate-100 hover:border-teal/60 hover:bg-white/10",
    ghost: "text-slate-300 hover:bg-white/5 hover:text-white",
    danger: "border border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("glass rounded-2xl", className)}>{children}</div>;
}

type BadgeTone = "teal" | "amber" | "red" | "slate" | "blue";

export function Badge({
  children,
  tone = "slate",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    teal: "border-teal/40 bg-teal/10 text-teal-bright",
    amber: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    red: "border-red-400/30 bg-red-500/10 text-red-200",
    slate: "border-white/15 bg-white/5 text-slate-300",
    blue: "border-sky-400/30 bg-sky-500/10 text-sky-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] uppercase",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "APPROVED":
    case "ACTIVE":
    case "SENT":
      return "teal";
    case "PENDING":
    case "RESERVED":
      return "amber";
    case "REJECTED":
    case "CANCELLED":
    case "EXPIRED":
    case "DENIED":
    case "REVOKED":
      return "red";
    case "COMPLETED":
    case "RELEASED":
    case "CONSUMED":
      return "blue";
    default:
      return "slate";
  }
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">{label}</span>
        {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="block text-xs text-red-300">{error}</span> : null}
    </label>
  );
}

const controlClasses =
  "w-full rounded-xl border border-white/10 bg-abyss-soft/80 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 transition-colors focus:border-teal/70";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(controlClasses, "appearance-none", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClasses, "min-h-20", className)} {...props} />;
}

export function Stat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  accent?: "teal" | "amber" | "red";
}) {
  const colors = {
    teal: "text-teal-bright",
    amber: "text-amber-300",
    red: "text-red-300",
  };
  return (
    <div className="glass rounded-2xl p-4">
      <p className="font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">{label}</p>
      <p className={cn("tabular mt-2 text-3xl font-semibold", accent ? colors[accent] : "text-white")}>
        {value}
        {suffix ? <span className="ml-1 text-base font-normal text-slate-400">{suffix}</span> : null}
      </p>
    </div>
  );
}

export function SectionTitle({
  title,
  caption,
  action,
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {caption ? <p className="mt-1 text-sm text-slate-400">{caption}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal/30 border-t-teal-bright" />
      {label}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {body ? <p className="mt-1 text-sm text-slate-500">{body}</p> : null}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      {message}
    </div>
  );
}

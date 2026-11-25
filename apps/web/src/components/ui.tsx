import { AlertCircle, CheckCircle2, ChevronDown, X } from "lucide-react";
import { cloneElement, isValidElement, useEffect, useId } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-accent text-white hover:bg-accent-hover shadow-[0_1px_2px_rgba(16,24,40,0.08)] disabled:bg-accent/50",
    secondary:
      "border border-border-strong bg-white text-ink hover:bg-surface-subtle shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
    ghost: "text-ink-muted hover:bg-surface-subtle hover:text-ink",
    danger:
      "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100/80 hover:border-red-300",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "h-8 rounded-md px-2.5 text-xs gap-1.5",
    md: "h-9 rounded-lg px-3.5 text-sm gap-2",
  };
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        sizes[size],
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

type BadgeTone = "teal" | "amber" | "red" | "slate" | "blue";

export function Badge({
  children,
  tone = "slate",
  className,
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
}) {
  const tones: Record<BadgeTone, string> = {
    teal: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    slate: "border-border bg-surface-subtle text-ink-muted",
    blue: "border-sky-200 bg-sky-50 text-sky-800",
  };
  const dotColors: Record<BadgeTone, string> = {
    teal: "bg-emerald-600",
    amber: "bg-amber-500",
    red: "bg-red-600",
    slate: "bg-zinc-400",
    blue: "bg-sky-600",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dotColors[tone])} /> : null}
      {children}
    </span>
  );
}

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "APPROVED":
    case "ACTIVE":
    case "SENT":
    case "AVAILABLE":
      return "teal";
    case "PENDING":
    case "RESERVED":
      return "amber";
    case "REJECTED":
    case "CANCELLED":
    case "EXPIRED":
    case "DENIED":
    case "REVOKED":
    case "BLOCKED":
      return "red";
    case "COMPLETED":
    case "RELEASED":
    case "CONSUMED":
    case "OCCUPIED":
      return "blue";
    default:
      return "slate";
  }
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const errorId = `${fieldId}-error`;

  let control = children;
  if (isValidElement(children)) {
    const childProps = children.props as Record<string, unknown>;
    const nextProps: Record<string, unknown> = {};
    if (!childProps.id) nextProps.id = fieldId;
    if (error) {
      nextProps["aria-invalid"] = true;
      nextProps["aria-describedby"] = errorId;
    }
    if (Object.keys(nextProps).length > 0) {
      control = cloneElement(children as ReactElement<Record<string, unknown>>, nextProps);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={fieldId} className="text-xs font-medium text-ink">
          {label}
          {required ? <span className="ml-0.5 text-red-600" aria-hidden="true">*</span> : null}
        </label>
        {hint ? <span className="text-[11px] text-ink-subtle">{hint}</span> : null}
      </div>
      {control}
      {error ? (
        <p id={errorId} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClasses =
  "w-full rounded-lg border border-border-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/75 transition-colors hover:border-zinc-400 focus:border-accent focus:outline-none disabled:bg-surface-subtle disabled:text-ink-subtle";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, "h-9", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(controlClasses, "h-9 appearance-none pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-ink-subtle"
        aria-hidden="true"
      />
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClasses, "min-h-20 py-2", className)} {...props} />;
}

export function Stat({
  label,
  value,
  suffix,
  accent,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  accent?: "teal" | "amber" | "red";
  hint?: string;
  icon?: ReactNode;
}) {
  const colors = {
    teal: "text-accent",
    amber: "text-amber-700",
    red: "text-red-700",
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        {icon ? <span className="text-ink-subtle">{icon}</span> : null}
      </div>
      <p className={cn("tabular mt-2 text-2xl font-semibold tracking-tight", accent ? colors[accent] : "text-ink")}>
        {value}
        {suffix ? <span className="ml-1 text-sm font-normal text-ink-subtle">{suffix}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p> : null}
    </Card>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {caption ? <p className="mt-0.5 text-xs text-ink-muted">{caption}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-8 text-sm text-ink-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  icon,
}: {
  title: string;
  body?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface-subtle/50 px-6 py-9 text-center">
      {icon ? <div className="mx-auto mb-2 flex justify-center text-ink-subtle">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body ? <p className="mt-1 text-xs text-ink-muted">{body}</p> : null}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function SuccessNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-lg overflow-hidden shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface-subtle hover:text-ink"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </Card>
    </div>
  );
}

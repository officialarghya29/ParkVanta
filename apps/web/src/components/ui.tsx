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

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap",
        size === "sm" && "h-8 px-3.5 text-xs",
        size === "md" && "h-9 px-4 text-sm",
        size === "lg" && "h-10 px-5 text-sm",
        variant === "primary" &&
          "rounded-full bg-accent text-white hover:bg-accent-hover shadow-xs",
        variant === "secondary" &&
          "rounded-full border border-line-strong bg-surface text-ink hover:bg-surface-subtle",
        variant === "subtle" &&
          "rounded-lg border border-line bg-surface-subtle text-ink hover:bg-surface-muted",
        variant === "ghost" &&
          "rounded-lg text-ink-muted hover:bg-surface-subtle hover:text-ink",
        variant === "danger" &&
          "rounded-full border border-bad-border bg-bad-soft text-bad hover:bg-bad hover:text-white hover:border-bad",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        "rounded-xl border border-line bg-surface",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function StudioPane({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-line bg-surface",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function StudioPaneHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export type BadgeTone = "neutral" | "ok" | "warn" | "bad" | "accent";

export function Badge({
  tone = "neutral",
  className,
  children,
  dot = false,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-4 tracking-tight whitespace-nowrap",
        tone === "neutral" && "border-line bg-surface-subtle text-ink-muted",
        tone === "ok" && "border-ok-border bg-ok-soft text-ok",
        tone === "warn" && "border-warn-border bg-warn-soft text-warn",
        tone === "bad" && "border-bad-border bg-bad-soft text-bad",
        tone === "accent" && "border-accent-border bg-accent-soft text-accent",
        className,
      )}
    >
      {dot ? (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "neutral" && "bg-ink-subtle",
            tone === "ok" && "bg-ok",
            tone === "warn" && "bg-warn",
            tone === "bad" && "bg-bad",
            tone === "accent" && "bg-accent",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

export function statusTone(status: string): BadgeTone {
  const s = status.toUpperCase();
  if (
    [
      "VALID",
      "APPROVED",
      "ACTIVE",
      "AVAILABLE",
      "COMPLETED",
      "VERIFIED",
      "OCCUPIED",
      "CONFIRMED",
    ].includes(s)
  ) {
    return "ok";
  }
  if (["PENDING", "RESERVED", "ENTRY_AUTHORIZED", "HOLD", "USED"].includes(s)) {
    return "warn";
  }
  if (["REJECTED", "REVOKED", "EXPIRED", "CANCELLED", "DENIED", "BLOCKED", "OVERSTAY"].includes(s)) {
    return "bad";
  }
  return "neutral";
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  const generatedId = useId();
  const fieldId =
    htmlFor ??
    (isValidElement<{ id?: string }>(children) && children.props.id
      ? children.props.id
      : generatedId);
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const control = isValidElement<{
    id?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }>(children)
    ? cloneElement(
        children as ReactElement<{
          id?: string;
          "aria-invalid"?: boolean;
          "aria-describedby"?: string;
        }>,
        {
          id: fieldId,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error ? errorId : hint ? hintId : undefined,
        },
      )
    : children;

  return (
    <div className="block space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={fieldId} className="text-xs font-medium text-ink">
          {label}
        </label>
        {hint ? (
          <span id={hintId} className="text-[11px] text-ink-subtle">
            {hint}
          </span>
        ) : null}
      </div>
      {control}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/75 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-ink-subtle";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, "h-9", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(inputBase, "h-9 appearance-none pr-8", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
        aria-hidden="true"
      />
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, "min-h-20", className)} {...props} />;
}

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "neutral" | "ok" | "warn" | "bad" | "accent";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-bad",
          tone === "accent" && "text-accent",
          tone === "neutral" && "text-ink",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p> : null}
    </div>
  );
}

export function MetricStrip({
  children,
  className,
  "data-testid": dataTestId,
}: {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "grid grid-cols-2 divide-y divide-x divide-line overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-4 xl:grid-cols-8 xl:divide-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MetricCell({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "neutral" | "ok" | "warn" | "bad" | "accent";
}) {
  return (
    <div className="flex flex-col justify-between px-4 py-3.5">
      <span className="text-[11px] font-medium text-ink-subtle">{label}</span>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "text-xl font-semibold tracking-tight tabular",
            tone === "ok" && "text-ok",
            tone === "warn" && "text-warn",
            tone === "bad" && "text-bad",
            tone === "accent" && "text-accent",
            tone === "neutral" && "text-ink",
          )}
        >
          {value}
        </span>
      </div>
      {sub ? <span className="mt-0.5 truncate text-[11px] text-ink-subtle">{sub}</span> : null}
    </div>
  );
}

export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-subtle p-1",
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-surface text-ink shadow-xs ring-1 ring-line"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0 text-[10px] tabular",
                  active ? "bg-accent-soft text-accent" : "bg-surface-muted text-ink-subtle",
                )}
              >
                {opt.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function KeyValueRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-ink-subtle">{label}</span>
      <span className={cn("text-right font-medium text-ink", mono && "font-mono text-xs")}>
        {value}
      </span>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2.5">{action}</div> : null}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-subtle">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-xs font-medium text-ink-subtle">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface-subtle/50 px-6 py-10 text-center">
      {icon ? <div className="mb-2.5 text-ink-subtle">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-subtle">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-bad-border bg-bad-soft px-3.5 py-2.5 text-xs font-medium text-bad"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function SuccessNote({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-ok-border bg-ok-soft px-3.5 py-2.5 text-xs font-medium text-ok"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>
            {description ? <p className="mt-0.5 text-xs text-ink-subtle">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-subtle hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

// ----- Button -----

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-deep border-transparent',
  secondary: 'bg-surface text-ink hover:bg-ground border-line',
  danger: 'bg-danger text-white hover:brightness-90 border-transparent',
  ghost: 'bg-transparent text-muted hover:bg-ground border-transparent',
};

export function Button({
  variant = 'primary',
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}>
      {loading ? <Spinner size={14} /> : null}
      {children}
    </button>
  );
}

// ----- Input -----

export function Input({
  label,
  hint,
  error,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      {label ? <span className="text-sm font-semibold text-ink">{label}</span> : null}
      <input
        {...rest}
        className={`rounded-lg border bg-surface px-3 py-2 text-sm outline-none transition placeholder:text-muted/60 focus:border-brand ${
          error ? 'border-danger bg-danger-tint/40' : 'border-line'
        } ${className}`}
      />
      {error ? (
        <span className="text-xs font-medium text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Textarea({
  label,
  hint,
  rows = 8,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      {label ? <span className="text-sm font-semibold text-ink">{label}</span> : null}
      <textarea
        {...rest}
        rows={rows}
        className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs outline-none transition placeholder:text-muted/60 focus:border-brand"
      />
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

// ----- Layout primitives -----

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface shadow-sm ${className}`}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title ? <h2 className="text-base font-bold text-ink">{title}</h2> : null}
            {subtitle ? (
              <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="tnum mt-1 text-3xl font-black text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'danger';

// `ok` is the brand green, so `accent` has to be the gold — otherwise the two tones
// are indistinguishable and a badge stops carrying meaning.
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ground text-muted border-line',
  accent: 'bg-accent-tint text-accent-deep border-accent/40',
  ok: 'bg-ok-tint text-ok border-ok/30',
  danger: 'bg-danger-tint text-danger border-danger/30',
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${BADGE_TONES[tone]}`}>
      {label}
    </span>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size }}
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <p className="text-base font-bold text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// ----- Table -----

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 -mb-5 overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`border-b border-line bg-ground/60 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-muted ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}>
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`border-b border-line px-5 py-3 align-middle ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}>
      {children}
    </td>
  );
}

// ----- Feedback -----

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-sm font-medium text-danger">
      {message}
    </p>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  tone = 'danger',
  loading,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  /** `danger` for destructive actions, `primary` for ordinary confirmations. */
  tone?: 'danger' | 'primary';
  loading?: boolean;
  /** Optional detail — e.g. a summary of exactly what is about to change. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape closes, matching every other dialog the admin has ever used. Bound only
  // while open so a background page never swallows the key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Backdrop click cancels; clicks inside the panel must not bubble up to it.
      onClick={() => {
        if (!loading) onCancel();
      }}>
      <div
        className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-muted">{message}</p>
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

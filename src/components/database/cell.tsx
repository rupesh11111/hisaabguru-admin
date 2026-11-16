'use client';

import { fmtDateTime } from '@/lib/format';

const MAX_INLINE = 80;
const NUMERIC = new Set(['Int', 'BigInt', 'Float', 'Decimal', 'int2', 'int4', 'int8', 'float4', 'float8', 'numeric']);

const isRedacted = (v: unknown) =>
  typeof v === 'object' &&
  v !== null &&
  'redacted' in v &&
  (v as { redacted: unknown }).redacted === true;

/** Full text form of a value, for titles, the row panel and CSV. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (isRedacted(v)) return '(hidden)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Looks like a timestamp the API serialised (ISO 8601, UTC). */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * One grid cell, the way a database client shows it: NULL distinct from empty, secrets
 * masked, JSON compact, long text cut with the full value on hover.
 */
export function Cell({ value, type }: { value: unknown; type?: string }) {
  if (value === null || value === undefined) {
    return <span className="text-xs italic text-muted/70">NULL</span>;
  }
  if (isRedacted(value)) {
    return (
      <span
        className="rounded bg-ground px-1.5 py-0.5 font-mono text-[11px] text-muted"
        title="Secret column — never sent to the browser">
        ••••• hidden
      </span>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <span className={`font-mono text-xs ${value ? 'text-ok' : 'text-danger'}`}>
        {String(value)}
      </span>
    );
  }
  if (typeof value === 'number' || (type && NUMERIC.has(type))) {
    return <span className="tnum font-mono text-xs text-ink">{String(value)}</span>;
  }
  if (typeof value === 'string' && ISO.test(value)) {
    return (
      <span className="tnum whitespace-nowrap font-mono text-xs text-ink" title={`${value} (UTC)`}>
        {fmtDateTime(value)}
      </span>
    );
  }
  const text = cellText(value);
  const isJson = typeof value === 'object';
  return (
    <span
      className={`whitespace-nowrap font-mono text-xs ${isJson ? 'text-brand-deep' : 'text-ink'}`}
      title={text.length > MAX_INLINE ? text : undefined}>
      {text.length > MAX_INLINE ? `${text.slice(0, MAX_INLINE)}…` : text}
    </span>
  );
}

/** Every field of one row, stacked, with full values — opened by clicking a row. */
export function RowPanel({
  entries,
  onClose,
}: {
  /** Name/value pairs in column order; names may repeat (a SQL join). */
  entries: Array<[string, unknown]>;
  onClose: () => void;
}) {
  const copy = () => {
    // Repeated names would collapse in an object, so pairs are kept when names repeat.
    const names = entries.map(([n]) => n);
    const payload = new Set(names).size === names.length ? Object.fromEntries(entries) : entries;
    void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2)).catch(() => undefined);
  };
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Row">
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="font-bold text-ink">Row</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ground">
              Copy JSON
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ground">
              Close
            </button>
          </div>
        </div>
        <dl className="flex-1 divide-y divide-line overflow-y-auto">
          {entries.map(([c, v], i) => {
            const pretty =
              v !== null && typeof v === 'object' && !isRedacted(v) ? JSON.stringify(v, null, 2) : null;
            return (
              <div key={`${i}:${c}`} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 px-5 py-2.5">
                <dt className="break-all font-mono text-xs font-semibold text-muted">{c}</dt>
                <dd className="min-w-0">
                  {pretty ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-ink">
                      {pretty}
                    </pre>
                  ) : v === null || v === undefined || isRedacted(v) ? (
                    <Cell value={v} />
                  ) : (
                    <span className="whitespace-pre-wrap break-all font-mono text-xs text-ink">
                      {String(v)}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}

/** RFC 4180 CSV, downloaded in the browser. Each row is aligned with `headers`. */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [
    headers.map(esc).join(','),
    ...rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : esc(cellText(v)))).join(',')),
  ];
  const url = URL.createObjectURL(
    new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

'use client';

import { useEffect, useRef, useState } from 'react';

import { Cell, RowPanel, downloadCsv } from '@/components/database/cell';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { adminApi } from '@/lib/api';
import type { SqlResult, SqlStatus } from '@/lib/types';

const HISTORY_KEY = 'hg.sqlConsole.history';
const HISTORY_MAX = 20;

const SAMPLES: Array<{ label: string; sql: string }> = [
  {
    label: 'Largest tables',
    sql: `SELECT relname AS "table",
       n_live_tup AS rows,
       pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20`,
  },
  {
    label: 'Products by shops',
    sql: `SELECT p.name, p.verification, count(i.id) AS shops
FROM products p
LEFT JOIN inventory i ON i."productId" = p.id
GROUP BY p.id
ORDER BY shops DESC
LIMIT 50`,
  },
  {
    label: 'Bills per day',
    sql: `SELECT date_trunc('day', "createdAt")::date AS day,
       count(*) AS bills,
       sum(total) AS total
FROM bills
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30`,
  },
  {
    label: 'Explain a query',
    sql: `EXPLAIN SELECT * FROM products WHERE name ILIKE '%rice%'`,
  },
];

function readHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeHistory(items: string[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // History is a convenience; a blocked storage just means none.
  }
}

/**
 * Raw read-only SQL. The API runs it as a SELECT-only database role, so what this page
 * cannot do is decided by Postgres, not by this UI.
 */
export function SqlConsole() {
  const [status, setStatus] = useState<SqlStatus | null>(null);
  const [sql, setSql] = useState(SAMPLES[0]?.sql ?? '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .sqlStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus({ enabled: false, reason: err instanceof Error ? err.message : 'Unavailable' });
        }
      });
    // Read after mount: localStorage does not exist during server rendering.
    const t = setTimeout(() => setHistory(readHistory()), 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const run = async () => {
    const text = sql.trim();
    if (!text || running) return;
    setRunning(true);
    setError(null);
    try {
      setOpenRow(null);
      setResult(await adminApi.runSql(text));
      const next = [text, ...history.filter((h) => h !== text)].slice(0, HISTORY_MAX);
      setHistory(next);
      writeHistory(next);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setRunning(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void run();
      return;
    }
    // Tab indents instead of leaving the editor.
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = `${sql.slice(0, s)}  ${sql.slice(end)}`;
      setSql(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  };

  if (!status) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!status.enabled) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-lg font-bold text-ink">SQL console is off</h2>
        <ErrorNote message={status.reason} />
        <div className="rounded-lg border border-line bg-ground p-4 text-sm text-ink">
          <p className="font-semibold">To turn it on, on the database:</p>
          <pre className="mt-2 overflow-x-auto rounded bg-surface p-3 font-mono text-xs">
            {`ALTER ROLE hg_sql_readonly LOGIN PASSWORD '<a long random password>';`}
          </pre>
          <p className="mt-3 font-semibold">and on the API, then restart it:</p>
          <pre className="mt-2 overflow-x-auto rounded bg-surface p-3 font-mono text-xs">
            {`ADMIN_READONLY_DATABASE_URL=postgresql://hg_sql_readonly:<password>@<host>:5432/<db>?schema=public`}
          </pre>
          <p className="mt-3 text-muted">
            The role is created by a migration and can only read. Never point this URL at a
            privileged user — the API refuses to run on one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">Samples</span>
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                setSql(s.sql);
                editor.current?.focus();
              }}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:border-brand">
              {s.label}
            </button>
          ))}
          {history.length > 0 ? (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) setSql(e.target.value);
              }}
              className="ml-auto max-w-[16rem] rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
              aria-label="Recent queries">
              <option value="">Recent queries…</option>
              {history.map((h, i) => (
                <option key={i} value={h}>
                  {h.replace(/\s+/g, ' ').slice(0, 70)}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <textarea
          ref={editor}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          rows={8}
          className="w-full resize-y rounded-lg border border-line bg-[#11140f] p-3 font-mono text-[13px] leading-relaxed text-[#e8f3ec] caret-[#c8a64b] outline-none focus:border-brand"
          aria-label="SQL"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Read-only, one statement, 5 s limit, first 500 rows. Ctrl + Enter runs it.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!result || result.rows.length === 0}
              onClick={() =>
                result &&
                downloadCsv(
                  'query.csv',
                  result.columns.map((c) => c.name),
                  result.rows,
                )
              }>
              CSV
            </Button>
            <Button onClick={() => void run()} loading={running} disabled={!sql.trim()}>
              Run
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="p-4">
          <ErrorNote message={error} />
        </div>
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-ground/40 px-4 py-2 text-xs text-muted">
            <span className="tnum font-semibold text-ink">
              {result.rowCount.toLocaleString('en-IN')} row{result.rowCount === 1 ? '' : 's'}
            </span>
            <span className="tnum">{result.durationMs} ms</span>
            {result.truncated ? (
              <span className="rounded-full bg-accent-tint px-2 py-0.5 font-semibold text-accent-deep">
                Showing the first {result.maxRows} — add a LIMIT or narrow the query
              </span>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            {result.columns.length === 0 ? (
              <p className="p-5 text-sm text-muted">The query returned no rows.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="sticky top-0 border-b border-r border-line bg-ground px-3 py-2 text-right text-[11px] font-bold text-muted">
                      #
                    </th>
                    {result.columns.map((c, j) => (
                      <th
                        key={j}
                        className="sticky top-0 whitespace-nowrap border-b border-line bg-ground px-3 py-2 text-left font-mono text-xs font-bold text-ink">
                        {c.name}
                        <span className="block font-sans text-[10px] font-normal text-muted">
                          {c.type}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr
                      key={i}
                      onClick={() => setOpenRow(i)}
                      className="cursor-pointer border-b border-line transition hover:bg-brand-tint/40">
                      <td className="tnum border-r border-line bg-ground/40 px-3 py-1.5 text-right text-[11px] text-muted">
                        {i + 1}
                      </td>
                      {result.columns.map((c, j) => (
                        <td key={j} className="max-w-[24rem] px-3 py-1.5">
                          {c.name === 'QUERY PLAN' ? (
                            <span className="whitespace-pre font-mono text-xs text-ink">
                              {String(row[j])}
                            </span>
                          ) : (
                            <Cell value={row[j]} type={c.type} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}

      {openRow !== null && result?.rows[openRow] ? (
        <RowPanel
          entries={result.columns.map((c, j) => [c.name, result.rows[openRow]![j]])}
          onClose={() => setOpenRow(null)}
        />
      ) : null}
    </div>
  );
}

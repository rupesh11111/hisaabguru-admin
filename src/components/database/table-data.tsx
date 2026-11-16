'use client';

import { useEffect, useMemo, useState } from 'react';

import { Cell, RowPanel, downloadCsv } from '@/components/database/cell';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { adminApi } from '@/lib/api';
import type { SchemaTable, TableRowsPage } from '@/lib/types';

const PAGE_SIZES = [25, 50, 100] as const;
const SEARCH_DEBOUNCE_MS = 400;

export type DataFilter = { column: string; q: string };

/** What defines a view; changing any of it starts again from the first page. */
type View = {
  pageSize: number;
  q: string;
  column: string;
  sort: string;
  dir: 'asc' | 'desc';
};

type Loaded = { key: string; page: TableRowsPage | null; error: string | null };

/**
 * Rows of one table, like a database client's data grid. Paging is keyset (a cursor per
 * page, kept in a stack for Prev), so page 5,000 is as fast as page 1. Search and sort run
 * on the server; secrets arrive already redacted.
 */
export function TableData({
  table,
  initialFilter,
  onOpenRef,
}: {
  table: SchemaTable;
  initialFilter?: DataFilter;
  /** Follow a foreign key: open `table` filtered to `column = value`. */
  onOpenRef: (table: string, filter: DataFilter) => void;
}) {
  const [view, setView] = useState<View>({
    pageSize: 50,
    q: initialFilter?.q ?? '',
    column: initialFilter?.column ?? '',
    sort: '',
    dir: 'asc',
  });
  const [input, setInput] = useState(initialFilter?.q ?? '');
  /** Cursors of the pages before the current one's; empty on the first page. */
  const [cursors, setCursors] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** The first page's total, kept while paging through the same view. */
  const [totals, setTotals] = useState<{ viewKey: string; total: number | null; estimate: boolean } | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const viewKey = JSON.stringify({ t: table.table, ...view, reload });
  const cursor = cursors[cursors.length - 1];
  const key = `${viewKey}|${cursor ?? ''}`;
  // Loading is derived, not set: what is on screen belongs to an older request.
  const loading = loaded?.key !== key;

  const changeView = (patch: Partial<View>) => {
    setView((prev) => ({ ...prev, ...patch }));
    setCursors([]);
    setOpenRow(null);
  };

  // Typing pauses before searching.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = input.trim();
      setView((prev) => (prev.q === q ? prev : { ...prev, q }));
      setCursors((prev) => (prev.length ? [] : prev));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .tableRows(table.table, {
        pageSize: view.pageSize,
        cursor,
        q: view.q,
        column: view.column,
        sort: view.sort,
        dir: view.dir,
      })
      .then((page) => {
        if (cancelled) return;
        setLoaded({ key, page, error: null });
        if (!cursor) setTotals({ viewKey, total: page.total, estimate: page.totalIsEstimate });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({ key, page: null, error: err instanceof Error ? err.message : 'Could not load rows' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, viewKey, cursor, table.table, view]);

  const page = loaded?.page ?? null;
  const columns = page?.columns ?? [];
  const refs = useMemo(
    () => new Map(table.columns.map((c) => [c.column, c.references])),
    [table.columns],
  );
  const total = totals?.viewKey === viewKey ? totals : null;
  const pageNo = cursors.length + 1;
  const from = page && page.rows.length > 0 ? (pageNo - 1) * page.pageSize + 1 : 0;
  const to = page ? from + Math.max(page.rows.length - 1, 0) : 0;

  const toggleSort = (column: string) => {
    // asc → desc → off, like most database clients.
    if (view.sort !== column) changeView({ sort: column, dir: 'asc' });
    else if (view.dir === 'asc') changeView({ dir: 'desc' });
    else changeView({ sort: '', dir: 'asc' });
  };

  const selected = columns.find((c) => c.column === view.column);
  const hint = !view.q
    ? null
    : selected
      ? selected.exact
        ? 'Exact match — served by an index.'
        : selected.indexed
          ? 'Indexed column.'
          : 'Not indexed — on a large table this search may hit the 5 s limit.'
      : 'Searching every text column — on a large table pick one column instead.';

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-col gap-1.5 border-b border-line bg-ground/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={view.column}
            onChange={(e) => changeView({ column: e.target.value })}
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
            aria-label="Search in column">
            <option value="">All text columns</option>
            {columns
              .filter((c) => !c.redacted)
              .map((c) => (
                <option key={c.column} value={c.column}>
                  {c.column}
                  {c.exact ? ' (exact)' : c.indexed ? ' (indexed)' : ''}
                </option>
              ))}
          </select>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={view.column ? `Search ${view.column}…` : 'Search…'}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand"
          />
          {input || view.column || view.sort ? (
            <Button
              variant="ghost"
              onClick={() => {
                setInput('');
                changeView({ q: '', column: '', sort: '', dir: 'asc' });
              }}>
              Clear
            </Button>
          ) : null}
          <select
            value={view.pageSize}
            onChange={(e) => changeView({ pageSize: Number(e.target.value) })}
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
            aria-label="Rows per page">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() => {
              setCursors([]);
              setReload((n) => n + 1);
            }}
            disabled={loading}>
            Refresh
          </Button>
          <Button
            variant="secondary"
            disabled={!page || page.rows.length === 0}
            onClick={() =>
              page &&
              downloadCsv(
                `${table.table}-p${pageNo}.csv`,
                columns.map((c) => c.column),
                page.rows.map((r) => columns.map((c) => r[c.column])),
              )
            }>
            CSV
          </Button>
        </div>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>

      {loaded?.error && !loading ? (
        <div className="p-4">
          <ErrorNote message={loaded.error} />
        </div>
      ) : null}

      {/* Grid */}
      <div className="relative overflow-x-auto">
        {loading ? (
          <div className="absolute inset-x-0 top-0 z-10 flex justify-center py-6">
            <span className="rounded-full border border-line bg-surface px-3 py-1.5 shadow-sm">
              <Spinner size={16} />
            </span>
          </div>
        ) : null}
        {page ? (
          <table className={`w-full border-collapse text-sm transition ${loading ? 'opacity-50' : ''}`}>
            <thead>
              <tr>
                <th className="sticky top-0 border-b border-r border-line bg-ground px-3 py-2 text-right text-[11px] font-bold text-muted">
                  #
                </th>
                {columns.map((c) => {
                  const active = view.sort === c.column;
                  return (
                    <th
                      key={c.column}
                      onClick={c.sortable ? () => toggleSort(c.column) : undefined}
                      title={
                        c.redacted
                          ? 'Secret column'
                          : c.sortable
                            ? `Sort by ${c.column}${c.indexed ? ' (indexed)' : ''}`
                            : 'Not sortable'
                      }
                      className={`sticky top-0 whitespace-nowrap border-b border-line bg-ground px-3 py-2 text-left font-mono text-xs font-bold ${
                        c.sortable ? 'cursor-pointer select-none hover:text-ink' : 'text-muted/70'
                      } ${active ? 'text-brand-deep' : 'text-ink'}`}>
                      {c.column}
                      {c.isId ? <span className="ml-1 text-[10px] text-accent-deep">PK</span> : null}
                      {active ? (view.dir === 'asc' ? ' ▲' : ' ▼') : null}
                      <span className="block font-sans text-[10px] font-normal text-muted">
                        {c.type}
                        {c.isList ? '[]' : ''}
                        {c.indexed ? ' · idx' : ''}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-sm text-muted">
                    {view.q ? 'No rows match this search.' : 'This table is empty.'}
                  </td>
                </tr>
              ) : (
                page.rows.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => setOpenRow(i)}
                    className="cursor-pointer border-b border-line transition hover:bg-brand-tint/40">
                    <td className="tnum border-r border-line bg-ground/40 px-3 py-1.5 text-right text-[11px] text-muted">
                      {(from + i).toLocaleString('en-IN')}
                    </td>
                    {columns.map((c) => {
                      const ref = refs.get(c.column);
                      const value = row[c.column];
                      return (
                        <td key={c.column} className="max-w-[24rem] px-3 py-1.5">
                          {ref && typeof value === 'string' ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenRef(ref.table, { column: ref.column, q: value });
                              }}
                              title={`Open ${ref.table} where ${ref.column} = ${value}`}
                              className="font-mono text-xs text-brand-deep underline decoration-dotted underline-offset-2 hover:text-brand">
                              {value}
                            </button>
                          ) : (
                            <Cell value={value} type={c.type} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : loading ? (
          <div className="py-16" />
        ) : null}
      </div>

      {/* Pager */}
      {page ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
          <span className="tnum text-muted">
            {page.rows.length === 0
              ? '0 rows'
              : `Rows ${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')}`}
            {total?.total != null
              ? ` of ${total.estimate ? '~' : ''}${total.total.toLocaleString('en-IN')}`
              : page.hasMore
                ? ' of many'
                : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={pageNo === 1 || loading} onClick={() => setCursors([])}>
              « First
            </Button>
            <Button
              variant="secondary"
              disabled={pageNo === 1 || loading}
              onClick={() => setCursors((prev) => prev.slice(0, -1))}>
              ‹ Prev
            </Button>
            <span className="tnum px-1 text-muted">Page {pageNo.toLocaleString('en-IN')}</span>
            <Button
              variant="secondary"
              disabled={!page.nextCursor || loading}
              onClick={() => {
                const next = page.nextCursor;
                if (next) setCursors((prev) => [...prev, next]);
              }}>
              Next ›
            </Button>
          </div>
        </div>
      ) : null}

      {openRow !== null && page?.rows[openRow] ? (
        <RowPanel
          entries={columns.map((c) => [c.column, page.rows[openRow]![c.column]])}
          onClose={() => setOpenRow(null)}
        />
      ) : null}
    </div>
  );
}

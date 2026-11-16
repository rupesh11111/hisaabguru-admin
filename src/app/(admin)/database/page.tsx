'use client';

import { useEffect, useMemo, useState } from 'react';

import { SqlConsole } from '@/components/database/sql-console';
import { type DataFilter, TableData } from '@/components/database/table-data';
import { Badge, ErrorNote, Spinner } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { adminApi } from '@/lib/api';
import type { DatabaseSchema, SchemaEnum, SchemaTable } from '@/lib/types';

type Selection =
  | { kind: 'overview' }
  | { kind: 'sql' }
  | { kind: 'table'; table: string; filter?: DataFilter }
  | { kind: 'enum'; name: string };
type Tab = 'data' | 'columns' | 'relations' | 'indexes';

function fmtBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** `~` marks Postgres's estimate; an exact count has none. */
function fmtRows(t: Pick<SchemaTable, 'rowEstimate' | 'rowCountExact'>): string {
  if (t.rowEstimate === null) return '—';
  return `${t.rowCountExact ? '' : '~'}${t.rowEstimate.toLocaleString('en-IN')}`;
}

/**
 * The database, laid out like a database client: structure, read-only rows (secrets
 * redacted) and a read-only SQL console. SUPER_ADMIN only, enforced by the API.
 */
export default function DatabasePage() {
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selection, setSelection] = useState<Selection>({ kind: 'overview' });
  const [tab, setTab] = useState<Tab>('data');
  /** Bumped on every open, so following the same FK twice still resets the grid. */
  const [openSeq, setOpenSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .schema()
      .then((s) => {
        if (!cancelled) setSchema(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the schema');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = filter.trim().toLowerCase();
  const tables = useMemo(
    () =>
      (schema?.tables ?? []).filter(
        (t) =>
          !q ||
          t.table.toLowerCase().includes(q) ||
          t.model.toLowerCase().includes(q) ||
          t.columns.some((c) => c.column.toLowerCase().includes(q)),
      ),
    [schema, q],
  );
  const enums = useMemo(
    () => (schema?.enums ?? []).filter((e) => !q || e.name.toLowerCase().includes(q)),
    [schema, q],
  );

  const openTable = (table: string, filter?: DataFilter) => {
    setSelection({ kind: 'table', table, filter });
    setTab('data');
    setOpenSeq((n) => n + 1);
  };
  const openEnum = (name: string) => setSelection({ kind: 'enum', name });

  if (error) return <ErrorNote message={error} />;
  if (!schema) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  const totalBytes = schema.tables.reduce((sum, t) => sum + (t.totalBytes ?? 0), 0);
  const selectedTable =
    selection.kind === 'table' ? schema.tables.find((t) => t.table === selection.table) : undefined;
  const selectedEnum =
    selection.kind === 'enum' ? schema.enums.find((e) => e.name === selection.name) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink">Database</h1>
          <p className="text-sm text-muted">
            Tables, rows and SQL — all read-only. Secret columns are never sent. Row counts
            marked ~ are Postgres estimates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Chip label="Tables" value={String(schema.tables.length)} />
          <Chip label="Enums" value={String(schema.enums.length)} />
          <Chip label="Size" value={fmtBytes(totalBytes)} />
          <Chip label="Read" value={fmtDateTime(schema.generatedAt)} />
        </div>
      </header>

      <div className="grid min-h-[70vh] overflow-hidden rounded-xl border border-line bg-surface shadow-sm md:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Object explorer */}
        <aside className="flex max-h-[40vh] flex-col border-b border-line bg-ground/60 md:max-h-[78vh] md:border-b-0 md:border-r">
          <div className="border-b border-line p-3">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tables, columns…"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <nav className="flex-1 overflow-y-auto p-2 text-sm">
            <ExplorerButton
              active={selection.kind === 'overview'}
              onClick={() => setSelection({ kind: 'overview' })}>
              <span className="font-semibold">All tables</span>
            </ExplorerButton>
            <ExplorerButton
              active={selection.kind === 'sql'}
              onClick={() => setSelection({ kind: 'sql' })}>
              <SqlIcon />
              <span className="font-semibold">SQL console</span>
            </ExplorerButton>

            <p className="px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted">
              Tables ({tables.length})
            </p>
            {tables.map((t) => (
              <ExplorerButton
                key={t.table}
                active={selection.kind === 'table' && selection.table === t.table}
                onClick={() => openTable(t.table)}>
                <TableIcon />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{t.table}</span>
                <span className="tnum shrink-0 text-[11px] text-muted">{fmtRows(t)}</span>
              </ExplorerButton>
            ))}

            <p className="px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted">
              Enums ({enums.length})
            </p>
            {enums.map((e) => (
              <ExplorerButton
                key={e.name}
                active={selection.kind === 'enum' && selection.name === e.name}
                onClick={() => openEnum(e.name)}>
                <EnumIcon />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{e.name}</span>
                <span className="tnum shrink-0 text-[11px] text-muted">{e.values.length}</span>
              </ExplorerButton>
            ))}
          </nav>
        </aside>

        {/* Detail */}
        <section className="min-w-0 overflow-y-auto md:max-h-[78vh]">
          {selection.kind === 'sql' ? (
            <SqlConsole />
          ) : selectedTable ? (
            <TableDetail
              key={`${selectedTable.table}:${openSeq}`}
              table={selectedTable}
              initialFilter={selection.kind === 'table' ? selection.filter : undefined}
              tab={tab}
              onTab={setTab}
              onOpenTable={openTable}
              onOpenEnum={openEnum}
              isEnum={(type) => schema.enums.some((e) => e.name === type)}
            />
          ) : selectedEnum ? (
            <EnumDetail value={selectedEnum} tables={schema.tables} onOpenTable={openTable} />
          ) : (
            <Overview tables={tables} onOpen={openTable} />
          )}
        </section>
      </div>
    </div>
  );
}

function Overview({ tables, onOpen }: { tables: SchemaTable[]; onOpen: (t: string) => void }) {
  const [sort, setSort] = useState<'name' | 'rows' | 'size'>('name');
  const sorted = [...tables].sort((a, b) =>
    sort === 'rows'
      ? (b.rowEstimate ?? -1) - (a.rowEstimate ?? -1)
      : sort === 'size'
        ? (b.totalBytes ?? -1) - (a.totalBytes ?? -1)
        : a.table.localeCompare(b.table),
  );
  const header = (key: typeof sort, label: string, right = false) => (
    <th
      onClick={() => setSort(key)}
      className={`sticky top-0 cursor-pointer select-none border-b border-line bg-ground px-4 py-2.5 text-xs font-bold uppercase tracking-wide hover:text-ink ${
        sort === key ? 'text-ink' : 'text-muted'
      } ${right ? 'text-right' : 'text-left'}`}>
      {label}
      {sort === key ? ' ↓' : ''}
    </th>
  );
  return (
    <table className="w-full min-w-[40rem] border-collapse text-sm">
      <thead>
        <tr>
          {header('name', 'Table')}
          <th className="sticky top-0 border-b border-line bg-ground px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted">
            Model
          </th>
          <th className="sticky top-0 border-b border-line bg-ground px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-muted">
            Columns
          </th>
          <th className="sticky top-0 border-b border-line bg-ground px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-muted">
            Indexes
          </th>
          {header('rows', 'Rows', true)}
          {header('size', 'Size', true)}
        </tr>
      </thead>
      <tbody>
        {sorted.map((t) => (
          <tr
            key={t.table}
            onClick={() => onOpen(t.table)}
            className="cursor-pointer border-b border-line transition hover:bg-ground/60">
            <td className="px-4 py-2.5 font-mono text-[13px] font-semibold text-ink">{t.table}</td>
            <td className="px-4 py-2.5 text-muted">{t.model}</td>
            <td className="tnum px-4 py-2.5 text-right text-muted">{t.columns.length}</td>
            <td className="tnum px-4 py-2.5 text-right text-muted">{t.indexes.length}</td>
            <td className="tnum px-4 py-2.5 text-right text-ink">{fmtRows(t)}</td>
            <td className="tnum px-4 py-2.5 text-right text-muted">{fmtBytes(t.totalBytes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableDetail({
  table,
  initialFilter,
  tab,
  onTab,
  onOpenTable,
  onOpenEnum,
  isEnum,
}: {
  table: SchemaTable;
  initialFilter?: DataFilter;
  tab: Tab;
  onTab: (t: Tab) => void;
  onOpenTable: (t: string, filter?: DataFilter) => void;
  onOpenEnum: (e: string) => void;
  isEnum: (type: string) => boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-line p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TableIcon />
          <h2 className="font-mono text-lg font-bold text-ink">{table.table}</h2>
          {table.model !== table.table ? (
            <span className="text-sm text-muted">model {table.model}</span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Chip label="Rows" value={fmtRows(table)} />
          <Chip label="Size" value={fmtBytes(table.totalBytes)} />
          <Chip label="Primary key" value={table.primaryKey.join(', ') || '—'} mono />
        </div>
        {table.documentation ? <Doc text={table.documentation} /> : null}
      </div>

      <div className="flex gap-1 border-b border-line px-3">
        {(
          [
            ['data', 'Data'],
            ['columns', `Columns (${table.columns.length})`],
            ['relations', `Relations (${table.relations.length})`],
            ['indexes', `Indexes (${table.indexes.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onTab(key)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
              tab === key
                ? 'border-brand text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'data' ? (
        <TableData table={table} initialFilter={initialFilter} onOpenRef={onOpenTable} />
      ) : null}

      <div className={tab === 'data' ? 'hidden' : 'overflow-x-auto'}>
        {tab === 'data' ? null : tab === 'columns' ? (
          <Grid
            headers={['#', 'Column', 'Type', 'Null', 'Default', 'Keys', 'Notes']}
            rows={table.columns.map((c, i) => [
              <span key="i" className="tnum text-muted">
                {i + 1}
              </span>,
              <span key="n" className="font-mono font-semibold text-ink">
                {c.column}
                {c.column !== c.name ? (
                  <span className="block text-[11px] font-normal text-muted">field {c.name}</span>
                ) : null}
              </span>,
              c.kind === 'enum' && isEnum(c.type) ? (
                <button
                  key="t"
                  type="button"
                  onClick={() => onOpenEnum(c.type)}
                  className="font-mono text-accent-deep hover:underline">
                  {c.type}
                  {c.isList ? '[]' : ''}
                </button>
              ) : (
                <span key="t" className="font-mono text-brand-deep">
                  {c.type}
                  {c.isList ? '[]' : ''}
                </span>
              ),
              <span key="nl" className={c.nullable ? 'text-muted' : 'font-semibold text-ink'}>
                {c.nullable ? 'NULL' : 'NOT NULL'}
              </span>,
              <span key="d" className="font-mono text-xs text-muted">
                {c.isUpdatedAt ? '@updatedAt' : (c.default ?? '')}
              </span>,
              <span key="k" className="flex flex-wrap gap-1">
                {c.isId ? <Badge label="PK" tone="accent" /> : null}
                {c.isUnique ? <Badge label="UNIQUE" tone="ok" /> : null}
                {c.references ? (
                  <button
                    type="button"
                    onClick={() => onOpenTable(c.references!.table)}
                    title={`ON DELETE ${c.references.onDelete}`}
                    className="rounded-full border border-line bg-ground px-2 py-0.5 font-mono text-[11px] text-ink hover:border-brand">
                    FK → {c.references.table}.{c.references.column}
                  </button>
                ) : null}
              </span>,
              <span key="doc" className="block max-w-[22rem] whitespace-pre-line text-xs text-muted">
                {c.documentation ?? ''}
              </span>,
            ])}
          />
        ) : tab === 'relations' ? (
          table.relations.length === 0 ? (
            <Empty text="No relations." />
          ) : (
            <Grid
              headers={['Name', 'Type', 'Table', 'Join', 'On delete']}
              rows={table.relations.map((r) => [
                <span key="n" className="font-mono font-semibold text-ink">
                  {r.name}
                </span>,
                <Badge
                  key="c"
                  label={r.cardinality}
                  tone={r.cardinality === 'one-to-many' ? 'neutral' : 'ok'}
                />,
                <button
                  key="t"
                  type="button"
                  onClick={() => onOpenTable(r.table)}
                  className="font-mono text-brand-deep hover:underline">
                  {r.table}
                </button>,
                <span key="j" className="font-mono text-xs text-muted">
                  {r.fields.length
                    ? `${r.fields.join(', ')} → ${r.table}.${r.references.join(', ')}`
                    : `key held by ${r.table}`}
                </span>,
                <span key="d" className="font-mono text-xs text-muted">
                  {r.onDelete ?? ''}
                </span>,
              ])}
            />
          )
        ) : table.indexes.length === 0 ? (
          <Empty text="No indexes found in the database for this table." />
        ) : (
          <Grid
            headers={['Name', 'Kind', 'Method', 'Definition']}
            rows={table.indexes.map((ix) => [
              <span key="n" className="font-mono font-semibold text-ink">
                {ix.name}
              </span>,
              <span key="k" className="flex gap-1">
                {ix.primary ? <Badge label="PRIMARY" tone="accent" /> : null}
                {ix.unique && !ix.primary ? <Badge label="UNIQUE" tone="ok" /> : null}
                {!ix.unique ? <Badge label="INDEX" tone="neutral" /> : null}
              </span>,
              <span key="m" className="font-mono text-xs uppercase text-muted">
                {ix.method}
              </span>,
              <code key="d" className="block whitespace-pre-wrap break-all font-mono text-xs text-ink">
                {ix.definition}
              </code>,
            ])}
          />
        )}
      </div>
    </div>
  );
}

function EnumDetail({
  value,
  tables,
  onOpenTable,
}: {
  value: SchemaEnum;
  tables: SchemaTable[];
  onOpenTable: (t: string) => void;
}) {
  const usedBy = tables.flatMap((t) =>
    t.columns.filter((c) => c.type === value.name).map((c) => ({ table: t.table, column: c.column })),
  );
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-center gap-2">
        <EnumIcon />
        <h2 className="font-mono text-lg font-bold text-ink">{value.name}</h2>
        <span className="text-sm text-muted">enum</span>
      </div>
      {value.documentation ? <Doc text={value.documentation} /> : null}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          Values ({value.values.length})
        </p>
        <div className="flex flex-wrap gap-2">
          {value.values.map((v) => (
            <span
              key={v}
              className="rounded-lg border border-line bg-ground px-2.5 py-1 font-mono text-sm text-ink">
              {v}
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Used by</p>
        {usedBy.length === 0 ? (
          <p className="text-sm text-muted">No column uses this enum.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {usedBy.map((u) => (
              <li key={`${u.table}.${u.column}`}>
                <button
                  type="button"
                  onClick={() => onOpenTable(u.table)}
                  className="font-mono text-brand-deep hover:underline">
                  {u.table}.{u.column}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Grid({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full min-w-[48rem] border-collapse text-sm">
      <thead>
        <tr>
          {headers.map((h) => (
            <th
              key={h}
              className="sticky top-0 border-b border-line bg-ground px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i} className="border-b border-line align-top transition hover:bg-ground/50">
            {cells.map((cell, j) => (
              <td key={j} className="px-4 py-2.5">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExplorerButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
        active ? 'bg-brand text-white [&_span]:text-white' : 'text-ink hover:bg-surface'
      }`}>
      {children}
    </button>
  );
}

function Chip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-muted">
      {label}:{' '}
      <span className={`tnum font-semibold text-ink ${mono ? 'font-mono' : ''}`}>{value}</span>
    </span>
  );
}

function Doc({ text }: { text: string }) {
  return (
    <p className="mt-3 whitespace-pre-line rounded-lg border border-line bg-ground px-3 py-2 text-sm text-muted">
      {text}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-5 text-sm text-muted">{text}</p>;
}

function TableIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="M2.5 8h15M8 8v8.5" />
    </svg>
  );
}

function EnumIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path d="M4 5h12M4 10h12M4 15h7" />
    </svg>
  );
}

function SqlIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path d="M5 7l3 3-3 3M10 13h5" />
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
    </svg>
  );
}

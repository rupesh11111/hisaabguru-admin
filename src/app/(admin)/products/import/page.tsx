'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Input,
  StatTile,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { BarcodeLookupError, assertScannableBarcode, lookupBarcode } from '@/lib/openfoodfacts';
import type {
  BulkImportResult,
  BulkImportRowResult,
  UpsertProductInput,
} from '@/lib/types';

const SAMPLE = `name,category,unit,barcodes,pack size
Parle-G Biscuit 100g,Biscuits,packet,8901719101083,100 g
Coca Cola Can 330ml,Beverages,can,049000006346|8901234567894,330 ml`;

type ParsedRow = UpsertProductInput & { line: number; error?: string };

/**
 * Why this row must not be sent. A blank name fails DTO validation, which rejects the
 * whole batch. A blank category or unit would pass and quietly become the server's
 * fallback, so the admin gets to fill it in first.
 */
function rowProblem(r: ParsedRow): string | undefined {
  if (r.error) return r.error;
  const missing = [
    !r.name.trim() && 'name',
    !r.category.trim() && 'category',
    !r.unit.trim() && 'unit',
  ].filter(Boolean);
  return missing.length > 0 ? `${missing.join(', ')} khaali hai` : undefined;
}

/** What the server turned a row's text into, so a mapped row isn't mistaken for as-typed. */
function describeMapped(mapped: BulkImportRowResult['mapped']): string | undefined {
  if (!mapped) return undefined;
  const parts = [
    mapped.category && `Category: "${mapped.category.from}" → "${mapped.category.to}"`,
    mapped.unit && `Unit: "${mapped.unit.from}" → "${mapped.unit.to}"`,
    mapped.packSize && `Pack size: "${mapped.packSize}"`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * CSV parser for the paste box.
 *
 * Deliberately small: this consumes a sheet an admin exported, not arbitrary CSV.
 * It handles quoted fields (so "Biscuit, 100g" survives) but not embedded newlines —
 * a row is always one line, which keeps error messages pointing at real line numbers.
 */
function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current);
    return out.map((c) => c.trim());
  };

  const header = splitLine(lines[0] ?? '').map((h) => h.toLowerCase());
  const hasHeader = header.includes('name');
  const cols = hasHeader
    ? {
        name: header.indexOf('name'),
        category: header.indexOf('category'),
        unit: header.indexOf('unit'),
        barcodes: header.indexOf('barcodes'),
        packSize: header.findIndex((h) => /^pack[ _]?size$/.test(h)),
      }
    : // Last, not beside unit: a headerless sheet from before this column stays valid.
      { name: 0, category: 1, unit: 2, barcodes: 3, packSize: 4 };

  const body = hasHeader ? lines.slice(1) : lines;

  return body.map((line, i) => {
    const cells = splitLine(line);
    const at = (idx: number) => (idx >= 0 ? (cells[idx] ?? '') : '');
    const lineNo = i + (hasHeader ? 2 : 1);

    const rawBarcodes = at(cols.barcodes)
      .split(/[|;\s]+/)
      .map((b) => b.trim())
      .filter(Boolean);

    let error: string | undefined;
    const barcodes: string[] = [];
    for (const raw of rawBarcodes) {
      try {
        barcodes.push(assertScannableBarcode(raw));
      } catch (err) {
        // Flagged locally so the admin can fix it before spending an API call.
        error = err instanceof BarcodeLookupError ? err.message : `Invalid barcode ${raw}`;
      }
    }
    if (!error && !at(cols.name)) error = 'name column khaali hai';

    return {
      line: lineNo,
      name: at(cols.name),
      category: at(cols.category),
      unit: at(cols.unit),
      packSize: at(cols.packSize),
      barcodes,
      error,
    };
  });
}

export default function ProductImportPage() {
  const [mode, setMode] = useState<'csv' | 'scan'>('csv');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const parsed = useMemo(() => (mode === 'csv' ? parseCsv(csv) : []), [csv, mode]);

  // Scan queue state
  const [scanDraft, setScanDraft] = useState('');
  const [scanRows, setScanRows] = useState<ParsedRow[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const rows = mode === 'csv' ? parsed : scanRows;
  const validRows = rows.filter((r) => !rowProblem(r));
  // Rows with `error` already explain themselves; these are the ones only this check stops.
  const blankRows = rows.filter((r) => !r.error && rowProblem(r)).length;

  const addScan = async () => {
    const raw = scanDraft.trim();
    if (!raw) return;
    let code: string;
    try {
      code = assertScannableBarcode(raw);
    } catch (err) {
      setScanError(err instanceof BarcodeLookupError ? err.message : 'Invalid barcode');
      return;
    }
    if (scanRows.some((r) => r.barcodes?.includes(code))) {
      setScanError('Yeh barcode queue me pehle se hai');
      return;
    }

    setScanError(null);
    setScanDraft('');
    setScanBusy(true);
    try {
      const found = await lookupBarcode(code);
      setScanRows((prev) => [
        ...prev,
        {
          line: prev.length + 1,
          name: found ? (found.brand ? `${found.brand} ${found.name}` : found.name) : '',
          category: found?.category ?? '',
          unit: 'piece',
          packSize: found?.quantity ?? '',
          barcodes: [code],
          error: found ? undefined : 'OpenFoodFacts me nahi mila — details bharein',
        },
      ]);
    } catch (err) {
      // Lookup failed, but the scan itself is still worth queueing.
      setScanRows((prev) => [
        ...prev,
        {
          line: prev.length + 1,
          name: '',
          category: '',
          unit: 'piece',
          packSize: '',
          barcodes: [code],
          error: err instanceof BarcodeLookupError ? err.message : 'Lookup fail',
        },
      ]);
    } finally {
      setScanBusy(false);
    }
  };

  const editScanRow = (index: number, patch: Partial<ParsedRow>) => {
    setScanRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        // Once every required field is filled the row is importable again.
        next.error = next.name.trim() && next.category.trim() && next.unit.trim()
          ? undefined
          : r.error;
        return next;
      }),
    );
  };

  const runImport = async () => {
    if (validRows.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload: UpsertProductInput[] = validRows.map((r) => ({
        name: r.name.trim(),
        category: r.category.trim(),
        unit: r.unit.trim(),
        // Omitted when blank: a sheet without this column must not wipe stored pack sizes.
        packSize: r.packSize?.trim() || undefined,
        barcodes: r.barcodes,
      }));
      setResult(await adminApi.bulkImportProducts(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fail');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/products" className="text-sm text-muted hover:text-ink">
          ← Products
        </Link>
        <h1 className="mt-1 text-2xl font-black text-ink">Bulk import</h1>
        <p className="text-sm text-muted">
          Ek saath kai products catalog me daalein. Jis barcode ka product pehle se hai,
          wo update ho jayega — dobara import karna safe hai.
        </p>
      </header>

      <div className="flex gap-2">
        <Button
          variant={mode === 'csv' ? 'primary' : 'secondary'}
          onClick={() => setMode('csv')}>
          CSV paste
        </Button>
        <Button
          variant={mode === 'scan' ? 'primary' : 'secondary'}
          onClick={() => setMode('scan')}>
          Scan queue
        </Button>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {mode === 'csv' ? (
        <Card
          title="CSV paste karein"
          subtitle="Columns: name, category, unit, barcodes, pack size. Header optional. Ek se zyada barcode ho to | ya space se alag karein. Jo category/unit list me nahi, unhe server map karta hai — neeche result me dikhega."
          actions={
            <Button variant="secondary" onClick={() => setCsv(SAMPLE)}>
              Sample bharein
            </Button>
          }>
          <Textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={SAMPLE}
            rows={10}
          />
        </Card>
      ) : (
        <Card
          title="Scan queue"
          subtitle="USB scanner se ek ke baad ek scan karte jaayein — har code ka naam OpenFoodFacts se apne aap bhar jayega.">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Scan ya barcode type karein"
                value={scanDraft}
                onChange={(e) => {
                  setScanDraft(e.target.value);
                  setScanError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addScan();
                  }
                }}
                placeholder="8901719101083"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                error={scanError ?? undefined}
                hint="Scanner Enter bhejta hai, isliye scan ke baad row apne aap jud jayegi."
              />
            </div>
            <Button
              variant="secondary"
              className="mb-1"
              onClick={() => void addScan()}
              loading={scanBusy}>
              Add
            </Button>
          </div>
        </Card>
      )}

      {rows.length > 0 ? (
        <Card
          title={`${rows.length} rows — ${validRows.length} import hone laayak`}
          subtitle={`${
            blankRows > 0
              ? `${blankRows} rows me name, category ya unit khaali hai — bheji nahi jayengi. `
              : ''
          }${
            mode === 'scan'
              ? 'Khaali fields bhar dein; jo rows adhoori hain woh skip ho jayengi.'
              : 'Laal rows skip ho jayengi. CSV theek karke dobara paste karein.'
          }`}
          actions={
            <Button onClick={() => void runImport()} loading={busy} disabled={validRows.length === 0}>
              {validRows.length} products import karein
            </Button>
          }>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Name</Th>
                <Th>Category</Th>
                <Th>Unit</Th>
                <Th>Pack size</Th>
                <Th>Barcodes</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.line}-${i}`} className={rowProblem(r) ? 'bg-danger-tint/40' : ''}>
                  <Td className="tnum text-muted">{r.line}</Td>
                  <Td>
                    {mode === 'scan' ? (
                      <input
                        value={r.name}
                        onChange={(e) => editScanRow(i, { name: e.target.value })}
                        placeholder="Product name"
                        className="w-44 rounded border border-line bg-surface px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="font-semibold text-ink">{r.name || '—'}</span>
                    )}
                    {rowProblem(r) ? (
                      <p className="mt-1 text-xs font-medium text-danger">{rowProblem(r)}</p>
                    ) : null}
                  </Td>
                  <Td>
                    {mode === 'scan' ? (
                      <input
                        value={r.category}
                        onChange={(e) => editScanRow(i, { category: e.target.value })}
                        placeholder="Category"
                        className="w-32 rounded border border-line bg-surface px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="text-muted">{r.category || '—'}</span>
                    )}
                  </Td>
                  <Td>
                    {mode === 'scan' ? (
                      <input
                        value={r.unit}
                        onChange={(e) => editScanRow(i, { unit: e.target.value })}
                        placeholder="Unit"
                        className="w-24 rounded border border-line bg-surface px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="text-muted">{r.unit || '—'}</span>
                    )}
                  </Td>
                  <Td>
                    {mode === 'scan' ? (
                      <input
                        value={r.packSize ?? ''}
                        onChange={(e) => editScanRow(i, { packSize: e.target.value })}
                        placeholder="100 g"
                        className="w-24 rounded border border-line bg-surface px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="text-muted">{r.packSize || '—'}</span>
                    )}
                  </Td>
                  <Td className="tnum font-mono text-xs text-muted">
                    {r.barcodes?.join(', ') || '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {result ? (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatTile label="Total" value={result.summary.total} />
            <StatTile label="Created" value={result.summary.created} />
            <StatTile label="Updated" value={result.summary.updated} />
            <StatTile label="Failed" value={result.summary.failed} />
          </div>

          <Card title="Import result" subtitle="Har row ka apna outcome.">
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>Status</Th>
                  <Th>Message</Th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.index}>
                    <Td>
                      {r.productId ? (
                        <Link
                          href={`/products/${r.productId}`}
                          className="font-semibold text-ink hover:text-brand-deep hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        <span className="font-semibold text-ink">{r.name}</span>
                      )}
                    </Td>
                    <Td>
                      <Badge
                        label={r.status}
                        tone={
                          r.status === 'failed'
                            ? 'danger'
                            : r.status === 'created'
                              ? 'ok'
                              : 'accent'
                        }
                      />
                    </Td>
                    <Td className="text-muted">
                      {r.message ?? describeMapped(r.mapped) ?? '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      ) : null}
    </div>
  );
}

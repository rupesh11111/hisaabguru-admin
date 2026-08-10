'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';

import { Badge, Button, Card, EmptyState } from '@/components/ui';
import {
  BarcodeLookupError,
  fetchRawBarcodeRecord,
  type DatabaseId,
} from '@/lib/openfoodfacts';

/**
 * Inspector for the Open*Facts record cached on a catalog product.
 *
 * The upstream shape is crowd-sourced and drifts constantly, so nothing here assumes
 * a field exists — every accessor is defensive, and whatever is not recognised still
 * shows up in the raw JSON at the bottom. That view is the source of truth; the
 * curated sections above it are only a convenience.
 */

type Json = Record<string, unknown>;

function str(data: Json, key: string): string | undefined {
  const v = data[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

/**
 * The cache holds one of two shapes: the whole v0 envelope `{ status, product }`
 * written by older mobile scans, or the bare product object written by this panel.
 * Unwrap so both render identically instead of showing an almost-empty card.
 */
function unwrapProduct(raw: Json | null | undefined): Json | null {
  if (!raw) return null;
  const inner = raw.product;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Json;
  }
  return raw;
}

const IMAGE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'image_front_url', label: 'Front' },
  { key: 'image_ingredients_url', label: 'Ingredients' },
  { key: 'image_nutrition_url', label: 'Nutrition' },
  { key: 'image_packaging_url', label: 'Packaging' },
];

const FACT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'code', label: 'Barcode' },
  { key: 'product_name', label: 'Name' },
  { key: 'brands', label: 'Brand' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'categories', label: 'Categories' },
  { key: 'labels', label: 'Labels' },
  { key: 'packaging', label: 'Packaging' },
  { key: 'serving_size', label: 'Serving size' },
  { key: 'countries', label: 'Countries' },
  { key: 'stores', label: 'Stores' },
  { key: 'allergens', label: 'Allergens' },
  { key: 'nutriscore_grade', label: 'Nutri-Score' },
  { key: 'nova_group', label: 'NOVA group' },
  { key: 'ecoscore_grade', label: 'Eco-Score' },
];

/** Per 100 g/ml — the basis Open*Facts normalises everything to. */
const NUTRIENTS: Array<{ key: string; label: string; unit: string }> = [
  { key: 'energy-kcal_100g', label: 'Energy', unit: 'kcal' },
  { key: 'fat_100g', label: 'Fat', unit: 'g' },
  { key: 'saturated-fat_100g', label: 'Saturated fat', unit: 'g' },
  { key: 'carbohydrates_100g', label: 'Carbohydrates', unit: 'g' },
  { key: 'sugars_100g', label: 'Sugars', unit: 'g' },
  { key: 'fiber_100g', label: 'Fibre', unit: 'g' },
  { key: 'proteins_100g', label: 'Protein', unit: 'g' },
  { key: 'salt_100g', label: 'Salt', unit: 'g' },
];

export function OffDataPanel({
  data,
  barcodes,
  onChange,
}: {
  data: Json | null;
  barcodes: string[];
  /** Staged into the form — persisted only when the admin saves. */
  onChange: (next: Json | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState<DatabaseId | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const product = useMemo(() => unwrapProduct(data), [data]);

  const rawText = useMemo(
    () => (data ? JSON.stringify(data, null, 2) : ''),
    [data],
  );

  const fetchRecord = async () => {
    const code = barcodes[0];
    if (!code) {
      setMessage('Pehle ek barcode add karein.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const record = await fetchRawBarcodeRecord(code);
      if (!record) {
        setMessage(`${code}: Open*Facts me koi record nahi mila.`);
        return;
      }
      setSource(record.source);
      onChange(record.data);
      setMessage(
        `${record.source} database se ${Object.keys(record.data).length} fields aaye — Save karna na bhoolein.`,
      );
    } catch (err) {
      setMessage(err instanceof BarcodeLookupError ? err.message : 'Fetch fail');
    } finally {
      setBusy(false);
    }
  };

  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage('Clipboard access nahi mila — JSON manually select karein.');
    }
  };

  const images = IMAGE_FIELDS.map((f) => ({
    ...f,
    url: product ? str(product, f.key) : undefined,
  })).filter((f): f is typeof f & { url: string } => Boolean(f.url));

  const facts = FACT_FIELDS.map((f) => ({
    ...f,
    value: product ? str(product, f.key) : undefined,
  })).filter((f): f is typeof f & { value: string } => Boolean(f.value));

  const nutriments =
    product && typeof product.nutriments === 'object' && product.nutriments
      ? (product.nutriments as Json)
      : null;
  const nutritionRows = nutriments
    ? NUTRIENTS.map((n) => ({ ...n, value: str(nutriments, n.key) })).filter(
        (n): n is typeof n & { value: string } => Boolean(n.value),
      )
    : [];

  const ingredients = product ? str(product, 'ingredients_text') : undefined;
  const fieldCount = product ? Object.keys(product).length : 0;

  return (
    <Card
      title="OpenFoodFacts data"
      subtitle={
        product
          ? `${fieldCount} fields cached${source ? ` · ${source}` : ''}`
          : 'Barcode ka poora upstream record — images, nutrition, sab kuch.'
      }
      actions={
        <Button variant="secondary" onClick={() => void fetchRecord()} loading={busy}>
          {product ? 'Dobara laayein' : 'Fetch karein'}
        </Button>
      }>
      {message ? (
        <p className="mb-4 rounded-lg border border-line bg-ground px-3 py-2 text-sm text-muted">
          {message}
        </p>
      ) : null}

      {!product ? (
        <EmptyState
          title="Koi cached data nahi"
          description={
            barcodes.length === 0
              ? 'Pehle upar barcode add karein, phir yahan se Open*Facts ka poora record laayein.'
              : `${barcodes[0]} ka poora record laane ke liye "Fetch karein" dabaayein.`
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {images.length > 0 ? (
            <section>
              <SectionLabel>Images</SectionLabel>
              <div className="flex flex-wrap gap-3">
                {images.map((img) => (
                  <a
                    key={img.key}
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex flex-col gap-1">
                    <span className="relative block size-28 overflow-hidden rounded-lg border border-line bg-white">
                      <Image
                        src={img.url}
                        alt={img.label}
                        fill
                        sizes="112px"
                        className="object-contain p-1"
                        unoptimized
                      />
                    </span>
                    <span className="text-center text-xs font-semibold text-muted group-hover:text-brand-deep">
                      {img.label}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {facts.length > 0 ? (
            <section>
              <SectionLabel>Key facts</SectionLabel>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {facts.map((f) => (
                  <div key={f.key} className="flex flex-col">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {f.label}
                    </dt>
                    <dd className="break-words text-sm text-ink">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {nutritionRows.length > 0 ? (
            <section>
              <SectionLabel>Nutrition (per 100 g/ml)</SectionLabel>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <tbody>
                    {nutritionRows.map((n, i) => (
                      <tr key={n.key} className={i % 2 ? 'bg-ground/50' : ''}>
                        <td className="px-3 py-1.5 text-muted">{n.label}</td>
                        <td className="tnum px-3 py-1.5 text-right font-semibold text-ink">
                          {n.value} {n.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {ingredients ? (
            <section>
              <SectionLabel>Ingredients</SectionLabel>
              <p className="text-sm leading-relaxed text-ink">{ingredients}</p>
            </section>
          ) : null}

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>Raw JSON</SectionLabel>
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => setShowRaw((v) => !v)}>
                  {showRaw ? 'Chhupaayein' : 'Dikhaayein'}
                </Button>
                <Button variant="ghost" onClick={() => void copyRaw()}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button variant="ghost" onClick={() => onChange(null)}>
                  Clear
                </Button>
              </span>
            </div>
            <p className="mb-2 text-xs text-muted">
              <Badge label={`${(rawText.length / 1024).toFixed(1)} KB`} tone="neutral" />{' '}
              Upar ke sections sirf convenience hain — asli record yahi hai.
            </p>
            {showRaw ? (
              <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-ground p-3 font-mono text-[11px] leading-relaxed text-ink">
                {rawText}
              </pre>
            ) : null}
          </section>
        </div>
      )}
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
      {children}
    </h3>
  );
}

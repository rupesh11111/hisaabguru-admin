'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { OffDataPanel } from '@/components/off-data-panel';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Input,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { ApiError, adminApi } from '@/lib/api';
import {
  BarcodeLookupError,
  assertScannableBarcode,
  lookupBarcode,
} from '@/lib/openfoodfacts';
import type { ProductCorrection, ProductDetail } from '@/lib/types';

type Json = Record<string, unknown>;

type Form = {
  name: string;
  category: string;
  unit: string;
  barcodes: string[];
  offData: Json | null;
};

const EMPTY_FORM: Form = {
  name: '',
  category: '',
  unit: '',
  barcodes: [],
  offData: null,
};

function formOf(p: ProductDetail): Form {
  return {
    name: p.name,
    category: p.category,
    unit: p.unit,
    barcodes: p.barcodes,
    offData: p.openFoodFactsData,
  };
}

/** One screen serves both modes; `/products/new` routes here with id === 'new'. */
export default function ProductEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const isNew = id === 'new';

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  /** Last saved state — the baseline the dirty check compares against. */
  const [baseline, setBaseline] = useState<Form>(EMPTY_FORM);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [overrideCustomized, setOverrideCustomized] = useState(false);
  const [corrections, setCorrections] = useState<ProductCorrection[]>([]);
  const [verifying, setVerifying] = useState(false);

  const patch = useCallback(
    (next: Partial<Form>) => setForm((prev) => ({ ...prev, ...next })),
    [],
  );

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    adminApi
      .getProduct(id)
      .then((p) => {
        if (cancelled) return;
        setProduct(p);
        setForm(formOf(p));
        setBaseline(formOf(p));
        void adminApi.listProductCorrections(p.id).then(setCorrections);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Product load fail');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline),
    [form, baseline],
  );

  // Defensive: this page crashed once because an endpoint's declared type promised
  // `stockedBy` that the response never carried. Types across a network boundary are
  // a claim, not a guarantee — read it through a fallback.
  const stockedBy = product?.stockedBy ?? [];

  /** Validates first, so the dialog never opens on a form that cannot be saved. */
  const requestSave = () => {
    if (!form.name.trim() || !form.category.trim() || !form.unit.trim()) {
      setError('Name, category aur unit teeno zaroori hain');
      return;
    }
    setError(null);
    setConfirmSave(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input = {
        name: form.name.trim(),
        category: form.category.trim(),
        unit: form.unit.trim(),
        barcodes: form.barcodes,
        openFoodFactsData: form.offData,
      };
      if (isNew) {
        const created = await adminApi.createProduct(input);
        router.replace(`/products/${created.id}`);
        return;
      }
      const updated = await adminApi.updateProduct(id, {
        ...input,
        reason: reason.trim() || undefined,
        overrideCustomized,
      });
      setProduct(updated);
      setBaseline(formOf(updated));
      setForm(formOf(updated));
      setReason('');
      setOverrideCustomized(false);
      // Report the real reach of the edit — how many shops it rewrote, and how many
      // it left alone because they had made that field their own.
      const c = updated.correction;
      setNotice(
        c
          ? `Save ho gaya — ${c.propagatedCount} shop row update hui${
              c.skippedCount > 0
                ? `, ${c.skippedCount} chhodi gayi (unhone khud badla tha)`
                : ''
            }.`
          : 'Save ho gaya — display data me koi badlav nahi tha.',
      );
      void adminApi.listProductCorrections(id).then(setCorrections);
    } catch (err) {
      // A 409 here means another catalog row already claims one of these barcodes.
      setError(err instanceof ApiError ? err.message : 'Save fail');
    } finally {
      setSaving(false);
      setConfirmSave(false);
    }
  };

  /** What actually differs from the last saved state — the point of the dialog. */
  const changes = useMemo(() => {
    if (isNew) return [];
    const out: string[] = [];
    if (form.name !== baseline.name) out.push(`Name: "${baseline.name}" → "${form.name}"`);
    if (form.category !== baseline.category) {
      out.push(`Category: "${baseline.category}" → "${form.category}"`);
    }
    if (form.unit !== baseline.unit) out.push(`Unit: "${baseline.unit}" → "${form.unit}"`);

    const added = form.barcodes.filter((b) => !baseline.barcodes.includes(b));
    const removed = baseline.barcodes.filter((b) => !form.barcodes.includes(b));
    if (added.length) out.push(`Barcodes add: ${added.join(', ')}`);
    if (removed.length) out.push(`Barcodes remove: ${removed.join(', ')}`);

    const before = baseline.offData ? 'cached' : 'khaali';
    const after = form.offData ? 'cached' : 'khaali';
    if (before !== after) out.push(`OpenFoodFacts data: ${before} → ${after}`);
    else if (JSON.stringify(form.offData) !== JSON.stringify(baseline.offData)) {
      out.push('OpenFoodFacts data refresh hui');
    }
    return out;
  }, [form, baseline, isNew]);

  const setVerification = async (action: 'verify' | 'reject') => {
    setVerifying(true);
    setError(null);
    try {
      const updated =
        action === 'verify'
          ? await adminApi.verifyProduct(id)
          : await adminApi.rejectProduct(id);
      setProduct((prev) => (prev ? { ...prev, ...updated } : updated));
      setNotice(
        action === 'verify'
          ? 'Approve ho gaya — ab doosri shops ko bhi prefill me milega.'
          : 'Reject ho gaya — kisi shop ko prefill me nahi milega.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action fail');
    } finally {
      setVerifying(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await adminApi.deleteProduct(id);
      router.replace('/products');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete fail');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-4">
      {/* Actions stay reachable however far the admin scrolls into the raw JSON. */}
      <header className="sticky top-0 z-20 -mx-6 flex flex-wrap items-end justify-between gap-3 border-b border-line bg-ground/95 px-6 py-4 backdrop-blur">
        <div className="min-w-0">
          <Link href="/products" className="text-sm text-muted hover:text-ink">
            ← Products
          </Link>
          <h1 className="mt-1 truncate text-2xl font-black text-ink">
            {isNew ? 'Naya product' : form.name || (product?.name ?? 'Product')}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {product ? (
              <>
                <span>{stockedBy.length} shops stock kar rahi hain</span>
                <span aria-hidden>·</span>
                <span className="tnum">
                  updated {new Date(product.updatedAt).toLocaleString()}
                </span>
              </>
            ) : (
              <span>Global catalog me naya item add karein.</span>
            )}
            {dirty ? <Badge label="Unsaved changes" tone="accent" /> : null}
            {product ? (
              <>
                <Badge
                  label={
                    product.verification === 'verified'
                      ? 'Verified'
                      : product.verification === 'rejected'
                        ? 'Rejected'
                        : 'Provisional'
                  }
                  tone={
                    product.verification === 'verified'
                      ? 'ok'
                      : product.verification === 'rejected'
                        ? 'danger'
                        : 'accent'
                  }
                />
                <Badge label={product.source} tone="neutral" />
                {product.consensusShops >= 3 ? (
                  <Badge
                    label={`${product.consensusShops} shops agree`}
                    tone="ok"
                  />
                ) : null}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {product && product.verification !== 'verified' ? (
            <Button
              variant="primary"
              onClick={() => void setVerification('verify')}
              loading={verifying}>
              Approve
            </Button>
          ) : null}
          {product && product.verification !== 'rejected' ? (
            <Button
              variant="secondary"
              onClick={() => void setVerification('reject')}
              disabled={verifying}>
              Reject
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => router.push('/products')}>
            Cancel
          </Button>
          <Button onClick={requestSave} loading={saving} disabled={!dirty && !isNew}>
            {isNew ? 'Create product' : 'Save changes'}
          </Button>
        </div>
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <p className="rounded-lg border border-ok/30 bg-ok-tint px-3 py-2 text-sm font-medium text-ok">
          {notice}
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Card
            title="Details"
            subtitle="Yeh master data sab shops ko dikhta hai jab woh barcode scan karti hain.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Product name *"
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="Parle-G Biscuit 100g"
                />
              </div>
              <Input
                label="Category *"
                value={form.category}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder="Biscuits"
              />
              <Input
                label="Unit *"
                value={form.unit}
                onChange={(e) => patch({ unit: e.target.value })}
                placeholder="packet"
              />
            </div>
          </Card>

          <BarcodesCard
            barcodes={form.barcodes}
            onChange={(barcodes) => patch({ barcodes })}
            onPrefill={(p) => {
              // Never clobber what the admin already typed — fill only the blanks.
              patch({
                name: form.name.trim() || (p.brand ? `${p.brand} ${p.name}` : p.name),
                category: form.category.trim() || p.category || '',
                unit: form.unit.trim() || p.quantity || '',
              });
            }}
          />

          {product ? (
            <Card title={`Stocked by ${stockedBy.length} shop(s)`}>
              {stockedBy.length === 0 ? (
                <EmptyState
                  title="Zero shops"
                  description="Naya product hai, ya sab shops ne archive kar diya."
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Shop</Th>
                      <Th>City</Th>
                      <Th align="right">Stock</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockedBy.map((s) => (
                      <tr key={s.shopId} className="transition hover:bg-ground/60">
                        <Td>
                          <Link
                            href={`/shops/${s.shopId}`}
                            className="font-semibold text-ink hover:text-brand-deep hover:underline">
                            {s.shopName}
                          </Link>
                        </Td>
                        <Td className="text-muted">{s.city}</Td>
                        <Td align="right" className="tnum text-muted">
                          {s.stockQuantity}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          ) : null}

          {corrections.length > 0 ? (
            <Card
              title={`Correction history (${corrections.length})`}
              subtitle="Har change ka record — kya badla, kisne badla, kitni shops par asar pada.">
              <Table>
                <thead>
                  <tr>
                    <Th>Change</Th>
                    <Th>Reason</Th>
                    <Th>By</Th>
                    <Th align="right">Reach</Th>
                  </tr>
                </thead>
                <tbody>
                  {corrections.map((c) => (
                    <tr key={c.id}>
                      <Td>
                        {c.changedFields.map((f) => (
                          <div key={f} className="text-xs">
                            <span className="text-muted">{f}: </span>
                            <span className="line-through opacity-60">
                              {String(c.before[f] ?? '')}
                            </span>{' '}
                            → <span className="font-semibold">{String(c.after[f] ?? '')}</span>
                          </div>
                        ))}
                        <p className="tnum mt-0.5 text-xs text-muted">
                          {new Date(c.createdAt).toLocaleString()}
                        </p>
                      </Td>
                      <Td className="text-muted">{c.reason ?? '—'}</Td>
                      <Td className="tnum text-muted">
                        {c.correctedByPhone ?? 'system'}
                        {c.forced ? (
                          <span className="ml-1">
                            <Badge label="forced" tone="danger" />
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right" className="tnum text-muted">
                        {c.propagatedCount} updated
                        {c.skippedCount > 0 ? ` · ${c.skippedCount} skipped` : ''}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}

          {!isNew ? (
            <Card
              title="Danger zone"
              subtitle="Delete karne par inventory rows ka snapshot data bacha rahega — sirf catalog link tutta hai.">
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete product
              </Button>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <OffDataPanel
            data={form.offData}
            barcodes={form.barcodes}
            onChange={(offData) => patch({ offData })}
          />

          {product ? (
            <Card title="Record">
              <dl className="flex flex-col gap-2 text-sm">
                <MetaRow label="Product ID" value={product.id} mono />
                <MetaRow
                  label="Created"
                  value={new Date(product.createdAt).toLocaleString()}
                />
                <MetaRow
                  label="Updated"
                  value={new Date(product.updatedAt).toLocaleString()}
                />
                <MetaRow
                  label="Archived"
                  value={
                    product.archivedAt
                      ? new Date(product.archivedAt).toLocaleString()
                      : 'nahi'
                  }
                />
              </dl>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSave}
        tone="primary"
        title={isNew ? 'Product create karein?' : 'Changes save karein?'}
        message={
          isNew
            ? `"${form.name.trim()}" global catalog me add ho jayega — sab shops ise barcode scan pe dekhengi.`
            : 'Yeh master data sab shops ko dikhta hai. Neeche dekh lein ki kya badal raha hai.'
        }
        confirmLabel={isNew ? 'Haan, create karein' : 'Haan, save karein'}
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirmSave(false)}>
        {isNew ? (
          <ul className="flex flex-col gap-1 rounded-lg border border-line bg-ground p-3 text-sm text-ink">
            <li>Name: {form.name.trim()}</li>
            <li>Category: {form.category.trim()}</li>
            <li>Unit: {form.unit.trim()}</li>
            <li>
              Barcodes:{' '}
              {form.barcodes.length > 0 ? form.barcodes.join(', ') : 'koi nahi'}
            </li>
          </ul>
        ) : changes.length > 0 ? (
          <div className="flex flex-col gap-3">
            <ul className="flex list-disc flex-col gap-1 rounded-lg border border-line bg-ground p-3 pl-7 text-sm text-ink">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>

            {stockedBy.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
                  Kaunsi shop pe kya asar hoga
                </p>
                {/* Showing each shop's own value beside the new one is the point: it
                    is what lets the admin tell a typo from a deliberate rename. */}
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-ground text-sm">
                  {stockedBy.map((sh) => {
                    const skipped =
                      sh.nameCustomized ||
                      sh.categoryCustomized ||
                      sh.unitCustomized;
                    return (
                      <li
                        key={sh.shopId}
                        className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                        <span className="font-semibold text-ink">{sh.shopName}</span>
                        {skipped && !overrideCustomized ? (
                          <span className="text-xs text-muted">
                            &quot;{sh.name}&quot; — khud badla hai,{' '}
                            <span className="font-semibold text-accent-deep">
                              chhod diya jayega
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted">
                            &quot;{sh.name}&quot; →{' '}
                            <span className="font-semibold text-ok">
                              {form.name.trim()}
                            </span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {stockedBy.some(
              (sh) =>
                sh.nameCustomized || sh.categoryCustomized || sh.unitCustomized,
            ) ? (
              <label className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent-tint p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={overrideCustomized}
                  onChange={(e) => setOverrideCustomized(e.target.checked)}
                />
                <span>
                  <span className="block font-semibold text-ink">
                    Jinhone khud badla hai unko bhi overwrite karein
                  </span>
                  <span className="block text-xs text-muted">
                    Tabhi lagayein jab wo rename nahi, typo ho. Audit me{' '}
                    <code>forced</code> record hoga.
                  </span>
                </span>
              </label>
            ) : null}

            <Input
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Typo fix, packaging change…"
              hint="Audit log me dikhega."
            />
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-ground p-3 text-sm text-muted">
            Koi badlav detect nahi hua.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        title="Product delete karein?"
        message={`"${product?.name ?? ''}" global catalog se hat jayega. Shops ka apna data safe rahega.`}
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd
        className={`min-w-0 truncate text-right text-ink ${mono ? 'font-mono text-xs' : 'tnum text-sm'}`}>
        {value}
      </dd>
    </div>
  );
}

type PrefillSource = {
  name: string;
  brand?: string;
  category?: string;
  quantity?: string;
};

/**
 * Barcode editor.
 *
 * A desk admin scans with a USB reader in keyboard-wedge mode: it types the digits
 * into whatever is focused and presses Enter. So the input just needs to accept
 * Enter — no camera, no permissions, and it works with typing too.
 */
function BarcodesCard({
  barcodes,
  onChange,
  onPrefill,
}: {
  barcodes: string[];
  onChange: (next: string[]) => void;
  onPrefill: (product: PrefillSource) => void;
}) {
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [looking, setLooking] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    let normalized: string;
    try {
      // Rejects mis-scans up front rather than letting a bad check digit reach the API.
      normalized = assertScannableBarcode(raw);
    } catch (err) {
      setFieldError(err instanceof BarcodeLookupError ? err.message : 'Invalid barcode');
      return;
    }
    if (barcodes.includes(normalized)) {
      setFieldError('Yeh barcode pehle se list me hai');
      return;
    }
    onChange([...barcodes, normalized]);
    setDraft('');
    setFieldError(null);
  };

  const lookup = async (code: string) => {
    setLooking(code);
    setLookupNote(null);
    try {
      const found = await lookupBarcode(code);
      if (!found) {
        setLookupNote(`${code}: Open*Facts me record nahi hai — manually bharein`);
        return;
      }
      onPrefill(found);
      setLookupNote(
        found.nameIsGuessed
          ? `Aadhi detail mili (${found.source}) — naam check kar lein`
          : `Mil gaya: ${found.name} (${found.source})`,
      );
    } catch (err) {
      setLookupNote(err instanceof BarcodeLookupError ? err.message : 'Lookup fail');
    } finally {
      setLooking(null);
    }
  };

  return (
    <Card
      title="Barcodes"
      subtitle="USB scanner seedha yahan scan kar sakta hai — wo digits type karke Enter dabata hai.">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Input
              label="Barcode add karein"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setFieldError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="8901719101083"
              inputMode="numeric"
              autoComplete="off"
              error={fieldError ?? undefined}
              hint="EAN-13 / UPC-A / UPC-E. Check digit verify hota hai, aur GTIN-13 me normalize."
            />
          </div>
          <Button variant="secondary" onClick={add} className="mt-7">
            Add
          </Button>
        </div>

        {barcodes.length === 0 ? (
          <p className="text-sm text-muted">Abhi koi barcode nahi joda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {barcodes.map((code) => (
              <li
                key={code}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-ground/50 px-3 py-2">
                <span className="tnum font-mono text-sm text-ink">{code}</span>
                <span className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void lookup(code)}
                    loading={looking === code}>
                    Details bharein
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => onChange(barcodes.filter((b) => b !== code))}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {lookupNote ? <p className="text-sm text-muted">{lookupNote}</p> : null}
      </div>
    </Card>
  );
}

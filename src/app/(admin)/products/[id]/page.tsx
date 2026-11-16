'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fmtDateTime } from '@/lib/format';
import { MergeProductDialog } from '@/components/merge-product-dialog';
import { OffDataPanel } from '@/components/off-data-panel';
import { ProductPhotos } from '@/components/product-photos';
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
import { ApiError, adminApi, catalogOptionsApi } from '@/lib/api';
import { notifyCatalogChanged } from '@/lib/catalog-events';
import {
  BarcodeLookupError,
  assertScannableBarcode,
  lookupBarcode,
} from '@/lib/openfoodfacts';
import type { CatalogOption, ProductCorrection, ProductDetail } from '@/lib/types';

type Json = Record<string, unknown>;

type Form = {
  name: string;
  category: string;
  unit: string;
  packSize: string;
  barcodes: string[];
  offData: Json | null;
};

/** The API's limit. OFF text can run longer, and a prefill must not fail the save. */
const PACK_SIZE_MAX = 40;

const EMPTY_FORM: Form = {
  name: '',
  category: '',
  unit: 'piece',
  packSize: '',
  barcodes: [],
  offData: null,
};

function formOf(p: ProductDetail): Form {
  return {
    name: p.name,
    category: p.category,
    unit: p.unit,
    packSize: p.packSize ?? '',
    barcodes: p.barcodes,
    offData: p.openFoodFactsData,
  };
}

/**
 * Maps an upstream category onto the fixed list. Blank only when `Uncategorised` is
 * itself unavailable, so the form never holds a value the picker cannot show.
 */
function matchCategory(upstream: string | undefined, options: CatalogOption[]): string {
  const find = (text: string) =>
    options.find((o) =>
      [o.value, o.labelEnglish].some((v) => v.toLowerCase() === text),
    )?.value;
  const wanted = upstream?.trim().toLowerCase();
  return (wanted ? find(wanted) : undefined) ?? find('uncategorised') ?? '';
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
  const [archiving, setArchiving] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  /** Null until loaded, and stays null if loading failed. */
  const [catalog, setCatalog] = useState<{
    categories: CatalogOption[];
    units: CatalogOption[];
  } | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);

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
          setError(err instanceof Error ? err.message : 'Could not load product');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      catalogOptionsApi.list('CATEGORY'),
      catalogOptionsApi.list('UNIT'),
    ])
      .then(([categories, units]) => {
        if (!cancelled) setCatalog({ categories, units });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setOptionsError(err instanceof Error ? err.message : 'Could not load options');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setError('Name, category and unit are all required');
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
        // Null, not undefined: omitting it would leave a cleared field on the server.
        packSize: form.packSize.trim() || null,
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
          ? `Saved — ${c.propagatedCount} shop row(s) updated${
              c.skippedCount > 0
                ? `, ${c.skippedCount} skipped (customised by the shop)`
                : ''
            }.`
          : 'Saved — no change to display data.',
      );
      void adminApi.listProductCorrections(id).then(setCorrections);
    } catch (err) {
      // A 409 here means another catalog row already claims one of these barcodes.
      setError(err instanceof ApiError ? err.message : 'Save failed');
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
    if (form.packSize !== baseline.packSize) {
      out.push(`Pack size: "${baseline.packSize}" → "${form.packSize}"`);
    }

    const added = form.barcodes.filter((b) => !baseline.barcodes.includes(b));
    const removed = baseline.barcodes.filter((b) => !form.barcodes.includes(b));
    if (added.length) out.push(`Barcodes add: ${added.join(', ')}`);
    if (removed.length) out.push(`Barcodes remove: ${removed.join(', ')}`);

    const before = baseline.offData ? 'cached' : 'empty';
    const after = form.offData ? 'cached' : 'empty';
    if (before !== after) out.push(`OpenFoodFacts data: ${before} → ${after}`);
    else if (JSON.stringify(form.offData) !== JSON.stringify(baseline.offData)) {
      out.push('OpenFoodFacts data refreshed');
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
      notifyCatalogChanged();
      setNotice(
        action === 'verify'
          ? 'Approved — other shops will now get it as a prefill.'
          : 'Rejected — no shop will get it as a prefill.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setVerifying(false);
    }
  };

  const setArchived = async (archive: boolean) => {
    setArchiving(true);
    setError(null);
    try {
      if (archive) await adminApi.archiveProduct(id);
      else await adminApi.restoreProduct(id);
      const fresh = await adminApi.getProduct(id);
      setProduct(fresh);
      notifyCatalogChanged();
      setNotice(
        archive
          ? 'Archived — hidden from the catalog and never prefilled. Its barcodes stay claimed.'
          : 'Restored to the active catalog.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setArchiving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await adminApi.deleteProduct(id);
      router.replace('/products');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
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
            {isNew ? 'New product' : form.name || (product?.name ?? 'Product')}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {product ? (
              <>
                <span>Stocked by {stockedBy.length} shops</span>
                <span aria-hidden>·</span>
                <span className="tnum">
                  updated {fmtDateTime(product.updatedAt)}
                </span>
              </>
            ) : (
              <span>Add a new item to the global catalog.</span>
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
                {product.mergedIntoId ? (
                  <Badge label="Merged" tone="neutral" />
                ) : product.archivedAt ? (
                  <Badge label="Archived" tone="danger" />
                ) : null}
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
      {product?.mergedIntoId ? (
        <p className="rounded-lg border border-line bg-ground px-3 py-2 text-sm text-ink">
          This product was merged into{' '}
          {product.mergedInto ? (
            <Link
              href={`/products/${product.mergedInto.id}`}
              className="font-semibold text-brand-deep hover:underline">
              {product.mergedInto.name}
            </Link>
          ) : (
            'another product'
          )}
          . Its barcodes and shops moved there; edit that product instead.
        </p>
      ) : null}
      {optionsError ? (
        <ErrorNote
          message={`Could not load categories/units (${optionsError}). The current value can still be saved; reload the page to pick a new one.`}
        />
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-ok/30 bg-ok-tint px-3 py-2 text-sm font-medium text-ok">
          {notice}
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Card
            title="Details"
            subtitle="This master data is shown to every shop when it scans the barcode.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Product name *"
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="Parle-G Biscuit 100g"
                />
              </div>
              <OptionSelect
                label="Category *"
                value={form.category}
                saved={baseline.category}
                options={catalog?.categories ?? null}
                onChange={(category) => patch({ category })}
              />
              <OptionSelect
                label="Unit *"
                value={form.unit}
                saved={baseline.unit}
                options={catalog?.units ?? null}
                onChange={(unit) => patch({ unit })}
              />
              <Input
                label="Pack size"
                value={form.packSize}
                onChange={(e) => patch({ packSize: e.target.value })}
                placeholder="100 g"
                maxLength={PACK_SIZE_MAX}
                hint="How much is in one pack. Unit says how the item is counted."
              />
            </div>
          </Card>

          {product ? (
            // Merged, and the form left alone: a photo is applied at once and must not
            // disturb unsaved edits or the baseline the dirty check compares against.
            <ProductPhotos
              product={product}
              onChange={(updated) =>
                setProduct((prev) => (prev ? { ...prev, ...updated } : updated))
              }
            />
          ) : isNew ? (
            <Card title="Photos">
              <p className="text-sm text-muted">
                Save the product first, then you can add photos.
              </p>
            </Card>
          ) : null}

          <BarcodesCard
            barcodes={form.barcodes}
            onChange={(barcodes) => patch({ barcodes })}
            onPrefill={(p) => {
              // Never clobber what the admin already typed — fill only the blanks. Unit is
              // left alone: OFF's `quantity` is a pack size ("100 g"), not a unit. Functional
              // update because the lookup is async and the admin may type meanwhile.
              setForm((prev) => ({
                ...prev,
                name: prev.name.trim() || (p.brand ? `${p.brand} ${p.name}` : p.name),
                category:
                  prev.category.trim() ||
                  matchCategory(p.category, catalog?.categories ?? []),
                packSize:
                  prev.packSize.trim() ||
                  (p.quantity ?? '').slice(0, PACK_SIZE_MAX).trim(),
              }));
            }}
          />

          {product ? (
            <Card title={`Stocked by ${stockedBy.length} shop(s)`}>
              {stockedBy.length === 0 ? (
                <EmptyState
                  title="Zero shops"
                  description="New product, or every shop has archived it."
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
              subtitle="A record of every change: what changed, who changed it, and how many shops it reached.">
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
                          {fmtDateTime(c.createdAt)}
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

          {product && !product.mergedIntoId ? (
            <Card
              title="Clean up"
              subtitle="Archive hides a product but keeps its barcodes claimed, so a scan never creates a duplicate. Merge folds a duplicate into the product it duplicates.">
              <div className="flex flex-wrap gap-2">
                {product.archivedAt ? (
                  <Button
                    variant="secondary"
                    loading={archiving}
                    onClick={() => void setArchived(false)}>
                    Restore
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => setMergeOpen(true)}>
                      Merge into another product…
                    </Button>
                    <Button
                      variant="secondary"
                      loading={archiving}
                      onClick={() => void setArchived(true)}>
                      Archive
                    </Button>
                  </>
                )}
                {product.archivedAt ? (
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    Delete permanently
                  </Button>
                ) : null}
              </div>
              {!product.archivedAt ? (
                <p className="mt-3 text-xs text-muted">
                  Permanent delete is available after archiving.
                </p>
              ) : null}
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
                  value={fmtDateTime(product.createdAt)}
                />
                <MetaRow
                  label="Updated"
                  value={fmtDateTime(product.updatedAt)}
                />
                <MetaRow
                  label="Archived"
                  value={
                    product.archivedAt
                      ? fmtDateTime(product.archivedAt)
                      : 'No'
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
        title={isNew ? 'Create product?' : 'Save changes?'}
        message={
          isNew
            ? `"${form.name.trim()}" will be added to the global catalog, and every shop will see it when scanning the barcode.`
            : 'This master data is shown to every shop. Review what is changing below.'
        }
        confirmLabel={isNew ? 'Yes, create' : 'Yes, save'}
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirmSave(false)}>
        {isNew ? (
          <ul className="flex flex-col gap-1 rounded-lg border border-line bg-ground p-3 text-sm text-ink">
            <li>Name: {form.name.trim()}</li>
            <li>Category: {form.category.trim()}</li>
            <li>Unit: {form.unit.trim()}</li>
            <li>Pack size: {form.packSize.trim() || 'None'}</li>
            <li>
              Barcodes:{' '}
              {form.barcodes.length > 0 ? form.barcodes.join(', ') : 'None'}
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
                  Effect on each shop
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
                            &quot;{sh.name}&quot; — customised by the shop,{' '}
                            <span className="font-semibold text-accent-deep">
                              will be skipped
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
                    Also overwrite shops that customised it
                  </span>
                  <span className="block text-xs text-muted">
                    Use only when it is a typo, not a rename. Recorded as{' '}
                    <code>forced</code> in the audit log.
                  </span>
                </span>
              </label>
            ) : null}

            <Input
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Typo fix, packaging change…"
              hint="Shown in the audit log."
            />
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-ground p-3 text-sm text-muted">
            No changes detected.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete permanently?"
        message={`"${product?.name ?? ''}" will be removed for good, with its correction history. Its barcodes become free, so the next scan of one creates a new product. Shops keep their own item data.`}
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />

      {mergeOpen && product ? (
        <MergeProductDialog
          source={{ id: product.id, name: product.name }}
          onClose={() => setMergeOpen(false)}
          onMerged={(res) => {
            notifyCatalogChanged();
            router.replace(`/products/${res.targetId}`);
          }}
        />
      ) : null}
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

/**
 * Picker over the fixed list that still tolerates rows predating it.
 *
 * A value outside the active list (legacy text like "1 kg", or an archived option)
 * stays selectable as an old value: otherwise the browser would show the first option
 * while the form still held the old text, and fixing an unrelated field would be
 * blocked or would change this one silently. `saved` keeps it available after the
 * admin moves away, so they can move back.
 */
function OptionSelect({
  label,
  value,
  saved,
  options,
  onChange,
}: {
  label: string;
  value: string;
  saved: string;
  /** Null while loading or after a failed load. */
  options: CatalogOption[] | null;
  onChange: (next: string) => void;
}) {
  const active = new Set(options?.map((o) => o.value));
  const old = [...new Set([value, saved])].filter((v) => v.trim() && !active.has(v));

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options === null}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-50">
        <option value="">— select —</option>
        {old.map((v) => (
          <option key={v} value={v}>
            {/* Until the list is in, nothing is known to be old. */}
            {options === null ? v : `${v} (old value)`}
          </option>
        ))}
        {options?.map((o) => (
          <option key={o.id} value={o.value}>
            {o.labelEnglish}
          </option>
        ))}
      </select>
      {options !== null && value && !active.has(value) ? (
        <span className="text-xs text-muted">
          Old value, not in the list. You can keep it or pick one from the list.
        </span>
      ) : null}
    </label>
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
      setFieldError('This barcode is already in the list');
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
        setLookupNote(`${code}: no record in Open*Facts. Fill in the details manually`);
        return;
      }
      onPrefill(found);
      setLookupNote(
        found.nameIsGuessed
          ? `Partial details found (${found.source}). Check the name`
          : `Found: ${found.name} (${found.source})`,
      );
    } catch (err) {
      setLookupNote(err instanceof BarcodeLookupError ? err.message : 'Lookup failed');
    } finally {
      setLooking(null);
    }
  };

  return (
    <Card
      title="Barcodes"
      subtitle="A USB scanner can scan straight into this field: it types the digits and presses Enter.">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Input
              label="Add barcode"
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
              hint="EAN-13 / UPC-A / UPC-E. The check digit is verified and the code is normalised to GTIN-13."
            />
          </div>
          <Button variant="secondary" onClick={add} className="mt-7">
            Add
          </Button>
        </div>

        {barcodes.length === 0 ? (
          <p className="text-sm text-muted">No barcodes added yet.</p>
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
                    Fill details
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

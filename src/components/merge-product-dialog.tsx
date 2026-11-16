'use client';

import { useEffect, useRef, useState } from 'react';

import { Badge, Button, ErrorNote, Input, Spinner } from '@/components/ui';
import { adminApi } from '@/lib/api';
import type { MergePreview, MergeResult, ProductListItem } from '@/lib/types';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Folds `source` into a product the admin picks. Three steps — pick, preview, confirm —
 * because a merge moves other shops' inventory links and cannot be undone.
 *
 * Mount it only while open: every opening then starts from fresh state.
 */
export function MergeProductDialog({
  source,
  onClose,
  onMerged,
}: {
  source: { id: string; name: string };
  onClose: () => void;
  onMerged: (result: MergeResult) => void;
}) {
  const [query, setQuery] = useState(source.name);
  const [results, setResults] = useState<ProductListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<ProductListItem | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (target || !term) return;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      setSearching(true);
      adminApi
        .listProducts({ query: term, archived: 'active', limit: 8 })
        .then((page) => {
          if (mine !== seq.current) return;
          setResults(page.items.filter((p) => p.id !== source.id));
        })
        .catch((err: unknown) => {
          if (mine === seq.current) {
            setError(err instanceof Error ? err.message : 'Search failed');
          }
        })
        .finally(() => {
          if (mine === seq.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, target, source.id]);

  const pick = async (p: ProductListItem) => {
    setTarget(p);
    setPreview(null);
    setError(null);
    setPreviewing(true);
    try {
      setPreview(await adminApi.mergePreview(source.id, p.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview the merge');
    } finally {
      setPreviewing(false);
    }
  };

  const merge = async () => {
    if (!target) return;
    setMerging(true);
    setError(null);
    try {
      onMerged(await adminApi.mergeProduct(source.id, target.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed');
      setMerging(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !merging) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [merging, onClose]);

  const shown = query.trim() ? results : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Merge product"
      onClick={() => {
        if (!merging) onClose();
      }}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-ink">Merge duplicate</h3>
        <p className="mt-1 text-sm text-muted">
          &quot;{source.name}&quot; will be folded into the product you pick and then
          archived. This cannot be undone.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {error ? <ErrorNote message={error} /> : null}

          {!target ? (
            <>
              <Input
                label="Keep which product?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, category or barcode…"
                autoFocus
              />
              {searching ? (
                <div className="flex justify-center py-4">
                  <Spinner />
                </div>
              ) : shown.length === 0 ? (
                <p className="text-sm text-muted">
                  {query.trim() ? 'No other active product matches.' : 'Type to search.'}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => void pick(p)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-ground">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink">
                            {p.name}
                          </span>
                          <span className="block text-xs text-muted">
                            {p.category} · {p.unit} · {p.shopsStockingCount} shops
                            {p.barcodes[0] ? ` · ${p.barcodes[0]}` : ''}
                          </span>
                        </span>
                        <Badge
                          label={
                            p.verification === 'verified'
                              ? 'Verified'
                              : p.verification === 'rejected'
                                ? 'Rejected'
                                : 'Pending'
                          }
                          tone={p.verification === 'verified' ? 'ok' : 'neutral'}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="rounded-lg border border-line bg-ground p-3 text-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Keeping
                </p>
                <p className="font-semibold text-ink">{target.name}</p>
                <p className="text-xs text-muted">
                  {target.category} · {target.unit}
                </p>
                <button
                  type="button"
                  className="mt-1 text-xs font-semibold text-brand-deep hover:underline"
                  disabled={merging}
                  onClick={() => {
                    setTarget(null);
                    setPreview(null);
                    setError(null);
                  }}>
                  Pick a different product
                </button>
              </div>

              {previewing ? (
                <div className="flex justify-center py-4">
                  <Spinner />
                </div>
              ) : preview ? (
                <MergeSummary preview={preview} />
              ) : null}
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={merging}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void merge()}
            loading={merging}
            disabled={!preview || previewing}>
            Merge
          </Button>
        </div>
      </div>
    </div>
  );
}

function MergeSummary({ preview }: { preview: MergePreview }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ul className="flex list-disc flex-col gap-1 rounded-lg border border-line bg-ground p-3 pl-7 text-ink">
        <li>
          {preview.barcodes.length > 0
            ? `Barcodes moving: ${preview.barcodes.join(', ')}`
            : 'No barcodes to move'}
        </li>
        <li>
          {preview.shopsToMove} shop{preview.shopsToMove === 1 ? '' : 's'} re-linked to the
          kept product (their own item name stays as they had it)
        </li>
        {preview.newPhotos > 0 ? <li>{preview.newPhotos} photo(s) added</li> : null}
        {preview.openReports > 0 ? (
          <li>{preview.openReports} open shop report(s) moved</li>
        ) : null}
      </ul>

      {preview.target.verification === 'verified' && preview.barcodes.length > 0 ? (
        <p className="rounded-lg border border-accent/40 bg-accent-tint p-3 text-xs text-ink">
          The kept product is <strong>Verified</strong>, so these barcodes will start
          prefilling its name in every shop that scans them.
        </p>
      ) : null}

      {preview.conflictShops.length > 0 ? (
        <div className="rounded-lg border border-accent/40 bg-accent-tint p-3 text-xs text-ink">
          <p className="font-semibold">
            {preview.conflictShops.length} shop(s) stock both and will be left as they are:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {preview.conflictShops.map((s) => (
              <li key={s.shopId}>
                {s.shopName} — &quot;{s.itemName}&quot;
              </li>
            ))}
          </ul>
          <p className="mt-1 text-muted">
            Merging two of a shop&apos;s own stock lines is the shop&apos;s decision.
          </p>
        </div>
      ) : null}
    </div>
  );
}

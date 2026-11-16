'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

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
import { adminApi, catalogOptionsApi } from '@/lib/api';
import { notifyCatalogChanged } from '@/lib/catalog-events';
import type {
  CatalogOption,
  ProductListItem,
  ProductListParams,
  ProductSort,
  ProductSource,
  ProductVerification,
} from '@/lib/types';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
/** Same cap as the API's bulk DTO. A bulk action must stay a reviewed batch. */
const MAX_BULK = 25;

type VerificationFilter = '' | ProductVerification;
type SourceFilter = '' | NonNullable<ProductListParams['source']>;
type ArchivedFilter = NonNullable<ProductListParams['archived']>;
type PresenceFilter = '' | 'yes' | 'no';
type BulkAction = 'approve' | 'reject';

type Filters = {
  verification: VerificationFilter;
  source: SourceFilter;
  archived: ArchivedFilter;
  category: string;
  barcode: PresenceFilter;
  photo: PresenceFilter;
  sort: ProductSort;
};

const DEFAULT_FILTERS: Filters = {
  verification: '',
  source: '',
  archived: 'active',
  category: '',
  barcode: '',
  photo: '',
  sort: 'name',
};

const SOURCE_LABEL: Record<ProductSource, string> = {
  openfoodfacts: 'Open*Facts',
  barcodereport: 'barcodereport',
  upcitemdb: 'upcitemdb',
  shop: 'Shop typed',
  admin: 'Admin',
  import: 'Import',
};

const presence = (v: PresenceFilter) => (v === '' ? undefined : v === 'yes');

const selectClass =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand';

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, string]>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={selectClass}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ProductsPage() {
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [categories, setCategories] = useState<CatalogOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [acting, setActing] = useState(false);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // Typing "parle" shouldn't fire five requests.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // The category filter is a convenience; the list works without it.
  useEffect(() => {
    catalogOptionsApi
      .list('CATEGORY')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  // A slow response for an abandoned search must never overwrite a newer one.
  const requestSeq = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      const seq = ++requestSeq.current;
      const page = await adminApi.listProducts({
        query: appliedSearch || undefined,
        verification: filters.verification || undefined,
        source: filters.source || undefined,
        archived: filters.archived,
        category: filters.category || undefined,
        hasBarcode: presence(filters.barcode),
        hasPhoto: presence(filters.photo),
        sort: filters.sort,
        limit: PAGE_SIZE,
        offset,
      });
      return seq === requestSeq.current ? page : null;
    },
    [appliedSearch, filters],
  );

  // Stale-while-revalidate: a new search keeps the previous rows on screen until the
  // fresh page lands, so the table doesn't blank out on every keystroke pause.
  useEffect(() => {
    let cancelled = false;
    fetchPage(0)
      .then((page) => {
        if (cancelled || !page) return;
        setItems(page.items);
        setTotal(page.total);
        // A selection made under the old filter must not ride along into the new one.
        setSelected(new Set());
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load products');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(items.length);
      if (!page) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more products');
    } finally {
      setLoadingMore(false);
    }
  };

  // Only active pending rows are actionable: the API's bulk calls touch nothing else.
  const actionable = (p: ProductListItem) =>
    p.verification === 'provisional' && !p.archivedAt;
  const pendingVisible = items.filter(actionable);
  const allPendingSelected =
    pendingVisible.length > 0 &&
    pendingVisible.slice(0, MAX_BULK).every((p) => selected.has(p.id));

  const toggleOne = (id: string) => {
    setNotice(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BULK) next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setNotice(null);
    setSelected(
      allPendingSelected
        ? new Set()
        : new Set(pendingVisible.slice(0, MAX_BULK).map((p) => p.id)),
    );
  };

  const runBulk = async () => {
    const ids = [...selected];
    if (ids.length === 0 || !pendingAction) return;
    setActing(true);
    try {
      const done =
        pendingAction === 'approve'
          ? (await adminApi.verifyProducts(ids)).verified
          : (await adminApi.rejectProducts(ids)).rejected;
      const verb = pendingAction === 'approve' ? 'approved' : 'rejected';
      setPendingAction(null);
      setNotice(
        done === ids.length
          ? `${done} ${verb}.`
          : `${done} of ${ids.length} ${verb} — the rest were no longer pending.`,
      );
      notifyCatalogChanged();
      const page = await fetchPage(0);
      if (page) {
        setItems(page.items);
        setTotal(page.total);
      }
      setSelected(new Set());
    } catch (err) {
      setPendingAction(null);
      setError(err instanceof Error ? err.message : 'Bulk action failed');
    } finally {
      setActing(false);
    }
  };

  const filtersActive =
    JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const filtered = Boolean(appliedSearch) || filtersActive;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink">Products catalog</h1>
          <p className="text-sm text-muted">
            Global catalog: every shop sees this when it scans a barcode.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/products/import">
            <Button variant="secondary">Bulk import</Button>
          </Link>
          <Link href="/products/new">
            <Button>New product</Button>
          </Link>
        </div>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <div className="flex flex-col gap-4">
          <Input
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Product name, category or barcode…"
            hint="Search runs on the server, so it covers the whole catalog, not just the loaded rows."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Status"
              value={filters.verification}
              onChange={(v) => setFilter('verification', v)}
              options={[
                ['', 'All'],
                ['provisional', 'Pending'],
                ['verified', 'Verified'],
                ['rejected', 'Rejected'],
              ]}
            />
            <Select
              label="Source"
              value={filters.source}
              onChange={(v) => setFilter('source', v)}
              options={[
                ['', 'All'],
                ['upstream', 'Third-party database'],
                ['shop', 'Shop typed'],
                ['admin', 'Admin'],
                ['import', 'Import'],
              ]}
            />
            <Select
              label="Category"
              value={filters.category}
              onChange={(v) => setFilter('category', v)}
              options={[
                ['', 'All'],
                ...categories.map((c): [string, string] => [c.value, c.labelEnglish]),
              ]}
            />
            <Select
              label="Sort by"
              value={filters.sort}
              onChange={(v) => setFilter('sort', v)}
              options={[
                ['name', 'Name (A–Z)'],
                ['newest', 'Newest first'],
                ['shops', 'Most shops first'],
              ]}
            />
            <Select
              label="Barcode"
              value={filters.barcode}
              onChange={(v) => setFilter('barcode', v)}
              options={[
                ['', 'Any'],
                ['yes', 'Has a barcode'],
                ['no', 'No barcode'],
              ]}
            />
            <Select
              label="Photo"
              value={filters.photo}
              onChange={(v) => setFilter('photo', v)}
              options={[
                ['', 'Any'],
                ['yes', 'Has a photo'],
                ['no', 'No photo'],
              ]}
            />
            <Select
              label="Show"
              value={filters.archived}
              onChange={(v) => setFilter('archived', v)}
              options={[
                ['active', 'Active products'],
                ['archived', 'Archived only'],
                ['all', 'Active and archived'],
              ]}
            />
            <div className="flex items-end">
              <Button
                variant="secondary"
                disabled={!filtersActive}
                onClick={() => setFilters(DEFAULT_FILTERS)}>
                Reset filters
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title={loading ? 'Loading…' : `${items.length} of ${total}`}
        subtitle="Click a row to edit, archive or merge it. Only Verified rows are prefilled for other shops.">
        {notice ? (
          <p className="mb-4 rounded-lg border border-line bg-ground px-3 py-2 text-sm font-medium text-ink">
            {notice}
          </p>
        ) : null}

        {pendingVisible.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Tick pending rows you have checked, then approve or reject them together (up
              to {MAX_BULK} at a time).
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => {
                  setNotice(null);
                  setPendingAction('reject');
                }}>
                Reject selected ({selected.size})
              </Button>
              <Button
                disabled={selected.size === 0}
                onClick={() => {
                  setNotice(null);
                  setPendingAction('approve');
                }}>
                Approve selected ({selected.size})
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner size={26} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No products found"
            description={
              filtered
                ? 'Clear the search or filters, or create a new product.'
                : 'The catalog is empty. Create a new product or use bulk import.'
            }
            action={
              <Link href="/products/import">
                <Button variant="secondary">Bulk import</Button>
              </Link>
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>
                    <input
                      type="checkbox"
                      aria-label={`Select up to ${MAX_BULK} pending rows`}
                      checked={allPendingSelected}
                      disabled={pendingVisible.length === 0}
                      onChange={toggleAll}
                      className="h-4 w-4 accent-brand"
                    />
                  </Th>
                  <Th>Product</Th>
                  <Th>Status</Th>
                  <Th>Category</Th>
                  <Th>Barcodes</Th>
                  <Th align="right">Shops</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const isSelected = selected.has(p.id);
                  return (
                    <tr
                      key={p.id}
                      className={`transition hover:bg-ground/60 ${isSelected ? 'bg-ground/60' : ''}`}>
                      <Td>
                        {actionable(p) ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.name}`}
                            checked={isSelected}
                            disabled={!isSelected && selected.size >= MAX_BULK}
                            onChange={() => toggleOne(p.id)}
                            className="h-4 w-4 accent-brand"
                          />
                        ) : null}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-3">
                          {p.imageUrl ? (
                            // Plain <img>: provider CDN hosts are open-ended (see CLAUDE.md).
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.imageUrl}
                              alt=""
                              loading="lazy"
                              className="size-9 shrink-0 rounded-md border border-line bg-ground object-cover"
                            />
                          ) : (
                            <span className="size-9 shrink-0 rounded-md border border-dashed border-line" />
                          )}
                          <span className="min-w-0">
                            <Link
                              href={`/products/${p.id}`}
                              className="font-semibold text-ink underline-offset-2 hover:text-brand-deep hover:underline">
                              {p.name}
                            </Link>
                            {p.mergedIntoId ? (
                              <span className="ml-2">
                                <Badge label="Merged" tone="neutral" />
                              </span>
                            ) : p.archivedAt ? (
                              <span className="ml-2">
                                <Badge label="Archived" tone="danger" />
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <Badge
                          label={
                            p.verification === 'verified'
                              ? 'Verified'
                              : p.verification === 'rejected'
                                ? 'Rejected'
                                : 'Pending'
                          }
                          tone={
                            p.verification === 'verified'
                              ? 'ok'
                              : p.verification === 'rejected'
                                ? 'danger'
                                : 'accent'
                          }
                        />
                        {p.consensusShops >= 3 ? (
                          <span className="ml-1 text-xs text-muted">
                            {p.consensusShops} agree
                          </span>
                        ) : null}
                        <span className="mt-1 block text-xs text-muted">
                          {SOURCE_LABEL[p.source] ?? p.source}
                        </span>
                      </Td>
                      <Td className="text-muted">
                        {p.category}
                        <span className="block text-xs opacity-70">
                          {p.unit}
                          {p.packSize ? ` · ${p.packSize}` : ''}
                        </span>
                      </Td>
                      <Td>
                        {p.barcodes.length === 0 ? (
                          <span className="text-xs text-muted">—</span>
                        ) : (
                          <span className="tnum font-mono text-xs text-muted">
                            {p.barcodes[0]}
                            {p.barcodes.length > 1 ? ` +${p.barcodes.length - 1}` : ''}
                          </span>
                        )}
                      </Td>
                      <Td align="right" className="tnum text-muted">
                        {p.shopsStockingCount}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            <div className="flex justify-center pt-5">
              {items.length < total ? (
                <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
                  Load {Math.min(PAGE_SIZE, total - items.length)} more
                </Button>
              ) : (
                <p className="text-xs text-muted">
                  {filtered ? 'Showing every match' : 'Showing the whole catalog'}
                </p>
              )}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={pendingAction !== null}
        title={`${pendingAction === 'reject' ? 'Reject' : 'Approve'} ${selected.size} product${
          selected.size === 1 ? '' : 's'
        }?`}
        message={
          pendingAction === 'reject'
            ? 'Rejected rows are never prefilled into other shops. They keep their barcode, so no duplicate is created when it is scanned again.'
            : 'Approved rows are prefilled into every shop that scans these barcodes. Approve only names, categories and units you have checked.'
        }
        confirmLabel={pendingAction === 'reject' ? 'Reject' : 'Approve'}
        tone={pendingAction === 'reject' ? 'danger' : 'primary'}
        loading={acting}
        onConfirm={() => void runBulk()}
        onCancel={() => setPendingAction(null)}>
        <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-ink">
          {items
            .filter((p) => selected.has(p.id))
            .map((p) => (
              <li key={p.id}>
                {p.name} <span className="text-muted">· {p.category}</span>
              </li>
            ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}

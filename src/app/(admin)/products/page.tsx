'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import type { ProductListItem } from '@/lib/types';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

export default function ProductsPage() {
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Typing "parle" shouldn't fire five requests.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // A slow response for an abandoned search must never overwrite a newer one.
  const requestSeq = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      const seq = ++requestSeq.current;
      const page = await adminApi.listProducts({
        query: appliedSearch || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      return seq === requestSeq.current ? page : null;
    },
    [appliedSearch],
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
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Products load fail');
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
      setError(err instanceof Error ? err.message : 'Aur products load nahi hue');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink">Products catalog</h1>
          <p className="text-sm text-muted">
            Global catalog — sab shops yeh dekhti hain barcode scan pe.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/products/import">
            <Button variant="secondary">Bulk import</Button>
          </Link>
          <Link href="/products/new">
            <Button>Naya product</Button>
          </Link>
        </div>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <Input
          label="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Product name, category, ya barcode…"
          hint="Search server pe chalta hai — poora catalog cover hota hai, sirf loaded rows nahi."
        />
      </Card>

      <Card
        title={loading ? 'Loading…' : `${items.length} of ${total}`}
        subtitle="Row pe click karke edit ya delete karein. Sirf Verified rows doosri shops ko prefill me milti hain.">
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner size={26} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Koi product nahi mila"
            description={
              appliedSearch
                ? 'Search clear karein ya naya product banayein.'
                : 'Catalog khaali hai — naya product banayein ya bulk import karein.'
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
                  <Th>Product</Th>
                  <Th>Status</Th>
                  <Th>Category</Th>
                  <Th>Barcodes</Th>
                  <Th align="right">Shops</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="transition hover:bg-ground/60">
                    <Td>
                      <Link
                        href={`/products/${p.id}`}
                        className="font-semibold text-ink underline-offset-2 hover:text-brand-deep hover:underline">
                        {p.name}
                      </Link>
                      {p.archivedAt ? (
                        <span className="ml-2">
                          <Badge label="Archived" tone="danger" />
                        </span>
                      ) : null}
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
                    </Td>
                    <Td className="text-muted">
                      {p.category}
                      <span className="block text-xs opacity-70">{p.unit}</span>
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
                ))}
              </tbody>
            </Table>

            <div className="flex justify-center pt-5">
              {items.length < total ? (
                <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
                  Aur {Math.min(PAGE_SIZE, total - items.length)} load karein
                </Button>
              ) : (
                <p className="text-xs text-muted">Poora catalog dikh gaya</p>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

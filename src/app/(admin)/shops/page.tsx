'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
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
import type { ShopListItem } from '@/lib/types';

export default function ShopsPage() {
  const [shops, setShops] = useState<ShopListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    adminApi
      .listShops()
      .then(setShops)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Shops load fail'),
      )
      .finally(() => setLoading(false));
  }, []);

  // The shops endpoint has no server-side search yet, so this filters what was loaded.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(
      (s) =>
        s.shopName.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        s.ownerName.toLowerCase().includes(q) ||
        (s.owner?.phoneNumber ?? '').includes(q),
    );
  }, [shops, search]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-black text-ink">Shops</h1>
        <p className="text-sm text-muted">{shops.length} registered shops.</p>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <Input
          label="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Shop name, city, owner ya phone…"
        />
      </Card>

      <Card title={`Showing ${filtered.length}`}>
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner size={26} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="Koi shop nahi mili" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Shop</Th>
                <Th>Owner</Th>
                <Th align="right">Members</Th>
                <Th align="right">Items</Th>
                <Th align="right">Bills</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="transition hover:bg-ground/60">
                  <Td>
                    <Link
                      href={`/shops/${s.id}`}
                      className="font-semibold text-ink hover:text-brand-deep hover:underline">
                      {s.shopName}
                    </Link>
                    <p className="text-xs text-muted">{s.city}</p>
                  </Td>
                  <Td>
                    <span className="text-ink">{s.ownerName}</span>
                    {s.owner ? (
                      <p className="tnum text-xs text-muted">{s.owner.phoneNumber}</p>
                    ) : null}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {s.members}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {s.items}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {s.bills}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

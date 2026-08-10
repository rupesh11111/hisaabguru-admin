'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Card, ErrorNote, Spinner, StatTile } from '@/components/ui';
import { adminApi } from '@/lib/api';
import type { AdminStats } from '@/lib/types';

export default function OverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .stats()
      .then(setStats)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Stats load fail'),
      );
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!stats) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-black text-ink">Platform overview</h1>
        <p className="text-sm text-muted">Platform-wide counts.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Users" value={stats.totals.users} />
        <StatTile label="Shops" value={stats.totals.shops} />
        <StatTile label="Bills" value={stats.totals.bills} />
        <StatTile label="Catalog products" value={stats.totals.products} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Users by plan tier">
          <BreakdownList entries={Object.entries(stats.byTier)} />
        </Card>
        <Card title="Users by platform role">
          <BreakdownList entries={Object.entries(stats.byRole)} />
        </Card>
      </div>

      <Card title="Shortcuts">
        <div className="flex flex-wrap gap-2">
          <Shortcut href="/products">Manage catalog</Shortcut>
          <Shortcut href="/products/import">Bulk import products</Shortcut>
          <Shortcut href="/shops">Browse shops</Shortcut>
          <Shortcut href="/users">Browse users</Shortcut>
        </div>
      </Card>
    </div>
  );
}

function BreakdownList({ entries }: { entries: Array<[string, number | undefined]> }) {
  if (entries.length === 0) return <p className="text-sm text-muted">Koi data nahi.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {entries.map(([key, count]) => (
        <li key={key} className="flex items-center justify-between text-sm">
          <span className="font-semibold text-ink">{key}</span>
          <span className="tnum text-muted">{count ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

function Shortcut({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition hover:bg-ground">
      {children}
    </Link>
  );
}

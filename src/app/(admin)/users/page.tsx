'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  Badge,
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
import type { UserListItem } from '@/lib/types';

export default function UsersPage() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    adminApi
      .listUsers()
      .then(setUsers)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Users load fail'),
      )
      .finally(() => setLoading(false));
  }, []);

  // The users endpoint has no server-side search yet, so this filters what was loaded.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.phoneNumber.toLowerCase().includes(q) ||
        (u.platformRole ?? '').toLowerCase().includes(q),
    );
  }, [users, search]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-black text-ink">Users</h1>
        <p className="text-sm text-muted">{users.length} registered users.</p>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <Input
          label="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Phone number ya role…"
        />
      </Card>

      <Card title={`Showing ${filtered.length}`}>
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner size={26} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="Koi user nahi mila" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Phone</Th>
                <Th>Role</Th>
                <Th>Plan</Th>
                <Th align="right">Shops</Th>
                <Th align="right">Memberships</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="transition hover:bg-ground/60">
                  <Td>
                    <Link
                      href={`/users/${u.id}`}
                      className="tnum font-semibold text-ink hover:text-brand-deep hover:underline">
                      {u.phoneNumber}
                    </Link>
                  </Td>
                  <Td>
                    <Badge
                      label={u.platformRole?.replace('_', ' ') ?? 'No role'}
                      tone={
                        u.platformRole && u.platformRole !== 'USER'
                          ? 'danger'
                          : 'neutral'
                      }
                    />
                  </Td>
                  <Td>
                    <Badge
                      label={`${u.subscriptionTier} · ${u.subscriptionStatus}`}
                      tone={u.subscriptionStatus === 'ACTIVE' ? 'ok' : 'neutral'}
                    />
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {u.shopsOwned}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {u.memberships}
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

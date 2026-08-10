'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorNote,
  Spinner,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ShopDetail } from '@/lib/types';

export default function ShopDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { state } = useSession();

  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    adminApi
      .getShop(id)
      .then(setShop)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Shop load fail'),
      )
      .finally(() => setLoading(false));
  }, [id]);

  const isSuper =
    state.status === 'authenticated' && state.user.platformRole === 'SUPER_ADMIN';

  const remove = async () => {
    setDeleting(true);
    try {
      await adminApi.deleteShop(id);
      router.replace('/shops');
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
  if (!shop) return <ErrorNote message={error ?? 'Shop nahi mili'} />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/shops" className="text-sm text-muted hover:text-ink">
          ← Shops
        </Link>
        <h1 className="mt-1 text-2xl font-black text-ink">{shop.shopName}</h1>
        <p className="text-sm text-muted">
          {shop.city} · owner {shop.ownerName}
          {shop.owner ? ` (${shop.owner.phoneNumber})` : ''}
        </p>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Bills" value={shop.counts.bills} />
        <StatTile label="Inventory" value={shop.counts.inventory} />
        <StatTile label="Customers" value={shop.counts.customers} />
        <StatTile label="Suppliers" value={shop.counts.suppliers} />
      </div>

      <Card title={`Members (${shop.memberships.length})`}>
        {shop.memberships.length === 0 ? (
          <p className="text-sm text-muted">Koi member nahi.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Phone</Th>
                <Th>Role</Th>
                <Th align="right">Permissions</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {shop.memberships.map((m) => (
                <tr key={m.id} className="transition hover:bg-ground/60">
                  <Td>
                    <Link
                      href={`/users/${m.userId}`}
                      className="tnum font-semibold text-ink hover:text-brand-deep hover:underline">
                      {m.phoneNumber}
                    </Link>
                  </Td>
                  <Td>
                    <Badge
                      label={m.role ?? 'No role'}
                      tone={m.role === 'OWNER' ? 'accent' : 'neutral'}
                    />
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {m.permissions.length}
                  </Td>
                  <Td>
                    <Badge
                      label={m.acceptedAt ? 'Active' : 'Pending'}
                      tone={m.acceptedAt ? 'ok' : 'neutral'}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card
        title="Danger zone"
        subtitle="Shop delete karne par uske bills, inventory aur customers bhi cascade me chale jayenge.">
        {isSuper ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete shop
          </Button>
        ) : (
          <p className="text-sm text-muted">
            Shop delete karne ke liye SUPER_ADMIN chahiye.
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Shop delete karein?"
        message={`"${shop.shopName}" aur uska saara data (${shop.counts.bills} bills, ${shop.counts.inventory} items) permanently delete ho jayega.`}
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

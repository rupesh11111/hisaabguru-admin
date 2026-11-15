'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

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
import { referralsApi, type AdminReferral, type ReferralStatus } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

const FILTERS: (ReferralStatus | 'ALL')[] = ['ALL', 'PENDING', 'REWARDED', 'EXPIRED', 'REJECTED'];

const TONE: Record<ReferralStatus, 'neutral' | 'accent' | 'ok' | 'danger'> = {
  PENDING: 'accent',
  REWARDED: 'ok',
  EXPIRED: 'neutral',
  REJECTED: 'danger',
};

export default function ReferralsPage() {
  const [rows, setRows] = useState<AdminReferral[]>([]);
  const [filter, setFilter] = useState<ReferralStatus | 'ALL'>('PENDING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminReferral | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    referralsApi
      .list(filter === 'ALL' ? undefined : filter)
      .then((list) => {
        setRows(list);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Referrals load fail'),
      )
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  const reject = async () => {
    if (!rejecting) return;
    setSaving(true);
    try {
      await referralsApi.reject(rejecting.id, reason.trim());
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject fail');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-black text-ink">Referrals</h1>
        <p className="text-sm text-muted">
          Inaam API ka job khud deta hai (7 active din, 14 din ke andar). Yahaan se sirf
          PENDING referral reject ho sakta hai, jaise fake shop. Diya hua inaam wapas lena ho
          to user ke page par wallet adjust karein.
        </p>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'primary' : 'secondary'}
            onClick={() => {
              if (f === filter) return;
              setLoading(true);
              setFilter(f);
            }}>
            {f}
          </Button>
        ))}
      </div>

      <Card title={`Showing ${rows.length}`}>
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner size={26} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Koi referral nahi" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Referrer</Th>
                <Th>New shopkeeper</Th>
                <Th>Status</Th>
                <Th align="right">Active days</Th>
                <Th>Claimed</Th>
                <Th>Window ends</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="transition hover:bg-ground/60">
                  <Td>
                    <Link
                      href={`/users/${r.referrer.id}`}
                      className="tnum font-semibold text-ink hover:text-brand-deep hover:underline">
                      {r.referrer.phoneNumber}
                    </Link>
                    <p className="tnum text-xs text-muted">
                      {r.code} · {r.source}
                    </p>
                  </Td>
                  <Td>
                    <Link
                      href={`/users/${r.referee.id}`}
                      className="tnum text-ink hover:text-brand-deep hover:underline">
                      {r.referee.phoneNumber}
                    </Link>
                    <p className="text-xs text-muted">
                      Joined {fmtDateTime(r.referee.createdAt)}
                    </p>
                  </Td>
                  <Td>
                    <Badge label={r.status} tone={TONE[r.status]} />
                    {r.status === 'REWARDED' && !r.referrerRewarded ? (
                      <p className="mt-1 text-xs text-muted">Referrer cap reached</p>
                    ) : null}
                    {r.rejectReason ? (
                      <p className="mt-1 text-xs text-muted">{r.rejectReason}</p>
                    ) : null}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {r.activeDays}
                  </Td>
                  <Td className="text-muted">{fmtDateTime(r.claimedAt)}</Td>
                  <Td className="text-muted">{fmtDateTime(r.windowEndsAt)}</Td>
                  <Td align="right">
                    {r.status === 'PENDING' ? (
                      <Button variant="ghost" onClick={() => setRejecting(r)}>
                        Reject
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={rejecting !== null}
        title="Referral reject karein?"
        message={`${rejecting?.referee.phoneNumber ?? ''} ka referral reject hoga. Kisi ko inaam nahi milega, aur yeh wapas nahi hota.`}
        confirmLabel="Reject"
        loading={saving}
        onConfirm={() => {
          if (reason.trim().length >= 3) void reject();
        }}
        onCancel={() => {
          setRejecting(null);
          setReason('');
        }}>
        <Input
          label="Reason (zaroori)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Jaise: same owner, fake shop"
        />
      </ConfirmDialog>
    </div>
  );
}

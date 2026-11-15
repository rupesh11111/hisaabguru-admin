'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge, Button, Card, Input, Spinner, Table, Td, Th } from '@/components/ui';
import { referralsApi, type UserWallet } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

const rupees = (paise: number) =>
  `${paise < 0 ? '-' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN')}`;

/**
 * A user's referral wallet. The only write is a signed adjustment with a reason; the
 * API refuses a deduction larger than the balance rather than taking part of it.
 */
export function WalletCard({
  userId,
  onError,
  onNotice,
}: {
  userId: string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    referralsApi
      .wallet(userId)
      .then(setWallet)
      .catch((err: unknown) => onError(err instanceof Error ? err.message : 'Wallet load fail'))
      .finally(() => setLoading(false));
  }, [userId, onError]);

  useEffect(load, [load]);

  const rupeeValue = Number(amount);
  const paise = Math.round(rupeeValue * 100);
  const valid = amount.trim() !== '' && Number.isFinite(rupeeValue) && paise !== 0 && reason.trim().length >= 3;

  const adjust = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      setWallet(await referralsApi.adjust(userId, paise, reason.trim()));
      onNotice(`Wallet ${paise > 0 ? 'me jode' : 'se kaate'}: ${rupees(Math.abs(paise))}`);
      setAmount('');
      setReason('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Adjust fail');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Referral wallet"
      subtitle="Plan kharidte waqt discount. Paisa nahi hai: refund ya cash-out nahi hota.">
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : wallet ? (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted">
            Balance: <span className="tnum text-lg font-bold text-ink">{rupees(wallet.balance)}</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
            <Input
              label="Amount (₹, minus = kaatna)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100 ya -50"
              inputMode="decimal"
            />
            <Input
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Jaise: fake referral ka inaam wapas"
            />
            <Button onClick={() => void adjust()} loading={saving} disabled={!valid}>
              Adjust
            </Button>
          </div>

          {wallet.transactions.length === 0 ? (
            <p className="text-sm text-muted">Koi entry nahi.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Type</Th>
                  <Th align="right">Amount</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {wallet.transactions.map((t) => (
                  <tr key={t.id}>
                    <Td className="text-muted">{fmtDateTime(t.createdAt)}</Td>
                    <Td>
                      <Badge
                        label={t.type}
                        tone={t.amount > 0 ? 'ok' : t.type === 'EXPIRE' ? 'neutral' : 'accent'}
                      />
                    </Td>
                    <Td align="right" className="tnum">
                      {rupees(t.amount)}
                    </Td>
                    <Td className="text-xs text-muted">
                      {t.reason ?? ''}
                      {t.paymentId ? ` · payment ${t.paymentId}` : ''}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      ) : null}
    </Card>
  );
}

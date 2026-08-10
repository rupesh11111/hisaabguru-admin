'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Input,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { plansApi } from '@/lib/api';
import type { SubscriptionPlan } from '@/lib/types';

/** Prices are stored in the smallest currency unit (paise for INR). */
function formatPrice(minor: number | null, currency: string): string {
  if (minor === null) return 'Custom';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

type Draft = {
  label: string;
  description: string;
  priority: string;
  maxShops: string;
  maxItemsPerShop: string;
  maxBillsPerMonth: string;
  maxEmployeesPerShop: string;
  priceMonthly: string;
  priceYearly: string;
};

function toDraft(p: SubscriptionPlan): Draft {
  return {
    label: p.label,
    description: p.description ?? '',
    priority: String(p.priority),
    maxShops: String(p.maxShops),
    maxItemsPerShop: String(p.maxItemsPerShop),
    maxBillsPerMonth: String(p.maxBillsPerMonth),
    maxEmployeesPerShop: String(p.maxEmployeesPerShop),
    priceMonthly: p.priceMonthly === null ? '' : String(p.priceMonthly / 100),
    priceYearly: p.priceYearly === null ? '' : String(p.priceYearly / 100),
  };
}

export default function PlansPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlans(await plansApi.list(showArchived));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plans load fail');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    // Fetch-on-mount: every setState here runs in a promise continuation, well after
    // the effect returns, so it can't drive the cascading re-render the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const startEdit = (p: SubscriptionPlan) => {
    setEditingId(p.id);
    setDraft(toDraft(p));
  };

  const save = async () => {
    if (!editingId || !draft) return;
    setSaving(true);
    setError(null);
    try {
      // Blank price means "contact us" pricing, which the API models as null.
      const toMinor = (v: string) =>
        v.trim() === '' ? null : Math.round(Number(v) * 100);
      await plansApi.update(editingId, {
        label: draft.label.trim(),
        description: draft.description.trim() || undefined,
        priority: Number(draft.priority),
        maxShops: Number(draft.maxShops),
        maxItemsPerShop: Number(draft.maxItemsPerShop),
        maxBillsPerMonth: Number(draft.maxBillsPerMonth),
        maxEmployeesPerShop: Number(draft.maxEmployeesPerShop),
        priceMonthly: toMinor(draft.priceMonthly),
        priceYearly: toMinor(draft.priceYearly),
      });
      setEditingId(null);
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan save fail');
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async (p: SubscriptionPlan) => {
    setError(null);
    try {
      if (p.archivedAt) await plansApi.restore(p.id);
      else await plansApi.archive(p.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive toggle fail');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink">Subscription plans</h1>
          <p className="text-sm text-muted">
            Limits aur pricing yahin se badalti hai — app restart ki zaroorat nahi.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Active dikhaayein' : 'Archived bhi dikhaayein'}
        </Button>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size={28} />
        </div>
      ) : (
        <Card title={`${plans.length} plans`}>
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Monthly</Th>
                <Th>Yearly</Th>
                <Th align="right">Shops</Th>
                <Th align="right">Items</Th>
                <Th align="right">Bills/mo</Th>
                <Th align="right">Subs</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="transition hover:bg-ground/60">
                  <Td>
                    <span className="font-semibold text-ink">{p.label}</span>
                    <p className="font-mono text-xs text-muted">{p.key}</p>
                    {p.archivedAt ? (
                      <Badge label="Archived" tone="danger" />
                    ) : p.isSystem ? (
                      <Badge label="System" tone="accent" />
                    ) : null}
                  </Td>
                  <Td className="tnum text-muted">
                    {formatPrice(p.priceMonthly, p.currency)}
                  </Td>
                  <Td className="tnum text-muted">
                    {formatPrice(p.priceYearly, p.currency)}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {p.maxShops}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {p.maxItemsPerShop}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {p.maxBillsPerMonth}
                  </Td>
                  <Td align="right" className="tnum text-muted">
                    {p.subscribersCount}
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => startEdit(p)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => void toggleArchive(p)}>
                        {p.archivedAt ? 'Restore' : 'Archive'}
                      </Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {draft && editingId ? (
        <Card
          title="Edit plan"
          subtitle="Plan key badli nahi ja sakti — usse existing subscriptions bandhi hain."
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditingId(null);
                  setDraft(null);
                }}>
                Cancel
              </Button>
              <Button onClick={() => void save()} loading={saving}>
                Save
              </Button>
            </>
          }>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Label"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
            <Input
              label="Priority"
              value={draft.priority}
              inputMode="numeric"
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
            />
            <div className="sm:col-span-2">
              <Input
                label="Description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <Input
              label="Price monthly (₹)"
              value={draft.priceMonthly}
              inputMode="decimal"
              hint="Khaali chhodein to 'Custom / contact us'."
              onChange={(e) => setDraft({ ...draft, priceMonthly: e.target.value })}
            />
            <Input
              label="Price yearly (₹)"
              value={draft.priceYearly}
              inputMode="decimal"
              hint="Khaali chhodein to 'Custom / contact us'."
              onChange={(e) => setDraft({ ...draft, priceYearly: e.target.value })}
            />
            <Input
              label="Max shops"
              value={draft.maxShops}
              inputMode="numeric"
              onChange={(e) => setDraft({ ...draft, maxShops: e.target.value })}
            />
            <Input
              label="Max items / shop"
              value={draft.maxItemsPerShop}
              inputMode="numeric"
              onChange={(e) => setDraft({ ...draft, maxItemsPerShop: e.target.value })}
            />
            <Input
              label="Max bills / month"
              value={draft.maxBillsPerMonth}
              inputMode="numeric"
              onChange={(e) => setDraft({ ...draft, maxBillsPerMonth: e.target.value })}
            />
            <Input
              label="Max employees / shop"
              value={draft.maxEmployeesPerShop}
              inputMode="numeric"
              onChange={(e) =>
                setDraft({ ...draft, maxEmployeesPerShop: e.target.value })
              }
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

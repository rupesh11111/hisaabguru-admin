'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
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
import { adminApi, plansApi, subscriptionsApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import type {
  ApiRole,
  PlatformRole,
  SubscriptionHistoryEntry,
  SubscriptionPlan,
  SubscriptionStatus,
  UserDetail,
  UserSubscription,
} from '@/lib/types';

/**
 * SUPER_ADMIN is deliberately absent: it carries the `*` wildcard, and handing that
 * out from a list of buttons is too easy to do by accident. Promote a super admin
 * from the database instead. Demoting one still works — it's just not offered here.
 */
const GRANTABLE_ROLES: PlatformRole[] = ['ADMIN', 'USER'];

const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'ACTIVE',
  'TRIAL',
  'EXPIRED',
  'CANCELLED',
];

/** Shop membership roles are the catalog minus the platform triad and OWNER. */
const PLATFORM_ROLE_KEYS = new Set(['SUPER_ADMIN', 'ADMIN', 'USER']);
const OWNER_ROLE_KEY = 'OWNER';

/**
 * Expiry is compared against `now` as a full timestamp on the server
 * (`sub.expiresAt < now`), so the minute matters — a date alone is not enough.
 *
 * `<input type="datetime-local">` speaks "YYYY-MM-DDTHH:mm" in the *browser's* zone
 * and carries no offset, so both directions must go through the local getters.
 * Slicing the ISO string instead would silently shift the value by the UTC offset.
 */
function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Shortcut presets land on 23:59 local, not on the current clock time — "+30 din"
 * should give the shopkeeper the whole 30th day, not cut them off mid-afternoon.
 */
function endOfTodayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return toLocalInputValue(d.toISOString());
}

/** Absolute, zone-labelled rendering so "expires on the 31st" is never ambiguous. */
function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { state } = useSession();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [history, setHistory] = useState<SubscriptionHistoryEntry[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [roles, setRoles] = useState<ApiRole[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [u, sub, hist, planList, roleList] = await Promise.all([
      adminApi.getUser(id),
      subscriptionsApi.get(id).catch(() => null),
      subscriptionsApi.history(id).catch(() => []),
      plansApi.list().catch(() => []),
      adminApi.listRoles().catch(() => []),
    ]);
    setUser(u);
    setSubscription(sub);
    setHistory(hist);
    setPlans(planList);
    setRoles(roleList);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'User load fail'),
      )
      .finally(() => setLoading(false));
  }, [load]);

  const isSuper =
    state.status === 'authenticated' && state.user.platformRole === 'SUPER_ADMIN';
  // The API refuses self-edits on both role and plan — reflect that instead of 403ing.
  const isSelf = state.status === 'authenticated' && state.user.userId === id;

  const changeRole = async (role: PlatformRole) => {
    if (!user || role === user.platformRole) return;
    setSavingRole(true);
    setError(null);
    setNotice(null);
    try {
      setUser(await adminApi.changeUserRole(user.id, role));
      setNotice(`Platform role ${role} kar diya — agla login se effect hoga.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role change fail');
    } finally {
      setSavingRole(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }
  if (!user) return <ErrorNote message={error ?? 'User nahi mila'} />;

  const membershipRoles = roles.filter(
    (r) => !PLATFORM_ROLE_KEYS.has(r.key) && r.key !== OWNER_ROLE_KEY,
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/users" className="text-sm text-muted hover:text-ink">
          ← Users
        </Link>
        <h1 className="tnum mt-1 text-2xl font-black text-ink">{user.phoneNumber}</h1>
        <p className="text-sm text-muted">
          {subscription
            ? `${subscription.planLabel} · ${subscription.status}`
            : 'Koi plan assign nahi'}
          {subscription?.expiresAt
            ? ` · expires ${formatWhen(subscription.expiresAt)}`
            : subscription
              ? ' · lifetime'
              : ''}
        </p>
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <p className="rounded-lg border border-ok/30 bg-ok-tint px-3 py-2 text-sm font-medium text-ok">
          {notice}
        </p>
      ) : null}

      <Card
        title="Platform role"
        subtitle={
          isSelf
            ? 'Apna role khud badal nahi sakte — API bhi isko rokta hai.'
            : isSuper
              ? 'Promote / demote — agla login se effect hoga. SUPER_ADMIN yahaan se nahi diya ja sakta.'
              : 'Read-only — role change ke liye SUPER_ADMIN chahiye.'
        }>
        <div className="flex flex-wrap items-center gap-2">
          {GRANTABLE_ROLES.map((role) => (
            <Button
              key={role}
              variant={user.platformRole === role ? 'primary' : 'secondary'}
              disabled={!isSuper || isSelf || savingRole}
              onClick={() => void changeRole(role)}>
              {role}
            </Button>
          ))}
          {user.platformRole === 'SUPER_ADMIN' ? (
            <span className="ml-1">
              <Badge label="Abhi SUPER ADMIN hai" tone="danger" />
            </span>
          ) : null}
        </div>
      </Card>

      <SubscriptionCard
        userId={user.id}
        subscription={subscription}
        plans={plans}
        disabled={isSelf}
        onChanged={(next) => {
          setSubscription(next);
          setNotice(`Plan ${next.planLabel} (${next.status}) kar diya.`);
          void subscriptionsApi.history(id).then(setHistory);
        }}
        onError={setError}
      />

      <Card title={`Owned shops (${user.ownedShops.length})`}>
        {user.ownedShops.length === 0 ? (
          <p className="text-sm text-muted">Koi shop own nahi karte.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Shop</Th>
                <Th>City</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {user.ownedShops.map((s) => (
                <tr key={s.id} className="transition hover:bg-ground/60">
                  <Td>
                    <Link
                      href={`/shops/${s.id}`}
                      className="font-semibold text-ink hover:text-brand-deep hover:underline">
                      {s.shopName}
                    </Link>
                  </Td>
                  <Td className="text-muted">{s.city}</Td>
                  <Td className="text-muted">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card
        title={`Memberships (${user.memberships.length})`}
        subtitle="Shop ke andar ka role. OWNER ka role yahaan se nahi badal sakta — uske liye ownership transfer chahiye, jo abhi backend me bana nahi hai.">
        {user.memberships.length === 0 ? (
          <p className="text-sm text-muted">Kisi shop ke member nahi hain.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Shop</Th>
                <Th>Role</Th>
                <Th align="right">Permissions</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {user.memberships.map((m) => (
                <tr key={m.id} className="transition hover:bg-ground/60">
                  <Td>
                    <Link
                      href={`/shops/${m.shopId}`}
                      className="font-semibold text-ink hover:text-brand-deep hover:underline">
                      {m.shopName}
                    </Link>
                    <p className="text-xs text-muted">{m.city}</p>
                  </Td>
                  <Td>
                    <MembershipRoleControl
                      shopId={m.shopId}
                      userId={user.id}
                      currentRole={m.role}
                      options={membershipRoles}
                      onChanged={() => void load()}
                      onError={setError}
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
        title="Plan history"
        subtitle="Append-only audit log — har plan change yahaan record hota hai.">
        {history.length === 0 ? (
          <p className="text-sm text-muted">Abhi koi plan change nahi hua.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Status</Th>
                <Th>From → to</Th>
                <Th>Changed by</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <Td className="font-semibold text-ink">{h.planLabel}</Td>
                  <Td>
                    <Badge
                      label={h.status}
                      tone={h.status === 'ACTIVE' ? 'ok' : 'neutral'}
                    />
                  </Td>
                  <Td className="tnum text-muted">
                    {formatWhen(h.startedAt)} →{' '}
                    {h.endedAt ? formatWhen(h.endedAt) : 'abhi tak'}
                  </Td>
                  <Td className="tnum text-muted">{h.changedByPhone ?? 'system'}</Td>
                  <Td className="text-muted">{h.reason ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/**
 * Plan editor. Everything is one PATCH — the API updates the current row and appends
 * the audit entry in a single transaction, so there is no half-applied state to undo.
 */
function SubscriptionCard({
  userId,
  subscription,
  plans,
  disabled,
  onChanged,
  onError,
}: {
  userId: string;
  subscription: UserSubscription | null;
  plans: SubscriptionPlan[];
  disabled: boolean;
  onChanged: (next: UserSubscription) => void;
  onError: (message: string) => void;
}) {
  const [planKey, setPlanKey] = useState(subscription?.planKey ?? '');
  const [status, setStatus] = useState<SubscriptionStatus>(
    subscription?.status ?? 'ACTIVE',
  );
  const [expiresAt, setExpiresAt] = useState(
    toLocalInputValue(subscription?.expiresAt),
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!planKey) {
      onError('Plan select karein');
      return;
    }
    setSaving(true);
    try {
      onChanged(
        await subscriptionsApi.change(userId, {
          planKey,
          status,
          // Empty date means "no expiry"; the API models that as an explicit null.
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          reason: reason.trim() || undefined,
        }),
      );
      setReason('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Plan change fail');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Subscription plan"
      subtitle={
        disabled
          ? 'Apna plan khud badal nahi sakte — API bhi isko rokta hai.'
          : 'Plan, status aur expiry badlein. Change audit log me record hoga.'
      }
      actions={
        <Button onClick={() => void save()} loading={saving} disabled={disabled}>
          Plan update karein
        </Button>
      }>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Plan</span>
          <select
            value={planKey}
            onChange={(e) => setPlanKey(e.target.value)}
            disabled={disabled}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-50">
            <option value="">— select —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.key}>
                {p.label} ({p.key})
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            Archived plans list me nahi aate — API unhe assign hone nahi deta.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
            disabled={disabled}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-50">
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <Input
            label="Expires on"
            type="datetime-local"
            value={expiresAt}
            disabled={disabled}
            onChange={(e) => setExpiresAt(e.target.value)}
            hint="Aapke apne timezone me. Khaali chhodein to expiry hategi (lifetime)."
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setExpiresAt(endOfTodayPlusDays(30))}
              className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-ground disabled:opacity-50">
              +30 din
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setExpiresAt(endOfTodayPlusDays(365))}
              className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-ground disabled:opacity-50">
              +1 saal
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setExpiresAt('')}
              className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-ground disabled:opacity-50">
              Lifetime
            </button>
          </div>
        </div>

        <Input
          label="Reason"
          value={reason}
          disabled={disabled}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Payment received, manual upgrade…"
          hint="Audit log me dikhega."
        />
      </div>
    </Card>
  );
}

/**
 * Per-membership shop role.
 *
 * The API refuses to touch an OWNER membership, and refuses to grant OWNER, pointing
 * at an ownership-transfer flow that does not exist yet. Rather than let the admin
 * click into a guaranteed 403, the control is locked with that reason shown.
 */
function MembershipRoleControl({
  shopId,
  userId,
  currentRole,
  options,
  onChanged,
  onError,
}: {
  shopId: string;
  userId: string;
  currentRole: string | null;
  options: ApiRole[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  if (currentRole === OWNER_ROLE_KEY) {
    return (
      <span title="Ownership transfer flow abhi backend me nahi hai">
        <Badge label="OWNER · locked" tone="accent" />
      </span>
    );
  }

  const change = async (roleKey: string) => {
    if (!roleKey || roleKey === currentRole) return;
    setSaving(true);
    try {
      await adminApi.updateMembershipRole(shopId, userId, roleKey);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Membership role change fail');
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      value={currentRole ?? ''}
      disabled={saving || options.length === 0}
      onChange={(e) => void change(e.target.value)}
      className="rounded-lg border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-brand disabled:opacity-50">
      {currentRole === null ? <option value="">— no role —</option> : null}
      {options.map((r) => (
        <option key={r.id} value={r.key}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

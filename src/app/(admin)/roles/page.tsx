'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorNote,
  Input,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import type { ApiRole, PermissionCatalog } from '@/lib/types';

export default function RolesPage() {
  const [roles, setRoles] = useState<ApiRole[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ApiRole | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<ApiRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        adminApi.listRoles(),
        adminApi.permissionCatalog(),
      ]);
      setRoles(r);
      setCatalog(c);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Roles load fail');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: every setState here runs in a promise continuation, well after
    // the effect returns, so it can't drive the cascading re-render the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const startEdit = (role: ApiRole) => {
    setEditing(role);
    setSelected(new Set(role.permissions));
  };

  const savePermissions = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.setRolePermissions(editing.id, [...selected]);
      setEditing(null);
      await load();
    } catch (err) {
      // The API refuses to let you grant a permission you don't hold yourself.
      setError(err instanceof Error ? err.message : 'Permissions save fail');
    } finally {
      setSaving(false);
    }
  };

  const createRole = async () => {
    if (!newKey.trim() || !newLabel.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.createRole({
        key: newKey.trim().toUpperCase(),
        label: newLabel.trim(),
      });
      setCreating(false);
      setNewKey('');
      setNewLabel('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role create fail');
    } finally {
      setSaving(false);
    }
  };

  const removeRole = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminApi.deleteRole(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role delete fail');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink">Roles</h1>
          <p className="text-sm text-muted">
            Role → permissions mapping. System roles rename ho sakte hain, delete nahi.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'Naya role'}
        </Button>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      {creating ? (
        <Card
          title="Naya role"
          actions={
            <Button
              onClick={() => void createRole()}
              loading={saving}
              disabled={!newKey.trim() || !newLabel.trim()}>
              Create
            </Button>
          }>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="STOCK_MANAGER"
              hint="Uppercase, underscore separated. Baad me badla nahi ja sakta."
            />
            <Input
              label="Label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Stock manager"
            />
          </div>
        </Card>
      ) : null}

      <Card title={`${roles.length} roles`}>
        <Table>
          <thead>
            <tr>
              <Th>Role</Th>
              <Th align="right">Permissions</Th>
              <Th align="right">Users</Th>
              <Th align="right">Memberships</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="transition hover:bg-ground/60">
                <Td>
                  <span className="font-semibold text-ink">{r.label}</span>
                  <p className="font-mono text-xs text-muted">{r.key}</p>
                  {r.isSystem ? <Badge label="System" tone="accent" /> : null}
                </Td>
                <Td align="right" className="tnum text-muted">
                  {r.permissions.length}
                </Td>
                <Td align="right" className="tnum text-muted">
                  {r.usersCount}
                </Td>
                <Td align="right" className="tnum text-muted">
                  {r.membershipsCount}
                </Td>
                <Td align="right">
                  <span className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => startEdit(r)}>
                      Permissions
                    </Button>
                    {!r.isSystem ? (
                      <Button variant="ghost" onClick={() => setDeleteTarget(r)}>
                        Delete
                      </Button>
                    ) : null}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {editing && catalog ? (
        <Card
          title={`${editing.label} — permissions`}
          subtitle={`${selected.size} of ${catalog.permissions.length} selected`}
          actions={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={() => void savePermissions()} loading={saving}>
                Save
              </Button>
            </>
          }>
          <div className="flex flex-col gap-6">
            {catalog.groups.map((group) => {
              const allOn = group.permissions.every((p) => selected.has(p.key));
              return (
                <div key={group.category} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-ink">{group.category}</h3>
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand-deep hover:underline"
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const p of group.permissions) {
                            if (allOn) next.delete(p.key);
                            else next.add(p.key);
                          }
                          return next;
                        })
                      }>
                      {allOn ? 'Sab hataayein' : 'Sab chunein'}
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.permissions.map((p) => (
                      <label
                        key={p.key}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected.has(p.key)}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(p.key);
                              else next.delete(p.key);
                              return next;
                            })
                          }
                        />
                        <span>
                          <span className="block text-sm font-semibold text-ink">
                            {p.label}
                          </span>
                          <span className="block font-mono text-xs text-muted">
                            {p.key}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Role delete karein?"
        message={`"${deleteTarget?.label ?? ''}" delete ho jayega. Jin users/memberships pe yeh role laga hai unhe pehle badalna hoga.`}
        loading={deleting}
        onConfirm={() => void removeRole()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

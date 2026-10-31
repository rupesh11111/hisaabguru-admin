'use client';

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
import { ApiError, catalogOptionsApi } from '@/lib/api';
import type { CatalogOption, CatalogOptionKind } from '@/lib/types';

const TABS: Array<{ kind: CatalogOptionKind; label: string }> = [
  { kind: 'CATEGORY', label: 'Categories' },
  { kind: 'UNIT', label: 'Units' },
];

type LabelDraft = {
  labelHinglish: string;
  labelHindi: string;
  labelEnglish: string;
  sortOrder: string;
};

const EMPTY_LABELS: LabelDraft = {
  labelHinglish: '',
  labelHindi: '',
  labelEnglish: '',
  sortOrder: '',
};

function toDraft(o: CatalogOption): LabelDraft {
  return {
    labelHinglish: o.labelHinglish,
    labelHindi: o.labelHindi,
    labelEnglish: o.labelEnglish,
    sortOrder: String(o.sortOrder),
  };
}

const labelsFilled = (d: LabelDraft) =>
  Boolean(d.labelHinglish.trim() && d.labelHindi.trim() && d.labelEnglish.trim());

/** Blank is allowed: on create it lets the server pick, on edit it leaves it alone. */
const sortOrderValid = (d: LabelDraft) => /^\d*$/.test(d.sortOrder.trim());

function toPayload(d: LabelDraft) {
  const sortOrder = d.sortOrder.trim();
  return {
    labelHinglish: d.labelHinglish.trim(),
    labelHindi: d.labelHindi.trim(),
    labelEnglish: d.labelEnglish.trim(),
    sortOrder: sortOrder ? Number(sortOrder) : undefined,
  };
}

export default function CatalogOptionsPage() {
  const [tab, setTab] = useState<CatalogOptionKind>('CATEGORY');
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink">Categories &amp; Units</h1>
          <p className="text-sm text-muted">
            Product forms inhi lists se pick karte hain. Archive karne par option sirf
            picker se hatta hai, items par value bani rehti hai.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Active dikhaayein' : 'Archived bhi dikhaayein'}
        </Button>
      </header>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <Button
            key={t.kind}
            variant={tab === t.kind ? 'primary' : 'secondary'}
            onClick={() => setTab(t.kind)}>
            {t.label}
          </Button>
        ))}
      </div>

      {/* Keyed so a tab switch drops the other tab's rows, drafts and in-flight load. */}
      <OptionsPanel key={tab} kind={tab} showArchived={showArchived} />
    </div>
  );
}

function OptionsPanel({
  kind,
  showArchived,
}: {
  kind: CatalogOptionKind;
  showArchived: boolean;
}) {
  const isCategory = kind === 'CATEGORY';

  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<CatalogOption | null>(null);
  const [draft, setDraft] = useState<LabelDraft>(EMPTY_LABELS);

  const [creating, setCreating] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [newDraft, setNewDraft] = useState<LabelDraft>(EMPTY_LABELS);

  const [archiveTarget, setArchiveTarget] = useState<CatalogOption | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    try {
      setOptions(await catalogOptionsApi.list(kind, showArchived));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Options load fail');
    } finally {
      setLoading(false);
    }
  }, [kind, showArchived]);

  useEffect(() => {
    // Fetch-on-mount: every setState here runs in a promise continuation, well after
    // the effect returns, so it can't drive the cascading re-render the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const startEdit = (o: CatalogOption) => {
    setEditing(o);
    setDraft(toDraft(o));
  };

  const save = async () => {
    if (!editing) return;
    if (!sortOrderValid(draft)) {
      setError('Sort order sirf number ho sakta hai');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await catalogOptionsApi.update(editing.id, toPayload(draft));
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Option save fail');
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const value = newValue.trim();
    if (!value || !labelsFilled(newDraft)) return;
    if (!sortOrderValid(newDraft)) {
      setError('Sort order sirf number ho sakta hai');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await catalogOptionsApi.create({ kind, value, ...toPayload(newDraft) });
      setCreating(false);
      setNewValue('');
      setNewDraft(EMPTY_LABELS);
      await load();
    } catch (err) {
      // An archived row still owns its value, and it is hidden from the default list.
      setError(
        err instanceof ApiError && err.statusCode === 409
          ? `"${value}" pehle se hai. List me nahi dikh rahi to archived hogi — wahan se Restore karein.`
          : err instanceof Error
            ? err.message
            : 'Option create fail',
      );
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    setError(null);
    try {
      await catalogOptionsApi.archive(archiveTarget.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive fail');
    } finally {
      setArchiving(false);
      setArchiveTarget(null);
    }
  };

  const restore = async (o: CatalogOption) => {
    setError(null);
    try {
      await catalogOptionsApi.restore(o.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore fail');
    }
  };

  const noun = isCategory ? 'category' : 'unit';
  const newLabel = isCategory ? 'Nayi category' : 'Naya unit';

  return (
    <>
      {error ? <ErrorNote message={error} /> : null}

      {creating ? (
        <Card
          title={newLabel}
          actions={
            <Button
              onClick={() => void create()}
              loading={saving}
              disabled={!newValue.trim() || !labelsFilled(newDraft)}>
              Create
            </Button>
          }>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Value *"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={isCategory ? 'Biscuits' : 'packet'}
                hint="Yahi value items par store hoti hai. Baad me badli nahi ja sakti."
              />
            </div>
            <LabelFields
              draft={newDraft}
              onChange={(next) => setNewDraft({ ...newDraft, ...next })}
            />
          </div>
        </Card>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size={28} />
        </div>
      ) : (
        <Card
          title={`${options.length} ${isCategory ? 'categories' : 'units'}`}
          actions={
            <Button onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : newLabel}
            </Button>
          }>
          {options.length === 0 ? (
            <EmptyState
              title={`Koi ${noun} nahi`}
              description="Naya option add karein, ya archived bhi dikhaayein."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Value</Th>
                  <Th>Hinglish</Th>
                  <Th>Hindi</Th>
                  <Th>English</Th>
                  <Th align="right">Sort</Th>
                  <Th align="right">Inventory</Th>
                  <Th align="right">Products</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {options.map((o) => (
                  <tr key={o.id} className="transition hover:bg-ground/60">
                    <Td>
                      <span className="font-mono text-sm font-semibold text-ink">
                        {o.value}
                      </span>
                      {o.archivedAt ? (
                        <p>
                          <Badge label="Archived" tone="danger" />
                        </p>
                      ) : o.isSystem ? (
                        <p>
                          <Badge label="System" tone="accent" />
                        </p>
                      ) : null}
                    </Td>
                    <Td className="text-muted">{o.labelHinglish}</Td>
                    <Td className="text-muted">{o.labelHindi}</Td>
                    <Td className="text-muted">{o.labelEnglish}</Td>
                    <Td align="right" className="tnum text-muted">
                      {o.sortOrder}
                    </Td>
                    <Td align="right" className="tnum text-muted">
                      {o.usage.inventory}
                    </Td>
                    <Td align="right" className="tnum text-muted">
                      {o.usage.products}
                    </Td>
                    <Td align="right">
                      <span className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => startEdit(o)}>
                          Edit
                        </Button>
                        {o.archivedAt ? (
                          <Button variant="ghost" onClick={() => void restore(o)}>
                            Restore
                          </Button>
                        ) : !o.isSystem ? (
                          <Button variant="ghost" onClick={() => setArchiveTarget(o)}>
                            Archive
                          </Button>
                        ) : null}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {editing ? (
        <Card
          title={`Edit ${noun}`}
          actions={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                loading={saving}
                disabled={!labelsFilled(draft)}>
                Save
              </Button>
            </>
          }>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Value"
                value={editing.value}
                readOnly
                className="cursor-not-allowed opacity-60"
                hint="Value badli nahi ja sakti — yeh items par store hoti hai. Sirf labels badalte hain."
              />
            </div>
            <LabelFields
              draft={draft}
              onChange={(next) => setDraft({ ...draft, ...next })}
            />
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        open={archiveTarget !== null}
        title={`${isCategory ? 'Category' : 'Unit'} archive karein?`}
        message={`"${archiveTarget?.value ?? ''}" sirf picker se hategi. Existing items ki value waisi hi rahegi — ${archiveTarget?.usage.inventory ?? 0} inventory rows aur ${archiveTarget?.usage.products ?? 0} products par koi asar nahi.`}
        confirmLabel="Archive"
        loading={archiving}
        onConfirm={() => void archive()}
        onCancel={() => setArchiveTarget(null)}
      />
    </>
  );
}

function LabelFields({
  draft,
  onChange,
}: {
  draft: LabelDraft;
  onChange: (next: Partial<LabelDraft>) => void;
}) {
  return (
    <>
      <Input
        label="Label (Hinglish) *"
        value={draft.labelHinglish}
        onChange={(e) => onChange({ labelHinglish: e.target.value })}
      />
      <Input
        label="Label (Hindi) *"
        value={draft.labelHindi}
        onChange={(e) => onChange({ labelHindi: e.target.value })}
      />
      <Input
        label="Label (English) *"
        value={draft.labelEnglish}
        onChange={(e) => onChange({ labelEnglish: e.target.value })}
      />
      <Input
        label="Sort order"
        value={draft.sortOrder}
        inputMode="numeric"
        hint="Chhota number picker me upar."
        onChange={(e) => onChange({ sortOrder: e.target.value })}
      />
    </>
  );
}

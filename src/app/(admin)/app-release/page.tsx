'use client';

import { useEffect, useState } from 'react';

import {
  Button,
  Card,
  ConfirmDialog,
  ErrorNote,
  Input,
  Spinner,
} from '@/components/ui';
import { appReleaseApi, type AppRelease, type AppReleasePlatform } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Numeric, so 1.10.0 > 1.9.0. Mirrors the API's own check. */
function compare(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const PLATFORMS: { key: AppReleasePlatform; label: string; storeHint: string }[] = [
  {
    key: 'android',
    label: 'Android (Play Store)',
    storeHint: 'Leave blank and the app opens its own Play Store page.',
  },
  {
    key: 'ios',
    label: 'iOS (App Store)',
    storeHint: 'iOS needs a store link, or the prompt will not show.',
  },
];

export default function AppReleasePage() {
  const [rows, setRows] = useState<AppRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    appReleaseApi
      .list()
      .then(setRows)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load'),
      );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-black text-ink">App release</h1>
        <p className="text-sm text-muted">
          Raise the latest version here only <strong>after</strong> the new build is live in the store.
          Users on an older app see a &quot;New version available&quot; popup, which they can
          dismiss for later. Apps older than the minimum version <strong>stop working</strong> until
          they update, so raise it only when the old app is genuinely broken.
          OTA updates (eas update) need nothing here; the app shows its own restart popup.
        </p>
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <p className="rounded-lg border border-ok/30 bg-ok-tint px-3 py-2 text-sm font-medium text-ok">
          {notice}
        </p>
      ) : null}

      {rows === null && !error ? (
        <div className="flex justify-center py-14">
          <Spinner size={26} />
        </div>
      ) : (
        PLATFORMS.map((p) => (
          <PlatformCard
            key={p.key}
            platform={p.key}
            label={p.label}
            storeHint={p.storeHint}
            current={rows?.find((r) => r.platform === p.key) ?? null}
            onSaved={(saved) => {
              setRows((prev) => [
                ...(prev ?? []).filter((r) => r.platform !== saved.platform),
                saved,
              ]);
              setNotice(`${p.label}: latest ${saved.latestVersion}, minimum ${saved.minVersion} saved.`);
              setError(null);
            }}
            onError={setError}
          />
        ))
      )}
    </div>
  );
}

function PlatformCard({
  platform,
  label,
  storeHint,
  current,
  onSaved,
  onError,
}: {
  platform: AppReleasePlatform;
  label: string;
  storeHint: string;
  current: AppRelease | null;
  onSaved: (saved: AppRelease) => void;
  onError: (message: string) => void;
}) {
  const [latest, setLatest] = useState(current?.latestVersion ?? '');
  const [min, setMin] = useState(current?.minVersion ?? '');
  const [storeUrl, setStoreUrl] = useState(current?.storeUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const formatOk = VERSION.test(latest) && VERSION.test(min);
  const orderOk = formatOk && compare(min, latest) <= 0;
  const dirty =
    latest !== (current?.latestVersion ?? '') ||
    min !== (current?.minVersion ?? '') ||
    storeUrl !== (current?.storeUrl ?? '');
  // Raising the minimum locks people out; that deserves a second look.
  const raisesMin = !!current && formatOk && compare(min, current.minVersion) > 0;

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await appReleaseApi.set(platform, {
          latestVersion: latest,
          minVersion: min,
          storeUrl: storeUrl.trim() || null,
        }),
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <Card
      title={label}
      subtitle={
        current
          ? `Current: latest ${current.latestVersion}, minimum ${current.minVersion} · ${fmtDateTime(current.updatedAt)}`
          : 'Not set yet, so the app shows no update popup.'
      }>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Latest version"
          value={latest}
          onChange={(e) => setLatest(e.target.value.trim())}
          placeholder="1.3.0"
        />
        <Input
          label="Minimum version (older apps are blocked)"
          value={min}
          onChange={(e) => setMin(e.target.value.trim())}
          placeholder="1.1.0"
        />
        <div className="sm:col-span-2">
          <Input
            label="Store link (optional)"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder={
              platform === 'android'
                ? 'market://details?id=com.hisaabguru.app'
                : 'https://apps.apple.com/app/id…'
            }
          />
          <p className="mt-1 text-xs text-muted">{storeHint}</p>
        </div>
      </div>
      {formatOk && !orderOk ? (
        <p className="mt-3 text-sm text-danger">
          Minimum version cannot be higher than the latest version.
        </p>
      ) : null}
      {!formatOk && (latest || min) ? (
        <p className="mt-3 text-sm text-danger">Enter a version like 1.2.0.</p>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button
          disabled={!dirty || !orderOk}
          loading={saving}
          onClick={() => (raisesMin ? setConfirming(true) : void save())}>
          Save
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Raise the minimum version?"
        message={`${label} apps older than ${min} will stop working immediately until the user updates from the store. Make sure ${latest} is live in the store.`}
        confirmLabel="Yes, raise it"
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}

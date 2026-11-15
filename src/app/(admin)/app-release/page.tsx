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
    storeHint: 'Khaali chhodein to app khud apna Play Store page kholega.',
  },
  {
    key: 'ios',
    label: 'iOS (App Store)',
    storeHint: 'iOS par store link zaroori hai, warna prompt nahi dikhega.',
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
        setError(err instanceof Error ? err.message : 'Load fail'),
      );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-black text-ink">App release</h1>
        <p className="text-sm text-muted">
          Store par naya version daalne ke <strong>baad</strong> yahaan Latest version badhaiye.
          Purane app wale ko &quot;Naya version aaya hai&quot; popup dikhega, jise wo baad me bhi
          kar sakte hain. Minimum version se purane app <strong>band ho jaate hain</strong> jab
          tak update na karein, isliye ise sirf tab badhaiye jab purana app sach me toot raha ho.
          OTA (eas update) ke liye yahaan kuch nahi karna, app khud restart ka popup dikhata hai.
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
              setNotice(`${p.label}: latest ${saved.latestVersion}, minimum ${saved.minVersion} save ho gaya.`);
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
      onError(err instanceof Error ? err.message : 'Save fail');
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
          ? `Abhi: latest ${current.latestVersion}, minimum ${current.minVersion} · ${fmtDateTime(current.updatedAt)}`
          : 'Abhi set nahi hai, isliye app koi update popup nahi dikhata.'
      }>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Latest version"
          value={latest}
          onChange={(e) => setLatest(e.target.value.trim())}
          placeholder="1.3.0"
        />
        <Input
          label="Minimum version (isse purana band)"
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
          Minimum version latest se bada nahi ho sakta.
        </p>
      ) : null}
      {!formatOk && (latest || min) ? (
        <p className="mt-3 text-sm text-danger">Version 1.2.0 jaisa likhiye.</p>
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
        title="Minimum version badhayein?"
        message={`${min} se purane ${label} app turant band ho jaayenge jab tak user store se update na kare. Pakka karein ki ${latest} store par live hai.`}
        confirmLabel="Haan, badhayein"
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}

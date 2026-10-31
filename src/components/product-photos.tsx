'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { Button, Card, ConfirmDialog, ErrorNote } from '@/components/ui';
import { adminApi } from '@/lib/api';
import type { ProductDetail } from '@/lib/types';

/** The API's limits, repeated here only to fail fast before a slow upload. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS = 8;

/**
 * Rows predating `imageUrls` keep their one photo in `imageUrl`. Read through a
 * fallback, so such a row shows its photo instead of an empty list.
 */
function photosOf(product: ProductDetail): string[] {
  if (product.imageUrls?.length) return product.imageUrls;
  return product.imageUrl ? [product.imageUrl] : [];
}

/**
 * Catalog photos of a saved product. Uploads and removals apply immediately and reach
 * every shop, so they stay separate from the form's Save. Errors stay in this card:
 * unconfigured storage is a 503 here and must not take the rest of the page with it.
 */
export function ProductPhotos({
  product,
  onChange,
}: {
  product: ProductDetail;
  onChange: (updated: ProductDetail) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  /** The photo awaiting confirmation. */
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const photos = photosOf(product);
  const full = photos.length >= MAX_PHOTOS;
  // Each response replaces the whole list, so two calls at once could undo each other.
  const busy = uploading || removing;

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Otherwise picking the same file again, say after a failure, fires no change event.
    e.target.value = '';
    if (!file) return;

    // `accept` only filters the picker; "All files" gets past it.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Sirf JPEG, PNG ya WebP photo chalegi.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `Photo ${(file.size / (1024 * 1024)).toFixed(1)} MB ki hai — 5 MB tak hi chalegi.`,
      );
      return;
    }

    setUploading(true);
    setError(null);
    try {
      onChange(await adminApi.addProductPhoto(product.id, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fail');
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!confirmUrl) return;
    setRemoving(true);
    setError(null);
    try {
      onChange(await adminApi.removeProductPhoto(product.id, confirmUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove fail');
    } finally {
      setRemoving(false);
      setConfirmUrl(null);
    }
  };

  return (
    <Card
      title={`Photos (${photos.length}/${MAX_PHOTOS})`}
      subtitle="Yeh photos sab shops me dikhti hain. Pehli photo main photo hai."
      actions={
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Photo chunein"
            className="hidden"
            onChange={(e) => void upload(e)}
          />
          <Button
            variant="secondary"
            onClick={() => input.current?.click()}
            loading={uploading}
            disabled={busy || full}>
            {uploading ? 'Upload ho raha hai…' : 'Add photo'}
          </Button>
        </>
      }>
      <div className="flex flex-col gap-4">
        {error ? <ErrorNote message={error} /> : null}

        {photos.length === 0 ? (
          <p className="text-sm text-muted">Abhi koi photo nahi hai.</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {photos.map((url, i) => (
              <li key={url} className="flex flex-col gap-1">
                <Frame>
                  <Photo url={url} alt={`${product.name} photo ${i + 1}`} />
                </Frame>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmUrl(url)}
                  disabled={busy}
                  aria-label={`Photo ${i + 1} remove karein`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted">
          {full
            ? `${MAX_PHOTOS} photos poori ho gayi — nayi add karne se pehle koi ek remove karein.`
            : 'JPEG, PNG ya WebP, 5 MB tak.'}
        </p>
      </div>

      <ConfirmDialog
        open={confirmUrl !== null}
        title="Photo remove karein?"
        message="Yeh photo sab shops se hat jayegi, sirf is screen se nahi."
        confirmLabel="Haan, remove karein"
        loading={removing}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmUrl(null)}>
        {confirmUrl ? (
          <Frame>
            <Photo url={confirmUrl} alt={`${product.name} photo`} />
          </Frame>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <span className="block size-28 overflow-hidden rounded-lg border border-line bg-white">
      {children}
    </span>
  );
}

/** Keyed by URL at its call site in the list, so a failure stays with its own photo. */
function Photo({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="flex size-full items-center justify-center bg-ground p-2 text-center text-xs text-muted">
        Photo load nahi hui
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- next/image throws on a host outside remotePatterns, which are fixed at build time; photos come from Cloudinary and from open-ended provider CDN hosts.
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-full object-contain p-1"
    />
  );
}

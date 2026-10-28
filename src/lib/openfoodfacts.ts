/**
 * Barcode → product lookup against the Open*Facts family of databases.
 *
 * Free, no API key, crowdsourced. Coverage for Indian kirana SKUs is patchy, so this
 * module is built to squeeze the most out of it:
 *   - GTIN validation + normalization (UPC-A ↔ EAN-13) before we spend a request
 *   - three databases tried in order: food → beauty → general products
 *   - partial records accepted (blank name is reconstructed from brand + quantity)
 *   - retry with exponential backoff + jitter, honouring Retry-After
 *   - in-memory TTL cache with LRU eviction, plus negative caching for misses
 *   - single-flight dedup so a double-scan doesn't fire two requests
 *
 * Reference: https://openfoodfacts.github.io/openfoodfacts-server/api/
 */

/** Browser build has no Sentry wiring yet — log and move on. */
function captureError(err: unknown, context?: Record<string, unknown>): void {
  console.error('[lookupBarcode]', err, context);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OpenFoodFactsProduct = {
  /** The barcode as scanned (not the normalized variant used for lookup). */
  barcode: string;
  name: string;
  brand?: string;
  category?: string;
  quantity?: string;
  imageUrl?: string;
  /** true jab naam OFF se nahi mila aur brand/quantity se banaya gaya hai — UI confirm karwa le. */
  nameIsGuessed: boolean;
  /** Which Open*Facts database answered. Useful for debugging coverage gaps. */
  source: DatabaseId;
  /** Full raw API response — store on item for offline future lookups. */
  raw: Record<string, unknown>;
};

export type BarcodeLookupErrorKind =
  /** Barcode is malformed or fails its GTIN check digit — never worth a request. */
  | 'invalid-barcode'
  /** Request exceeded the per-attempt timeout budget. */
  | 'timeout'
  /** DNS/offline/TLS — no HTTP response at all. */
  | 'network'
  /** 429 from the API; we already backed off and retried. */
  | 'rate-limited'
  /** 5xx from the API after retries. */
  | 'server'
  /** Caller aborted via their own AbortSignal. */
  | 'aborted';

export class BarcodeLookupError extends Error {
  constructor(
    message: string,
    public readonly kind: BarcodeLookupErrorKind,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'BarcodeLookupError';
  }
}

export type LookupOptions = {
  signal?: AbortSignal;
  /** Skip the cache and force a fresh network lookup. */
  forceRefresh?: boolean;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Open*Facts asks every client to send an identifying User-Agent so they can
 * contact us if we misbehave. Unidentified clients get rate-limited harder.
 */
const USER_AGENT = 'hisaabGuru-admin/1.0 (Web; +https://hisaabguru.app)';

// India subdomains. Same global database as `world.` — compared live on 2026-10-29
// (Maggi, Nutella: identical records; foreign products still resolve) — so this
// loses no coverage. Keep the backend and admin lists identical.
const DATABASES = [
  { id: 'food', host: 'in.openfoodfacts.org' },
  { id: 'beauty', host: 'in.openbeautyfacts.org' },
  { id: 'products', host: 'in.openproductsfacts.org' },
] as const;

export type DatabaseId = (typeof DATABASES)[number]['id'];

/** Fields we actually read. Asking for a subset keeps responses ~20x smaller. */
const FIELDS = [
  'product_name',
  'product_name_en',
  'generic_name',
  'generic_name_en',
  'abbreviated_product_name',
  'brands',
  'categories',
  'categories_tags',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'net_weight',
  'image_front_small_url',
  'image_front_url',
  'image_small_url',
  'image_url',
].join(',');

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 4_000;

const CACHE_MAX_ENTRIES = 500;
const CACHE_TTL_HIT_MS = 7 * 24 * 60 * 60 * 1_000; // Product metadata barely changes.
const CACHE_TTL_MISS_MS = 60 * 60 * 1_000; // Misses can become hits — recheck hourly.

// ---------------------------------------------------------------------------
// GTIN validation & normalization
// ---------------------------------------------------------------------------

/**
 * Mod-10 check digit shared by GTIN-8/12/13/14. A scanner occasionally emits a
 * misread; catching it here saves a pointless round trip and a wrong prefill.
 */
function hasValidCheckDigit(code: string): boolean {
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  // Rightmost digit before the check digit always carries weight 3.
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Lookup candidates for a scanned code, most likely first.
 *
 * Open*Facts stores everything as GTIN-13, so a 12-digit UPC-A must be zero-padded.
 * UPC-E (8 digits) is a compressed UPC-A — expanding it is the only way those
 * scan-at-the-counter codes ever match.
 */
function lookupCandidates(code: string): string[] {
  const out = [code];
  if (code.length === 12) out.push(`0${code}`);
  if (code.length === 8) {
    const expanded = expandUpcE(code);
    if (expanded) out.push(expanded, `0${expanded}`);
  }
  if (code.length === 14 && code.startsWith('0')) out.push(code.slice(1));
  return Array.from(new Set(out));
}

/** UPC-E → UPC-A per GS1 zero-suppression rules. Returns null if not expandable. */
function expandUpcE(code: string): string | null {
  if (code.length !== 8 || !code.startsWith('0')) return null;
  const d = code.slice(1, 7);
  const check = code[7];
  const last = d[5];

  let middle: string;
  if (last === '0' || last === '1' || last === '2') {
    middle = `${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
  } else if (last === '3') {
    middle = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
  } else if (last === '4') {
    middle = `${d.slice(0, 4)}00000${d[4]}`;
  } else {
    middle = `${d.slice(0, 5)}0000${last}`;
  }
  return `0${middle}${check}`;
}

/** Normalizes and validates a scanned string. Throws on anything unusable. */
export function assertScannableBarcode(input: string): string {
  // Scanners sometimes append whitespace or a trailing newline from keyboard-wedge mode.
  const code = input.trim().replace(/\s+/g, '');
  if (!code) {
    throw new BarcodeLookupError('Barcode khaali hai', 'invalid-barcode');
  }
  if (!/^\d+$/.test(code)) {
    throw new BarcodeLookupError('Barcode mein sirf digits hone chahiye', 'invalid-barcode');
  }
  if (![8, 12, 13, 14].includes(code.length)) {
    throw new BarcodeLookupError(
      `${code.length}-digit barcode retail GTIN nahi hai`,
      'invalid-barcode',
    );
  }
  if (!hasValidCheckDigit(code)) {
    throw new BarcodeLookupError('Barcode check digit galat hai — dobara scan karein', 'invalid-barcode');
  }
  return code;
}

// ---------------------------------------------------------------------------
// Cache (TTL + LRU) and single-flight dedup
// ---------------------------------------------------------------------------

type CacheEntry = { value: OpenFoodFactsProduct | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<OpenFoodFactsProduct | null>>();

function cacheGet(key: string, now: number): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  // Map preserves insertion order — re-inserting marks this key as most recently used.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key: string, value: OpenFoodFactsProduct | null, now: number): void {
  cache.set(key, {
    value,
    expiresAt: now + (value ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS),
  });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Exposed for tests and for a "refresh catalog" action. */
export function clearBarcodeCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// HTTP with timeout, retry and backoff
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new BarcodeLookupError('Lookup cancel ho gaya', 'aborted'));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
  });
}

/** Full jitter backoff — avoids a thundering herd when many devices retry together. */
function backoffDelay(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, BACKOFF_CAP_MS);
  }
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
  return Math.random() * ceiling;
}

/**
 * One HTTP GET with its own timeout, chained to the caller's abort signal.
 * `AbortSignal.any` isn't available on Hermes, so the two signals are bridged by hand.
 */
async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();

  if (signal?.aborted) {
    clearTimeout(timer);
    throw new BarcodeLookupError('Lookup cancel ho gaya', 'aborted');
  }
  signal?.addEventListener('abort', onCallerAbort);

  try {
    return await fetch(url, {
      // Browsers own the real `User-Agent`; Open*Facts reads `X-User-Agent` instead so
      // web clients can still identify themselves. It is on their CORS allow-list, so
      // the preflight succeeds (and is cached for 20 days).
      headers: { 'X-User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    // Both the timeout and the caller's cancel surface as the same AbortError.
    if (err instanceof Error && err.name === 'AbortError') {
      if (signal?.aborted) throw new BarcodeLookupError('Lookup cancel ho gaya', 'aborted');
      throw new BarcodeLookupError('OpenFoodFacts timeout — network slow hai', 'timeout');
    }
    throw new BarcodeLookupError(
      err instanceof Error ? `Network error: ${err.message}` : 'Network error',
      'network',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Queries one database for one barcode variant.
 * Returns null for a clean "not in this database"; throws only on real failures.
 */
async function queryDatabase(
  host: string,
  code: string,
  signal: AbortSignal | undefined,
  /** `null` asks for the complete record — every field the database holds. */
  fields: string | null = FIELDS,
): Promise<RawResponse | null> {
  const url =
    `https://${host}/api/v2/product/${encodeURIComponent(code)}.json` +
    `?${fields ? `fields=${fields}&` : ''}lc=en`;

  let lastError: BarcodeLookupError | null = null;
  // Retry-After from the previous response. Local, so concurrent lookups can't clobber it.
  let retryAfter: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffDelay(attempt - 1, retryAfter), signal);

    let res: Response;
    try {
      res = await fetchWithTimeout(url, signal);
    } catch (err) {
      const e = err as BarcodeLookupError;
      // A cancelled request must not be retried — the user closed the scanner.
      if (e.kind === 'aborted' || e.kind === 'invalid-barcode') throw e;
      lastError = e;
      retryAfter = null;
      continue;
    }

    // 404 is the API's normal "no such product" — a definitive answer, not a failure.
    if (res.status === 404) return null;

    if (res.status === 429 || res.status >= 500) {
      retryAfter = res.headers.get('Retry-After');
      lastError = new BarcodeLookupError(
        res.status === 429
          ? 'OpenFoodFacts rate limit — thodi der baad try karein'
          : `OpenFoodFacts server error (${res.status})`,
        res.status === 429 ? 'rate-limited' : 'server',
        res.status,
      );
      continue;
    }

    if (!res.ok) {
      throw new BarcodeLookupError(`OpenFoodFacts ${res.status}`, 'server', res.status);
    }

    try {
      return (await res.json()) as RawResponse;
    } catch {
      // Captive-portal HTML or a truncated body — treat as a retryable server fault.
      retryAfter = null;
      lastError = new BarcodeLookupError('OpenFoodFacts ne invalid JSON bheja', 'server');
    }
  }

  throw lastError ?? new BarcodeLookupError('OpenFoodFacts lookup fail', 'network');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

type RawProduct = {
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  generic_name_en?: string;
  abbreviated_product_name?: string;
  brands?: string;
  categories?: string;
  categories_tags?: string[];
  quantity?: string;
  product_quantity?: string | number;
  product_quantity_unit?: string;
  net_weight?: string;
  image_front_small_url?: string;
  image_front_url?: string;
  image_small_url?: string;
  image_url?: string;
};

type RawResponse = {
  status?: 0 | 1;
  product?: RawProduct;
};

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * `categories_tags` is language-tagged ("en:sweet-biscuits"); the plain `categories`
 * string mixes French and German entries that would land verbatim in the user's form.
 */
function pickCategory(p: RawProduct): string | undefined {
  const enTags = (p.categories_tags ?? []).filter((t) => t.startsWith('en:'));
  // Tags run general → specific, so the last one is the most useful label.
  const mostSpecific = enTags.at(-1);
  if (mostSpecific) {
    const slug = mostSpecific.slice(3).replace(/-/g, ' ').trim();
    if (slug) return slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  const parts = (p.categories ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^[a-z]{2}:/.test(s));
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

/** `quantity` blank ho toh product_quantity + unit se bana lo ("500" + "g" → "500 g"). */
function pickQuantity(p: RawProduct): string | undefined {
  const direct = clean(p.quantity) ?? clean(p.net_weight);
  if (direct) return direct;

  const amount = clean(p.product_quantity === undefined ? undefined : String(p.product_quantity));
  if (!amount) return undefined;
  // Unit missing? Leave it off — guessing "g" mislabels every drink as a solid weight.
  const unit = clean(p.product_quantity_unit);
  return unit ? `${amount} ${unit}` : amount;
}

/**
 * A surprising number of OFF contributors paste the barcode itself (or a bare SKU
 * number) into `product_name`. Those are worse than blank — they look like a real
 * hit while filling the shopkeeper's form with a meaningless string.
 */
function isUsableName(name: string | undefined): name is string {
  if (!name) return false;
  return !/^\d[\d\s-]*$/.test(name);
}

/**
 * Name resolution chain. When every name field is blank we synthesize one from
 * brand + quantity: a half-filled form the shopkeeper can correct beats a dead end.
 */
function pickName(
  p: RawProduct,
  brand: string | undefined,
  quantity: string | undefined,
): { name: string; guessed: boolean } | null {
  const direct = [
    p.product_name_en,
    p.product_name,
    p.generic_name_en,
    p.generic_name,
    p.abbreviated_product_name,
  ]
    .map(clean)
    .find(isUsableName);
  if (direct) return { name: direct, guessed: false };

  const fallback = [brand, quantity].filter(Boolean).join(' ');
  return fallback ? { name: fallback, guessed: true } : null;
}

function toProduct(
  json: RawResponse,
  scannedBarcode: string,
  source: DatabaseId,
): OpenFoodFactsProduct | null {
  if (json.status === 0 || !json.product) return null;

  const p = json.product;
  const brand = clean(p.brands?.split(',')[0]);
  const quantity = pickQuantity(p);
  const picked = pickName(p, brand, quantity);
  // Name, brand and quantity all empty — the record is a stub with nothing to prefill.
  if (!picked) return null;

  return {
    barcode: scannedBarcode,
    name: picked.name,
    brand,
    category: pickCategory(p),
    quantity,
    imageUrl:
      p.image_front_small_url || p.image_front_url || p.image_small_url || p.image_url || undefined,
    nameIsGuessed: picked.guessed,
    source,
    raw: json as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Looks a barcode up across the Open*Facts databases.
 *
 * Resolves to null when the barcode is genuinely absent everywhere.
 * Throws {@link BarcodeLookupError} for malformed input and for network/API failures,
 * so callers can distinguish "not found — add manually" from "try again".
 */
export async function lookupBarcode(
  barcode: string,
  options: LookupOptions = {},
): Promise<OpenFoodFactsProduct | null> {
  const code = assertScannableBarcode(barcode);
  const now = Date.now();

  if (!options.forceRefresh) {
    const cached = cacheGet(code, now);
    if (cached) return cached.value;
  }

  // Two rapid scans of the same item share one request instead of racing.
  const pending = inFlight.get(code);
  if (pending && !options.forceRefresh) return pending;

  const task = resolveAcrossDatabases(code, options.signal)
    .then((product) => {
      cacheSet(code, product, Date.now());
      return product;
    })
    .catch((err: unknown) => {
      // Failures stay uncached so the next scan retries; only report the unexpected ones.
      if (!(err instanceof BarcodeLookupError) || err.kind === 'server') {
        captureError(err, { scope: 'lookupBarcode', barcode: code });
      }
      throw err;
    })
    .finally(() => {
      inFlight.delete(code);
    });

  inFlight.set(code, task);
  return task;
}

/**
 * Walks database × barcode-variant until something answers.
 *
 * A transport failure against one database doesn't abandon the search — the next
 * database still gets a shot — but if every attempt failed we surface the error
 * rather than reporting a misleading "product not found".
 */
async function resolveAcrossDatabases(
  code: string,
  signal: AbortSignal | undefined,
): Promise<OpenFoodFactsProduct | null> {
  const candidates = lookupCandidates(code);
  let lastError: BarcodeLookupError | null = null;
  let sawDefinitiveMiss = false;

  for (const db of DATABASES) {
    for (const candidate of candidates) {
      try {
        const json = await queryDatabase(db.host, candidate, signal);
        if (json === null) {
          sawDefinitiveMiss = true;
          continue;
        }
        const product = toProduct(json, code, db.id);
        if (product) return product;
        sawDefinitiveMiss = true;
      } catch (err) {
        const e = err as BarcodeLookupError;
        if (e.kind === 'aborted') throw e;
        // Device is offline or the connection is dead — the other databases live on
        // the same network, so grinding through them just burns the user's time.
        if (e.kind === 'network' || e.kind === 'timeout') throw e;
        lastError = e;
      }
    }
  }

  if (!sawDefinitiveMiss && lastError) throw lastError;
  return null;
}

// ---------------------------------------------------------------------------
// Full record (admin inspector)
// ---------------------------------------------------------------------------

export type RawBarcodeRecord = {
  /** The barcode as scanned, not the variant that happened to match. */
  barcode: string;
  source: DatabaseId;
  /** Complete upstream response — hundreds of fields, images and nutriments included. */
  data: Record<string, unknown>;
};

/**
 * Fetches the **complete** record rather than the handful of fields
 * {@link lookupBarcode} needs.
 *
 * The prefill path deliberately asks for a narrow field list to keep responses small
 * on a shop counter's connection. An admin inspecting the catalog wants the opposite:
 * everything the database holds, so they can judge whether the cached metadata is
 * any good. Different job, so a different request — not a wider default for everyone.
 *
 * Not cached: this is an explicit "go look again" action.
 */
export async function fetchRawBarcodeRecord(
  barcode: string,
  options: { signal?: AbortSignal } = {},
): Promise<RawBarcodeRecord | null> {
  const code = assertScannableBarcode(barcode);
  const candidates = lookupCandidates(code);
  let lastError: BarcodeLookupError | null = null;
  let sawDefinitiveMiss = false;

  for (const db of DATABASES) {
    for (const candidate of candidates) {
      try {
        const json = await queryDatabase(db.host, candidate, options.signal, null);
        if (json === null || json.status === 0 || !json.product) {
          sawDefinitiveMiss = true;
          continue;
        }
        return {
          barcode: code,
          source: db.id,
          data: json.product as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const e = err as BarcodeLookupError;
        if (e.kind === 'aborted') throw e;
        if (e.kind === 'network' || e.kind === 'timeout') throw e;
        lastError = e;
      }
    }
  }

  if (!sawDefinitiveMiss && lastError) throw lastError;
  return null;
}

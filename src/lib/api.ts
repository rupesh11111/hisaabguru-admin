/**
 * Browser-side client for the hisaabGuru NestJS API.
 *
 * Requests go straight from the browser to the API, so the API's `CORS_ORIGINS`
 * must include this app's origin. The JWT lives in localStorage rather than a
 * cookie because the API authenticates via a bearer header and sets no cookie of
 * its own — there is nothing for the browser to attach automatically.
 */

import type {
  AdminStats,
  ApiRole,
  AuthResponse,
  BulkImportResult,
  CatalogOption,
  CatalogOptionKind,
  ChangeSubscriptionInput,
  CorrectionOutcome,
  ProductCorrection,
  CreateCatalogOptionInput,
  CreateRoleInput,
  CreateSubscriptionPlanInput,
  CurrentUser,
  OtpRequestResponse,
  PermissionCatalog,
  ProductDetail,
  MergePreview,
  MergeResult,
  ProductListPage,
  ProductListParams,
  ShopDetail,
  ShopListItem,
  SubscriptionHistoryEntry,
  SubscriptionPlan,
  UpdateCatalogOptionInput,
  UpdateRoleInput,
  UpdateSubscriptionPlanInput,
  UpsertProductInput,
  UserDetail,
  UserListItem,
  UserSubscription,
} from './types';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1';

const TOKEN_KEY = 'hisaabguru.admin.token';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ----- Token storage -----

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Set by the session provider so a 401 anywhere can bounce the user to /login. */
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

// ----- Core request -----

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  skipAuth?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, skipAuth } = options;

  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.append(k, String(v));
      }
    }
  }

  // A FormData body must not get a Content-Type: the browser writes one that carries
  // the multipart boundary, and without that boundary the server cannot parse the body.
  const multipart = body instanceof FormData;
  // The admin panel is in English. The API translates an error only on an exact
  // language match, and a browser's own `en-US,en;q=0.9` is not one, so ask for `en`.
  const headers: Record<string, string> = multipart
    ? { 'Accept-Language': 'en' }
    : { 'Content-Type': 'application/json', 'Accept-Language': 'en' };
  if (!skipAuth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: multipart
        ? body
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
      signal,
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? `Network error: ${err.message}` : 'Network error',
      0,
    );
  }

  if (res.status === 401 && !skipAuth) {
    setToken(null);
    onUnauthorized?.();
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const err = payload as { message?: string | string[]; error?: string } | null;
    const message = Array.isArray(err?.message)
      ? err.message.join(', ')
      : (err?.message ?? err?.error ?? `Request failed (${res.status})`);
    throw new ApiError(message, res.status, payload);
  }

  // The backend wraps every success response as { data: ... }.
  if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

// ----- Auth -----

export const authApi = {
  requestOtp: (phoneNumber: string) =>
    request<OtpRequestResponse>('/auth/otp/request', {
      method: 'POST',
      body: { phoneNumber },
      skipAuth: true,
    }),
  verifyOtp: (phoneNumber: string, code: string) =>
    request<AuthResponse>('/auth/otp/verify', {
      method: 'POST',
      body: { phoneNumber, code },
      skipAuth: true,
    }),
  me: () => request<CurrentUser>('/auth/me'),
};

// ----- Admin -----

export const adminApi = {
  stats: () => request<AdminStats>('/admin/stats'),

  // Products catalog
  listProducts: (params: ProductListParams = {}) =>
    request<ProductListPage>('/admin/products', {
      query: {
        query: params.query,
        limit: params.limit,
        offset: params.offset,
        includeArchived: params.includeArchived ? 'true' : undefined,
        verification: params.verification,
        source: params.source,
        archived: params.archived,
        category: params.category,
        hasBarcode: params.hasBarcode === undefined ? undefined : String(params.hasBarcode),
        hasPhoto: params.hasPhoto === undefined ? undefined : String(params.hasPhoto),
        sort: params.sort,
      },
    }),
  getProduct: (id: string) => request<ProductDetail>(`/admin/products/${id}`),
  createProduct: (input: UpsertProductInput) =>
    request<ProductDetail>('/admin/products', { method: 'POST', body: input }),
  /**
   * Corrects a product. This PROPAGATES into every shop that has not customised the
   * field — the response's `correction` reports what it actually did.
   */
  updateProduct: (id: string, input: UpsertProductInput) =>
    request<ProductDetail & { correction: CorrectionOutcome | null }>(
      `/admin/products/${id}`,
      { method: 'PUT', body: input },
    ),
  listProductCorrections: (id: string) =>
    request<ProductCorrection[]>(`/admin/products/${id}/corrections`),
  /** Publishes a row for cross-shop prefill. Nothing else in the system can. */
  verifyProduct: (id: string) =>
    request<ProductDetail>(`/admin/products/${id}/verify`, { method: 'POST' }),
  rejectProduct: (id: string) =>
    request<ProductDetail>(`/admin/products/${id}/reject`, { method: 'POST' }),
  /** Server caps this at 25 ids — the cap is not just a UI convention. */
  verifyProducts: (productIds: string[]) =>
    request<{ verified: number }>('/admin/products/verify', {
      method: 'POST',
      body: { productIds },
    }),
  /** Same 25-id server cap as `verifyProducts`. Pending rows only. */
  rejectProducts: (productIds: string[]) =>
    request<{ rejected: number }>('/admin/products/reject', {
      method: 'POST',
      body: { productIds },
    }),
  archiveProduct: (id: string) =>
    request<{ archived: boolean }>(`/admin/products/${id}/archive`, { method: 'POST' }),
  restoreProduct: (id: string) =>
    request<{ restored: boolean }>(`/admin/products/${id}/restore`, { method: 'POST' }),
  mergePreview: (id: string, intoId: string) =>
    request<MergePreview>(`/admin/products/${id}/merge-preview`, { query: { intoId } }),
  /** Folds `id` into `intoId`; `id` is archived for good. */
  mergeProduct: (id: string, intoId: string) =>
    request<MergeResult>(`/admin/products/${id}/merge`, {
      method: 'POST',
      body: { intoId },
    }),
  /** The API refuses (409) unless the product is archived first. */
  deleteProduct: (id: string) =>
    request<{ ok: boolean }>(`/admin/products/${id}`, { method: 'DELETE' }),
  /** Per-row outcomes; never throws because one row was bad — inspect `results`. */
  bulkImportProducts: (items: UpsertProductInput[]) =>
    request<BulkImportResult>('/admin/products/bulk', {
      method: 'POST',
      body: { items },
    }),
  /** The new photo goes first. Shows in every shop; 503 if storage is not configured. */
  addProductPhoto: (id: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<ProductDetail>(`/admin/products/${id}/photos`, {
      method: 'POST',
      body,
    });
  },
  removeProductPhoto: (id: string, url: string) =>
    request<ProductDetail>(`/admin/products/${id}/photos`, {
      method: 'DELETE',
      body: { url },
    }),

  // Users
  listUsers: () => request<UserListItem[]>('/admin/users'),
  getUser: (id: string) => request<UserDetail>(`/admin/users/${id}`),
  changeUserRole: (id: string, roleKey: string) =>
    request<UserDetail>(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: { roleKey },
    }),

  // Shops
  listShops: () => request<ShopListItem[]>('/admin/shops'),
  getShop: (id: string) => request<ShopDetail>(`/admin/shops/${id}`),
  deleteShop: (id: string) =>
    request<{ ok: boolean }>(`/admin/shops/${id}`, { method: 'DELETE' }),
  /**
   * Change a member's role inside one shop. The API rejects both editing an OWNER
   * membership and granting OWNER — those need an ownership-transfer flow.
   */
  updateMembershipRole: (shopId: string, userId: string, roleKey: string) =>
    request<unknown>(`/admin/shops/${shopId}/members/${userId}/role`, {
      method: 'PATCH',
      body: { roleKey },
    }),

  // RBAC catalog
  permissionCatalog: () => request<PermissionCatalog>('/admin/meta/permissions'),
  listRoles: () => request<ApiRole[]>('/admin/meta/roles'),
  createRole: (input: CreateRoleInput) =>
    request<ApiRole>('/admin/roles', { method: 'POST', body: input }),
  updateRole: (id: string, input: UpdateRoleInput) =>
    request<ApiRole>(`/admin/roles/${id}`, { method: 'PATCH', body: input }),
  setRolePermissions: (id: string, permissions: string[]) =>
    request<ApiRole>(`/admin/roles/${id}/permissions`, {
      method: 'PATCH',
      body: { permissions },
    }),
  deleteRole: (id: string) =>
    request<{ ok: boolean }>(`/admin/roles/${id}`, { method: 'DELETE' }),
};

// ----- Subscription plans -----

// SubscriptionsController is also mounted under `admin`, so these share the prefix.
export const plansApi = {
  list: (archived = false) =>
    request<SubscriptionPlan[]>('/admin/meta/subscription-plans', {
      query: { archived: archived ? 'true' : undefined },
    }),
  get: (id: string) => request<SubscriptionPlan>(`/admin/subscription-plans/${id}`),
  create: (input: CreateSubscriptionPlanInput) =>
    request<SubscriptionPlan>('/admin/subscription-plans', {
      method: 'POST',
      body: input,
    }),
  update: (id: string, input: UpdateSubscriptionPlanInput) =>
    request<SubscriptionPlan>(`/admin/subscription-plans/${id}`, {
      method: 'PATCH',
      body: input,
    }),
  archive: (id: string) =>
    request<{ ok: boolean }>(`/admin/subscription-plans/${id}`, { method: 'DELETE' }),
  restore: (id: string) =>
    request<SubscriptionPlan>(`/admin/subscription-plans/${id}/restore`, {
      method: 'POST',
    }),
};

// ----- Catalog options -----

export const catalogOptionsApi = {
  list: (kind: CatalogOptionKind, archived = false) =>
    request<CatalogOption[]>('/admin/meta/catalog-options', {
      query: { kind, archived: archived ? 'true' : undefined },
    }),
  create: (input: CreateCatalogOptionInput) =>
    request<CatalogOption>('/admin/meta/catalog-options', {
      method: 'POST',
      body: input,
    }),
  update: (id: string, input: UpdateCatalogOptionInput) =>
    request<CatalogOption>(`/admin/meta/catalog-options/${id}`, {
      method: 'PATCH',
      body: input,
    }),
  /** Refused for system rows; allowed while in use, since items keep their value. */
  archive: (id: string) =>
    request<{ ok: boolean }>(`/admin/meta/catalog-options/${id}`, { method: 'DELETE' }),
  restore: (id: string) =>
    request<CatalogOption>(`/admin/meta/catalog-options/${id}/restore`, {
      method: 'POST',
    }),
};

/**
 * A user's own subscription, separate from the plan catalog above.
 *
 * Changes are atomic on the server: the current row is updated and an audit row is
 * appended in one transaction, so `history` is always a complete record.
 */
export const subscriptionsApi = {
  get: (userId: string) =>
    request<UserSubscription | null>(`/admin/users/${userId}/subscription`),
  history: (userId: string) =>
    request<SubscriptionHistoryEntry[]>(
      `/admin/users/${userId}/subscription/history`,
    ),
  change: (userId: string, input: ChangeSubscriptionInput) =>
    request<UserSubscription>(`/admin/users/${userId}/subscription`, {
      method: 'PATCH',
      body: input,
    }),
};

export type UserAutopay = {
  status: string;
  planLabel: string;
  period: 'MONTHLY' | 'YEARLY';
  /** Paise per cycle. */
  amount: number;
  nextChargeAt: string | null;
  cancelAtCycleEnd: boolean;
};

export const autopayApi = {
  get: (userId: string) =>
    request<UserAutopay | null>(`/payments/autopay/users/${userId}`),
  cancel: (userId: string) =>
    request<{ cancelled: true }>(`/payments/autopay/users/${userId}/cancel`, {
      method: 'POST',
    }),
};

// ----- Referrals & wallet -----

export type ReferralStatus = 'PENDING' | 'REWARDED' | 'REJECTED' | 'EXPIRED';

export type AdminReferral = {
  id: string;
  code: string;
  source: 'LINK' | 'MANUAL';
  status: ReferralStatus;
  activeDays: number;
  claimedAt: string;
  windowEndsAt: string;
  rewardedAt: string | null;
  /** False when the referrer had reached the earning cap. */
  referrerRewarded: boolean;
  rejectReason: string | null;
  referrer: { id: string; phoneNumber: string };
  referee: { id: string; phoneNumber: string; createdAt: string };
};

export type UserWallet = {
  /** Paise spendable now. */
  balance: number;
  lots: {
    id: string;
    amount: number;
    remaining: number;
    source: 'REFERRAL_REFERRER' | 'REFERRAL_REFEREE' | 'ADMIN_ADJUST';
    expiresAt: string;
    expired: boolean;
    createdAt: string;
  }[];
  transactions: {
    id: string;
    type: 'EARN' | 'SPEND' | 'RESTORE' | 'EXPIRE' | 'ADJUST';
    /** Signed paise. */
    amount: number;
    paymentId: string | null;
    reason: string | null;
    actorId: string | null;
    createdAt: string;
  }[];
};

/**
 * Referral payouts are decided by the API's own job; the admin can only reject one
 * that has not been paid yet, or correct a wallet with a signed adjustment.
 */
export const referralsApi = {
  list: (status?: ReferralStatus) =>
    request<AdminReferral[]>('/admin/referrals', { query: { status } }),
  reject: (id: string, reason: string) =>
    request<{ rejected: true }>(`/admin/referrals/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }),
  wallet: (userId: string) => request<UserWallet>(`/admin/users/${userId}/wallet`),
  /** `amount` is signed paise: positive adds credit, negative deducts it. */
  adjust: (userId: string, amount: number, reason: string) =>
    request<UserWallet>(`/admin/users/${userId}/wallet/adjust`, {
      method: 'POST',
      body: { amount, reason },
    }),
};

// ----- App releases -----

export type AppReleasePlatform = 'android' | 'ios';

export type AppRelease = {
  platform: AppReleasePlatform;
  /** Older installs get an "update available" prompt they can postpone. */
  latestVersion: string;
  /** Older installs are blocked until they update. */
  minVersion: string;
  storeUrl: string | null;
  updatedAt: string;
};

export const appReleaseApi = {
  list: () => request<AppRelease[]>('/admin/app-releases'),
  set: (
    platform: AppReleasePlatform,
    input: { latestVersion: string; minVersion: string; storeUrl: string | null },
  ) =>
    request<AppRelease>(`/admin/app-releases/${platform}`, {
      method: 'PUT',
      body: input,
    }),
};

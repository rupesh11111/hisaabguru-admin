/**
 * API response shapes, mirroring the NestJS backend.
 *
 * Kept standalone rather than shared with the mobile app: the two clients ship on
 * different release cycles, and a shared package would couple an Expo build to a
 * Next.js one for no real benefit at this size.
 */

export type PlatformRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
export type ShopRole = 'OWNER' | 'EMPLOYEE';
export type SubscriptionTier = string;
export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'TRIAL';

// ----- Auth -----

export type OtpRequestResponse = {
  phoneNumber: string;
  /** Only present when the backend runs with SMS disabled (dev/staging). */
  debugCode?: string;
};

export type AuthResponse = {
  accessToken: string;
  user: {
    id: string;
    phoneNumber: string;
    platformRole: PlatformRole;
    subscription: {
      tier: SubscriptionTier;
      status: SubscriptionStatus;
      expiresAt: string | null;
    };
  };
  activeShopId: string | null;
};

export type CurrentUser = {
  userId: string;
  phoneNumber: string;
  shopId: string | null;
  roleKey: string;
  platformRole: PlatformRole;
  permissions: string[];
};

// ----- Dashboard -----

export type AdminStats = {
  totals: { users: number; shops: number; bills: number; products: number };
  byTier: Partial<Record<SubscriptionTier, number>>;
  byRole: Partial<Record<PlatformRole, number>>;
};

// ----- Products catalog -----

export type ProductSource =
  | 'openfoodfacts'
  | 'barcodereport'
  | 'upcitemdb'
  | 'shop'
  | 'admin'
  | 'import';
/** Only `verified` rows are ever prefilled into a shop that doesn't stock the item. */
export type ProductVerification = 'provisional' | 'verified' | 'rejected';

export type ProductListItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  barcodes: string[];
  shopsStockingCount: number;
  source: ProductSource;
  verification: ProductVerification;
  imageUrl: string | null;
  /** How many distinct shops independently typed the same name. Ranking only. */
  consensusShops: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductDetail = ProductListItem & {
  openFoodFactsData: Record<string, unknown> | null;
  verifiedAt: string | null;
  createdByShopId: string | null;
  consensusName: string | null;
  /**
   * Each shop's OWN snapshot plus its per-field customised flags. This is what lets
   * the admin see "Uncle Chiprs" beside "Uncle Chips" and judge typo vs rename — a
   * call no flag can make for them.
   */
  stockedBy: Array<{
    shopId: string;
    shopName: string;
    city: string;
    stockQuantity: number;
    name: string;
    category: string;
    unit: string;
    nameCustomized: boolean;
    categoryCustomized: boolean;
    unitCustomized: boolean;
  }>;
};

/** What a save actually did to the shops stocking the product. */
export type CorrectionOutcome = {
  changedFields: string[];
  propagatedCount: number;
  skippedCount: number;
};

export type ProductCorrection = {
  id: string;
  before: Record<string, string>;
  after: Record<string, string>;
  changedFields: string[];
  propagatedCount: number;
  skippedCount: number;
  forced: boolean;
  reason: string | null;
  /** Null when a machine made the change — rendered as "system". */
  correctedByPhone: string | null;
  createdAt: string;
};

export type UpsertProductInput = {
  name: string;
  category: string;
  unit: string;
  barcodes?: string[];
  /** Stored on the audit row. */
  reason?: string;
  /** Rewrite even shops that customised the field. Recorded as `forced`. */
  overrideCustomized?: boolean;
  /**
   * Cached Open*Facts record. Omit to leave whatever is stored untouched;
   * pass `null` to clear it.
   */
  openFoodFactsData?: Record<string, unknown> | null;
};

/** Server-paginated page. `total` counts every match, not just this page. */
export type ProductListPage = {
  items: ProductListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type ProductListParams = {
  /** Matches name, category, or an exact barcode. */
  query?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
};

/**
 * Bulk import reports per row rather than all-or-nothing, so one bad row in a
 * 200-row paste never blocks the other 199.
 */
export type BulkImportRowResult = {
  index: number;
  name: string;
  status: 'created' | 'updated' | 'failed';
  message?: string;
  productId?: string;
};

export type BulkImportResult = {
  summary: { total: number; created: number; updated: number; failed: number };
  results: BulkImportRowResult[];
};

// ----- Users -----

export type UserListItem = {
  id: string;
  phoneNumber: string;
  /** Null when the user row has no Role attached — the API models roles as optional. */
  platformRole: PlatformRole | null;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string | null;
  shopsOwned: number;
  memberships: number;
  createdAt: string;
};

export type UserDetail = Omit<UserListItem, 'memberships'> & {
  defaultShopId: string | null;
  memberships: Array<{
    id: string;
    shopId: string;
    shopName: string;
    city: string;
    role: ShopRole | null;
    permissions: string[];
    invitedAt: string;
    acceptedAt: string | null;
  }>;
  ownedShops: Array<{ id: string; shopName: string; city: string; createdAt: string }>;
};

// ----- Shops -----

export type ShopListItem = {
  id: string;
  shopName: string;
  ownerName: string;
  city: string;
  owner: { id: string; phoneNumber: string } | null;
  members: number;
  bills: number;
  items: number;
  createdAt: string;
};

export type ShopDetail = {
  id: string;
  shopName: string;
  ownerName: string;
  city: string;
  upiId: string | null;
  owner: { id: string; phoneNumber: string } | null;
  createdAt: string;
  counts: { bills: number; inventory: number; customers: number; suppliers: number };
  memberships: Array<{
    id: string;
    userId: string;
    phoneNumber: string;
    role: ShopRole | null;
    permissions: string[];
    invitedAt: string;
    acceptedAt: string | null;
  }>;
};

// ----- RBAC -----

export type ApiPermission = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  category: string;
};

export type PermissionCatalog = {
  permissions: ApiPermission[];
  groups: { category: string; permissions: ApiPermission[] }[];
};

export type ApiRole = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  priority: number;
  permissions: string[];
  usersCount: number;
  membershipsCount: number;
};

export type CreateRoleInput = {
  key: string;
  label: string;
  description?: string;
  priority?: number;
  permissions?: string[];
};

export type UpdateRoleInput = {
  label?: string;
  description?: string;
  priority?: number;
};

// ----- Subscription plans -----

export type SubscriptionPlan = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  priority: number;
  maxShops: number;
  maxItemsPerShop: number;
  maxBillsPerMonth: number;
  maxEmployeesPerShop: number;
  permissions: string[];
  /** Smallest unit of `currency` (paise for INR). Null = "contact us" pricing. */
  priceMonthly: number | null;
  priceYearly: number | null;
  currency: string;
  archivedAt: string | null;
  subscribersCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateSubscriptionPlanInput = {
  key: string;
  label: string;
  description?: string;
  priority?: number;
  maxShops?: number;
  maxItemsPerShop?: number;
  maxBillsPerMonth?: number;
  maxEmployeesPerShop?: number;
  permissions?: string[];
  priceMonthly?: number | null;
  priceYearly?: number | null;
  currency?: string;
};

export type UpdateSubscriptionPlanInput = Partial<
  Omit<CreateSubscriptionPlanInput, 'key'>
>;

// ----- Per-user subscription -----

/** A user's current plan. Null when they've never been assigned one. */
export type UserSubscription = {
  id: string;
  userId: string;
  planId: string;
  planKey: string;
  planLabel: string;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Append-only audit row. Every plan change writes one. */
export type SubscriptionHistoryEntry = {
  id: string;
  userId: string;
  planId: string;
  planKey: string;
  planLabel: string;
  status: SubscriptionStatus;
  startedAt: string;
  endedAt: string | null;
  changedById: string | null;
  changedByPhone: string | null;
  reason: string | null;
  priceSnapshot: number | null;
  currencySnapshot: string | null;
  paymentRef: string | null;
  createdAt: string;
};

export type ChangeSubscriptionInput = {
  /** Either planId or planKey is required by the API. */
  planId?: string;
  planKey?: string;
  status?: SubscriptionStatus;
  /** ISO date string. `null` clears the expiry; omit to keep the current one. */
  expiresAt?: string | null;
  reason?: string;
  paymentRef?: string;
};

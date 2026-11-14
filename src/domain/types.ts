export type UserRole = 'owner' | 'manager' | 'accountant' | 'cashier';

export type SyncStatus = 'pending' | 'synced' | 'conflict';

export type CurrencyCode = 'YER' | 'SAR' | 'USD';

export type PaymentMode = 'cash' | 'credit' | 'partial';

export type PaymentMethod = 'cash' | 'transfer' | 'wallet';

export type CustomerCategory = 'vip' | 'regular' | 'wholesale';

export type MessageChannel = 'sms';

export type MessageStatus =
  | 'pending'
  | 'sending'
  | 'sent_to_network'
  | 'delivered'
  | 'failed'
  | 'unknown';

export type TemplateCategory = 'debt' | 'offer' | 'welcome' | 'occasion' | 'vip' | 'general';

export type AudienceFilterType =
  | 'all'
  | 'debtors'
  | 'debt_above'
  | 'overdue'
  | 'inactive'
  | 'paid_today'
  | 'vip'
  | 'active'
  | 'manual';

export type AppScreen =
  | 'splash'
  | 'setup'
  | 'login'
  | 'dashboard'
  | 'customers'
  | 'customer_form'
  | 'customer_profile'
  | 'customer_statement'
  | 'sales'
  | 'new_sale'
  | 'sale_detail'
  | 'debts'
  | 'collection'
  | 'receipt'
  | 'cashbox'
  | 'expenses'
  | 'reports'
  | 'messaging'
  | 'templates'
  | 'message_log'
  | 'sms_settings'
  | 'products'
  | 'users'
  | 'org_profile'
  | 'settings'
  | 'backup'
  | 'maintenance'
  | 'sync'
  | 'subscription'
  | 'support';

export interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  isMain: boolean;
}

export interface Organization {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  whatsapp: string;
  address: string;
  description: string;
  logoDataUrl?: string;
  currency: CurrencyCode;
  currencyDecimals: number;
  numberLocale: 'ar-YE' | 'en-US';
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY';
  invoiceHeader: string;
  invoiceFooter: string;
  autoLockMinutes: number;
  activeBranchId: string;
  branches: Branch[];
  subscriptionPlan: 'starter' | 'pro' | 'enterprise';
  subscriptionStatus: 'active' | 'trial' | 'expired' | 'suspended';
  subscriptionExpiry: string;
  maxUsers: number;
  maxDevices: number;
  orgAuthSecret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppUser {
  id: string;
  orgId: string;
  branchId: string;
  name: string;
  role: UserRole;
  pinHash?: string;
  hasPin: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  orgId: string;
  branchId: string;
  fullName: string;
  phone: string;
  whatsapp?: string;
  avatarUrl?: string;
  address: string;
  category: CustomerCategory;
  creditLimit: number;
  status: 'active' | 'inactive';
  marketingOptOut: boolean;
  notes: string;
  cachedBalance: number;
  cachedTotalPurchases: number;
  cachedTotalPaid: number;
  purchaseCount: number;
  lastPurchaseAt?: string;
  lastPaymentAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  syncStatus: SyncStatus;
}

export interface Product {
  id: string;
  orgId: string;
  name: string;
  grade: string;
  unitName: string;
  unitPrice: number;
  costPrice?: number;
  active: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface SaleItem {
  productId: string;
  productName: string;
  grade: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  orgId: string;
  branchId: string;
  invoiceNumber: string;
  customerId?: string;
  customerName: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMode: PaymentMode;
  paymentMethod: PaymentMethod;
  notes: string;
  status: 'active' | 'reversed';
  reversedByEntryId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName: string;
  deviceId: string;
  syncStatus: SyncStatus;
}

export interface PaymentAllocation {
  saleId: string;
  invoiceNumber: string;
  amount: number;
}

export interface Payment {
  id: string;
  orgId: string;
  branchId: string;
  receiptNumber: string;
  customerId: string;
  customerName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  allocationMode: 'auto' | 'manual';
  allocations: PaymentAllocation[];
  excessAction: 'reject' | 'credit_advance';
  notes: string;
  status: 'active' | 'reversed';
  reversedByEntryId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName: string;
  deviceId: string;
  syncStatus: SyncStatus;
}

export interface LedgerEntry {
  id: string;
  orgId: string;
  branchId: string;
  customerId: string;
  refType: 'sale' | 'payment' | 'adjustment' | 'reversal' | 'opening_balance';
  refId: string;
  refNumber: string;
  description: string;
  debit: number;
  credit: number;
  cashIn: number;
  discountAmount: number;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  deviceId: string;
  idempotencyKey: string;
  syncStatus: SyncStatus;
}

export interface Expense {
  id: string;
  orgId: string;
  branchId: string;
  title: string;
  amount: number;
  category: string;
  date: string;
  paymentMethod: PaymentMethod;
  notes: string;
  responsibleUserId: string;
  responsibleUserName: string;
  status: 'active' | 'reversed';
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
  deviceId: string;
  syncStatus: SyncStatus;
}

export interface CashboxSession {
  id: string;
  orgId: string;
  branchId: string;
  date: string;
  openingBalance: number;
  closingBalance?: number;
  notes: string;
  status: 'open' | 'closed';
  closedBy?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface MessageTemplate {
  id: string;
  orgId: string;
  name: string;
  category: TemplateCategory;
  channel: MessageChannel;
  body: string;
  itemName?: string;
  grade?: string;
  price?: number;
  offerTime?: string;
  imageUrl?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Offer {
  id: string;
  orgId: string;
  title: string;
  itemName: string;
  grade: string;
  price: number;
  description: string;
  imageUrl?: string;
  startDate: string;
  endDate: string;
  targetFilter: AudienceFilterType;
  channel: MessageChannel;
  active: boolean;
  createdAt: string;
}

export interface Campaign {
  id: string;
  orgId: string;
  title: string;
  offerId?: string;
  templateId?: string;
  channel: MessageChannel;
  targetFilter: AudienceFilterType;
  recipientCount: number;
  sentCount: number;
  queuedCount: number;
  failedCount: number;
  status: 'draft' | 'queued' | 'dispatched' | 'partial';
  createdAt: string;
  createdBy: string;
}

export interface MessageLog {
  id: string;
  orgId: string;
  campaignId?: string;
  customerId: string;
  customerName: string;
  phone: string;
  channel: MessageChannel;
  body: string;
  status: MessageStatus;
  simSlot?: number;
  subscriptionId?: number;
  carrierName?: string;
  partsCount?: number;
  encoding?: 'GSM-7' | 'UCS-2';
  dispatchMethod?: 'native_sim' | 'device_intent_fallback';
  sentAt?: string;
  deliveredAt?: string;
  externalMessageId?: string;
  errorReason?: string;
  attemptCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessagingConfig {
  orgId: string;
  smsEnabled: boolean;
  preferredSimSubscriptionId?: number;
  preferredSimSlotIndex?: number;
  requireManualConfirmInWebFallback: boolean;
  updatedAt: string;
}

export interface SyncOperation {
  id: string;
  orgId: string;
  deviceId: string;
  entityType: 'customer' | 'product' | 'sale' | 'payment' | 'ledger' | 'expense' | 'organization' | 'cashbox';
  entityId: string;
  action: 'create' | 'update' | 'reverse';
  payload: unknown;
  idempotencyKey: string;
  status: 'pending' | 'synced' | 'conflict' | 'failed';
  conflictDetails?: string;
  serverRevision?: number;
  createdAt: string;
  syncedAt?: string;
}

export interface AuditLog {
  id: string;
  orgId: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  deviceId: string;
  createdAt: string;
}

export interface BackupRecord {
  id: string;
  orgId: string;
  createdAt: string;
  recordCount: number;
  sizeBytes: number;
  encrypted: boolean;
  checksum: string;
  storageType: 'local_file' | 'cloud_optional';
}

export type Permission =
  | 'view_dashboard'
  | 'create_sale'
  | 'reverse_sale'
  | 'create_payment'
  | 'reverse_payment'
  | 'create_adjustment'
  | 'manage_customers'
  | 'manage_products'
  | 'manage_expenses'
  | 'manage_cashbox'
  | 'view_reports'
  | 'view_profit'
  | 'manage_messaging'
  | 'manage_users'
  | 'manage_org'
  | 'manage_backup'
  | 'manage_sync';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    'view_dashboard', 'create_sale', 'reverse_sale', 'create_payment', 'reverse_payment',
    'create_adjustment', 'manage_customers', 'manage_products', 'manage_expenses', 'manage_cashbox',
    'view_reports', 'view_profit', 'manage_messaging', 'manage_users', 'manage_org',
    'manage_backup', 'manage_sync',
  ],
  manager: [
    'view_dashboard', 'create_sale', 'reverse_sale', 'create_payment', 'reverse_payment',
    'create_adjustment', 'manage_customers', 'manage_products', 'manage_expenses', 'manage_cashbox',
    'view_reports', 'view_profit', 'manage_messaging', 'manage_backup', 'manage_sync',
  ],
  accountant: [
    'view_dashboard', 'create_sale', 'create_payment', 'reverse_payment', 'create_adjustment',
    'manage_customers', 'manage_expenses', 'manage_cashbox', 'view_reports', 'view_profit',
  ],
  cashier: [
    'view_dashboard', 'create_sale', 'create_payment', 'manage_customers',
  ],
};

export function hasPermission(role: UserRole | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

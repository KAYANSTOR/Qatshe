import Dexie, { type Table } from 'dexie';
import type {
  AppUser,
  AuditLog,
  BackupRecord,
  Campaign,
  CashboxSession,
  Customer,
  Expense,
  LedgerEntry,
  MessageLog,
  MessageTemplate,
  MessagingConfig,
  Offer,
  Organization,
  Payment,
  Product,
  Sale,
  SyncOperation,
} from '../domain/types';

export interface KvMetaRecord {
  key: string;
  value: string;
}

export class QatshiDatabase extends Dexie {
  organizations!: Table<Organization, string>;
  users!: Table<AppUser, string>;
  customers!: Table<Customer, string>;
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  payments!: Table<Payment, string>;
  ledgerEntries!: Table<LedgerEntry, string>;
  expenses!: Table<Expense, string>;
  cashboxSessions!: Table<CashboxSession, string>;
  messageTemplates!: Table<MessageTemplate, string>;
  offers!: Table<Offer, string>;
  campaigns!: Table<Campaign, string>;
  messageLogs!: Table<MessageLog, string>;
  messagingConfigs!: Table<MessagingConfig, string>;
  syncOperations!: Table<SyncOperation, string>;
  auditLogs!: Table<AuditLog, string>;
  backupRecords!: Table<BackupRecord, string>;
  kvMeta!: Table<KvMetaRecord, string>;

  constructor() {
    super('QatshiDB');
    this.version(1).stores({
      organizations: 'id, updatedAt',
      users: 'id, orgId, [orgId+active], role',
      customers: 'id, orgId, [orgId+status], [orgId+phone], [orgId+fullName], [orgId+cachedBalance], [orgId+updatedAt]',
      products: 'id, orgId, [orgId+active], name',
      sales: 'id, orgId, [orgId+createdAt], [orgId+customerId], [orgId+status], &idempotencyKey, invoiceNumber',
      payments: 'id, orgId, [orgId+createdAt], [orgId+customerId], [orgId+status], &idempotencyKey, receiptNumber',
      ledgerEntries: 'id, orgId, [orgId+customerId], [orgId+customerId+createdAt], [orgId+createdAt], [orgId+refId], &idempotencyKey',
      expenses: 'id, orgId, [orgId+date], [orgId+createdAt], &idempotencyKey',
      cashboxSessions: 'id, orgId, [orgId+date]',
      messageTemplates: 'id, orgId, [orgId+category]',
      offers: 'id, orgId, [orgId+active], [orgId+createdAt]',
      campaigns: 'id, orgId, [orgId+createdAt]',
      messageLogs: 'id, orgId, [orgId+customerId], [orgId+status], [orgId+createdAt], campaignId',
      messagingConfigs: 'orgId',
      syncOperations: 'id, orgId, [orgId+status], [orgId+createdAt], &idempotencyKey',
      auditLogs: 'id, orgId, [orgId+createdAt], userId',
      backupRecords: 'id, orgId, [orgId+createdAt]',
      kvMeta: 'key',
    });

    this.version(2)
      .stores({
        organizations: 'id, updatedAt',
        users: 'id, orgId, [orgId+active], role',
        customers:
          'id, orgId, [orgId+status], [orgId+phone], [orgId+fullName], [orgId+cachedBalance], [orgId+updatedAt]',
        products: 'id, orgId, [orgId+active], name',
        sales:
          'id, orgId, [orgId+createdAt], [orgId+customerId], [orgId+status], [orgId+status+createdAt], [orgId+remainingAmount], &idempotencyKey, invoiceNumber',
        payments:
          'id, orgId, [orgId+createdAt], [orgId+customerId], [orgId+status], [orgId+status+createdAt], &idempotencyKey, receiptNumber',
        ledgerEntries:
          'id, orgId, [orgId+customerId], [orgId+customerId+createdAt], [orgId+createdAt], [orgId+refId], &idempotencyKey',
        expenses: 'id, orgId, [orgId+date], [orgId+createdAt], &idempotencyKey',
        cashboxSessions: 'id, orgId, [orgId+date]',
        messageTemplates: 'id, orgId, [orgId+category]',
        offers: 'id, orgId, [orgId+active], [orgId+createdAt]',
        campaigns: 'id, orgId, [orgId+createdAt]',
        messageLogs: 'id, orgId, [orgId+customerId], [orgId+status], [orgId+createdAt], campaignId',
        messagingConfigs: 'orgId',
        syncOperations: 'id, orgId, [orgId+status], [orgId+createdAt], &idempotencyKey',
        auditLogs: 'id, orgId, [orgId+createdAt], userId',
        backupRecords: 'id, orgId, [orgId+createdAt]',
        kvMeta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('organizations')
          .toCollection()
          .modify((org: Organization) => {
            if (!org.orgAuthSecret) {
              const bytes = new Uint8Array(16);
              crypto.getRandomValues(bytes);
              org.orgAuthSecret = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
            }
          });
      });

    this.version(3)
      .stores({
        organizations: 'id, updatedAt',
        users: 'id, orgId, [orgId+active], role',
        customers:
          'id, orgId, [orgId+status], [orgId+phone], [orgId+fullName], [orgId+cachedBalance], [orgId+updatedAt]',
        products: 'id, orgId, [orgId+active], name',
        sales:
          'id, orgId, [orgId+createdAt], [orgId+customerId], [orgId+status], [orgId+status+createdAt], [orgId+remainingAmount], &idempotencyKey, invoiceNumber',
        payments:
          'id, orgId, [orgId+createdAt], [orgId+customerId], [orgId+status], [orgId+status+createdAt], &idempotencyKey, receiptNumber',
        ledgerEntries:
          'id, orgId, [orgId+customerId], [orgId+customerId+createdAt], [orgId+createdAt], [orgId+refId], &idempotencyKey',
        expenses: 'id, orgId, [orgId+date], [orgId+createdAt], &idempotencyKey',
        cashboxSessions: 'id, orgId, [orgId+date]',
        messageTemplates: 'id, orgId, [orgId+category]',
        offers: 'id, orgId, [orgId+active], [orgId+createdAt]',
        campaigns: 'id, orgId, [orgId+createdAt]',
        messageLogs: 'id, orgId, [orgId+customerId], [orgId+status], [orgId+createdAt], campaignId',
        messagingConfigs: 'orgId',
        syncOperations: 'id, orgId, [orgId+status], [orgId+createdAt], &idempotencyKey',
        auditLogs: 'id, orgId, [orgId+createdAt], userId',
        backupRecords: 'id, orgId, [orgId+createdAt]',
        kvMeta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('messageLogs')
          .toCollection()
          .modify((log: Record<string, unknown>) => {
            log.channel = 'sms';
            if (log.status === 'ready') log.status = 'pending';
            else if (log.status === 'sent') log.status = 'sent_to_network';
            else if (log.status === 'retry_needed') log.status = 'failed';
          });
        await tx
          .table('messagingConfigs')
          .toCollection()
          .modify((cfg: Record<string, unknown>) => {
            delete cfg.smsWebhookUrl;
            delete cfg.whatsappEnabled;
            delete cfg.whatsappMode;
            delete cfg.whatsappBusinessEnabled;
            delete cfg.whatsappWebhookUrl;
            delete cfg.smsMode;
            cfg.smsEnabled = true;
            cfg.requireManualConfirmInWebFallback = true;
          });
      });
  }
}

export const db = new QatshiDatabase();

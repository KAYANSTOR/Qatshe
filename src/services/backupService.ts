import { db } from '../db/qatshiDb';
import { toLocalDateKey } from '../domain/money';
import type { BackupRecord, Organization } from '../domain/types';
import { buildCleanExportFileName } from '../domain/formatters';
import { generateTenantSecret, generateUuid, runSafeDbWrite, setMeta } from './device';

export const CURRENT_BACKUP_SCHEMA_VERSION = 2;

export interface BackupPayload {
  schemaVersion: number;
  app: 'QATSHI';
  orgId: string;
  orgName: string;
  exportedAt: string;
  checksum: string;
  data: {
    organization: unknown;
    users: unknown[];
    customers: unknown[];
    products: unknown[];
    sales: unknown[];
    payments: unknown[];
    ledgerEntries: unknown[];
    expenses: unknown[];
    cashboxSessions: unknown[];
    messageTemplates: unknown[];
    offers: unknown[];
    campaigns: unknown[];
    messageLogs: unknown[];
    messagingConfigs: unknown[];
    auditLogs: unknown[];
  };
}

interface EncryptedEnvelope {
  encrypted: true;
  algorithm: 'AES-GCM';
  saltB64: string;
  ivB64: string;
  cipherB64: string;
  orgId: string;
  orgName: string;
  exportedAt: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function migrateBackupPayload(raw: BackupPayload): BackupPayload {
  const schemaVersion = Number(raw.schemaVersion ?? 1);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    throw new Error('إصدار النسخة الاحتياطية غير مدعوم');
  }
  const orgObj = (raw.data.organization || {}) as Partial<Organization>;
  const normalizedOrg: Organization = {
    ...(orgObj as Organization),
    orgAuthSecret: orgObj.orgAuthSecret || generateTenantSecret(),
  };

  return {
    ...raw,
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    data: {
      organization: normalizedOrg,
      users: Array.isArray(raw.data.users) ? raw.data.users : [],
      customers: Array.isArray(raw.data.customers) ? raw.data.customers : [],
      products: Array.isArray(raw.data.products) ? raw.data.products : [],
      sales: Array.isArray(raw.data.sales) ? raw.data.sales : [],
      payments: Array.isArray(raw.data.payments) ? raw.data.payments : [],
      ledgerEntries: Array.isArray(raw.data.ledgerEntries) ? raw.data.ledgerEntries : [],
      expenses: Array.isArray(raw.data.expenses) ? raw.data.expenses : [],
      cashboxSessions: Array.isArray(raw.data.cashboxSessions) ? raw.data.cashboxSessions : [],
      messageTemplates: Array.isArray(raw.data.messageTemplates) ? raw.data.messageTemplates : [],
      offers: Array.isArray(raw.data.offers) ? raw.data.offers : [],
      campaigns: Array.isArray(raw.data.campaigns) ? raw.data.campaigns : [],
      messageLogs: Array.isArray(raw.data.messageLogs) ? raw.data.messageLogs : [],
      messagingConfigs: Array.isArray(raw.data.messagingConfigs) ? raw.data.messagingConfigs : [],
      auditLogs: Array.isArray(raw.data.auditLogs) ? raw.data.auditLogs : [],
    },
  };
}

export async function createOrganizationBackup(params: {
  orgId: string;
  password?: string;
  storageType?: 'local_file' | 'cloud_optional';
}): Promise<{ fileContent: string; fileName: string; record: BackupRecord }> {
  const org = await db.organizations.get(params.orgId);
  if (!org) throw new Error('المؤسسة غير موجودة');

  const [
    users,
    customers,
    products,
    sales,
    payments,
    ledgerEntries,
    expenses,
    cashboxSessions,
    messageTemplates,
    offers,
    campaigns,
    messageLogs,
    messagingConfigs,
    auditLogs,
  ] = await Promise.all([
    db.users.where('orgId').equals(params.orgId).toArray(),
    db.customers.where('orgId').equals(params.orgId).toArray(),
    db.products.where('orgId').equals(params.orgId).toArray(),
    db.sales.where('orgId').equals(params.orgId).toArray(),
    db.payments.where('orgId').equals(params.orgId).toArray(),
    db.ledgerEntries.where('orgId').equals(params.orgId).toArray(),
    db.expenses.where('orgId').equals(params.orgId).toArray(),
    db.cashboxSessions.where('orgId').equals(params.orgId).toArray(),
    db.messageTemplates.where('orgId').equals(params.orgId).toArray(),
    db.offers.where('orgId').equals(params.orgId).toArray(),
    db.campaigns.where('orgId').equals(params.orgId).toArray(),
    db.messageLogs.where('orgId').equals(params.orgId).toArray(),
    db.messagingConfigs.where('orgId').equals(params.orgId).toArray(),
    db.auditLogs.where('orgId').equals(params.orgId).toArray(),
  ]);

  const data = {
    organization: org,
    users,
    customers,
    products,
    sales,
    payments,
    ledgerEntries,
    expenses,
    cashboxSessions,
    messageTemplates,
    offers,
    campaigns,
    messageLogs,
    messagingConfigs,
    auditLogs,
  };

  const dataJson = JSON.stringify(data);
  const checksum = await sha256Hex(dataJson);
  const exportedAt = new Date().toISOString();

  const payload: BackupPayload = {
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    app: 'QATSHI',
    orgId: org.id,
    orgName: org.name,
    exportedAt,
    checksum,
    data,
  };

  let fileContent = JSON.stringify(payload, null, 2);
  let encrypted = false;

  if (params.password && params.password.trim().length > 0) {
    encrypted = true;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(params.password, salt);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(fileContent)
    );
    const envelope: EncryptedEnvelope = {
      encrypted: true,
      algorithm: 'AES-GCM',
      saltB64: toBase64(salt),
      ivB64: toBase64(iv),
      cipherB64: toBase64(new Uint8Array(cipherBuf)),
      orgId: org.id,
      orgName: org.name,
      exportedAt,
    };
    fileContent = JSON.stringify(envelope, null, 2);
  }

  const recordCount =
    users.length +
    customers.length +
    products.length +
    sales.length +
    payments.length +
    ledgerEntries.length +
    expenses.length;

  const sizeBytes = new Blob([fileContent]).size;
  const record: BackupRecord = {
    id: generateUuid(),
    orgId: org.id,
    createdAt: exportedAt,
    recordCount,
    sizeBytes,
    encrypted,
    checksum,
    storageType: params.storageType ?? 'local_file',
  };

  await runSafeDbWrite(async () => {
    await db.backupRecords.put(record);
    await setMeta(`lastBackupAt:${org.id}`, exportedAt);
  });

  const stamp = toLocalDateKey(exportedAt);
  const fileName = buildCleanExportFileName(
    ['نسخة-احتياطية', org.name, stamp, encrypted ? 'مشفرة' : ''],
    'qatshi.json'
  );
  return { fileContent, fileName, record };
}

export async function parseAndVerifyBackupFile(params: {
  rawText: string;
  password?: string;
  currentOrgId: string;
  allowCrossOrgRestore: boolean;
}): Promise<{ payload: BackupPayload; isCrossOrg: boolean }> {
  let parsed: Partial<BackupPayload & EncryptedEnvelope>;
  try {
    parsed = JSON.parse(params.rawText) as Partial<BackupPayload & EncryptedEnvelope>;
  } catch {
    throw new Error('ملف النسخة الاحتياطية ليس بصيغة JSON صالحة');
  }

  let payload: BackupPayload;
  if (parsed.encrypted) {
    if (!params.password) {
      throw new Error('PASSWORD_REQUIRED:هذه النسخة الاحتياطية مشفرة — أدخل كلمة المرور لفك التشفير');
    }
    try {
      const salt = fromBase64(parsed.saltB64!);
      const iv = fromBase64(parsed.ivB64!);
      const cipher = fromBase64(parsed.cipherB64!);
      const key = await deriveAesKey(params.password, salt);
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        key,
        cipher.buffer as ArrayBuffer
      );
      payload = JSON.parse(new TextDecoder().decode(plainBuf)) as BackupPayload;
    } catch {
      throw new Error('كلمة مرور فك التشفير غير صحيحة أو الملف تالف');
    }
  } else {
    payload = parsed as BackupPayload;
  }

  if (payload.app !== 'QATSHI' || !payload.data || !payload.checksum || !payload.orgId) {
    throw new Error('ملف النسخة الاحتياطية غير صالح أو لا ينتمي لنظام قاتشي');
  }

  const computedChecksum = await sha256Hex(JSON.stringify(payload.data));
  if (computedChecksum !== payload.checksum) {
    throw new Error('فشل التحقق من سلامة النسخة الاحتياطية — قد يكون الملف معدلاً أو تالفاً');
  }

  const isCrossOrg = payload.orgId !== params.currentOrgId;
  if (isCrossOrg && !params.allowCrossOrgRestore) {
    throw new Error(
      `CROSS_ORG_MISMATCH:تحذير: هذه النسخة تخص مؤسسة مختلفة (${payload.orgName}). يرجى تأكيد الاستعادة الصريحة.`
    );
  }

  const migrated = migrateBackupPayload(payload);
  return { payload: migrated, isCrossOrg };
}

export async function restoreBackupPayload(payload: BackupPayload): Promise<void> {
  const normalized = migrateBackupPayload(payload);
  const targetOrgId = normalized.orgId;
  const tables = [
    db.organizations,
    db.users,
    db.customers,
    db.products,
    db.sales,
    db.payments,
    db.ledgerEntries,
    db.expenses,
    db.cashboxSessions,
    db.messageTemplates,
    db.offers,
    db.campaigns,
    db.messageLogs,
    db.messagingConfigs,
    db.auditLogs,
  ];

  await runSafeDbWrite(() =>
    db.transaction('rw', tables, async () => {
      await Promise.all([
        db.users.where('orgId').equals(targetOrgId).delete(),
        db.customers.where('orgId').equals(targetOrgId).delete(),
        db.products.where('orgId').equals(targetOrgId).delete(),
        db.sales.where('orgId').equals(targetOrgId).delete(),
        db.payments.where('orgId').equals(targetOrgId).delete(),
        db.ledgerEntries.where('orgId').equals(targetOrgId).delete(),
        db.expenses.where('orgId').equals(targetOrgId).delete(),
        db.cashboxSessions.where('orgId').equals(targetOrgId).delete(),
        db.messageTemplates.where('orgId').equals(targetOrgId).delete(),
        db.offers.where('orgId').equals(targetOrgId).delete(),
        db.campaigns.where('orgId').equals(targetOrgId).delete(),
        db.messageLogs.where('orgId').equals(targetOrgId).delete(),
        db.messagingConfigs.where('orgId').equals(targetOrgId).delete(),
        db.auditLogs.where('orgId').equals(targetOrgId).delete(),
      ]);

      if (normalized.data.organization) {
        await db.organizations.put(normalized.data.organization as never);
      }
      if (normalized.data.users.length) await db.users.bulkPut(normalized.data.users as never[]);
      if (normalized.data.customers.length) await db.customers.bulkPut(normalized.data.customers as never[]);
      if (normalized.data.products.length) await db.products.bulkPut(normalized.data.products as never[]);
      if (normalized.data.sales.length) await db.sales.bulkPut(normalized.data.sales as never[]);
      if (normalized.data.payments.length) await db.payments.bulkPut(normalized.data.payments as never[]);
      if (normalized.data.ledgerEntries.length)
        await db.ledgerEntries.bulkPut(normalized.data.ledgerEntries as never[]);
      if (normalized.data.expenses.length) await db.expenses.bulkPut(normalized.data.expenses as never[]);
      if (normalized.data.cashboxSessions.length)
        await db.cashboxSessions.bulkPut(normalized.data.cashboxSessions as never[]);
      if (normalized.data.messageTemplates.length)
        await db.messageTemplates.bulkPut(normalized.data.messageTemplates as never[]);
      if (normalized.data.offers.length) await db.offers.bulkPut(normalized.data.offers as never[]);
      if (normalized.data.campaigns.length) await db.campaigns.bulkPut(normalized.data.campaigns as never[]);
      if (normalized.data.messageLogs.length) await db.messageLogs.bulkPut(normalized.data.messageLogs as never[]);
      if (normalized.data.messagingConfigs.length)
        await db.messagingConfigs.bulkPut(normalized.data.messagingConfigs as never[]);
      if (normalized.data.auditLogs.length) await db.auditLogs.bulkPut(normalized.data.auditLogs as never[]);
    })
  );

  await setMeta('activeOrgId', targetOrgId);
}

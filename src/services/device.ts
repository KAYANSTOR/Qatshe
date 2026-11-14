import { db } from '../db/qatshiDb';

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.kvMeta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.kvMeta.put({ key, value });
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getMeta('deviceId');
  if (existing) return existing;
  const created = `DEV-${generateUuid().slice(0, 8).toUpperCase()}`;
  await setMeta('deviceId', created);
  return created;
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`qatshi-pin:${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPin(pin: string, salt: string, expectedHash: string): Promise<boolean> {
  const actual = await hashPin(pin, salt);
  return actual === expectedHash;
}

export interface StorageDiagnostics {
  persisted: boolean;
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
}

export async function requestAndCheckPersistentStorage(): Promise<StorageDiagnostics> {
  let persisted = false;
  let usageBytes = 0;
  let quotaBytes = 0;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (typeof navigator.storage.persisted === 'function') {
        persisted = await navigator.storage.persisted();
      }
      if (!persisted && typeof navigator.storage.persist === 'function') {
        persisted = await navigator.storage.persist();
      }
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        usageBytes = est.usage ?? 0;
        quotaBytes = est.quota ?? 0;
      }
    } catch {
      // Ignore storage API restriction in private mode
    }
  }

  return {
    persisted,
    usageBytes,
    quotaBytes,
    usagePercent: quotaBytes > 0 ? Math.round((usageBytes / quotaBytes) * 1000) / 10 : 0,
  };
}

export function generateTenantSecret(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

import { formatSequentialDocumentNumber } from '../domain/formatters';

export async function allocateNextDocumentNumber(
  orgId: string,
  prefix: 'INV' | 'REC' | 'ADJ' | 'OPEN' | 'EXP',
  fallbackCount: number,
  _deviceId?: string,
  branchId = 'main',
  branchIndex = 1
): Promise<string> {
  const key = `seq:${orgId}:${branchId}:${prefix}`;
  const existing = await db.kvMeta.get(key);
  const current = existing ? Number(existing.value) || fallbackCount : fallbackCount;
  const next = current + 1;
  await db.kvMeta.put({ key, value: String(next) });
  return formatSequentialDocumentNumber(prefix, next, branchIndex);
}

export async function runSafeDbWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);
    if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
      throw new Error(
        'مساحة التخزين المحلية في المتصفح ممتلئة — يرجى تصدير نسخة احتياطية فوراً وتحرير مساحة من الجهاز'
      );
    }
    throw err;
  }
}

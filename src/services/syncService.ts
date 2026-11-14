import { db } from '../db/qatshiDb';
import type { Organization, SyncOperation } from '../domain/types';
import { generateTenantSecret, generateUuid, getMeta, getOrCreateDeviceId, setMeta } from './device';

export interface SyncRunResult {
  pushedCount: number;
  pulledCount: number;
  duplicateCount: number;
  conflictCount: number;
  serverReachable: boolean;
  message: string;
}

const SYNC_BATCH_SIZE = 100;

export async function ensureOrgAuthSecret(orgId: string): Promise<string> {
  const org = await db.organizations.get(orgId);
  if (!org) throw new Error('المؤسسة غير موجودة');
  if (org.orgAuthSecret && org.orgAuthSecret.length >= 8) {
    return org.orgAuthSecret;
  }
  const secret = generateTenantSecret();
  await db.organizations.put({
    ...org,
    orgAuthSecret: secret,
    updatedAt: new Date().toISOString(),
  });
  return secret;
}

export async function queueEntitySyncOperation(params: {
  orgId: string;
  entityType: SyncOperation['entityType'];
  entityId: string;
  action: SyncOperation['action'];
  payload: unknown;
  idempotencyKey?: string;
}): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  const now = new Date().toISOString();
  await db.syncOperations.put({
    id: generateUuid(),
    orgId: params.orgId,
    deviceId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    payload: params.payload,
    idempotencyKey: params.idempotencyKey || `${params.entityType}-${params.entityId}-${now}`,
    status: 'pending',
    createdAt: now,
  });
}

export async function runOrganizationSync(orgId: string): Promise<SyncRunResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      pushedCount: 0,
      pulledCount: 0,
      duplicateCount: 0,
      conflictCount: 0,
      serverReachable: false,
      message: 'الجهاز غير متصل بالإنترنت — تستمر العمليات محلياً دون انقطاع',
    };
  }

  const secret = await ensureOrgAuthSecret(orgId);
  const deviceId = await getOrCreateDeviceId();
  const pendingOps = await db.syncOperations
    .where('[orgId+status]')
    .equals([orgId, 'pending'])
    .toArray();

  if (!pendingOps.length) {
    try {
      const health = await fetch('/api/health');
      if (!health.ok) throw new Error('Server unavailable');
      const pulled = await pullOrganizationChanges(orgId, secret, deviceId);
      return {
        pushedCount: 0,
        pulledCount: pulled,
        duplicateCount: 0,
        conflictCount: 0,
        serverReachable: true,
        message:
          pulled > 0
            ? `تمت مزامنة واستلام ${pulled} تحديث من الأجهزة الأخرى`
            : 'جميع السجلات متزامنة ومحدثة',
      };
    } catch {
      return {
        pushedCount: 0,
        pulledCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        serverReachable: false,
        message: 'خادم المزامنة غير متاح حالياً — بياناتك محفوظة محلياً',
      };
    }
  }

  let pushedCount = 0;
  let duplicateCount = 0;
  let conflictCount = 0;

  try {
    for (let i = 0; i < pendingOps.length; i += SYNC_BATCH_SIZE) {
      const batch = pendingOps.slice(i, i + SYNC_BATCH_SIZE);
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-secret': secret,
        },
        body: JSON.stringify({ orgId, operations: batch }),
      });

      if (!res.ok) {
        return {
          pushedCount,
          pulledCount: 0,
          duplicateCount,
          conflictCount,
          serverReachable: false,
          message: `تعذرت المزامنة مؤقتاً (رمز ${res.status}) — ستُعاد المحاولة لاحقاً`,
        };
      }

      const data = (await res.json()) as {
        results: Array<{
          id: string;
          status: 'synced' | 'duplicate' | 'conflict';
          serverRevision?: number;
          conflictDetails?: string;
        }>;
      };

      const now = new Date().toISOString();
      for (const r of data.results) {
        const op = batch.find((o) => o.id === r.id);
        if (!op) continue;
        if (r.status === 'conflict') {
          conflictCount++;
          await db.syncOperations.put({
            ...op,
            status: 'conflict',
            conflictDetails: r.conflictDetails || 'تعارض مراجعات على نفس السجل المالي',
          });
        } else {
          if (r.status === 'duplicate') duplicateCount++;
          else pushedCount++;
          await db.syncOperations.put({
            ...op,
            status: 'synced',
            serverRevision: r.serverRevision,
            syncedAt: now,
          });
        }
      }
    }

    const pulledCount = await pullOrganizationChanges(orgId, secret, deviceId);

    return {
      pushedCount,
      pulledCount,
      duplicateCount,
      conflictCount,
      serverReachable: true,
      message:
        conflictCount > 0
          ? `تمت مزامنة ${pushedCount} عملية مع وجود ${conflictCount} تعارض يتطلب مراجعة`
          : `تمت مزامنة ${pushedCount} عملية بنجاح`,
    };
  } catch {
    return {
      pushedCount,
      pulledCount: 0,
      duplicateCount,
      conflictCount,
      serverReachable: false,
      message: 'تعذر الوصول إلى خادم المزامنة — يستمر العمل محلياً بالكامل',
    };
  }
}

async function pullOrganizationChanges(orgId: string, secret: string, deviceId: string): Promise<number> {
  const sinceRevRaw = await getMeta(`syncRevision:${orgId}`);
  const sinceRevision = Number(sinceRevRaw || 0) || 0;
  try {
    const res = await fetch(
      `/api/sync/pull?orgId=${encodeURIComponent(orgId)}&sinceRevision=${sinceRevision}&deviceId=${encodeURIComponent(deviceId)}`,
      { headers: { 'x-org-secret': secret } }
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      ok?: boolean;
      latestRevision?: number;
      operations?: Array<{ serverRevision?: number }>;
    };
    if (typeof data.latestRevision === 'number') {
      await setMeta(`syncRevision:${orgId}`, String(data.latestRevision));
    }
    return data.operations?.length ?? 0;
  } catch {
    return 0;
  }
}

export async function resolveSyncConflict(
  op: SyncOperation,
  resolution: 'keep_local' | 'mark_reviewed'
): Promise<void> {
  await db.syncOperations.put({
    ...op,
    status: resolution === 'keep_local' ? 'pending' : 'synced',
    conflictDetails: resolution === 'mark_reviewed' ? 'تمت المراجعة والاعتماد بواسطة المالك' : undefined,
    syncedAt: resolution === 'mark_reviewed' ? new Date().toISOString() : undefined,
  });
}

export async function getOrgSecretForApi(org: Organization): Promise<string> {
  return ensureOrgAuthSecret(org.id);
}

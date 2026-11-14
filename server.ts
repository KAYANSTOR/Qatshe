import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

export interface SyncOpInput {
  id: string;
  orgId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: unknown;
  idempotencyKey: string;
  baseRevision?: number;
  serverRevision?: number;
  createdAt: string;
}

interface TenantRecord {
  authSecretHash?: string;
  revisionCounter: number;
  seenIdempotencyKeys: Record<string, string>;
  entityVersions: Record<string, { lastModifiedAt: string; deviceId: string; revision: number }>;
  operations: SyncOpInput[];
  backups: Array<{ id: string; exportedAt: string; content: string }>;
}

interface StoredSyncData {
  orgs: Record<string, TenantRecord>;
}

function getDataFilePath(): string {
  return process.env.QATSHI_SYNC_STORE_FILE
    ? path.resolve(process.env.QATSHI_SYNC_STORE_FILE)
    : path.resolve(process.cwd(), '.qatshi-sync-store.json');
}

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(`qatshi-tenant:${secret}`).digest('hex');
}

function extractTenantSecret(req: express.Request): string {
  const header = req.header('x-org-secret');
  if (header && header.trim()) return header.trim();
  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function ensureTenantAuth(
  tenant: TenantRecord | undefined,
  secret: string,
  createIfMissing: boolean
): { ok: true; tenant: TenantRecord } | { ok: false; status: number; error: string } {
  if (!secret || secret.length < 8) {
    return { ok: false, status: 401, error: 'رمز مصادقة المؤسسة مفقود أو غير صالح' };
  }
  const secretHash = hashSecret(secret);
  if (!tenant) {
    if (!createIfMissing) {
      return { ok: false, status: 404, error: 'المؤسسة غير مسجلة في خادم المزامنة' };
    }
    return {
      ok: true,
      tenant: {
        authSecretHash: secretHash,
        revisionCounter: 0,
        seenIdempotencyKeys: {},
        entityVersions: {},
        operations: [],
        backups: [],
      },
    };
  }
  if (!tenant.authSecretHash) {
    tenant.authSecretHash = secretHash;
  } else if (tenant.authSecretHash !== secretHash) {
    return { ok: false, status: 403, error: 'رفض الوصول: رمز المؤسسة غير مطابق (عزل المؤسسات)' };
  }
  return { ok: true, tenant };
}

let storeLock: Promise<void> = Promise.resolve();

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storeLock.then(fn, fn);
  storeLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function loadSyncStore(): Promise<StoredSyncData> {
  try {
    const raw = await fs.readFile(getDataFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as StoredSyncData;
    return parsed?.orgs ? parsed : { orgs: {} };
  } catch {
    return { orgs: {} };
  }
}

async function saveSyncStore(store: StoredSyncData): Promise<void> {
  const filePath = getDataFilePath();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

export function createQatshiApp() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'qatshi-sync', timestamp: new Date().toISOString() });
  });

  app.post('/api/sync/push', async (req, res) => {
    try {
      const { orgId, operations } = req.body as { orgId?: string; operations?: SyncOpInput[] };
      if (!orgId || !Array.isArray(operations)) {
        res.status(400).json({ error: 'orgId and operations array are required' });
        return;
      }

      const secret = extractTenantSecret(req);
      const outcome = await withStoreLock(async () => {
        const store = await loadSyncStore();
        const auth = ensureTenantAuth(store.orgs[orgId], secret, true);
        if (!auth.ok) return auth;

        const tenant = auth.tenant;
        store.orgs[orgId] = tenant;
        const results: Array<{
          id: string;
          status: 'synced' | 'duplicate' | 'conflict';
          serverRevision?: number;
          conflictDetails?: string;
        }> = [];

        for (const op of operations) {
          if (op.orgId !== orgId) {
            results.push({
              id: op.id,
              status: 'conflict',
              conflictDetails: 'رفض عزل المؤسسات: المؤسسة غير مطابقة',
            });
            continue;
          }

          if (tenant.seenIdempotencyKeys[op.idempotencyKey]) {
            results.push({ id: op.id, status: 'duplicate' });
            continue;
          }

          const entityKey = `${op.entityType}:${op.entityId}`;
          const existingVer = tenant.entityVersions[entityKey];
          if (existingVer && op.action === 'update' && existingVer.deviceId !== op.deviceId) {
            const revisionConflict =
              typeof op.baseRevision === 'number' && op.baseRevision < existingVer.revision;
            const timestampConflict =
              typeof op.baseRevision !== 'number' && existingVer.lastModifiedAt > op.createdAt;
            if (revisionConflict || timestampConflict) {
              results.push({
                id: op.id,
                status: 'conflict',
                conflictDetails: `تعديل أحدث مسجل من الجهاز ${existingVer.deviceId} (مراجعة ${existingVer.revision})`,
              });
              continue;
            }
          }

          tenant.revisionCounter = (tenant.revisionCounter || 0) + 1;
          const serverRevision = tenant.revisionCounter;
          tenant.seenIdempotencyKeys[op.idempotencyKey] = new Date().toISOString();
          tenant.entityVersions[entityKey] = {
            lastModifiedAt: op.createdAt,
            deviceId: op.deviceId,
            revision: serverRevision,
          };
          tenant.operations.push({ ...op, serverRevision });
          results.push({ id: op.id, status: 'synced', serverRevision });
        }

        await saveSyncStore(store);
        return { ok: true as const, results, latestRevision: tenant.revisionCounter };
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json({ ok: true, results: outcome.results, latestRevision: outcome.latestRevision });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  app.get('/api/sync/pull', async (req, res) => {
    try {
      const orgId = String(req.query.orgId || '');
      const sinceRevision = Number(req.query.sinceRevision || 0) || 0;
      const excludeDeviceId = String(req.query.deviceId || '');
      if (!orgId) {
        res.status(400).json({ error: 'orgId required' });
        return;
      }

      const secret = extractTenantSecret(req);
      const store = await loadSyncStore();
      const auth = ensureTenantAuth(store.orgs[orgId], secret, false);
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }

      const ops = auth.tenant.operations.filter(
        (op) =>
          (op.serverRevision ?? 0) > sinceRevision &&
          (!excludeDeviceId || op.deviceId !== excludeDeviceId)
      );
      res.json({
        ok: true,
        latestRevision: auth.tenant.revisionCounter || 0,
        operations: ops.slice(0, 200),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Pull failed' });
    }
  });

  app.post('/api/backup/upload', async (req, res) => {
    try {
      const { orgId, content } = req.body as { orgId?: string; content?: string };
      if (!orgId || !content) {
        res.status(400).json({ error: 'orgId and backup content required' });
        return;
      }

      const secret = extractTenantSecret(req);
      const outcome = await withStoreLock(async () => {
        const store = await loadSyncStore();
        const auth = ensureTenantAuth(store.orgs[orgId], secret, true);
        if (!auth.ok) return auth;

        store.orgs[orgId] = auth.tenant;
        const backupId = `bkp-${Date.now()}`;
        auth.tenant.backups.unshift({
          id: backupId,
          exportedAt: new Date().toISOString(),
          content,
        });
        auth.tenant.backups = auth.tenant.backups.slice(0, 5);
        await saveSyncStore(store);
        return { ok: true as const, backupId };
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json({ ok: true, backupId: outcome.backupId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Backup upload failed' });
    }
  });

  app.get('/api/backup/latest', async (req, res) => {
    const orgId = String(req.query.orgId || '');
    if (!orgId) {
      res.status(400).json({ error: 'orgId required' });
      return;
    }
    const secret = extractTenantSecret(req);
    const store = await loadSyncStore();
    const auth = ensureTenantAuth(store.orgs[orgId], secret, false);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }
    const latest = auth.tenant.backups?.[0];
    if (!latest) {
      res.status(404).json({ error: 'لا توجد نسخة سحابية محفوظة لهذه المؤسسة' });
      return;
    }
    res.json({ ok: true, backup: latest });
  });

  return app;
}

async function startServer() {
  const app = createQatshiApp();
  const port = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`QATSHI server listening on http://localhost:${port}`);
  });
}

if (process.env.QATSHI_TEST_NO_LISTEN !== '1') {
  startServer();
}

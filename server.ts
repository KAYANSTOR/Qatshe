import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

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

type AuthAccount = { id: string; phone: string; ownerName: string; codeHash: string; projectId: string | null; projectName: string | null };
type RemoteCustomerRow = {
  id: string;
  projectId: string;
  fullName: string;
  phone: string;
  address: string;
  balance: number;
  category: string;
  creditLimit: number;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

function createPostgresPool(): Pool | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const disableSsl =
    url.includes('sslmode=disable') ||
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('.railway.internal');
  return new Pool({
    connectionString: url,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
  });
}

const database = createPostgresPool();
const memoryAccounts = new Map<string, AuthAccount>();
const memorySessions = new Map<string, string>();
const memoryCustomers = new Map<string, RemoteCustomerRow[]>();

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/\D/g, '');
}

function validatePhoneAndCode(phoneValue: unknown, codeValue: unknown) {
  const phone = normalizeDigits(String(phoneValue || ''));
  const code = normalizeDigits(String(codeValue || ''));
  if (!/^\d{7,15}$/.test(phone)) throw new Error('رقم الهاتف يجب أن يتكون من 7 إلى 15 رقمًا');
  if (!/^\d{4,8}$/.test(code)) throw new Error('الرمز يجب أن يتكون من 4 إلى 8 أرقام فقط');
  return { phone, code };
}

function hashNumericCode(code: string, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(code, salt, 64).toString('hex')}`;
}

function verifyNumericCode(code: string, stored: string) {
  const [salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const actual = crypto.scryptSync(code, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashSessionToken(token: string) { return crypto.createHash('sha256').update(token).digest('hex'); }
function newId(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function readCookie(req: express.Request, name: string) {
  const item = (req.header('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function isSecureCookieRequest(req: express.Request): boolean {
  const local = ['localhost', '127.0.0.1'].includes(req.hostname);
  if (local) return false;
  return req.secure || req.header('x-forwarded-proto') === 'https';
}

function setSessionCookie(req: express.Request, res: express.Response, token: string) {
  const secure = isSecureCookieRequest(req);
  res.setHeader(
    'Set-Cookie',
    `qatshi_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Max-Age=2592000; SameSite=${secure ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`
  );
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const secure = isSecureCookieRequest(req);
  res.setHeader(
    'Set-Cookie',
    `qatshi_session=; Path=/; HttpOnly; Max-Age=0; SameSite=${secure ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`
  );
}

export async function initializeDatabase() {
  if (!database) return;
  await database.query(`
    CREATE TABLE IF NOT EXISTS qatshi_accounts (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      owner_name TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS qatshi_projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES qatshi_accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS qatshi_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES qatshi_accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qatshi_customers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES qatshi_projects(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT DEFAULT '',
      balance NUMERIC NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'regular',
      credit_limit NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, phone)
    );
    ALTER TABLE qatshi_customers ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'regular';
    ALTER TABLE qatshi_customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE qatshi_customers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE qatshi_customers ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
    CREATE INDEX IF NOT EXISTS qatshi_customers_project_idx ON qatshi_customers(project_id);
  `);
}

async function accountFromRequest(req: express.Request): Promise<AuthAccount | null> {
  const token = readCookie(req, 'qatshi_session');
  if (!token) return null;
  if (!database) {
    const accountId = memorySessions.get(hashSessionToken(token));
    return accountId ? [...memoryAccounts.values()].find((account) => account.id === accountId) || null : null;
  }
  const result = await database.query(
    `SELECT a.id, a.phone, a.owner_name AS "ownerName", a.code_hash AS "codeHash", p.id AS "projectId", p.name AS "projectName"
     FROM qatshi_sessions s
     JOIN qatshi_accounts a ON a.id = s.account_id
     LEFT JOIN qatshi_projects p ON p.owner_id = a.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [hashSessionToken(token)]
  );
  return (result.rows[0] as AuthAccount | undefined) || null;
}

async function createAuthSession(req: express.Request, res: express.Response, account: AuthAccount) {
  const token = crypto.randomBytes(32).toString('base64url');
  if (!database) memorySessions.set(hashSessionToken(token), account.id);
  else {
    await database.query(
      `INSERT INTO qatshi_sessions(token_hash, account_id, expires_at) VALUES($1, $2, NOW() + INTERVAL '30 days')`,
      [hashSessionToken(token), account.id]
    );
  }
  setSessionCookie(req, res, token);
}

function publicAccount(account: AuthAccount) {
  return {
    id: account.id,
    phone: account.phone,
    ownerName: account.ownerName,
    projectId: account.projectId,
    projectName: account.projectName,
  };
}

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
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'qatshi-sync',
      database: database ? 'postgres' : 'memory',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/integration/health', (_req, res) => {
    res.json({ ok: true, service: 'qatshe', capabilities: ['health', 'capabilities', 'revalidate'], timestamp: new Date().toISOString() });
  });

  app.post('/api/integration/command', (req, res) => {
    const secret = process.env.HUB_INTEGRATION_SECRET;
    const provided = req.header('x-hub-signature') || '';
    const raw = JSON.stringify(req.body || {});
    const expected = secret ? crypto.createHmac('sha256', secret).update(raw).digest('hex') : '';
    const valid = Boolean(secret) && provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!valid) return res.status(401).json({ error: 'invalid_hub_signature' });
    if (req.body?.command !== 'revalidate') return res.status(400).json({ error: 'unsupported_command' });
    return res.status(202).json({ ok: true, accepted: true, command: 'revalidate', timestamp: new Date().toISOString() });
  });

  app.get('/api/auth/me', async (req, res) => {
    try {
      const account = await accountFromRequest(req);
      res.json(account ? { authenticated: true, user: publicAccount(account) } : { authenticated: false });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'تعذر التحقق من الجلسة' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { phone, code } = validatePhoneAndCode(req.body?.phone, req.body?.code);
      const ownerName = String(req.body?.ownerName || '').trim();
      const projectName = String(req.body?.projectName || '').trim();
      if (ownerName.length < 2 || ownerName.length > 80) throw new Error('اكتب اسم صاحب الحساب');
      if (projectName.length < 2 || projectName.length > 100) throw new Error('اكتب اسم المشروع');
      if (database) {
        const existing = await database.query('SELECT id FROM qatshi_accounts WHERE phone=$1', [phone]);
        if (existing.rowCount) { res.status(409).json({ error: 'رقم الهاتف مسجل مسبقًا' }); return; }
        const accountId = newId('acct');
        const projectId = newId('proj');
        await database.query('BEGIN');
        try {
          await database.query('INSERT INTO qatshi_accounts(id,phone,owner_name,code_hash) VALUES($1,$2,$3,$4)', [accountId, phone, ownerName, hashNumericCode(code)]);
          await database.query('INSERT INTO qatshi_projects(id,owner_id,name) VALUES($1,$2,$3)', [projectId, accountId, projectName]);
          await database.query('COMMIT');
        } catch (error) { await database.query('ROLLBACK'); throw error; }
        const account = { id: accountId, phone, ownerName, codeHash: '', projectId, projectName };
        await createAuthSession(req, res, account);
        res.status(201).json({ ok: true, user: publicAccount(account) });
        return;
      }
      if (memoryAccounts.has(phone)) { res.status(409).json({ error: 'رقم الهاتف مسجل مسبقًا' }); return; }
      const account = { id: newId('acct'), phone, ownerName, codeHash: hashNumericCode(code), projectId: newId('proj'), projectName };
      memoryAccounts.set(phone, account);
      await createAuthSession(req, res, account);
      res.status(201).json({ ok: true, user: publicAccount(account) });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'تعذر إنشاء الحساب' }); }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { phone, code } = validatePhoneAndCode(req.body?.phone, req.body?.code);
      let account: AuthAccount | undefined;
      if (database) {
        const result = await database.query(
          `SELECT a.id, a.phone, a.owner_name AS "ownerName", a.code_hash AS "codeHash", p.id AS "projectId", p.name AS "projectName"
           FROM qatshi_accounts a
           LEFT JOIN qatshi_projects p ON p.owner_id = a.id
           WHERE a.phone = $1
           LIMIT 1`,
          [phone]
        );
        account = result.rows[0] as AuthAccount | undefined;
      } else {
        account = memoryAccounts.get(phone);
      }
      if (!account || !verifyNumericCode(code, account.codeHash)) {
        res.status(401).json({ error: 'رقم الهاتف أو الرمز غير صحيح' });
        return;
      }
      await createAuthSession(req, res, account);
      res.json({ ok: true, user: publicAccount(account) });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'تعذر تسجيل الدخول' }); }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = readCookie(req, 'qatshi_session');
      if (token) {
        if (database) await database.query('DELETE FROM qatshi_sessions WHERE token_hash=$1', [hashSessionToken(token)]);
        else memorySessions.delete(hashSessionToken(token));
      }
      clearSessionCookie(req, res);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'تعذر تسجيل الخروج' });
    }
  });

  app.get('/api/customers', async (req, res) => {
    try {
      const account = await accountFromRequest(req);
      if (!account?.projectId) { res.status(401).json({ error: 'يجب تسجيل الدخول أولًا' }); return; }
      if (!database) {
        res.json({ ok: true, customers: memoryCustomers.get(account.projectId) || [] });
        return;
      }
      const result = await database.query(
        `SELECT id, project_id AS "projectId", full_name AS "fullName", phone, address, balance::float8 AS balance, category, credit_limit::float8 AS "creditLimit", status, notes, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM qatshi_customers
         WHERE project_id = $1
         ORDER BY updated_at DESC`,
        [account.projectId]
      );
      res.json({ ok: true, customers: result.rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'تعذر جلب العملاء' });
    }
  });

  app.post('/api/customers', async (req, res) => {
    try {
      const account = await accountFromRequest(req);
      if (!account?.projectId) { res.status(401).json({ error: 'يجب تسجيل الدخول أولًا' }); return; }
      const fullName = String(req.body?.fullName || '').trim();
      const phone = normalizeDigits(String(req.body?.phone || ''));
      if (!fullName || !/^\d{7,15}$/.test(phone)) {
        res.status(400).json({ error: 'اسم العميل ورقم الهاتف الصحيح مطلوبان' });
        return;
      }
      const id = String(req.body?.id || '').trim() || newId('cust');
      const address = String(req.body?.address || '').trim();
      const balance = Number(req.body?.balance || 0) || 0;
      const category = ['vip', 'wholesale', 'regular'].includes(String(req.body?.category))
        ? String(req.body?.category)
        : 'regular';
      const creditLimit = Number(req.body?.creditLimit || 0) || 0;
      const status = req.body?.status === 'inactive' ? 'inactive' : 'active';
      const notes = String(req.body?.notes || '').trim();
      const now = new Date().toISOString();

      if (!database) {
        const list = memoryCustomers.get(account.projectId) || [];
        const existingIdx = list.findIndex((c) => c.phone === phone || c.id === id);
        const record: RemoteCustomerRow = {
          id: existingIdx >= 0 ? list[existingIdx].id : id,
          projectId: account.projectId,
          fullName,
          phone,
          address,
          balance,
          category,
          creditLimit,
          status,
          notes,
          createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : now,
          updatedAt: now,
        };
        if (existingIdx >= 0) list[existingIdx] = record;
        else list.unshift(record);
        memoryCustomers.set(account.projectId, list);
        res.status(201).json({ ok: true, customer: record });
        return;
      }

      const result = await database.query(
        `INSERT INTO qatshi_customers(id, project_id, full_name, phone, address, balance, category, credit_limit, status, notes, updated_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (project_id, phone)
         DO UPDATE SET
           full_name = EXCLUDED.full_name,
           address = EXCLUDED.address,
           balance = EXCLUDED.balance,
           category = EXCLUDED.category,
           credit_limit = EXCLUDED.credit_limit,
           status = EXCLUDED.status,
           notes = EXCLUDED.notes,
           updated_at = NOW()
         RETURNING id, project_id AS "projectId", full_name AS "fullName", phone, address, balance::float8 AS balance, category, credit_limit::float8 AS "creditLimit", status, notes, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, account.projectId, fullName, phone, address, balance, category, creditLimit, status, notes]
      );
      res.status(201).json({ ok: true, customer: result.rows[0] });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'تعذر حفظ العميل' });
    }
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

export async function startServer() {
  await initializeDatabase();
  const app = createQatshiApp();
  const port = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await (0, eval)('import("vite")');
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

if (process.env.QATSHI_TEST_NO_LISTEN !== '1' && !process.env.VERCEL) {
  startServer();
}

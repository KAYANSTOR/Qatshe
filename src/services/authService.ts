import { db } from '../db/qatshiDb';
import type { AppUser, Customer, CustomerCategory, Organization } from '../domain/types';
import { generateTenantSecret, generateUuid, getOrCreateDeviceId, setMeta } from './device';
import { buildDefaultTemplates } from './seedService';

export interface AuthUser {
  id: string;
  phone: string;
  ownerName: string;
  projectId: string | null;
  projectName: string | null;
}

export interface RemoteCustomer {
  id: string;
  projectId?: string;
  fullName: string;
  phone: string;
  address?: string;
  balance?: number;
  category?: string;
  creditLimit?: number;
  status?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthResponse {
  ok: true;
  user: AuthUser;
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\D/g, '');
}

export function normalizePhone(value: string): string {
  return normalizeDigits(value).slice(0, 15);
}

export function normalizeNumericCode(value: string): string {
  return normalizeDigits(value).slice(0, 8);
}

async function request<T>(path: string, body?: unknown, method = 'GET'): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || 'تعذر الاتصال بخدمة الحساب');
  return payload;
}

export async function getCurrentAuthUser(): Promise<AuthUser | null> {
  try {
    const payload = await request<{ authenticated: boolean; user?: AuthUser }>('/api/auth/me');
    return payload.authenticated ? payload.user || null : null;
  } catch {
    return null;
  }
}

export async function loginWithPhone(phone: string, code: string): Promise<AuthUser> {
  const cleanPhone = normalizePhone(phone);
  const cleanCode = normalizeNumericCode(code);
  if (!/^\d{7,15}$/.test(cleanPhone)) {
    throw new Error('رقم الهاتف يجب أن يتكون من 7 إلى 15 رقمًا');
  }
  if (!/^\d{4,8}$/.test(cleanCode)) {
    throw new Error('الرمز يجب أن يتكون من 4 إلى 8 أرقام فقط');
  }
  const payload = await request<AuthResponse>(
    '/api/auth/login',
    { phone: cleanPhone, code: cleanCode },
    'POST'
  );
  return payload.user;
}

export async function registerWithPhone(input: {
  phone: string;
  code: string;
  ownerName: string;
  projectName: string;
}): Promise<AuthUser> {
  const cleanPhone = normalizePhone(input.phone);
  const cleanCode = normalizeNumericCode(input.code);
  const ownerName = input.ownerName.trim();
  const projectName = input.projectName.trim();

  if (ownerName.length < 2 || ownerName.length > 80) {
    throw new Error('اكتب اسم صاحب الحساب (حرفان على الأقل)');
  }
  if (projectName.length < 2 || projectName.length > 100) {
    throw new Error('اكتب اسم المشروع أو المحل (حرفان على الأقل)');
  }
  if (!/^\d{7,15}$/.test(cleanPhone)) {
    throw new Error('رقم الهاتف يجب أن يتكون من 7 إلى 15 رقمًا');
  }
  if (!/^\d{4,8}$/.test(cleanCode)) {
    throw new Error('الرمز يجب أن يتكون من 4 إلى 8 أرقام فقط');
  }

  const payload = await request<AuthResponse>(
    '/api/auth/register',
    {
      phone: cleanPhone,
      code: cleanCode,
      ownerName,
      projectName,
    },
    'POST'
  );
  return payload.user;
}

export async function logoutAuth(): Promise<void> {
  await request('/api/auth/logout', undefined, 'POST');
}

export async function fetchRemoteCustomers(): Promise<RemoteCustomer[]> {
  try {
    const payload = await request<{ ok: boolean; customers?: RemoteCustomer[] }>('/api/customers');
    return Array.isArray(payload.customers) ? payload.customers : [];
  } catch {
    return [];
  }
}

export async function syncCustomerToRailway(customer: Customer): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  try {
    await request('/api/customers', {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
      address: customer.address,
      balance: customer.cachedBalance,
      category: customer.category,
      creditLimit: customer.creditLimit,
      status: customer.status,
      notes: customer.notes,
    }, 'POST');
  } catch {
    // Non-blocking: local IndexedDB holds full offline source of truth
  }
}

export async function ensureLocalProjectInitialized(authUser: AuthUser): Promise<string | null> {
  if (!authUser.projectId || !authUser.projectName) return null;

  const orgId = authUser.projectId;
  const existingOrg = await db.organizations.get(orgId);
  const now = new Date().toISOString();

  if (!existingOrg) {
    const branchId = `branch-${generateUuid().slice(0, 8)}`;
    const ownerId = `user-${authUser.id}`;

    const newOrg: Organization = {
      id: orgId,
      name: authUser.projectName,
      ownerName: authUser.ownerName,
      phone: authUser.phone,
      whatsapp: authUser.phone,
      address: 'الفرع الرئيسي',
      description: 'محل قات وخدمات عملاء',
      currency: 'YER',
      currencyDecimals: 0,
      numberLocale: 'en-US',
      dateFormat: 'YYYY-MM-DD',
      invoiceHeader: authUser.projectName,
      invoiceFooter: 'شكراً لتعاملكم معنا',
      autoLockMinutes: 15,
      activeBranchId: branchId,
      branches: [
        {
          id: branchId,
          name: 'الفرع الرئيسي',
          address: '',
          phone: authUser.phone,
          isMain: true,
        },
      ],
      subscriptionPlan: 'pro',
      subscriptionStatus: 'active',
      subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      maxUsers: 10,
      maxDevices: 5,
      orgAuthSecret: generateTenantSecret(),
      createdAt: now,
      updatedAt: now,
    };

    const ownerUser: AppUser = {
      id: ownerId,
      orgId,
      branchId,
      name: authUser.ownerName,
      role: 'owner',
      hasPin: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await db.transaction('rw', [db.organizations, db.users, db.messageTemplates], async () => {
      await db.organizations.put(newOrg);
      await db.users.put(ownerUser);
      await db.messageTemplates.bulkPut(buildDefaultTemplates(orgId));
    });
    await setMeta('activeUserId', ownerId);
  }

  await setMeta('activeOrgId', orgId);

  // Pull any existing customers from Railway PostgreSQL for this project
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    const remoteCustomers = await fetchRemoteCustomers();
    if (remoteCustomers.length > 0) {
      const org = await db.organizations.get(orgId);
      const branchId = org?.activeBranchId || 'branch-main';
      const deviceId = await getOrCreateDeviceId();
      const existingLocal = await db.customers.where('orgId').equals(orgId).toArray();
      const existingPhones = new Set(existingLocal.map((c) => c.phone));

      const toInsert: Customer[] = [];
      for (const rc of remoteCustomers) {
        if (existingPhones.has(rc.phone)) continue;
        const cat: CustomerCategory =
          rc.category === 'vip' || rc.category === 'wholesale' ? rc.category : 'regular';
        toInsert.push({
          id: rc.id,
          orgId,
          branchId,
          fullName: rc.fullName,
          phone: rc.phone,
          whatsapp: rc.phone,
          address: rc.address || '',
          category: cat,
          creditLimit: Number(rc.creditLimit || 0) || 0,
          status: rc.status === 'inactive' ? 'inactive' : 'active',
          marketingOptOut: false,
          notes: rc.notes || '',
          cachedBalance: Number(rc.balance || 0) || 0,
          cachedTotalPurchases: 0,
          cachedTotalPaid: 0,
          purchaseCount: 0,
          createdAt: rc.createdAt || now,
          updatedAt: rc.updatedAt || now,
          createdBy: `user-${authUser.id}`,
          deviceId,
          syncStatus: 'synced',
        });
      }
      if (toInsert.length > 0) {
        await db.customers.bulkPut(toInsert);
      }
    }
  }

  return orgId;
}

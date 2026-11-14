import * as XLSX from 'xlsx';
import { db } from '../db/qatshiDb';
import { roundMoney, toLocalDateKey } from '../domain/money';
import {
  hasPermission,
  type AppUser,
  type Customer,
  type CustomerCategory,
  type LedgerEntry,
  type Organization,
} from '../domain/types';
import { buildCleanExportFileName } from '../domain/formatters';
import { allocateNextDocumentNumber, generateUuid, getOrCreateDeviceId, runSafeDbWrite } from './device';

export async function saveCustomer(params: {
  org: Organization;
  user: AppUser;
  customerId?: string;
  fullName: string;
  phone: string;
  whatsapp?: string;
  address: string;
  category: CustomerCategory;
  creditLimit: number;
  status: 'active' | 'inactive';
  marketingOptOut: boolean;
  notes: string;
  openingBalance?: number;
}): Promise<Customer> {
  if (!hasPermission(params.user.role, 'manage_customers')) {
    throw new Error('صلاحيتك لا تسمح بإدارة أو تعديل بيانات العملاء');
  }
  if (!params.fullName.trim()) throw new Error('الاسم الكامل للعميل مطلوب');
  if (!params.phone.trim()) throw new Error('رقم الهاتف مطلوب');

  const deviceId = await getOrCreateDeviceId();

  return runSafeDbWrite(() =>
    db.transaction(
      'rw',
      [db.customers, db.ledgerEntries, db.kvMeta, db.syncOperations, db.auditLogs],
      async () => {
        const now = new Date().toISOString();
        const existing = params.customerId ? await db.customers.get(params.customerId) : undefined;
        if (existing && existing.orgId !== params.org.id) {
          throw new Error('لا يمكن تعديل عميل تابع لمؤسسة أخرى');
        }

        const openingAmount =
          !existing && params.openingBalance && params.openingBalance > 0
            ? roundMoney(params.openingBalance, params.org.currencyDecimals)
            : 0;

        const record: Customer = existing
          ? {
              ...existing,
              fullName: params.fullName.trim(),
              phone: params.phone.trim(),
              whatsapp: params.whatsapp?.trim() || params.phone.trim(),
              address: params.address.trim(),
              category: params.category,
              creditLimit: Math.max(0, params.creditLimit || 0),
              status: params.status,
              marketingOptOut: params.marketingOptOut,
              notes: params.notes.trim(),
              updatedAt: now,
              syncStatus: 'pending',
            }
          : {
              id: generateUuid(),
              orgId: params.org.id,
              branchId: params.org.activeBranchId,
              fullName: params.fullName.trim(),
              phone: params.phone.trim(),
              whatsapp: params.whatsapp?.trim() || params.phone.trim(),
              address: params.address.trim(),
              category: params.category,
              creditLimit: Math.max(0, params.creditLimit || 0),
              status: params.status,
              marketingOptOut: params.marketingOptOut,
              notes: params.notes.trim(),
              cachedBalance: openingAmount,
              cachedTotalPurchases: 0,
              cachedTotalPaid: 0,
              purchaseCount: 0,
              createdAt: now,
              updatedAt: now,
              createdBy: params.user.id,
              deviceId,
              syncStatus: 'pending',
            };

        await db.customers.put(record);

        if (openingAmount > 0) {
          const branchIndex = Math.max(
            1,
            params.org.branches.findIndex((b) => b.id === params.org.activeBranchId) + 1
          );
          const openCount = await db.ledgerEntries.where('orgId').equals(params.org.id).count();
          const openRef = await allocateNextDocumentNumber(
            params.org.id,
            'OPEN',
            openCount,
            deviceId,
            params.org.activeBranchId,
            branchIndex
          );
          const openEntry: LedgerEntry = {
            id: generateUuid(),
            orgId: params.org.id,
            branchId: params.org.activeBranchId,
            customerId: record.id,
            refType: 'opening_balance',
            refId: record.id,
            refNumber: openRef,
            description: 'رصيد افتتاحي مرحّل عند تأسيس ملف العميل',
            debit: openingAmount,
            credit: 0,
            cashIn: 0,
            discountAmount: 0,
            createdAt: now,
            createdBy: params.user.id,
            createdByName: params.user.name,
            deviceId,
            idempotencyKey: `open-${record.id}`,
            syncStatus: 'pending',
          };
          await db.ledgerEntries.put(openEntry);

          await db.syncOperations.put({
            id: generateUuid(),
            orgId: params.org.id,
            deviceId,
            entityType: 'ledger',
            entityId: openEntry.id,
            action: 'create',
            payload: openEntry,
            idempotencyKey: `open-sync-${record.id}`,
            status: 'pending',
            createdAt: now,
          });
        }

        await db.syncOperations.put({
          id: generateUuid(),
          orgId: params.org.id,
          deviceId,
          entityType: 'customer',
          entityId: record.id,
          action: existing ? 'update' : 'create',
          payload: record,
          idempotencyKey: `cust-${record.id}-${now}`,
          status: 'pending',
          createdAt: now,
        });

        await db.auditLogs.put({
          id: generateUuid(),
          orgId: params.org.id,
          userId: params.user.id,
          userName: params.user.name,
          action: existing ? 'update' : 'create',
          entityType: 'customer',
          entityId: record.id,
          summary: `${existing ? 'تحديث' : 'إضافة'} عميل: ${record.fullName}${openingAmount > 0 ? ` (رصيد افتتاحي ${openingAmount})` : ''}`,
          deviceId,
          createdAt: now,
        });

        return record;
      }
    )
  );
}

export function exportCustomersToWorkbook(customers: Customer[], format: 'xlsx' | 'csv'): void {
  const rows = customers.map((c) => ({
    'الاسم الكامل': c.fullName,
    'رقم الهاتف': c.phone,
    'رقم واتساب': c.whatsapp || c.phone,
    'العنوان / المنطقة': c.address,
    'التصنيف': c.category === 'vip' ? 'مميز' : c.category === 'wholesale' ? 'جملة' : 'عادي',
    'الحد الائتماني': c.creditLimit,
    'المديونية الحالية': c.cachedBalance,
    'إجمالي المشتريات': c.cachedTotalPurchases,
    'إجمالي المدفوعات': c.cachedTotalPaid,
    'الحالة': c.status === 'active' ? 'نشط' : 'غير نشط',
    'ملاحظات': c.notes,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'العملاء');
  const fileName = buildCleanExportFileName(['قائمة-العملاء', toLocalDateKey()], format);
  XLSX.writeFile(wb, fileName, { bookType: format });
}

export async function importCustomersFromFile(params: {
  file: File;
  org: Organization;
  user: AppUser;
}): Promise<{ imported: number; skipped: number }> {
  const buffer = await params.file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('الملف لا يحتوي على أوراق بيانات');

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
  const existingPhones = new Set<string>();
  const existingBatch = await db.customers.where('orgId').equals(params.org.id).toArray();
  for (const c of existingBatch) existingPhones.add(c.phone.trim());

  let imported = 0;
  let skipped = 0;

  for (const row of rawRows) {
    const fullName = String(
      row['الاسم الكامل'] || row['الاسم'] || row['fullName'] || row['name'] || ''
    ).trim();
    const phone = String(
      row['رقم الهاتف'] || row['الهاتف'] || row['phone'] || ''
    ).trim();

    if (!fullName || !phone || existingPhones.has(phone)) {
      skipped++;
      continue;
    }

    const catRaw = String(row['التصنيف'] || row['category'] || '');
    const category: CustomerCategory =
      catRaw.includes('مميز') || catRaw.toLowerCase() === 'vip'
        ? 'vip'
        : catRaw.includes('جملة') || catRaw.toLowerCase() === 'wholesale'
        ? 'wholesale'
        : 'regular';

    const openingRaw = Number(row['المديونية الحالية'] || row['الرصيد الافتتاحي'] || row['openingBalance'] || 0) || 0;

    await saveCustomer({
      org: params.org,
      user: params.user,
      fullName,
      phone,
      whatsapp: String(row['رقم واتساب'] || row['whatsapp'] || phone).trim(),
      address: String(row['العنوان / المنطقة'] || row['العنوان'] || row['address'] || '').trim(),
      category,
      creditLimit: Number(row['الحد الائتماني'] || row['creditLimit'] || 0) || 0,
      status: 'active',
      marketingOptOut: false,
      notes: String(row['ملاحظات'] || row['notes'] || '').trim(),
      openingBalance: openingRaw > 0 ? openingRaw : undefined,
    });

    existingPhones.add(phone);
    imported++;
  }

  return { imported, skipped };
}

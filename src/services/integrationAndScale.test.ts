import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { db } from '../db/qatshiDb';
import { computeCustomerLedgerStatement, computeDailyCloseSummary } from '../domain/accounting';
import { toLocalDateKey } from '../domain/money';
import type { AppUser, Customer, LedgerEntry, Organization } from '../domain/types';
import {
  createAdjustmentTransaction,
  createExpenseTransaction,
  createPaymentTransaction,
  createSaleTransaction,
  queryCustomerFinancialProfile,
  reverseExpenseTransaction,
  reversePaymentTransaction,
  reverseSaleTransaction,
  saveCashboxSession,
  verifyAndRepairLedgerIntegrity,
} from './accountingService';
import {
  CURRENT_BACKUP_SCHEMA_VERSION,
  createOrganizationBackup,
  migrateBackupPayload,
  parseAndVerifyBackupFile,
  restoreBackupPayload,
} from './backupService';
import { saveCustomer } from './customerService';
import { generateTenantSecret, generateUuid } from './device';
import { auditAndCleanProvenDemoData, DEMO_ORG_ID } from './dataCleanupService';
import {
  confirmManualSmsOutcome,
  deleteMessageTemplate,
  dispatchSmsViaDeviceSim,
  getOrCreateMessagingConfig,
  prepareConfirmedSmsBatch,
  saveMessageTemplate,
} from './messagingService';
import type { SmsBridgeAdapter } from './nativeSmsBridge';
import { resolveInitialOrganizationId } from './seedService';

async function resetDb() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

function makeOrg(id = 'org-test-1'): Organization {
  const now = new Date().toISOString();
  return {
    id,
    name: 'محل قاتشي التجاري الاختباري',
    ownerName: 'أحمد المالك',
    phone: '777100200',
    whatsapp: '777100200',
    address: 'صنعاء',
    description: 'محل قات تجاري',
    currency: 'YER',
    currencyDecimals: 0,
    numberLocale: 'en-US',
    dateFormat: 'YYYY-MM-DD',
    invoiceHeader: 'فاتورة رسمية',
    invoiceFooter: 'شكراً لتعاملكم',
    autoLockMinutes: 0,
    subscriptionPlan: 'pro',
    subscriptionStatus: 'active',
    subscriptionExpiry: '2028-01-01',
    maxUsers: 10,
    maxDevices: 5,
    branches: [{ id: 'branch-main', name: 'الرئيسي', address: 'صنعاء', phone: '777100200', isMain: true }],
    activeBranchId: 'branch-main',
    orgAuthSecret: generateTenantSecret(),
    createdAt: now,
    updatedAt: now,
  };
}

function makeUser(orgId: string, role: AppUser['role'], id = `user-${role}`): AppUser {
  const now = new Date().toISOString();
  return {
    id,
    orgId,
    branchId: 'branch-main',
    name: `موظف ${role}`,
    role,
    hasPin: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

test('Integration 1: Full accounting lifecycle, RBAC, cashbox locks, reversals, adjustments & idempotency', async () => {
  await resetDb();
  const org = makeOrg();
  const owner = makeUser(org.id, 'owner');
  const cashier = makeUser(org.id, 'cashier');
  await db.organizations.put(org);
  await db.users.bulkPut([owner, cashier]);

  // 1. Customer with opening balance
  const cust = await saveCustomer({
    org,
    user: owner,
    fullName: 'عبدالله الصلاحي',
    phone: '777555111',
    address: 'السبعين',
    category: 'vip',
    creditLimit: 50000,
    status: 'active',
    marketingOptOut: false,
    notes: '',
    openingBalance: 10000,
  });
  assert.equal(cust.cachedBalance, 10000);

  // Verify opening_balance entry exists in ledger
  const afterOpen = await queryCustomerFinancialProfile(org.id, cust.id);
  assert.equal(afterOpen.entries.length, 1);
  assert.equal(afterOpen.entries[0].refType, 'opening_balance');
  assert.equal(afterOpen.entries[0].debit, 10000);

  // 2. Partial sale & credit sale
  const sale1 = await createSaleTransaction({
    org,
    user: cashier,
    customerId: cust.id,
    items: [
      {
        productId: 'p1',
        productName: 'قات ولعة',
        grade: 'أولى',
        unitName: 'ربطة',
        quantity: 2,
        unitPrice: 12000,
        costPrice: 8000,
      },
    ],
    discount: 2000, // subtotal 24000 -> total 22000
    paymentMode: 'partial',
    paidAmount: 7000,
    paymentMethod: 'cash',
    notes: '',
    idempotencyKey: 'sale-1-idem',
  });
  assert.equal(sale1.total, 22000);
  assert.equal(sale1.remainingAmount, 15000);

  // Idempotent replay must return identical sale without adding duplicate ledger entries
  const sale1Replay = await createSaleTransaction({
    org,
    user: cashier,
    customerId: cust.id,
    items: [
      {
        productId: 'p1',
        productName: 'قات ولعة',
        grade: 'أولى',
        unitName: 'ربطة',
        quantity: 2,
        unitPrice: 12000,
      },
    ],
    discount: 2000,
    paymentMode: 'partial',
    paidAmount: 7000,
    paymentMethod: 'cash',
    notes: '',
    idempotencyKey: 'sale-1-idem',
  });
  assert.equal(sale1Replay.id, sale1.id);

  // Balance should be 10000 + 15000 = 25000
  let custNow = await db.customers.get(cust.id);
  assert.equal(custNow?.cachedBalance, 25000);

  // 3. Credit limit guard (limit 50,000; balance 25,000 -> adding 30,000 credit fails without override)
  await assert.rejects(
    () =>
      createSaleTransaction({
        org,
        user: cashier,
        customerId: cust.id,
        items: [
          {
            productId: 'p1',
            productName: 'قات ولعة',
            grade: 'أولى',
            unitName: 'ربطة',
            quantity: 1,
            unitPrice: 30000,
          },
        ],
        discount: 0,
        paymentMode: 'credit',
        paidAmount: 0,
        paymentMethod: 'cash',
        notes: '',
        idempotencyKey: 'sale-2-blocked',
      }),
    /CREDIT_LIMIT_EXCEEDED/
  );

  // Override allowed
  const sale2 = await createSaleTransaction({
    org,
    user: owner,
    customerId: cust.id,
    items: [
      {
        productId: 'p1',
        productName: 'قات ولعة',
        grade: 'أولى',
        unitName: 'ربطة',
        quantity: 1,
        unitPrice: 30000,
      },
    ],
    discount: 0,
    paymentMode: 'credit',
    paidAmount: 0,
    paymentMethod: 'cash',
    notes: '',
    idempotencyKey: 'sale-2-override',
    allowCreditLimitOverride: true,
  });
  // Balance = 25000 + 30000 = 55000
  custNow = await db.customers.get(cust.id);
  assert.equal(custNow?.cachedBalance, 55000);
  assert.equal(custNow?.purchaseCount, 2);

  // 4. FIFO Payment across invoices (20,000 -> clears sale1 15,000 + 5,000 of sale2)
  const pay1 = await createPaymentTransaction({
    org,
    user: cashier,
    customerId: cust.id,
    amount: 20000,
    paymentMethod: 'cash',
    allocationMode: 'auto',
    notes: 'دفعة أولى',
    idempotencyKey: 'pay-1-idem',
  });
  assert.equal(pay1.allocations.length, 2);
  assert.equal(pay1.allocations[0].saleId, sale1.id);
  assert.equal(pay1.allocations[0].amount, 15000);
  assert.equal(pay1.allocations[1].saleId, sale2.id);
  assert.equal(pay1.allocations[1].amount, 5000);

  // Balance = 35000
  custNow = await db.customers.get(cust.id);
  assert.equal(custNow?.cachedBalance, 35000);

  // 5. Overpayment rejected without flag, allowed with allowExcessCredit
  await assert.rejects(
    () =>
      createPaymentTransaction({
        org,
        user: cashier,
        customerId: cust.id,
        amount: 40000,
        paymentMethod: 'cash',
        allocationMode: 'auto',
        notes: '',
        idempotencyKey: 'pay-over-reject',
      }),
    /يتجاوز إجمالي المديونية/
  );

  // 6. Credit adjustment (return / إشعار دائن) of 5,000 -> balance becomes 30,000
  // Cashier is blocked by service-layer RBAC
  await assert.rejects(
    () =>
      createAdjustmentTransaction({
        org,
        user: cashier,
        customerId: cust.id,
        direction: 'credit',
        amount: 5000,
        reason: 'مرتجع',
        idempotencyKey: 'adj-cashier-denied',
      }),
    /صلاحيتك/
  );

  await createAdjustmentTransaction({
    org,
    user: owner,
    customerId: cust.id,
    direction: 'credit',
    amount: 5000,
    reason: 'مرتجع جزء تالف',
    idempotencyKey: 'adj-1-idem',
  });
  custNow = await db.customers.get(cust.id);
  assert.equal(custNow?.cachedBalance, 30000);

  // 7. Reversing sale1 while pay1 is allocated to it MUST fail
  await assert.rejects(
    () => reverseSaleTransaction({ org, user: owner, saleId: sale1.id, reason: 'خطأ' }),
    /سند سداد نشط مرتبط بها/
  );

  // Cashier cannot reverse payment or sale
  await assert.rejects(
    () => reversePaymentTransaction({ org, user: cashier, paymentId: pay1.id, reason: 'اختبار' }),
    /صلاحيتك/
  );

  // Reverse pay1 -> balance goes back from 30,000 to 50,000; then reverse sale1 -> net -15,000 -> 35,000
  await reversePaymentTransaction({ org, user: owner, paymentId: pay1.id, reason: 'خطأ في السند' });
  await reverseSaleTransaction({ org, user: owner, saleId: sale1.id, reason: 'إلغاء الفاتورة 1' });
  custNow = await db.customers.get(cust.id);
  assert.equal(custNow?.cachedBalance, 35000);
  assert.equal(custNow?.purchaseCount, 1); // Only sale2 active

  // Statement balance matches cachedBalance
  const prof = await queryCustomerFinancialProfile(org.id, cust.id);
  const stmt = computeCustomerLedgerStatement(prof.entries, undefined, undefined, org.currencyDecimals);
  assert.equal(stmt.closingBalance, 35000);

  // 8. Expense + Daily Close Summary (verify old debt collections not counted as sales)
  const pay2 = await createPaymentTransaction({
    org,
    user: owner,
    customerId: cust.id,
    amount: 10000,
    paymentMethod: 'cash',
    allocationMode: 'auto',
    notes: 'تحصيل',
    idempotencyKey: 'pay-2-idem',
  });
  const todayKey = toLocalDateKey();
  const exp1 = await createExpenseTransaction({
    org,
    user: owner,
    title: 'نقل قات',
    amount: 3000,
    category: 'تشغيل ونقل',
    date: todayKey,
    paymentMethod: 'cash',
    notes: '',
    idempotencyKey: 'exp-1-idem',
  });

  const activeSales = (await db.sales.where('orgId').equals(org.id).toArray()).filter((s) => s.status === 'active');
  const activePays = (await db.payments.where('orgId').equals(org.id).toArray()).filter((p) => p.status === 'active');
  const activeExps = (await db.expenses.where('orgId').equals(org.id).toArray()).filter((e) => e.status === 'active');
  const daily = computeDailyCloseSummary({
    daySales: activeSales,
    dayPayments: activePays,
    dayExpenses: activeExps,
    openingBalance: 5000,
    decimals: 0,
  });
  assert.equal(daily.totalSales, 30000); // only sale2
  assert.equal(daily.cashSalesReceipts, 0);
  assert.equal(daily.oldDebtCollections, 10000); // pay2
  assert.equal(daily.totalExpenses, 3000);
  assert.equal(daily.expectedClosingBalance, 12000); // 5000 + 10000 - 3000

  // 9. Close cashbox -> blocks new sales, payments, adjustments, expenses & reversals
  await saveCashboxSession({
    org,
    user: owner,
    date: todayKey,
    openingBalance: 5000,
    closingBalance: daily.expectedClosingBalance,
    status: 'closed',
    notes: 'إقفال',
  });

  await assert.rejects(
    () =>
      createSaleTransaction({
        org,
        user: owner,
        items: [
          {
            productId: 'p1',
            productName: 'قات',
            grade: 'أولى',
            unitName: 'ربطة',
            quantity: 1,
            unitPrice: 5000,
          },
        ],
        discount: 0,
        paymentMode: 'cash',
        paidAmount: 5000,
        paymentMethod: 'cash',
        notes: '',
        idempotencyKey: 'sale-after-close',
      }),
    /تم إقفال صندوق يوم/
  );
  await assert.rejects(
    () => reverseExpenseTransaction({ org, user: owner, expenseId: exp1.id }),
    /تم إقفال صندوق يوم/
  );

  // Cashier blocked from reopening closed cashbox
  await assert.rejects(
    () =>
      saveCashboxSession({
        org,
        user: cashier,
        date: todayKey,
        openingBalance: 5000,
        status: 'open',
        notes: '',
      }),
    /صلاحيتك|للمالك أو المدير/
  );

  // Owner reopens -> payment allowed again
  await saveCashboxSession({
    org,
    user: owner,
    date: todayKey,
    openingBalance: 5000,
    status: 'open',
    notes: 'إعادة فتح',
  });
  assert.ok(pay2.id);

  // 10. Integrity repair heals corrupted cache
  await db.customers.update(cust.id, { cachedBalance: 999999 });
  const repairRes = await verifyAndRepairLedgerIntegrity(org.id, 0);
  assert.equal(repairRes.repairedCount, 1);
  assert.equal(repairRes.discrepancies[0].cached, 999999);
  assert.equal(repairRes.discrepancies[0].ledger, 25000);
});

test('Integration 2: Encrypted & unencrypted backup/restore, checksum tamper detection & schema migration', async () => {
  await resetDb();
  const org = makeOrg('org-bak-1');
  const owner = makeUser(org.id, 'owner');
  await db.organizations.put(org);
  await db.users.put(owner);

  const cust = await saveCustomer({
    org,
    user: owner,
    fullName: 'صادق الحميري',
    phone: '777222333',
    address: 'عدن',
    category: 'regular',
    creditLimit: 30000,
    status: 'active',
    marketingOptOut: false,
    notes: '',
    openingBalance: 14500,
  });

  // Encrypted backup
  const encBak = await createOrganizationBackup({ orgId: org.id, password: 'StrongPassword!99' });
  assert.equal(encBak.record.encrypted, true);

  // Wrong password fails
  await assert.rejects(
    () =>
      parseAndVerifyBackupFile({
        rawText: encBak.fileContent,
        password: 'WrongPassword',
        currentOrgId: org.id,
        allowCrossOrgRestore: false,
      }),
    /غير صحيحة/
  );

  // Plain backup + checksum tamper check
  const plainBak = await createOrganizationBackup({ orgId: org.id });
  const tampered = JSON.parse(plainBak.fileContent) as { data: { customers: Customer[] } };
  tampered.data.customers[0].cachedBalance = 0;
  await assert.rejects(
    () =>
      parseAndVerifyBackupFile({
        rawText: JSON.stringify(tampered),
        currentOrgId: org.id,
        allowCrossOrgRestore: false,
      }),
    /فشل التحقق من سلامة النسخة/
  );

  // Cross-org block without explicit flag
  await assert.rejects(
    () =>
      parseAndVerifyBackupFile({
        rawText: encBak.fileContent,
        password: 'StrongPassword!99',
        currentOrgId: 'other-org',
        allowCrossOrgRestore: false,
      }),
    /CROSS_ORG_MISMATCH/
  );

  // Wipe DB and restore encrypted backup cleanly
  await resetDb();
  const verified = await parseAndVerifyBackupFile({
    rawText: encBak.fileContent,
    password: 'StrongPassword!99',
    currentOrgId: org.id,
    allowCrossOrgRestore: false,
  });
  await restoreBackupPayload(verified.payload);

  const restoredCust = await db.customers.get(cust.id);
  assert.equal(restoredCust?.cachedBalance, 14500);
  const restoredOrg = await db.organizations.get(org.id);
  assert.equal(restoredOrg?.name, org.name);

  // Migrate v1 payload missing orgAuthSecret
  const v1Raw = JSON.parse(plainBak.fileContent) as ReturnType<typeof migrateBackupPayload>;
  v1Raw.schemaVersion = 1;
  delete (v1Raw.data.organization as { orgAuthSecret?: string }).orgAuthSecret;
  const migrated = migrateBackupPayload(v1Raw);
  assert.equal(migrated.schemaVersion, CURRENT_BACKUP_SCHEMA_VERSION);
  assert.ok((migrated.data.organization as Organization).orgAuthSecret);
});

test('Integration 3: Native SIM SMS lifecycle, 6 statuses, unknown no-auto-retry, web fallback & templates CRUD', async () => {
  await resetDb();
  const org = makeOrg('org-msg-1');
  const owner = makeUser(org.id, 'owner');
  await db.organizations.put(org);
  await db.users.put(owner);
  await getOrCreateMessagingConfig(org.id);

  const custOk = await saveCustomer({
    org,
    user: owner,
    fullName: 'عميل موافق',
    phone: '777000001',
    address: '',
    category: 'vip',
    creditLimit: 10000,
    status: 'active',
    marketingOptOut: false,
    notes: '',
  });
  const custOptOut = await saveCustomer({
    org,
    user: owner,
    fullName: 'عميل مستبعد تسويقياً',
    phone: '777000002',
    address: '',
    category: 'vip',
    creditLimit: 10000,
    status: 'active',
    marketingOptOut: true,
    notes: '',
  });
  const custUnselected = await saveCustomer({
    org,
    user: owner,
    fullName: 'عميل غير محدد',
    phone: '777000003',
    address: '',
    category: 'vip',
    creditLimit: 10000,
    status: 'active',
    marketingOptOut: false,
    notes: '',
  });

  // 1. Confirmed-only recipient selection + marketing opt-out exclusion
  const batch = await prepareConfirmedSmsBatch({
    org,
    user: owner,
    title: 'دفعة ترويجية SMS',
    bodyTemplate: 'أهلاً {customer_name} من {shop_name}',
    confirmedCustomerIds: [custOk.id, custOptOut.id],
    isMarketingMessage: true,
    simSlot: 0,
    subscriptionId: 11,
  });
  assert.equal(batch.logs.length, 1);
  assert.equal(batch.logs[0].customerId, custOk.id);
  assert.equal(batch.logs[0].channel, 'sms');
  assert.equal(batch.logs[0].status, 'pending');
  assert.equal(batch.logs[0].encoding, 'UCS-2');
  assert.equal(batch.excludedOptOutCount, 1);
  assert.ok(custUnselected.id);

  // 2. Native Android SIM mock dispatch -> sent_to_network (distinct from delivered)
  const nativeBridge: SmsBridgeAdapter = {
    async getEnvironmentStatus() {
      return {
        isNativeAndroid: true,
        platform: 'android',
        sendSmsGranted: true,
        readPhoneStateGranted: true,
        hasTelephonyHardware: true,
        airplaneModeOn: false,
        hasCellularSignal: true,
        sims: [{ subscriptionId: 11, slotIndex: 0, displayName: 'SIM 1', carrierName: 'Yemen Mobile' }],
        playStorePolicyNote: '',
      };
    },
    async requestPermissions() {
      return { sendSmsGranted: true, readPhoneStateGranted: true };
    },
    async pickDeviceContact() {
      return null;
    },
    async sendSmsViaSim() {
      return {
        status: 'sent_to_network',
        simSlot: 0,
        subscriptionId: 11,
        carrierName: 'Yemen Mobile',
        partsCount: 1,
        encoding: 'UCS-2',
        sentAt: new Date().toISOString(),
      };
    },
  };

  const sentToNet = await dispatchSmsViaDeviceSim({
    logId: batch.logs[0].id,
    bridge: nativeBridge,
  });
  assert.equal(sentToNet.status, 'sent_to_network');
  assert.equal(sentToNet.carrierName, 'Yemen Mobile');
  assert.equal(sentToNet.attemptCount, 1);
  assert.equal(sentToNet.deliveredAt, undefined);

  // Idempotent dispatch guard: already sent_to_network will NOT double-send
  const idempRetry = await dispatchSmsViaDeviceSim({
    logId: batch.logs[0].id,
    bridge: nativeBridge,
  });
  assert.equal(idempRetry.attemptCount, 1);

  // 3. Unknown outcome from SIM bridge blocks auto-retry unless explicitly approved
  const batchUnknown = await prepareConfirmedSmsBatch({
    org,
    user: owner,
    title: 'دفعة غير مؤكدة',
    bodyTemplate: 'تذكير رصيد {customer_name}',
    confirmedCustomerIds: [custOk.id],
    isMarketingMessage: false,
  });
  const throwingBridge: SmsBridgeAdapter = {
    ...nativeBridge,
    async sendSmsViaSim() {
      throw new Error('Broadcast timeout');
    },
  };
  const unknownRes = await dispatchSmsViaDeviceSim({
    logId: batchUnknown.logs[0].id,
    bridge: throwingBridge,
  });
  assert.equal(unknownRes.status, 'unknown');

  await assert.rejects(
    () => dispatchSmsViaDeviceSim({ logId: unknownRes.id, bridge: nativeBridge }),
    /نتيجة هذه الرسالة غير محققة/
  );

  // Explicit owner review resend works
  const explicitResend = await dispatchSmsViaDeviceSim({
    logId: unknownRes.id,
    bridge: nativeBridge,
    explicitResendUnknown: true,
  });
  assert.equal(explicitResend.status, 'sent_to_network');

  // 4. Web fallback stays pending until owner confirms manually
  const webBatch = await prepareConfirmedSmsBatch({
    org,
    user: owner,
    title: 'تأكيد يدوي بالمتصفح',
    bodyTemplate: 'مرحباً {customer_name}',
    confirmedCustomerIds: [custOk.id],
    isMarketingMessage: false,
  });
  const webBridge: SmsBridgeAdapter = {
    ...nativeBridge,
    async getEnvironmentStatus() {
      return {
        isNativeAndroid: false,
        platform: 'web',
        sendSmsGranted: false,
        readPhoneStateGranted: false,
        hasTelephonyHardware: false,
        airplaneModeOn: false,
        hasCellularSignal: false,
        sims: [],
        unsupportedReason: 'Browser cannot access SIM',
        playStorePolicyNote: '',
      };
    },
  };
  const webDispatched = await dispatchSmsViaDeviceSim({
    logId: webBatch.logs[0].id,
    bridge: webBridge,
  });
  assert.equal(webDispatched.status, 'pending');
  assert.equal(webDispatched.dispatchMethod, 'device_intent_fallback');

  const manuallyDelivered = await confirmManualSmsOutcome(webDispatched.id, 'delivered');
  assert.equal(manuallyDelivered?.status, 'delivered');
  assert.ok(manuallyDelivered?.deliveredAt);

  // 5. Local SMS Templates CRUD
  const createdTpl = await saveMessageTemplate(org.id, {
    name: 'تذكير خاص',
    category: 'debt',
    body: 'يرجى سداد {customer_balance}',
    isDefault: false,
  });
  const updatedTpl = await saveMessageTemplate(org.id, {
    id: createdTpl.id,
    name: 'تذكير خاص محدث',
    category: 'debt',
    body: 'تم التحديث: {customer_balance}',
    isDefault: false,
  });
  assert.equal(updatedTpl.id, createdTpl.id);
  assert.equal(updatedTpl.name, 'تذكير خاص محدث');
  await deleteMessageTemplate(createdTpl.id);
  assert.equal(await db.messageTemplates.get(createdTpl.id), undefined);
});

test('Integration 4: Multi-tenant Express server auth isolation, conflict detection, pull & SSRF defense', async (t) => {
  const tempStoreFile = path.join(os.tmpdir(), `qatshi-test-store-${generateUuid()}.json`);
  process.env.QATSHI_TEST_NO_LISTEN = '1';
  process.env.QATSHI_SYNC_STORE_FILE = tempStoreFile;

  t.after(async () => {
    delete process.env.QATSHI_SYNC_STORE_FILE;
    await fs.rm(tempStoreFile, { force: true });
  });

  const { createQatshiApp } = await import('../../server');
  const app = createQatshiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const orgASecret = 'org-a-secret-123456';
  const orgBSecret = 'org-b-secret-654321';

  // 1. Missing secret -> 401
  const noAuthRes = await fetch(`${baseUrl}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: 'org-A', operations: [] }),
  });
  assert.equal(noAuthRes.status, 401);

  // 2. Push Org A from Device 1
  const push1 = await fetch(`${baseUrl}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-secret': orgASecret },
    body: JSON.stringify({
      orgId: 'org-A',
      operations: [
        {
          id: 'op-1',
          orgId: 'org-A',
          deviceId: 'DEV-1',
          entityType: 'sale',
          entityId: 'sale-100',
          action: 'create',
          payload: { total: 5000 },
          idempotencyKey: 'idem-op-1',
          createdAt: '2026-06-01T10:00:00.000Z',
        },
      ],
    }),
  });
  assert.equal(push1.status, 200);
  const push1Json = (await push1.json()) as {
    results: Array<{ status: string; serverRevision?: number }>;
  };
  assert.equal(push1Json.results[0].status, 'synced');
  assert.equal(push1Json.results[0].serverRevision, 1);

  // 3. Cross-tenant access to Org A with Org B secret -> 403
  const wrongTenantPull = await fetch(
    `${baseUrl}/api/sync/pull?orgId=org-A&sinceRevision=0&deviceId=DEV-2`,
    { headers: { 'x-org-secret': orgBSecret } }
  );
  assert.equal(wrongTenantPull.status, 403);

  // 4. Device 2 pulls Org A changes with Org A secret -> receives op-1
  const dev2Pull = await fetch(
    `${baseUrl}/api/sync/pull?orgId=org-A&sinceRevision=0&deviceId=DEV-2`,
    { headers: { 'x-org-secret': orgASecret } }
  );
  assert.equal(dev2Pull.status, 200);
  const pullJson = (await dev2Pull.json()) as { latestRevision: number; operations: Array<{ id: string }> };
  assert.equal(pullJson.latestRevision, 1);
  assert.equal(pullJson.operations.length, 1);
  assert.equal(pullJson.operations[0].id, 'op-1');

  // 5. Duplicate idempotencyKey -> 'duplicate'; different device updating stale entity -> 'conflict'
  const push2 = await fetch(`${baseUrl}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-secret': orgASecret },
    body: JSON.stringify({
      orgId: 'org-A',
      operations: [
        {
          id: 'op-1-dup',
          orgId: 'org-A',
          deviceId: 'DEV-1',
          entityType: 'sale',
          entityId: 'sale-100',
          action: 'create',
          payload: {},
          idempotencyKey: 'idem-op-1',
          createdAt: '2026-06-01T10:00:00.000Z',
        },
        {
          id: 'op-conflict',
          orgId: 'org-A',
          deviceId: 'DEV-2',
          entityType: 'sale',
          entityId: 'sale-100',
          action: 'update',
          payload: {},
          idempotencyKey: 'idem-op-conflict',
          baseRevision: 0,
          createdAt: '2026-06-01T10:01:00.000Z',
        },
      ],
    }),
  });
  const push2Json = (await push2.json()) as { results: Array<{ status: string }> };
  assert.equal(push2Json.results[0].status, 'duplicate');
  assert.equal(push2Json.results[1].status, 'conflict');

  // 6. Backup upload & cross-tenant isolation
  const bakUpload = await fetch(`${baseUrl}/api/backup/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-secret': orgASecret },
    body: JSON.stringify({ orgId: 'org-A', content: '{"ok":true}' }),
  });
  assert.equal(bakUpload.status, 200);

  const bakCrossRead = await fetch(`${baseUrl}/api/backup/latest?orgId=org-A`, {
    headers: { 'x-org-secret': orgBSecret },
  });
  assert.equal(bakCrossRead.status, 403);

  // 7. Verify legacy external messaging gateway route is completely removed
  const legacyMsgRes = await fetch(`${baseUrl}/api/messaging/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-secret': orgASecret },
    body: JSON.stringify({}),
  });
  assert.equal(legacyMsgRes.status, 404);
});

test('Integration 5: Extreme scale IndexedDB benchmark (5,000 customers & 100,000 ledger entries)', async () => {
  await resetDb();
  const org = makeOrg('org-scale-1');
  await db.organizations.put(org);

  const now = new Date().toISOString();
  const customersBatch: Customer[] = [];
  for (let i = 0; i < 5000; i++) {
    customersBatch.push({
      id: `cust-${i}`,
      orgId: org.id,
      branchId: 'branch-main',
      fullName: `عميل رقم ${i}`,
      phone: `77${String(i).padStart(7, '0')}`,
      address: 'صنعاء',
      category: i % 10 === 0 ? 'vip' : 'regular',
      creditLimit: 500000,
      status: 'active',
      marketingOptOut: false,
      notes: '',
      cachedBalance: 10000, // 20 entries * (1000 debit - 500 credit) = 10,000 per customer
      cachedTotalPurchases: 20000,
      cachedTotalPaid: 10000,
      purchaseCount: 10,
      createdAt: now,
      updatedAt: now,
      createdBy: 'owner',
      deviceId: 'DEV-SCALE',
      syncStatus: 'synced',
    });
  }

  const t0 = performance.now();
  await db.customers.bulkPut(customersBatch);

  const CHUNK_ENTRIES = 10000;
  let totalInserted = 0;
  let buffer: LedgerEntry[] = [];
  for (let c = 0; c < 5000; c++) {
    for (let j = 0; j < 20; j++) {
      const isSale = j % 2 === 0;
      const idx = c * 20 + j;
      buffer.push({
        id: `led-${idx}`,
        orgId: org.id,
        branchId: 'branch-main',
        customerId: `cust-${c}`,
        refType: isSale ? 'sale' : 'payment',
        refId: `ref-${idx}`,
        refNumber: `REF-${idx}`,
        description: isSale ? 'فاتورة بيع جملة' : 'سند قبض جزئي',
        debit: isSale ? 2000 : 0,
        credit: isSale ? 0 : 1000,
        cashIn: isSale ? 0 : 1000,
        discountAmount: 0,
        createdAt: `2026-05-${String((j % 28) + 1).padStart(2, '0')}T10:${String(j).padStart(2, '0')}:00.000Z`,
        createdBy: 'owner',
        createdByName: 'المالك',
        deviceId: 'DEV-SCALE',
        idempotencyKey: `scale-idem-${idx}`,
        syncStatus: 'synced',
      });
      if (buffer.length >= CHUNK_ENTRIES) {
        await db.ledgerEntries.bulkPut(buffer);
        totalInserted += buffer.length;
        buffer = [];
      }
    }
  }
  if (buffer.length > 0) {
    await db.ledgerEntries.bulkPut(buffer);
    totalInserted += buffer.length;
  }
  const writeMs = Math.round(performance.now() - t0);
  assert.equal(totalInserted, 100000);

  // Measure indexed single-customer profile lookup across 100,000 entries
  const tQuery = performance.now();
  const profile = await queryCustomerFinancialProfile(org.id, 'cust-4242');
  const stmt = computeCustomerLedgerStatement(profile.entries, undefined, undefined, 0);
  const queryMs = Math.round((performance.now() - tQuery) * 100) / 100;
  assert.equal(profile.entries.length, 20);
  assert.equal(stmt.closingBalance, 10000);

  // Measure paginated integrity scan across all 5,000 customers & 100,000 entries
  const tAudit = performance.now();
  const audit = await verifyAndRepairLedgerIntegrity(org.id, 0);
  const auditMs = Math.round(performance.now() - tAudit);
  assert.equal(audit.checkedCustomers, 5000);
  assert.equal(audit.repairedCount, 0);

  console.log(
    `[SCALE BENCHMARK] 5,000 customers + 100,000 ledger entries -> write: ${writeMs}ms | indexed customer statement: ${queryMs}ms | full paginated audit: ${auditMs}ms`
  );
});

test('Integration 6: Clean DB boots empty (no auto-seeding) & safe cleanup removes only proven demo fixtures', async () => {
  await resetDb();

  // 1. Clean database must resolve to null so SetupWizard launches instead of demo store
  const initialOrgId = await resolveInitialOrganizationId();
  assert.equal(initialOrgId, null);

  // 2. Populate legacy proven demo org/records + real org + ambiguous manual record inside demo org
  const legacyDemoOrg = makeOrg(DEMO_ORG_ID);
  const realOrg = makeOrg('org-real-customer');
  await db.organizations.bulkPut([legacyDemoOrg, realOrg]);

  const owner = makeUser(realOrg.id, 'owner', 'user-real-owner');
  await db.users.put(owner);

  const realCust = await saveCustomer({
    org: realOrg,
    user: owner,
    fullName: 'عميل حقيقي',
    phone: '777888999',
    address: '',
    category: 'regular',
    creditLimit: 50000,
    status: 'active',
    marketingOptOut: false,
    notes: '',
  });

  // Proven demo seed customer (exact ID + phone signature)
  await db.customers.put({
    ...realCust,
    id: 'cust-1',
    orgId: DEMO_ORG_ID,
    fullName: 'عميل تجريبي قديم',
    phone: '777210340',
  });

  // Ambiguous customer inside legacy demo org that does NOT match demo seed signature
  await db.customers.put({
    ...realCust,
    id: 'cust-manual-user',
    orgId: DEMO_ORG_ID,
    fullName: 'عميل مضاف يدوياً داخل المؤسسة القديمة',
    phone: '777123999',
  });

  const cleanupReport = await auditAndCleanProvenDemoData({ createSafetyBackup: true });

  // Proven seed cust-1 was deleted; safety backup was created; real + ambiguous records were preserved
  assert.ok(cleanupReport.preCleanupBackupCreated);
  assert.equal(await db.customers.get('cust-1'), undefined);
  assert.ok(await db.customers.get(realCust.id));
  assert.ok(await db.customers.get('cust-manual-user'));
  assert.equal(cleanupReport.ambiguousRecordsForReview.length, 1);
  assert.equal(cleanupReport.ambiguousRecordsForReview[0].id, 'cust-manual-user');
});

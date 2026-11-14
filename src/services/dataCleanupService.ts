import { db } from '../db/qatshiDb';
import { createOrganizationBackup } from './backupService';
import { getMeta, setMeta } from './device';

export const DEMO_ORG_ID = 'org-qatshi-flagship';

const DEMO_CUSTOMER_SIGNATURES = new Map<string, string>([
  ['cust-1', '777210340'],
  ['cust-2', '771884210'],
  ['cust-3', '773992104'],
  ['cust-4', '770315690'],
  ['cust-5', '775441820'],
]);

const DEMO_PRODUCT_SIGNATURES = new Map<string, string>([
  ['prod-1', 'قات ولعة أصلي'],
  ['prod-2', 'قات شامي فاخر'],
  ['prod-3', 'قات صوطي مختار'],
  ['prod-4', 'قات أرحبي يومي'],
  ['prod-5', 'قات عادي طازج'],
]);

export interface DemoDataAuditReport {
  hasDemoOrg: boolean;
  provenDemoCounts: {
    organizations: number;
    users: number;
    customers: number;
    products: number;
    sales: number;
    payments: number;
    ledgerEntries: number;
    expenses: number;
    offers: number;
    cashboxSessions: number;
    messageTemplates: number;
  };
  realDataCounts: {
    organizations: number;
    customers: number;
    sales: number;
    payments: number;
  };
  ambiguousRecordsForReview: Array<{
    table: string;
    id: string;
    label: string;
    reason: string;
  }>;
  preCleanupBackupCreated?: {
    orgId: string;
    fileName: string;
    fileContent: string;
  };
  cleanedRecordsTotal: number;
}

export async function auditDemoDataInDb(): Promise<{
  report: DemoDataAuditReport;
  demoRecordIds: {
    orgIds: string[];
    userIds: string[];
    customerIds: string[];
    productIds: string[];
    saleIds: string[];
    paymentIds: string[];
    ledgerIds: string[];
    expenseIds: string[];
    offerIds: string[];
    cashboxIds: string[];
    templateIds: string[];
  };
}> {
  const [orgs, users, customers, products, sales, payments, ledgerEntries, expenses, offers, cashboxSessions, templates] =
    await Promise.all([
      db.organizations.toArray(),
      db.users.toArray(),
      db.customers.toArray(),
      db.products.toArray(),
      db.sales.toArray(),
      db.payments.toArray(),
      db.ledgerEntries.toArray(),
      db.expenses.toArray(),
      db.offers.toArray(),
      db.cashboxSessions.toArray(),
      db.messageTemplates.toArray(),
    ]);

  const ambiguousRecordsForReview: DemoDataAuditReport['ambiguousRecordsForReview'] = [];

  const demoUserIds = users
    .filter((u) => u.orgId === DEMO_ORG_ID && ['user-owner-1', 'user-cashier-1', 'user-acc-1'].includes(u.id))
    .map((u) => u.id);

  const demoCustomerIds = customers
    .filter((c) => DEMO_CUSTOMER_SIGNATURES.get(c.id) === c.phone && c.orgId === DEMO_ORG_ID)
    .map((c) => c.id);
  for (const c of customers) {
    if (c.orgId === DEMO_ORG_ID && !demoCustomerIds.includes(c.id)) {
      ambiguousRecordsForReview.push({
        table: 'customers',
        id: c.id,
        label: c.fullName,
        reason: 'سجل عميل داخل المؤسسة التجريبية القديمة ولا يطابق توقيع البذور — يتطلب مراجعة قبل الحذف',
      });
    }
  }

  const demoProductIds = products
    .filter((p) => DEMO_PRODUCT_SIGNATURES.get(p.id) === p.name && p.orgId === DEMO_ORG_ID)
    .map((p) => p.id);

  const demoSaleIds = sales
    .filter((s) => s.id.startsWith('sale-seed-') || s.idempotencyKey.startsWith('seed-sale-'))
    .map((s) => s.id);
  for (const s of sales) {
    if (s.orgId === DEMO_ORG_ID && !demoSaleIds.includes(s.id)) {
      ambiguousRecordsForReview.push({
        table: 'sales',
        id: s.id,
        label: `${s.invoiceNumber} — ${s.customerName}`,
        reason: 'فاتورة داخل المؤسسة التجريبية القديمة ولكنها منشأة يدوياً — محفوظة للمراجعة',
      });
    }
  }

  const demoPaymentIds = payments
    .filter((p) => p.id.startsWith('pay-seed-') || p.idempotencyKey.startsWith('seed-pay-'))
    .map((p) => p.id);
  for (const p of payments) {
    if (p.orgId === DEMO_ORG_ID && !demoPaymentIds.includes(p.id)) {
      ambiguousRecordsForReview.push({
        table: 'payments',
        id: p.id,
        label: `${p.receiptNumber} — ${p.customerName}`,
        reason: 'سند سداد داخل المؤسسة التجريبية القديمة ومنشأ يدوياً — محفوظ للمراجعة',
      });
    }
  }

  const demoLedgerIds = ledgerEntries
    .filter((l) => l.idempotencyKey.startsWith('seed-'))
    .map((l) => l.id);

  const demoExpenseIds = expenses
    .filter((e) => e.id.startsWith('exp-seed-') || e.idempotencyKey.startsWith('seed-exp-'))
    .map((e) => e.id);

  const demoOfferIds = offers
    .filter((o) => o.id.startsWith('offer-seed-'))
    .map((o) => o.id);

  const demoCashboxIds = cashboxSessions
    .filter((c) => c.id === 'cashbox-today' && c.orgId === DEMO_ORG_ID && c.openingBalance === 100000)
    .map((c) => c.id);

  const hasNonSeedDataInDemoOrg = ambiguousRecordsForReview.length > 0;
  const demoOrgIds =
    orgs.some((o) => o.id === DEMO_ORG_ID) && !hasNonSeedDataInDemoOrg ? [DEMO_ORG_ID] : [];
  const demoTemplateIds = demoOrgIds.length
    ? templates.filter((t) => t.orgId === DEMO_ORG_ID && t.isDefault).map((t) => t.id)
    : [];

  return {
    report: {
      hasDemoOrg: orgs.some((o) => o.id === DEMO_ORG_ID),
      provenDemoCounts: {
        organizations: demoOrgIds.length,
        users: demoUserIds.length,
        customers: demoCustomerIds.length,
        products: demoProductIds.length,
        sales: demoSaleIds.length,
        payments: demoPaymentIds.length,
        ledgerEntries: demoLedgerIds.length,
        expenses: demoExpenseIds.length,
        offers: demoOfferIds.length,
        cashboxSessions: demoCashboxIds.length,
        messageTemplates: demoTemplateIds.length,
      },
      realDataCounts: {
        organizations: orgs.filter((o) => o.id !== DEMO_ORG_ID).length,
        customers: customers.filter((c) => !demoCustomerIds.includes(c.id)).length,
        sales: sales.filter((s) => !demoSaleIds.includes(s.id)).length,
        payments: payments.filter((p) => !demoPaymentIds.includes(p.id)).length,
      },
      ambiguousRecordsForReview,
      cleanedRecordsTotal: 0,
    },
    demoRecordIds: {
      orgIds: demoOrgIds,
      userIds: demoUserIds,
      customerIds: demoCustomerIds,
      productIds: demoProductIds,
      saleIds: demoSaleIds,
      paymentIds: demoPaymentIds,
      ledgerIds: demoLedgerIds,
      expenseIds: demoExpenseIds,
      offerIds: demoOfferIds,
      cashboxIds: demoCashboxIds,
      templateIds: demoTemplateIds,
    },
  };
}

export async function auditAndCleanProvenDemoData(params?: {
  createSafetyBackup?: boolean;
}): Promise<DemoDataAuditReport> {
  const { report, demoRecordIds } = await auditDemoDataInDb();
  const totalProven = Object.values(report.provenDemoCounts).reduce((s, n) => s + n, 0);

  if (totalProven === 0) {
    return report;
  }

  let preCleanupBackupCreated: DemoDataAuditReport['preCleanupBackupCreated'];
  if (params?.createSafetyBackup !== false && report.hasDemoOrg) {
    const bak = await createOrganizationBackup({
      orgId: DEMO_ORG_ID,
      storageType: 'local_file',
    });
    preCleanupBackupCreated = {
      orgId: DEMO_ORG_ID,
      fileName: bak.fileName,
      fileContent: bak.fileContent,
    };
  }

  await db.transaction(
    'rw',
    [
      db.organizations,
      db.users,
      db.customers,
      db.products,
      db.sales,
      db.payments,
      db.ledgerEntries,
      db.expenses,
      db.offers,
      db.cashboxSessions,
      db.messageTemplates,
    ],
    async () => {
      if (demoRecordIds.ledgerIds.length) await db.ledgerEntries.bulkDelete(demoRecordIds.ledgerIds);
      if (demoRecordIds.paymentIds.length) await db.payments.bulkDelete(demoRecordIds.paymentIds);
      if (demoRecordIds.saleIds.length) await db.sales.bulkDelete(demoRecordIds.saleIds);
      if (demoRecordIds.expenseIds.length) await db.expenses.bulkDelete(demoRecordIds.expenseIds);
      if (demoRecordIds.offerIds.length) await db.offers.bulkDelete(demoRecordIds.offerIds);
      if (demoRecordIds.cashboxIds.length) await db.cashboxSessions.bulkDelete(demoRecordIds.cashboxIds);
      if (demoRecordIds.customerIds.length) await db.customers.bulkDelete(demoRecordIds.customerIds);
      if (demoRecordIds.productIds.length) await db.products.bulkDelete(demoRecordIds.productIds);
      if (demoRecordIds.templateIds.length) await db.messageTemplates.bulkDelete(demoRecordIds.templateIds);
      if (demoRecordIds.userIds.length) await db.users.bulkDelete(demoRecordIds.userIds);
      if (demoRecordIds.orgIds.length) await db.organizations.bulkDelete(demoRecordIds.orgIds);
    }
  );

  const activeOrgId = await getMeta('activeOrgId');
  if (activeOrgId === DEMO_ORG_ID && demoRecordIds.orgIds.includes(DEMO_ORG_ID)) {
    const nextRealOrg = await db.organizations.toCollection().first();
    await setMeta('activeOrgId', nextRealOrg ? nextRealOrg.id : '');
    if (!nextRealOrg) {
      await setMeta('activeUserId', '');
    }
  }

  return {
    ...report,
    preCleanupBackupCreated,
    cleanedRecordsTotal: totalProven,
  };
}

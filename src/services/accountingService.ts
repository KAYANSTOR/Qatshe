import { db } from '../db/qatshiDb';
import {
  allocatePaymentToInvoices,
  calculateSaleTotals,
  computeCustomerBalanceFromLedger,
  computeOpenSaleRemainingMap,
} from '../domain/accounting';
import { addMoney, roundMoney, subMoney, toLocalDateKey } from '../domain/money';
import {
  hasPermission,
  type AppUser,
  type CashboxSession,
  type Customer,
  type Expense,
  type LedgerEntry,
  type Organization,
  type Payment,
  type PaymentAllocation,
  type PaymentMethod,
  type PaymentMode,
  type Sale,
  type SyncOperation,
} from '../domain/types';
import {
  allocateNextDocumentNumber,
  generateUuid,
  getOrCreateDeviceId,
  runSafeDbWrite,
} from './device';

async function assertCashboxNotClosed(orgId: string, dateKey: string): Promise<void> {
  const session = await db.cashboxSessions.where('[orgId+date]').equals([orgId, dateKey]).first();
  if (session && session.status === 'closed') {
    throw new Error(
      `تم إقفال صندوق يوم ${dateKey} — يجب إعادة فتح اليوم بواسطة المالك أو المدير قبل تسجيل أو عكس أي عملية مالية`
    );
  }
}

async function queueSyncAndAudit(params: {
  orgId: string;
  deviceId: string;
  user: AppUser;
  entityType: SyncOperation['entityType'];
  entityId: string;
  action: SyncOperation['action'];
  payload: unknown;
  auditSummary: string;
  idempotencyKey: string;
}) {
  const now = new Date().toISOString();
  await db.syncOperations.put({
    id: generateUuid(),
    orgId: params.orgId,
    deviceId: params.deviceId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    payload: params.payload,
    idempotencyKey: `${params.idempotencyKey}:sync`,
    status: 'pending',
    createdAt: now,
  });
  await db.auditLogs.put({
    id: generateUuid(),
    orgId: params.orgId,
    userId: params.user.id,
    userName: params.user.name,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    summary: params.auditSummary,
    deviceId: params.deviceId,
    createdAt: now,
  });
}

export async function recalculateCustomerCache(
  orgId: string,
  customerId: string,
  decimals: number
): Promise<Customer | undefined> {
  const customer = await db.customers.get(customerId);
  if (!customer || customer.orgId !== orgId) return undefined;

  const entries = await db.ledgerEntries
    .where('[orgId+customerId]')
    .equals([orgId, customerId])
    .toArray();

  const reversedSaleIds = new Set(
    entries.filter((e) => e.refType === 'reversal' && e.credit > 0).map((e) => e.refId)
  );

  const balance = computeCustomerBalanceFromLedger(entries, decimals);
  let totalPurchases = 0;
  let totalPaid = 0;
  let purchaseCount = 0;
  let lastPurchaseAt: string | undefined;
  let lastPaymentAt: string | undefined;

  for (const e of entries) {
    if (e.refType === 'sale') {
      totalPurchases = addMoney(totalPurchases, e.debit, decimals);
      if (!reversedSaleIds.has(e.refId)) {
        purchaseCount++;
        if (!lastPurchaseAt || e.createdAt > lastPurchaseAt) lastPurchaseAt = e.createdAt;
      }
    } else if (e.refType === 'payment') {
      totalPaid = addMoney(totalPaid, e.credit, decimals);
      if (!lastPaymentAt || e.createdAt > lastPaymentAt) lastPaymentAt = e.createdAt;
    } else if (e.refType === 'reversal') {
      totalPurchases = subMoney(totalPurchases, e.credit, decimals);
      totalPaid = subMoney(totalPaid, e.debit, decimals);
    }
  }

  const updated: Customer = {
    ...customer,
    cachedBalance: balance,
    cachedTotalPurchases: Math.max(0, totalPurchases),
    cachedTotalPaid: Math.max(0, totalPaid),
    purchaseCount: Math.max(0, purchaseCount),
    lastPurchaseAt,
    lastPaymentAt,
    updatedAt: new Date().toISOString(),
  };
  await db.customers.put(updated);
  return updated;
}

export async function createSaleTransaction(params: {
  org: Organization;
  user: AppUser;
  customerId?: string;
  items: Array<{
    productId: string;
    productName: string;
    grade: string;
    unitName: string;
    quantity: number;
    unitPrice: number;
    costPrice?: number;
  }>;
  discount: number;
  paymentMode: PaymentMode;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  notes: string;
  idempotencyKey: string;
  allowCreditLimitOverride?: boolean;
}): Promise<Sale> {
  if (!hasPermission(params.user.role, 'create_sale')) {
    throw new Error('صلاحيتك لا تسمح بإنشاء فواتير مبيعات');
  }
  const deviceId = await getOrCreateDeviceId();

  return runSafeDbWrite(() =>
    db.transaction(
      'rw',
      [db.sales, db.customers, db.ledgerEntries, db.cashboxSessions, db.kvMeta, db.syncOperations, db.auditLogs],
      async () => {
        const existing = await db.sales.where('idempotencyKey').equals(params.idempotencyKey).first();
        if (existing) {
          return existing;
        }

        const now = new Date().toISOString();
        await assertCashboxNotClosed(params.org.id, toLocalDateKey(now));

        const calc = calculateSaleTotals({
          items: params.items,
          discount: params.discount,
          paymentMode: params.paymentMode,
          paidAmount: params.paidAmount,
          decimals: params.org.currencyDecimals,
        });

        let customerName = 'عميل نقدي مباشر';
        let customer: Customer | undefined;

        if (params.customerId) {
          customer = await db.customers.get(params.customerId);
          if (!customer || customer.orgId !== params.org.id) {
            throw new Error('العميل المحدد غير موجود في هذه المؤسسة');
          }
          customerName = customer.fullName;
        } else if (calc.remainingAmount > 0) {
          throw new Error('يجب اختيار عميل محدد عند وجود مبلغ آجل أو متبقي');
        }

        if (customer && calc.remainingAmount > 0 && customer.creditLimit > 0 && !params.allowCreditLimitOverride) {
          const projected = addMoney(customer.cachedBalance, calc.remainingAmount, params.org.currencyDecimals);
          if (projected > customer.creditLimit) {
            throw new Error(
              `CREDIT_LIMIT_EXCEEDED:يتجاوز البيع الحد الائتماني للعميل (${customer.creditLimit}) — الرصيد المتوقع ${projected}`
            );
          }
        }

        const orgSalesCount = await db.sales.where('orgId').equals(params.org.id).count();
        const branchIndex = Math.max(
          1,
          params.org.branches.findIndex((b) => b.id === params.org.activeBranchId) + 1
        );
        const invoiceNumber = await allocateNextDocumentNumber(
          params.org.id,
          'INV',
          orgSalesCount,
          deviceId,
          params.org.activeBranchId,
          branchIndex
        );
        const saleId = generateUuid();

        const sale: Sale = {
          id: saleId,
          orgId: params.org.id,
          branchId: params.org.activeBranchId,
          invoiceNumber,
          customerId: customer?.id,
          customerName,
          items: calc.items,
          subtotal: calc.subtotal,
          discount: calc.discount,
          total: calc.total,
          paidAmount: calc.paidAmount,
          remainingAmount: calc.remainingAmount,
          paymentMode: params.paymentMode,
          paymentMethod: params.paymentMethod,
          notes: params.notes.trim(),
          status: 'active',
          idempotencyKey: params.idempotencyKey,
          createdAt: now,
          updatedAt: now,
          createdBy: params.user.id,
          createdByName: params.user.name,
          deviceId,
          syncStatus: 'pending',
        };

        await db.sales.put(sale);

        if (customer) {
          const saleLedgerEntry: LedgerEntry = {
            id: generateUuid(),
            orgId: params.org.id,
            branchId: params.org.activeBranchId,
            customerId: customer.id,
            refType: 'sale',
            refId: sale.id,
            refNumber: sale.invoiceNumber,
            description: `فاتورة بيع (${calc.items.map((i) => `${i.productName} × ${i.quantity}`).join('، ')})`,
            debit: calc.total,
            credit: 0,
            cashIn: 0,
            discountAmount: calc.discount,
            createdAt: now,
            createdBy: params.user.id,
            createdByName: params.user.name,
            deviceId,
            idempotencyKey: `${params.idempotencyKey}:debit`,
            syncStatus: 'pending',
          };
          await db.ledgerEntries.put(saleLedgerEntry);

          if (calc.paidAmount > 0) {
            const downPaymentTime = new Date(Date.now() + 1).toISOString();
            const payLedgerEntry: LedgerEntry = {
              id: generateUuid(),
              orgId: params.org.id,
              branchId: params.org.activeBranchId,
              customerId: customer.id,
              refType: 'payment',
              refId: sale.id,
              refNumber: sale.invoiceNumber,
              description: `سداد فوري مع ${sale.invoiceNumber}`,
              debit: 0,
              credit: calc.paidAmount,
              cashIn: calc.paidAmount,
              discountAmount: 0,
              createdAt: downPaymentTime,
              createdBy: params.user.id,
              createdByName: params.user.name,
              deviceId,
              idempotencyKey: `${params.idempotencyKey}:downpay`,
              syncStatus: 'pending',
            };
            await db.ledgerEntries.put(payLedgerEntry);
          }

          await recalculateCustomerCache(params.org.id, customer.id, params.org.currencyDecimals);
        }

        await queueSyncAndAudit({
          orgId: params.org.id,
          deviceId,
          user: params.user,
          entityType: 'sale',
          entityId: sale.id,
          action: 'create',
          payload: sale,
          auditSummary: `تسجيل ${invoiceNumber} بمبلغ ${calc.total} (${customerName})`,
          idempotencyKey: params.idempotencyKey,
        });

        return sale;
      }
    )
  );
}

export async function createPaymentTransaction(params: {
  org: Organization;
  user: AppUser;
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  allocationMode: 'auto' | 'manual';
  manualAllocations?: PaymentAllocation[];
  allowExcessCredit?: boolean;
  notes: string;
  idempotencyKey: string;
}): Promise<Payment> {
  if (!hasPermission(params.user.role, 'create_payment')) {
    throw new Error('صلاحيتك لا تسمح بتسجيل سندات السداد');
  }
  const deviceId = await getOrCreateDeviceId();

  return runSafeDbWrite(() =>
    db.transaction(
      'rw',
      [db.payments, db.sales, db.customers, db.ledgerEntries, db.cashboxSessions, db.kvMeta, db.syncOperations, db.auditLogs],
      async () => {
        const existing = await db.payments.where('idempotencyKey').equals(params.idempotencyKey).first();
        if (existing) return existing;

        const now = new Date().toISOString();
        await assertCashboxNotClosed(params.org.id, toLocalDateKey(now));

        const customer = await db.customers.get(params.customerId);
        if (!customer || customer.orgId !== params.org.id) {
          throw new Error('العميل غير موجود في هذه المؤسسة');
        }

        const customerEntries = await db.ledgerEntries
          .where('[orgId+customerId]')
          .equals([params.org.id, customer.id])
          .toArray();
        const authoritativeDebt = computeCustomerBalanceFromLedger(customerEntries, params.org.currencyDecimals);

        const custSales = await db.sales
          .where('[orgId+customerId]')
          .equals([params.org.id, customer.id])
          .toArray();
        const custPayments = await db.payments
          .where('[orgId+customerId]')
          .equals([params.org.id, customer.id])
          .toArray();
        const openMap = computeOpenSaleRemainingMap(custSales, custPayments, params.org.currencyDecimals);

        const openSales = custSales
          .filter((s) => openMap.has(s.id))
          .map((s) => ({
            id: s.id,
            invoiceNumber: s.invoiceNumber,
            remainingAmount: openMap.get(s.id)!,
            createdAt: s.createdAt,
          }));

        const allocationResult = allocatePaymentToInvoices({
          openSales,
          customerCurrentDebt: authoritativeDebt,
          paymentAmount: params.amount,
          mode: params.allocationMode,
          manualAllocations: params.manualAllocations,
          allowExcessCredit: params.allowExcessCredit,
          decimals: params.org.currencyDecimals,
        });

        const count = await db.payments.where('orgId').equals(params.org.id).count();
        const branchIndex = Math.max(
          1,
          params.org.branches.findIndex((b) => b.id === params.org.activeBranchId) + 1
        );
        const receiptNumber = await allocateNextDocumentNumber(
          params.org.id,
          'REC',
          count,
          deviceId,
          params.org.activeBranchId,
          branchIndex
        );
        const paymentId = generateUuid();

        const payment: Payment = {
          id: paymentId,
          orgId: params.org.id,
          branchId: params.org.activeBranchId,
          receiptNumber,
          customerId: customer.id,
          customerName: customer.fullName,
          amount: roundMoney(params.amount, params.org.currencyDecimals),
          paymentMethod: params.paymentMethod,
          allocationMode: params.allocationMode,
          allocations: allocationResult.allocations,
          excessAction: params.allowExcessCredit ? 'credit_advance' : 'reject',
          notes: params.notes.trim(),
          status: 'active',
          idempotencyKey: params.idempotencyKey,
          createdAt: now,
          updatedAt: now,
          createdBy: params.user.id,
          createdByName: params.user.name,
          deviceId,
          syncStatus: 'pending',
        };

        await db.payments.put(payment);

        const ledgerEntry: LedgerEntry = {
          id: generateUuid(),
          orgId: params.org.id,
          branchId: params.org.activeBranchId,
          customerId: customer.id,
          refType: 'payment',
          refId: payment.id,
          refNumber: receiptNumber,
          description:
            allocationResult.allocations.length > 0
              ? `${receiptNumber} (${allocationResult.allocations.map((a) => a.invoiceNumber).join('، ')})`
              : receiptNumber,
          debit: 0,
          credit: payment.amount,
          cashIn: payment.amount,
          discountAmount: 0,
          createdAt: now,
          createdBy: params.user.id,
          createdByName: params.user.name,
          deviceId,
          idempotencyKey: `${params.idempotencyKey}:credit`,
          syncStatus: 'pending',
        };

        await db.ledgerEntries.put(ledgerEntry);
        await recalculateCustomerCache(params.org.id, customer.id, params.org.currencyDecimals);

        await queueSyncAndAudit({
          orgId: params.org.id,
          deviceId,
          user: params.user,
          entityType: 'payment',
          entityId: payment.id,
          action: 'create',
          payload: payment,
          auditSummary: `تسجيل ${receiptNumber} بمبلغ ${payment.amount} من ${customer.fullName}`,
          idempotencyKey: params.idempotencyKey,
        });

        return payment;
      }
    )
  );
}

export async function createAdjustmentTransaction(params: {
  org: Organization;
  user: AppUser;
  customerId: string;
  direction: 'credit' | 'debit';
  amount: number;
  reason: string;
  idempotencyKey: string;
}): Promise<LedgerEntry> {
  if (!hasPermission(params.user.role, 'create_adjustment')) {
    throw new Error('صلاحيتك لا تسمح بإنشاء تسويات أو مرتجعات محاسبية');
  }
  const cleanAmount = roundMoney(params.amount, params.org.currencyDecimals);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    throw new Error('مبلغ التسوية أو المرتجع يجب أن يكون أكبر من صفر');
  }
  if (!params.reason.trim()) {
    throw new Error('يرجى إدخال سبب التسوية أو المرتجع');
  }

  const deviceId = await getOrCreateDeviceId();

  return runSafeDbWrite(() =>
    db.transaction(
      'rw',
      [db.customers, db.ledgerEntries, db.cashboxSessions, db.kvMeta, db.syncOperations, db.auditLogs],
      async () => {
        const existing = await db.ledgerEntries.where('idempotencyKey').equals(params.idempotencyKey).first();
        if (existing) return existing;

        const now = new Date().toISOString();
        await assertCashboxNotClosed(params.org.id, toLocalDateKey(now));

        const customer = await db.customers.get(params.customerId);
        if (!customer || customer.orgId !== params.org.id) {
          throw new Error('العميل غير موجود في هذه المؤسسة');
        }

        const adjCount = await db.ledgerEntries.where('orgId').equals(params.org.id).count();
        const branchIndex = Math.max(
          1,
          params.org.branches.findIndex((b) => b.id === params.org.activeBranchId) + 1
        );
        const refNumber = await allocateNextDocumentNumber(
          params.org.id,
          'ADJ',
          adjCount,
          deviceId,
          params.org.activeBranchId,
          branchIndex
        );
        const entryId = generateUuid();

        const entry: LedgerEntry = {
          id: entryId,
          orgId: params.org.id,
          branchId: params.org.activeBranchId,
          customerId: customer.id,
          refType: 'adjustment',
          refId: entryId,
          refNumber,
          description: `${params.direction === 'credit' ? 'إشعار دائن / مرتجع' : 'تسوية مدينة'}: ${params.reason.trim()}`,
          debit: params.direction === 'debit' ? cleanAmount : 0,
          credit: params.direction === 'credit' ? cleanAmount : 0,
          cashIn: 0,
          discountAmount: params.direction === 'credit' ? cleanAmount : 0,
          createdAt: now,
          createdBy: params.user.id,
          createdByName: params.user.name,
          deviceId,
          idempotencyKey: params.idempotencyKey,
          syncStatus: 'pending',
        };

        await db.ledgerEntries.put(entry);
        await recalculateCustomerCache(params.org.id, customer.id, params.org.currencyDecimals);

        await queueSyncAndAudit({
          orgId: params.org.id,
          deviceId,
          user: params.user,
          entityType: 'ledger',
          entityId: entry.id,
          action: 'create',
          payload: entry,
          auditSummary: `${entry.description} (${cleanAmount} للعميل ${customer.fullName})`,
          idempotencyKey: params.idempotencyKey,
        });

        return entry;
      }
    )
  );
}

export async function reverseSaleTransaction(params: {
  org: Organization;
  user: AppUser;
  saleId: string;
  reason: string;
}): Promise<void> {
  if (!hasPermission(params.user.role, 'reverse_sale')) {
    throw new Error('صلاحيتك لا تسمح بإجراء قيد عكسي للفواتير');
  }
  const deviceId = await getOrCreateDeviceId();

  await runSafeDbWrite(() =>
    db.transaction(
      'rw',
      [db.sales, db.payments, db.customers, db.ledgerEntries, db.cashboxSessions, db.syncOperations, db.auditLogs],
      async () => {
        const sale = await db.sales.get(params.saleId);
        if (!sale || sale.orgId !== params.org.id) throw new Error('الفاتورة غير موجودة');
        if (sale.status === 'reversed') throw new Error('تم عكس هذه الفاتورة مسبقاً');

        await assertCashboxNotClosed(params.org.id, toLocalDateKey(sale.createdAt));

        if (sale.customerId) {
          const custPayments = await db.payments
            .where('[orgId+customerId]')
            .equals([params.org.id, sale.customerId])
            .toArray();
          const activeLinked = custPayments.find(
            (p) => p.status === 'active' && p.allocations.some((a) => a.saleId === sale.id && a.amount > 0)
          );
          if (activeLinked) {
            throw new Error(
              `لا يمكن عكس الفاتورة ${sale.invoiceNumber} لوجود سند سداد نشط مرتبط بها (${activeLinked.receiptNumber}) — اعكس السند أولاً`
            );
          }
        }

        const revId = generateUuid();
        const now = new Date().toISOString();

        await db.sales.put({
          ...sale,
          status: 'reversed',
          reversedByEntryId: revId,
          updatedAt: now,
          syncStatus: 'pending',
        });

        if (sale.customerId) {
          const netCustomerImpact = subMoney(sale.total, sale.paidAmount, params.org.currencyDecimals);
          const revEntry: LedgerEntry = {
            id: revId,
            orgId: params.org.id,
            branchId: sale.branchId,
            customerId: sale.customerId,
            refType: 'reversal',
            refId: sale.id,
            refNumber: `قيد عكسي - ${sale.invoiceNumber}`,
            description: `قيد عكسي لإلغاء ${sale.invoiceNumber}: ${params.reason || 'تصحيح قيد'}`,
            debit: sale.paidAmount,
            credit: sale.total,
            cashIn: -sale.paidAmount,
            discountAmount: 0,
            createdAt: now,
            createdBy: params.user.id,
            createdByName: params.user.name,
            deviceId,
            idempotencyKey: `rev-sale-${sale.id}`,
            syncStatus: 'pending',
          };
          if (netCustomerImpact !== 0 || sale.total > 0) {
            await db.ledgerEntries.put(revEntry);
          }
          await recalculateCustomerCache(params.org.id, sale.customerId, params.org.currencyDecimals);
        }

        await queueSyncAndAudit({
          orgId: params.org.id,
          deviceId,
          user: params.user,
          entityType: 'sale',
          entityId: sale.id,
          action: 'reverse',
          payload: { saleId: sale.id, reason: params.reason },
          auditSummary: `قيد عكسي للفاتورة ${sale.invoiceNumber}: ${params.reason}`,
          idempotencyKey: `rev-sale-${sale.id}`,
        });
      }
    )
  );
}

export async function reversePaymentTransaction(params: {
  org: Organization;
  user: AppUser;
  paymentId: string;
  reason: string;
}): Promise<void> {
  if (!hasPermission(params.user.role, 'reverse_payment')) {
    throw new Error('صلاحيتك لا تسمح بعكس سندات السداد');
  }
  const deviceId = await getOrCreateDeviceId();

  await runSafeDbWrite(() =>
    db.transaction(
      'rw',
      [db.payments, db.customers, db.ledgerEntries, db.cashboxSessions, db.syncOperations, db.auditLogs],
      async () => {
        const payment = await db.payments.get(params.paymentId);
        if (!payment || payment.orgId !== params.org.id) throw new Error('سند السداد غير موجود');
        if (payment.status === 'reversed') throw new Error('تم عكس هذا السند مسبقاً');

        await assertCashboxNotClosed(params.org.id, toLocalDateKey(payment.createdAt));

        const revId = generateUuid();
        const now = new Date().toISOString();

        await db.payments.put({
          ...payment,
          status: 'reversed',
          reversedByEntryId: revId,
          updatedAt: now,
          syncStatus: 'pending',
        });

        await db.ledgerEntries.put({
          id: revId,
          orgId: params.org.id,
          branchId: payment.branchId,
          customerId: payment.customerId,
          refType: 'reversal',
          refId: payment.id,
          refNumber: `قيد عكسي - ${payment.receiptNumber}`,
          description: `قيد عكسي لإلغاء ${payment.receiptNumber}: ${params.reason || 'تصحيح سداد'}`,
          debit: payment.amount,
          credit: 0,
          cashIn: -payment.amount,
          discountAmount: 0,
          createdAt: now,
          createdBy: params.user.id,
          createdByName: params.user.name,
          deviceId,
          idempotencyKey: `rev-pay-${payment.id}`,
          syncStatus: 'pending',
        });

        await recalculateCustomerCache(params.org.id, payment.customerId, params.org.currencyDecimals);

        await queueSyncAndAudit({
          orgId: params.org.id,
          deviceId,
          user: params.user,
          entityType: 'payment',
          entityId: payment.id,
          action: 'reverse',
          payload: { paymentId: payment.id, reason: params.reason },
          auditSummary: `قيد عكسي لسند القبض ${payment.receiptNumber}: ${params.reason}`,
          idempotencyKey: `rev-pay-${payment.id}`,
        });
      }
    )
  );
}

export async function createExpenseTransaction(params: {
  org: Organization;
  user: AppUser;
  title: string;
  amount: number;
  category: string;
  date: string;
  paymentMethod: PaymentMethod;
  notes: string;
  idempotencyKey: string;
}): Promise<Expense> {
  if (!hasPermission(params.user.role, 'manage_expenses')) {
    throw new Error('صلاحيتك لا تسمح بتسجيل المصروفات');
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error('مبلغ المصروف يجب أن يكون أكبر من صفر');
  }
  const deviceId = await getOrCreateDeviceId();

  return runSafeDbWrite(() =>
    db.transaction('rw', [db.expenses, db.cashboxSessions, db.syncOperations, db.auditLogs], async () => {
      const existing = await db.expenses.where('idempotencyKey').equals(params.idempotencyKey).first();
      if (existing) return existing;

      await assertCashboxNotClosed(params.org.id, params.date);

      const now = new Date().toISOString();
      const expense: Expense = {
        id: generateUuid(),
        orgId: params.org.id,
        branchId: params.org.activeBranchId,
        title: params.title.trim(),
        amount: roundMoney(params.amount, params.org.currencyDecimals),
        category: params.category,
        date: params.date,
        paymentMethod: params.paymentMethod,
        notes: params.notes.trim(),
        responsibleUserId: params.user.id,
        responsibleUserName: params.user.name,
        status: 'active',
        idempotencyKey: params.idempotencyKey,
        createdAt: now,
        createdBy: params.user.id,
        deviceId,
        syncStatus: 'pending',
      };
      await db.expenses.put(expense);

      await queueSyncAndAudit({
        orgId: params.org.id,
        deviceId,
        user: params.user,
        entityType: 'expense',
        entityId: expense.id,
        action: 'create',
        payload: expense,
        auditSummary: `تسجيل مصروف: ${expense.title} (${expense.amount})`,
        idempotencyKey: params.idempotencyKey,
      });

      return expense;
    })
  );
}

export async function reverseExpenseTransaction(params: {
  org: Organization;
  user: AppUser;
  expenseId: string;
}): Promise<void> {
  if (!hasPermission(params.user.role, 'manage_expenses')) {
    throw new Error('صلاحيتك لا تسمح بعكس المصروفات');
  }
  const deviceId = await getOrCreateDeviceId();
  await runSafeDbWrite(() =>
    db.transaction('rw', [db.expenses, db.cashboxSessions, db.syncOperations, db.auditLogs], async () => {
      const exp = await db.expenses.get(params.expenseId);
      if (!exp || exp.orgId !== params.org.id) throw new Error('المصروف غير موجود');
      if (exp.status === 'reversed') return;

      await assertCashboxNotClosed(params.org.id, exp.date);

      await db.expenses.put({ ...exp, status: 'reversed', syncStatus: 'pending' });
      await queueSyncAndAudit({
        orgId: params.org.id,
        deviceId,
        user: params.user,
        entityType: 'expense',
        entityId: exp.id,
        action: 'reverse',
        payload: { expenseId: exp.id },
        auditSummary: `عكس مصروف: ${exp.title}`,
        idempotencyKey: `rev-exp-${exp.id}`,
      });
    })
  );
}

export async function saveCashboxSession(params: {
  org: Organization;
  user: AppUser;
  date: string;
  openingBalance: number;
  closingBalance?: number;
  status: 'open' | 'closed';
  notes: string;
}): Promise<CashboxSession> {
  if (!hasPermission(params.user.role, 'manage_cashbox')) {
    throw new Error('صلاحيتك لا تسمح بإدارة الصندوق والإقفال اليومي');
  }
  const deviceId = await getOrCreateDeviceId();

  return runSafeDbWrite(() =>
    db.transaction('rw', [db.cashboxSessions, db.syncOperations, db.auditLogs], async () => {
      const existing = await db.cashboxSessions
        .where('[orgId+date]')
        .equals([params.org.id, params.date])
        .first();

      if (existing?.status === 'closed' && params.status === 'open') {
        if (params.user.role !== 'owner' && params.user.role !== 'manager') {
          throw new Error('إعادة فتح صندوق يوم مقفل متاحة فقط للمالك أو المدير');
        }
      }

      const now = new Date().toISOString();
      const session: CashboxSession = {
        id: existing?.id ?? generateUuid(),
        orgId: params.org.id,
        branchId: params.org.activeBranchId,
        date: params.date,
        openingBalance: roundMoney(Math.max(0, params.openingBalance), params.org.currencyDecimals),
        closingBalance:
          params.closingBalance !== undefined
            ? roundMoney(params.closingBalance, params.org.currencyDecimals)
            : undefined,
        notes: params.notes,
        status: params.status,
        closedBy: params.status === 'closed' ? params.user.name : undefined,
        closedAt: params.status === 'closed' ? now : undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        syncStatus: 'pending',
      };
      await db.cashboxSessions.put(session);

      await queueSyncAndAudit({
        orgId: params.org.id,
        deviceId,
        user: params.user,
        entityType: 'cashbox',
        entityId: session.id,
        action: existing ? 'update' : 'create',
        payload: session,
        auditSummary:
          params.status === 'closed'
            ? `إقفال صندوق يوم ${params.date} برصيد ${session.closingBalance ?? 0}`
            : existing?.status === 'closed'
            ? `إعادة فتح صندوق يوم ${params.date}`
            : `تحديث رصيد افتتاحي لصندوق ${params.date}`,
        idempotencyKey: `cashbox-${session.id}-${now}`,
      });

      return session;
    })
  );
}

export async function queryCustomerFinancialProfile(
  orgId: string,
  customerId: string
): Promise<{
  entries: LedgerEntry[];
  sales: Sale[];
  payments: Payment[];
}> {
  const [entries, sales, payments] = await Promise.all([
    db.ledgerEntries
      .where('[orgId+customerId+createdAt]')
      .between([orgId, customerId, ''], [orgId, customerId, '\uffff'])
      .toArray(),
    db.sales.where('[orgId+customerId]').equals([orgId, customerId]).toArray(),
    db.payments.where('[orgId+customerId]').equals([orgId, customerId]).toArray(),
  ]);
  return { entries, sales, payments };
}

export async function verifyAndRepairLedgerIntegrity(orgId: string, decimals = 0): Promise<{
  checkedCustomers: number;
  repairedCount: number;
  discrepancies: Array<{ customerId: string; fullName: string; cached: number; ledger: number }>;
}> {
  const BATCH_SIZE = 250;
  let offset = 0;
  let checkedCustomers = 0;
  let repairedCount = 0;
  const discrepancies: Array<{ customerId: string; fullName: string; cached: number; ledger: number }> = [];

  while (true) {
    const batch = await db.customers.where('orgId').equals(orgId).offset(offset).limit(BATCH_SIZE).toArray();
    if (!batch.length) break;

    for (const c of batch) {
      checkedCustomers++;
      const entries = await db.ledgerEntries.where('[orgId+customerId]').equals([orgId, c.id]).toArray();
      const trueBalance = computeCustomerBalanceFromLedger(entries, decimals);
      if (trueBalance !== c.cachedBalance) {
        discrepancies.push({
          customerId: c.id,
          fullName: c.fullName,
          cached: c.cachedBalance,
          ledger: trueBalance,
        });
        await recalculateCustomerCache(orgId, c.id, decimals);
        repairedCount++;
      }
    }

    offset += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  return {
    checkedCustomers,
    repairedCount,
    discrepancies,
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocatePaymentToInvoices,
  calculateSaleTotals,
  classifyDebtAging,
  computeCustomerBalanceFromLedger,
  computeCustomerLedgerStatement,
  computeDailyCloseSummary,
  computeProfitReport,
} from './accounting';
import { renderTemplateVariables } from './templates';
import type { Expense, LedgerEntry, Payment, Product, Sale } from './types';

test('calculateSaleTotals enforces cash, credit, and partial rules accurately', () => {
  const cashSale = calculateSaleTotals({
    items: [
      { productId: 'p1', productName: 'قات ولعة', grade: 'درجة أولى', unitName: 'ربطة', quantity: 2, unitPrice: 12500 },
    ],
    discount: 1000,
    paymentMode: 'cash',
    paidAmount: 0,
    decimals: 0,
  });
  assert.equal(cashSale.subtotal, 25000);
  assert.equal(cashSale.total, 24000);
  assert.equal(cashSale.paidAmount, 24000);
  assert.equal(cashSale.remainingAmount, 0);

  const partialSale = calculateSaleTotals({
    items: [
      { productId: 'p1', productName: 'قات ممتاز', grade: 'ممتاز', unitName: 'ربطة', quantity: 1, unitPrice: 50000 },
    ],
    discount: 0,
    paymentMode: 'partial',
    paidAmount: 20000,
    decimals: 0,
  });
  assert.equal(partialSale.remainingAmount, 30000);

  assert.throws(() =>
    calculateSaleTotals({
      items: [{ productId: 'p1', productName: 'قات', grade: 'عادي', unitName: 'ربطة', quantity: 1, unitPrice: 5000 }],
      discount: 6000,
      paymentMode: 'cash',
      paidAmount: 0,
      decimals: 0,
    })
  );
});

test('computeCustomerLedgerStatement calculates opening, running, and closing balances from ledger entries', () => {
  const entries: LedgerEntry[] = [
    {
      id: 'l1',
      orgId: 'org1',
      branchId: 'b1',
      customerId: 'c1',
      refType: 'sale',
      refId: 's1',
      refNumber: 'INV-1',
      description: 'مبيعات آجل',
      debit: 50000,
      credit: 0,
      cashIn: 0,
      discountAmount: 0,
      createdAt: '2026-10-01T10:00:00.000Z',
      createdBy: 'u1',
      createdByName: 'المالك',
      deviceId: 'dev1',
      idempotencyKey: 'k1',
      syncStatus: 'synced',
    },
    {
      id: 'l2',
      orgId: 'org1',
      branchId: 'b1',
      customerId: 'c1',
      refType: 'payment',
      refId: 'pay1',
      refNumber: 'REC-1',
      description: 'سداد جزئي',
      debit: 0,
      credit: 20000,
      cashIn: 20000,
      discountAmount: 0,
      createdAt: '2026-10-10T10:00:00.000Z',
      createdBy: 'u1',
      createdByName: 'المالك',
      deviceId: 'dev1',
      idempotencyKey: 'k2',
      syncStatus: 'synced',
    },
    {
      id: 'l3',
      orgId: 'org1',
      branchId: 'b1',
      customerId: 'c1',
      refType: 'sale',
      refId: 's2',
      refNumber: 'INV-2',
      description: 'مبيعات آجل جديدة',
      debit: 15000,
      credit: 0,
      cashIn: 0,
      discountAmount: 0,
      createdAt: '2026-10-15T10:00:00.000Z',
      createdBy: 'u1',
      createdByName: 'المالك',
      deviceId: 'dev1',
      idempotencyKey: 'k3',
      syncStatus: 'synced',
    },
  ];

  assert.equal(computeCustomerBalanceFromLedger(entries, 0), 45000);

  const statement = computeCustomerLedgerStatement(entries, '2026-10-05', '2026-10-20', 0);
  assert.equal(statement.openingBalance, 50000);
  assert.equal(statement.rows.length, 2);
  assert.equal(statement.rows[0].runningBalance, 30000);
  assert.equal(statement.rows[1].runningBalance, 45000);
  assert.equal(statement.closingBalance, 45000);
});

test('allocatePaymentToInvoices uses FIFO and blocks overpayment unless credit advance approved', () => {
  const openSales = [
    { id: 's1', invoiceNumber: 'INV-001', remainingAmount: 20000, createdAt: '2026-10-01T10:00:00.000Z' },
    { id: 's2', invoiceNumber: 'INV-002', remainingAmount: 30000, createdAt: '2026-10-05T10:00:00.000Z' },
  ];

  const auto = allocatePaymentToInvoices({
    openSales,
    customerCurrentDebt: 50000,
    paymentAmount: 25000,
    mode: 'auto',
  });
  assert.equal(auto.allocations.length, 2);
  assert.equal(auto.allocations[0].amount, 20000);
  assert.equal(auto.allocations[1].amount, 5000);

  assert.throws(() =>
    allocatePaymentToInvoices({
      openSales,
      customerCurrentDebt: 50000,
      paymentAmount: 60000,
      mode: 'auto',
      allowExcessCredit: false,
    })
  );
});

test('classifyDebtAging assigns invoices to exact day buckets', () => {
  const summary = classifyDebtAging(
    [
      { id: '1', remainingAmount: 10000, createdAt: '2026-11-11T10:00:00.000Z' }, // 3 days
      { id: '2', remainingAmount: 20000, createdAt: '2026-10-30T10:00:00.000Z' }, // 15 days
      { id: '3', remainingAmount: 30000, createdAt: '2026-10-01T10:00:00.000Z' }, // 44 days
      { id: '4', remainingAmount: 40000, createdAt: '2026-08-01T10:00:00.000Z' }, // 105 days
    ],
    '2026-11-14T10:00:00.000Z',
    0
  );
  assert.equal(summary.bucket1_7, 10000);
  assert.equal(summary.bucket8_30, 20000);
  assert.equal(summary.bucket31_60, 30000);
  assert.equal(summary.bucketOver60, 40000);
  assert.equal(summary.totalOpenDebt, 100000);
  assert.equal(summary.overdueCount, 3);
});

test('computeDailyCloseSummary strictly separates new cash sales from old debt collections', () => {
  const daySales: Sale[] = [
    {
      id: 's1',
      orgId: 'org1',
      branchId: 'b1',
      invoiceNumber: 'INV-1',
      customerName: 'سعيد',
      items: [],
      subtotal: 30000,
      discount: 0,
      total: 30000,
      paidAmount: 10000,
      remainingAmount: 20000,
      paymentMode: 'partial',
      paymentMethod: 'cash',
      notes: '',
      status: 'active',
      idempotencyKey: 'k1',
      createdAt: '2026-11-14T09:00:00.000Z',
      updatedAt: '2026-11-14T09:00:00.000Z',
      createdBy: 'u1',
      createdByName: 'المالك',
      deviceId: 'd1',
      syncStatus: 'pending',
    },
  ];
  const dayPayments: Payment[] = [
    {
      id: 'p1',
      orgId: 'org1',
      branchId: 'b1',
      receiptNumber: 'REC-1',
      customerId: 'c1',
      customerName: 'أحمد',
      amount: 25000,
      paymentMethod: 'cash',
      allocationMode: 'auto',
      allocations: [],
      excessAction: 'reject',
      notes: '',
      status: 'active',
      idempotencyKey: 'k2',
      createdAt: '2026-11-14T11:00:00.000Z',
      updatedAt: '2026-11-14T11:00:00.000Z',
      createdBy: 'u1',
      createdByName: 'المالك',
      deviceId: 'd1',
      syncStatus: 'pending',
    },
  ];
  const dayExpenses: Expense[] = [
    {
      id: 'e1',
      orgId: 'org1',
      branchId: 'b1',
      title: 'إيجار وكهرباء',
      amount: 5000,
      category: 'تشغيل',
      date: '2026-11-14',
      paymentMethod: 'cash',
      notes: '',
      responsibleUserId: 'u1',
      responsibleUserName: 'المالك',
      status: 'active',
      idempotencyKey: 'k3',
      createdAt: '2026-11-14T12:00:00.000Z',
      createdBy: 'u1',
      deviceId: 'd1',
      syncStatus: 'pending',
    },
  ];

  const close = computeDailyCloseSummary({
    daySales,
    dayPayments,
    dayExpenses,
    openingBalance: 100000,
    decimals: 0,
  });

  assert.equal(close.totalSales, 30000);
  assert.equal(close.cashSalesReceipts, 10000);
  assert.equal(close.creditSalesGenerated, 20000);
  assert.equal(close.oldDebtCollections, 25000);
  assert.equal(close.totalCashIn, 35000);
  assert.equal(close.netCashMovement, 30000);
  assert.equal(close.expectedClosingBalance, 130000);
});

test('computeProfitReport never fabricates profit on uncosted products', () => {
  const products: Product[] = [
    { id: 'p1', orgId: 'org1', name: 'قات ولعة', grade: 'أولى', unitName: 'ربطة', unitPrice: 15000, costPrice: 10000, active: true, createdAt: '', updatedAt: '', syncStatus: 'synced' },
    { id: 'p2', orgId: 'org1', name: 'قات عادي', grade: 'عادي', unitName: 'ربطة', unitPrice: 5000, active: true, createdAt: '', updatedAt: '', syncStatus: 'synced' },
  ];
  const sales: Sale[] = [
    {
      id: 's1',
      orgId: 'org1',
      branchId: 'b1',
      invoiceNumber: 'INV-1',
      customerName: 'عميل',
      items: [
        { productId: 'p1', productName: 'قات ولعة', grade: 'أولى', unitName: 'ربطة', quantity: 2, unitPrice: 15000, costPrice: 10000, lineTotal: 30000 },
        { productId: 'p2', productName: 'قات عادي', grade: 'عادي', unitName: 'ربطة', quantity: 1, unitPrice: 5000, lineTotal: 5000 },
      ],
      subtotal: 35000,
      discount: 0,
      total: 35000,
      paidAmount: 35000,
      remainingAmount: 0,
      paymentMode: 'cash',
      paymentMethod: 'cash',
      notes: '',
      status: 'active',
      idempotencyKey: 'k1',
      createdAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:00:00.000Z',
      createdBy: 'u1',
      createdByName: 'المالك',
      deviceId: 'd1',
      syncStatus: 'pending',
    },
  ];
  const report = computeProfitReport(sales, products, 0);
  assert.equal(report.costedRevenue, 30000);
  assert.equal(report.uncostedRevenue, 5000);
  assert.equal(report.actualProfitOnCostedItems, 10000);
  assert.equal(report.hasUncostedItems, true);
});

test('renderTemplateVariables substitutes all customer and shop variables cleanly', () => {
  const rendered = renderTemplateVariables(
    'مرحباً {customer_name}، رصيدك المتبقي لدى {shop_name} هو {remaining_balance}. للتواصل: {shop_phone}',
    {
      customerName: 'محمد الهمداني',
      shopName: 'قاتشي الفاخر',
      customerBalance: 30000,
      remainingBalance: 30000,
      shopPhone: '777123456',
      org: { currency: 'YER', currencyDecimals: 0, numberLocale: 'en-US', dateFormat: 'YYYY-MM-DD' },
    }
  );
  assert.ok(rendered.includes('محمد الهمداني'));
  assert.ok(rendered.includes('قاتشي الفاخر'));
  assert.ok(rendered.includes('30,000 ر.ي'));
  assert.ok(rendered.includes('777123456'));
});

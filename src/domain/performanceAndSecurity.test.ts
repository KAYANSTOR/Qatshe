import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCustomerBalanceFromLedger,
  computeCustomerLedgerStatement,
  computeDailyCloseSummary,
} from './accounting';
import { evaluateTargetAudience } from './templates';
import { hasPermission, type Customer, type LedgerEntry, type Payment, type Sale } from './types';

test('performance: evaluates 100,000 ledger entries and 5,000 customers rapidly without blocking', () => {
  const start = performance.now();
  const entries: LedgerEntry[] = [];
  for (let i = 0; i < 100_000; i++) {
    entries.push({
      id: `l-${i}`,
      orgId: 'org-perf',
      branchId: 'b1',
      customerId: `c-${i % 5000}`,
      refType: i % 3 === 0 ? 'payment' : 'sale',
      refId: `r-${i}`,
      refNumber: `REF-${i}`,
      description: 'حركة',
      debit: i % 3 === 0 ? 0 : 10000,
      credit: i % 3 === 0 ? 5000 : 0,
      cashIn: i % 3 === 0 ? 5000 : 0,
      discountAmount: 0,
      createdAt: '2026-11-14T10:00:00.000Z',
      createdBy: 'u1',
      createdByName: 'owner',
      deviceId: 'd1',
      idempotencyKey: `k-${i}`,
      syncStatus: 'synced',
    });
  }

  const singleCustEntries = entries.filter((e) => e.customerId === 'c-1');
  const balance = computeCustomerBalanceFromLedger(singleCustEntries, 0);
  const statement = computeCustomerLedgerStatement(singleCustEntries, undefined, undefined, 0);
  const elapsedMs = performance.now() - start;

  assert.equal(statement.closingBalance, balance);
  assert.ok(elapsedMs < 500, `Expected <500ms for 100k scan, got ${elapsedMs}ms`);
});

test('security: RBAC permissions isolate cashier from sensitive owner/accountant controls', () => {
  assert.equal(hasPermission('cashier', 'create_sale'), true);
  assert.equal(hasPermission('cashier', 'create_payment'), true);
  assert.equal(hasPermission('cashier', 'reverse_sale'), false);
  assert.equal(hasPermission('cashier', 'manage_users'), false);
  assert.equal(hasPermission('cashier', 'manage_backup'), false);
  assert.equal(hasPermission('cashier', 'view_profit'), false);
  assert.equal(hasPermission('owner', 'manage_users'), true);
  assert.equal(hasPermission('owner', 'manage_backup'), true);
});

test('marketing opt-out exclusion prevents opted-out customers from receiving offer campaigns', () => {
  const customers: Customer[] = [
    {
      id: 'c1',
      orgId: 'o1',
      branchId: 'b1',
      fullName: 'عميل موافق',
      phone: '777111111',
      address: '',
      category: 'vip',
      creditLimit: 0,
      status: 'active',
      marketingOptOut: false,
      notes: '',
      cachedBalance: 10000,
      cachedTotalPurchases: 10000,
      cachedTotalPaid: 0,
      purchaseCount: 1,
      createdAt: '',
      updatedAt: '',
      createdBy: 'u1',
      deviceId: 'd1',
      syncStatus: 'synced',
    },
    {
      id: 'c2',
      orgId: 'o1',
      branchId: 'b1',
      fullName: 'عميل مستبعد',
      phone: '777222222',
      address: '',
      category: 'vip',
      creditLimit: 0,
      status: 'active',
      marketingOptOut: true,
      notes: '',
      cachedBalance: 10000,
      cachedTotalPurchases: 10000,
      cachedTotalPaid: 0,
      purchaseCount: 1,
      createdAt: '',
      updatedAt: '',
      createdBy: 'u1',
      deviceId: 'd1',
      syncStatus: 'synced',
    },
  ];
  const sales: Sale[] = [];
  const payments: Payment[] = [];

  const marketingAudience = evaluateTargetAudience({
    customers,
    sales,
    payments,
    filter: 'vip',
    isMarketingCampaign: true,
  });
  assert.equal(marketingAudience.length, 1);
  assert.equal(marketingAudience[0].id, 'c1');

  const debtReminderAudience = evaluateTargetAudience({
    customers,
    sales,
    payments,
    filter: 'debtors',
    isMarketingCampaign: false,
  });
  assert.equal(debtReminderAudience.length, 2);
});

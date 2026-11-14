import { addMoney, mulMoney, roundMoney, subMoney, toLocalDateKey, toMinorUnits } from './money';
import type {
  Expense,
  LedgerEntry,
  Payment,
  PaymentAllocation,
  PaymentMode,
  Product,
  Sale,
  SaleItem,
} from './types';

export interface SaleCalculationInput {
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
  decimals: number;
}

export interface SaleCalculationResult {
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  remainingAmount: number;
}

export function calculateSaleTotals(input: SaleCalculationInput): SaleCalculationResult {
  const { decimals } = input;
  if (!input.items.length) {
    throw new Error('يجب إضافة صنف واحد على الأقل لإتمام البيع');
  }

  let subtotalMinor = 0;
  const computedItems: SaleItem[] = input.items.map((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error(`كمية غير صالحة للصنف: ${item.productName}`);
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new Error(`سعر غير صالح للصنف: ${item.productName}`);
    }
    const lineTotal = mulMoney(item.unitPrice, item.quantity, decimals);
    subtotalMinor += toMinorUnits(lineTotal, decimals);
    return {
      ...item,
      quantity: Number(item.quantity),
      unitPrice: roundMoney(item.unitPrice, decimals),
      lineTotal,
    };
  });

  const subtotal = roundMoney(subtotalMinor / Math.pow(10, decimals), decimals);
  const discount = roundMoney(Math.max(0, input.discount || 0), decimals);
  if (toMinorUnits(discount, decimals) > toMinorUnits(subtotal, decimals)) {
    throw new Error('لا يمكن أن يتجاوز الخصم إجمالي الفاتورة');
  }

  const total = subMoney(subtotal, discount, decimals);
  let paidAmount = 0;

  if (input.paymentMode === 'cash') {
    paidAmount = total;
  } else if (input.paymentMode === 'credit') {
    paidAmount = 0;
  } else {
    const requestedPaid = roundMoney(input.paidAmount, decimals);
    if (toMinorUnits(requestedPaid, decimals) <= 0) {
      throw new Error('في البيع الجزئي يجب إدخال مبلغ مدفوع أكبر من صفر');
    }
    if (toMinorUnits(requestedPaid, decimals) >= toMinorUnits(total, decimals)) {
      throw new Error('المبلغ المدفوع يساوي أو يتجاوز الإجمالي — استخدم البيع النقدي بالكامل');
    }
    paidAmount = requestedPaid;
  }

  const remainingAmount = subMoney(total, paidAmount, decimals);
  return {
    items: computedItems,
    subtotal,
    discount,
    total,
    paidAmount,
    remainingAmount,
  };
}

export function computeCustomerBalanceFromLedger(entries: LedgerEntry[], decimals = 0): number {
  let balanceMinor = 0;
  for (const e of entries) {
    balanceMinor += toMinorUnits(e.debit, decimals) - toMinorUnits(e.credit, decimals);
  }
  return roundMoney(balanceMinor / Math.pow(10, decimals), decimals);
}

export interface StatementRow {
  entry: LedgerEntry;
  runningBalance: number;
}

export interface CustomerStatementResult {
  openingBalance: number;
  rows: StatementRow[];
  totalPurchasesDebit: number;
  totalPaymentsCredit: number;
  totalDiscountsAndAdjustments: number;
  closingBalance: number;
}

export function computeCustomerLedgerStatement(
  entries: LedgerEntry[],
  fromDate?: string,
  toDate?: string,
  decimals = 0
): CustomerStatementResult {
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const fromDay = fromDate ? fromDate.slice(0, 10) : undefined;
  const toDay = toDate ? toDate.slice(0, 10) : undefined;

  let openingMinor = 0;
  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  let totalAdjMinor = 0;
  const rows: StatementRow[] = [];

  for (const entry of sorted) {
    const entryDay = toLocalDateKey(entry.createdAt);
    const debitMinor = toMinorUnits(entry.debit, decimals);
    const creditMinor = toMinorUnits(entry.credit, decimals);

    if (fromDay && entryDay < fromDay) {
      openingMinor += debitMinor - creditMinor;
      continue;
    }
    if (toDay && entryDay > toDay) {
      continue;
    }

    totalDebitMinor += debitMinor;
    totalCreditMinor += creditMinor;
    if (entry.discountAmount > 0) {
      totalAdjMinor += toMinorUnits(entry.discountAmount, decimals);
    } else if (entry.refType === 'adjustment') {
      totalAdjMinor += creditMinor > 0 ? creditMinor : debitMinor;
    }

    const prevMinor = rows.length
      ? toMinorUnits(rows[rows.length - 1].runningBalance, decimals)
      : openingMinor;
    const nextMinor = prevMinor + debitMinor - creditMinor;

    rows.push({
      entry,
      runningBalance: roundMoney(nextMinor / Math.pow(10, decimals), decimals),
    });
  }

  const openingBalance = roundMoney(openingMinor / Math.pow(10, decimals), decimals);
  const closingBalance = rows.length
    ? rows[rows.length - 1].runningBalance
    : openingBalance;

  return {
    openingBalance,
    rows,
    totalPurchasesDebit: roundMoney(totalDebitMinor / Math.pow(10, decimals), decimals),
    totalPaymentsCredit: roundMoney(totalCreditMinor / Math.pow(10, decimals), decimals),
    totalDiscountsAndAdjustments: roundMoney(totalAdjMinor / Math.pow(10, decimals), decimals),
    closingBalance,
  };
}

export function computeOpenSaleRemainingMap(
  sales: Sale[],
  payments: Payment[],
  decimals = 0
): Map<string, number> {
  const map = new Map<string, number>();
  for (const sale of sales) {
    if (sale.status === 'active' && toMinorUnits(sale.remainingAmount, decimals) > 0) {
      map.set(sale.id, toMinorUnits(sale.remainingAmount, decimals));
    }
  }
  for (const p of payments) {
    if (p.status !== 'active') continue;
    for (const alloc of p.allocations) {
      const cur = map.get(alloc.saleId);
      if (cur !== undefined) {
        map.set(alloc.saleId, Math.max(0, cur - toMinorUnits(alloc.amount, decimals)));
      }
    }
  }
  const result = new Map<string, number>();
  for (const [id, minor] of map.entries()) {
    if (minor > 0) {
      result.set(id, roundMoney(minor / Math.pow(10, decimals), decimals));
    }
  }
  return result;
}

export function allocatePaymentToInvoices(params: {
  openSales: Array<{ id: string; invoiceNumber: string; remainingAmount: number; createdAt: string }>;
  customerCurrentDebt: number;
  paymentAmount: number;
  mode: 'auto' | 'manual';
  manualAllocations?: PaymentAllocation[];
  allowExcessCredit?: boolean;
  decimals?: number;
}): {
  allocations: PaymentAllocation[];
  excessAmount: number;
} {
  const decimals = params.decimals ?? 0;
  const amountMinor = toMinorUnits(params.paymentAmount, decimals);
  const debtMinor = toMinorUnits(params.customerCurrentDebt, decimals);

  if (amountMinor <= 0) {
    throw new Error('يجب إدخال مبلغ سداد أكبر من صفر');
  }

  if (amountMinor > debtMinor && !params.allowExcessCredit) {
    throw new Error('مبلغ السداد يتجاوز إجمالي المديونية المستحقة على العميل');
  }

  if (params.mode === 'manual') {
    const manual = (params.manualAllocations || []).filter((a) => toMinorUnits(a.amount, decimals) > 0);
    let sumManualMinor = 0;
    const openMap = new Map(params.openSales.map((s) => [s.id, s]));

    for (const alloc of manual) {
      const sale = openMap.get(alloc.saleId);
      if (!sale) {
        throw new Error(`الفاتورة ${alloc.invoiceNumber} غير متاحة للسداد`);
      }
      const allocMinor = toMinorUnits(alloc.amount, decimals);
      if (allocMinor > toMinorUnits(sale.remainingAmount, decimals)) {
        throw new Error(`المبلغ المخصص للفاتورة ${alloc.invoiceNumber} يتجاوز المتبقي عليها`);
      }
      sumManualMinor += allocMinor;
    }

    if (sumManualMinor > amountMinor) {
      throw new Error('مجموع التوزيع اليدوي يتجاوز مبلغ السداد المدخل');
    }

    return {
      allocations: manual.map((a) => ({ ...a, amount: roundMoney(a.amount, decimals) })),
      excessAmount: roundMoney((amountMinor - sumManualMinor) / Math.pow(10, decimals), decimals),
    };
  }

  // FIFO Auto Allocation (oldest open invoices first)
  const sortedOpen = [...params.openSales]
    .filter((s) => toMinorUnits(s.remainingAmount, decimals) > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let remainingToAllocateMinor = amountMinor;
  const allocations: PaymentAllocation[] = [];

  for (const sale of sortedOpen) {
    if (remainingToAllocateMinor <= 0) break;
    const saleRemMinor = toMinorUnits(sale.remainingAmount, decimals);
    const appliedMinor = Math.min(remainingToAllocateMinor, saleRemMinor);
    if (appliedMinor > 0) {
      allocations.push({
        saleId: sale.id,
        invoiceNumber: sale.invoiceNumber,
        amount: roundMoney(appliedMinor / Math.pow(10, decimals), decimals),
      });
      remainingToAllocateMinor -= appliedMinor;
    }
  }

  return {
    allocations,
    excessAmount: roundMoney(remainingToAllocateMinor / Math.pow(10, decimals), decimals),
  };
}

export type AgingBucketKey = '1_7' | '8_30' | '31_60' | 'over_60';

export interface AgingSummary {
  bucket1_7: number;
  bucket8_30: number;
  bucket31_60: number;
  bucketOver60: number;
  totalOpenDebt: number;
  overdueCount: number;
}

export function classifyDebtAging(
  openSales: Array<{ id: string; remainingAmount: number; createdAt: string }>,
  referenceDateIso: string,
  decimals = 0
): AgingSummary {
  const refMs = new Date(referenceDateIso).getTime();
  let b1_7 = 0;
  let b8_30 = 0;
  let b31_60 = 0;
  let bOver60 = 0;
  let overdueCount = 0;

  for (const sale of openSales) {
    const remMinor = toMinorUnits(sale.remainingAmount, decimals);
    if (remMinor <= 0) continue;
    const ageDays = Math.max(1, Math.floor((refMs - new Date(sale.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
    if (ageDays <= 7) {
      b1_7 += remMinor;
    } else if (ageDays <= 30) {
      b8_30 += remMinor;
      overdueCount++;
    } else if (ageDays <= 60) {
      b31_60 += remMinor;
      overdueCount++;
    } else {
      bOver60 += remMinor;
      overdueCount++;
    }
  }

  const totalMinor = b1_7 + b8_30 + b31_60 + bOver60;
  const factor = Math.pow(10, decimals);
  return {
    bucket1_7: roundMoney(b1_7 / factor, decimals),
    bucket8_30: roundMoney(b8_30 / factor, decimals),
    bucket31_60: roundMoney(b31_60 / factor, decimals),
    bucketOver60: roundMoney(bOver60 / factor, decimals),
    totalOpenDebt: roundMoney(totalMinor / factor, decimals),
    overdueCount,
  };
}

export interface DailyCloseSummary {
  totalSales: number;
  cashSalesReceipts: number;
  creditSalesGenerated: number;
  oldDebtCollections: number;
  totalCashIn: number;
  totalExpenses: number;
  netCashMovement: number;
  openingBalance: number;
  expectedClosingBalance: number;
}

export function computeDailyCloseSummary(params: {
  daySales: Sale[];
  dayPayments: Payment[];
  dayExpenses: Expense[];
  openingBalance: number;
  decimals?: number;
}): DailyCloseSummary {
  const decimals = params.decimals ?? 0;
  let totalSales = 0;
  let cashSalesReceipts = 0;
  let creditSalesGenerated = 0;

  for (const s of params.daySales) {
    if (s.status !== 'active') continue;
    totalSales = addMoney(totalSales, s.total, decimals);
    cashSalesReceipts = addMoney(cashSalesReceipts, s.paidAmount, decimals);
    creditSalesGenerated = addMoney(creditSalesGenerated, s.remainingAmount, decimals);
  }

  let oldDebtCollections = 0;
  for (const p of params.dayPayments) {
    if (p.status !== 'active') continue;
    oldDebtCollections = addMoney(oldDebtCollections, p.amount, decimals);
  }

  let totalExpenses = 0;
  for (const e of params.dayExpenses) {
    if (e.status !== 'active') continue;
    totalExpenses = addMoney(totalExpenses, e.amount, decimals);
  }

  const totalCashIn = addMoney(cashSalesReceipts, oldDebtCollections, decimals);
  const netCashMovement = subMoney(totalCashIn, totalExpenses, decimals);
  const expectedClosingBalance = addMoney(params.openingBalance, netCashMovement, decimals);

  return {
    totalSales,
    cashSalesReceipts,
    creditSalesGenerated,
    oldDebtCollections,
    totalCashIn,
    totalExpenses,
    netCashMovement,
    openingBalance: roundMoney(params.openingBalance, decimals),
    expectedClosingBalance,
  };
}

export interface ProfitReportSummary {
  totalRevenue: number;
  costedRevenue: number;
  uncostedRevenue: number;
  recordedCost: number;
  actualProfitOnCostedItems: number;
  totalDiscounts: number;
  hasUncostedItems: boolean;
}

export function computeProfitReport(
  sales: Sale[],
  products: Product[],
  decimals = 0
): ProfitReportSummary {
  const productMap = new Map(products.map((p) => [p.id, p]));
  let totalRevenue = 0;
  let costedRevenue = 0;
  let uncostedRevenue = 0;
  let recordedCost = 0;
  let totalDiscounts = 0;

  for (const sale of sales) {
    if (sale.status !== 'active') continue;
    totalRevenue = addMoney(totalRevenue, sale.total, decimals);
    totalDiscounts = addMoney(totalDiscounts, sale.discount, decimals);

    const discountRatio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;

    for (const item of sale.items) {
      const effectiveLineRev = roundMoney(item.lineTotal * discountRatio, decimals);
      const itemCost = item.costPrice ?? productMap.get(item.productId)?.costPrice;

      if (itemCost !== undefined && itemCost > 0) {
        costedRevenue = addMoney(costedRevenue, effectiveLineRev, decimals);
        recordedCost = addMoney(recordedCost, mulMoney(itemCost, item.quantity, decimals), decimals);
      } else {
        uncostedRevenue = addMoney(uncostedRevenue, effectiveLineRev, decimals);
      }
    }
  }

  const actualProfitOnCostedItems = subMoney(costedRevenue, recordedCost, decimals);
  return {
    totalRevenue,
    costedRevenue,
    uncostedRevenue,
    recordedCost,
    actualProfitOnCostedItems,
    totalDiscounts,
    hasUncostedItems: toMinorUnits(uncostedRevenue, decimals) > 0,
  };
}

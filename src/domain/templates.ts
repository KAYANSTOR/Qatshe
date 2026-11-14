import { formatDateArabic, formatMoney, toLocalDateKey } from './money';
import type { AudienceFilterType, Customer, Organization, Payment, Sale } from './types';

export interface TemplateVariableContext {
  customerName: string;
  shopName: string;
  customerBalance: number;
  amountPaid?: number;
  remainingBalance?: number;
  lastPurchaseDate?: string;
  lastPaymentDate?: string;
  todayDate?: string;
  shopPhone: string;
  org: Pick<Organization, 'currency' | 'currencyDecimals' | 'numberLocale' | 'dateFormat'>;
}

export function renderTemplateVariables(body: string, ctx: TemplateVariableContext): string {
  const { currency, currencyDecimals, numberLocale, dateFormat } = ctx.org;
  const todayIso = ctx.todayDate || new Date().toISOString();

  const replacements: Record<string, string> = {
    '{customer_name}': ctx.customerName || 'عميلنا العزيز',
    '{shop_name}': ctx.shopName || 'قاتشي',
    '{customer_balance}': formatMoney(ctx.customerBalance, currency, currencyDecimals, numberLocale),
    '{amount_paid}': formatMoney(ctx.amountPaid ?? 0, currency, currencyDecimals, numberLocale),
    '{remaining_balance}': formatMoney(
      ctx.remainingBalance ?? ctx.customerBalance,
      currency,
      currencyDecimals,
      numberLocale
    ),
    '{last_purchase_date}': formatDateArabic(ctx.lastPurchaseDate, dateFormat),
    '{last_payment_date}': formatDateArabic(ctx.lastPaymentDate, dateFormat),
    '{today_date}': formatDateArabic(todayIso, dateFormat),
    '{shop_phone}': ctx.shopPhone || '',
  };

  let output = body;
  for (const [token, val] of Object.entries(replacements)) {
    output = output.split(token).join(val);
  }
  return output;
}

export function evaluateTargetAudience(params: {
  customers: Customer[];
  sales: Sale[];
  payments: Payment[];
  filter: AudienceFilterType;
  minDebtThreshold?: number;
  inactiveDays?: number;
  manualCustomerIds?: string[];
  isMarketingCampaign?: boolean;
  referenceDateIso?: string;
}): Customer[] {
  const refIso = params.referenceDateIso || new Date().toISOString();
  const todayPrefix = toLocalDateKey(refIso);
  const refMs = new Date(refIso).getTime();
  const inactiveDays = params.inactiveDays ?? 14;
  const minDebt = params.minDebtThreshold ?? 10000;

  const paidTodaySet = new Set(
    params.payments
      .filter((p) => p.status === 'active' && toLocalDateKey(p.createdAt) === todayPrefix)
      .map((p) => p.customerId)
  );

  const overdueCustomerSet = new Set<string>();
  const thirtyDaysAgoMs = refMs - 14 * 24 * 60 * 60 * 1000;
  for (const s of params.sales) {
    if (s.status === 'active' && s.remainingAmount > 0 && s.customerId) {
      if (new Date(s.createdAt).getTime() <= thirtyDaysAgoMs) {
        overdueCustomerSet.add(s.customerId);
      }
    }
  }

  return params.customers.filter((c) => {
    if (params.isMarketingCampaign && c.marketingOptOut) {
      return false;
    }

    switch (params.filter) {
      case 'all':
        return true;
      case 'active':
        return c.status === 'active';
      case 'vip':
        return c.category === 'vip' && c.status === 'active';
      case 'debtors':
        return c.cachedBalance > 0;
      case 'debt_above':
        return c.cachedBalance >= minDebt;
      case 'overdue':
        return c.cachedBalance > 0 && overdueCustomerSet.has(c.id);
      case 'paid_today':
        return paidTodaySet.has(c.id);
      case 'inactive': {
        if (!c.lastPurchaseAt) return true;
        const diffDays = (refMs - new Date(c.lastPurchaseAt).getTime()) / (1000 * 60 * 60 * 24);
        return diffDays >= inactiveDays;
      }
      case 'manual':
        return (params.manualCustomerIds || []).includes(c.id);
      default:
        return false;
    }
  });
}


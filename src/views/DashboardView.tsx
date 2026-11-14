import React, { useMemo } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BarChart3,
  FileSpreadsheet,
  Plus,
  UserPlus,
} from 'lucide-react';
import { useQatshi } from '../context/QatshiContext';
import { computeDailyCloseSummary } from '../domain/accounting';
import { formatCommercialRef } from '../domain/formatters';
import { formatDateArabic, formatMoney, toLocalDateKey } from '../domain/money';
import { EmptyState, KpiMetric, PageHeader, SurfaceCard } from '../components/ui/LuxuryUI';

export const DashboardView: React.FC = () => {
  const {
    org,
    sales,
    payments,
    expenses,
    cashboxSessions,
    orgCounts,
    totalReceivables,
    debtorsCount,
    navigate,
  } = useQatshi();

  const todayKey = toLocalDateKey();

  const metrics = useMemo(() => {
    if (!org) return null;
    const todaySales = sales.filter((s) => s.status === 'active' && toLocalDateKey(s.createdAt) === todayKey);
    const todayPayments = payments.filter((p) => p.status === 'active' && toLocalDateKey(p.createdAt) === todayKey);
    const todayExpenses = expenses.filter((e) => e.status === 'active' && e.date === todayKey);

    const todaySession = cashboxSessions.find((s) => s.date === todayKey);
    const openingBalance = todaySession?.openingBalance ?? 0;

    const dailyClose = computeDailyCloseSummary({
      daySales: todaySales,
      dayPayments: todayPayments,
      dayExpenses: todayExpenses,
      openingBalance,
      decimals: org.currencyDecimals,
    });

    const recentOps = [
      ...sales.slice(0, 5).map((s) => ({
        id: s.id,
        type: 'sale' as const,
        title: `${formatCommercialRef(s.invoiceNumber, 'sale')} — ${s.customerName}`,
        amount: s.total,
        sub:
          s.remainingAmount > 0
            ? `متبقي: ${formatMoney(s.remainingAmount, org.currency, org.currencyDecimals, org.numberLocale)}`
            : 'مدفوعة نقداً',
        date: s.createdAt,
        status: s.status,
      })),
      ...payments.slice(0, 5).map((p) => ({
        id: p.id,
        type: 'payment' as const,
        title: `${formatCommercialRef(p.receiptNumber, 'payment')} — ${p.customerName}`,
        amount: p.amount,
        sub: p.notes || 'تحصيل مديونية',
        date: p.createdAt,
        status: p.status,
      })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);

    return {
      dailyClose,
      totalReceivables,
      debtorsCount,
      recentOps,
    };
  }, [org, sales, payments, expenses, cashboxSessions, todayKey, totalReceivables, debtorsCount]);

  if (!org || !metrics) return null;

  const fmt = (val: number) => formatMoney(val, org.currency, org.currencyDecimals, org.numberLocale);
  const hasAnyData = orgCounts.customers > 0 || orgCounts.sales > 0 || orgCounts.payments > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="ملخص اليوم"
        subtitle={`${org.name} · ${formatDateArabic(new Date().toISOString(), org.dateFormat)}`}
      />

      {/* ONLY 4 Primary KPIs — Calm & Focused */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiMetric
          label="مبيعات اليوم"
          value={fmt(metrics.dailyClose.totalSales)}
          meta={`نقداً: ${fmt(metrics.dailyClose.cashSalesReceipts)}`}
          onClick={() => navigate('sales')}
        />
        <KpiMetric
          label="المبالغ المحصلة اليوم"
          value={fmt(metrics.dailyClose.totalCashIn)}
          meta={`تحصيل ديون: ${fmt(metrics.dailyClose.oldDebtCollections)}`}
          tone="positive"
          onClick={() => navigate('cashbox')}
        />
        <KpiMetric
          label="ديون العملاء الحالية"
          value={fmt(metrics.totalReceivables)}
          meta={`${metrics.debtorsCount} عميل مدين`}
          tone={metrics.totalReceivables > 0 ? 'danger' : 'positive'}
          onClick={() => navigate('debts')}
        />
        <KpiMetric
          label="رصيد الصندوق"
          value={fmt(metrics.dailyClose.expectedClosingBalance)}
          meta={`مصروفات اليوم: ${fmt(metrics.dailyClose.totalExpenses)}`}
          tone="positive"
          onClick={() => navigate('cashbox')}
        />
      </div>

      {/* Thumb-Friendly Daily Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => navigate('new_sale')}
          className="min-h-[58px] px-4 py-3 rounded-2xl bg-[#0F1F17] dark:bg-[#3E5A3F] text-white hover:bg-[#1E3A2E] active:scale-[0.98] transition-all flex items-center gap-3 text-right shadow-xs"
        >
          <span className="h-9 w-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Plus className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold">بيع جديد</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('collection')}
          className="min-h-[58px] px-4 py-3 rounded-2xl bg-white dark:bg-[#12241B] border border-[#C7CBB8]/70 dark:border-[#243B2E] hover:border-[#3E5A3F] active:scale-[0.98] transition-all flex items-center gap-3 text-right"
        >
          <span className="h-9 w-9 rounded-xl bg-[#EFF1EA] dark:bg-[#1E3A2E] flex items-center justify-center shrink-0">
            <Banknote className="h-5 w-5 text-[#1E3A2E] dark:text-[#8FB98D]" />
          </span>
          <span className="text-sm font-semibold">تسجيل سداد</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('customer_form')}
          className="min-h-[58px] px-4 py-3 rounded-2xl bg-white dark:bg-[#12241B] border border-[#C7CBB8]/70 dark:border-[#243B2E] hover:border-[#3E5A3F] active:scale-[0.98] transition-all flex items-center gap-3 text-right"
        >
          <span className="h-9 w-9 rounded-xl bg-[#EFF1EA] dark:bg-[#1E3A2E] flex items-center justify-center shrink-0">
            <UserPlus className="h-5 w-5 text-[#1E3A2E] dark:text-[#8FB98D]" />
          </span>
          <span className="text-sm font-semibold">إضافة عميل</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('customer_statement')}
          className="min-h-[58px] px-4 py-3 rounded-2xl bg-white dark:bg-[#12241B] border border-[#C7CBB8]/70 dark:border-[#243B2E] hover:border-[#3E5A3F] active:scale-[0.98] transition-all flex items-center gap-3 text-right"
        >
          <span className="h-9 w-9 rounded-xl bg-[#EFF1EA] dark:bg-[#1E3A2E] flex items-center justify-center shrink-0">
            <FileSpreadsheet className="h-5 w-5 text-[#1E3A2E] dark:text-[#8FB98D]" />
          </span>
          <span className="text-sm font-semibold">كشف حساب</span>
        </button>
      </div>

      {/* Empty State on Fresh Org OR Concise Recent Activity */}
      {!hasAnyData ? (
        <EmptyState
          title="ابدأ يومك في قاتشي"
          description="أضف أصناف القات وعملاءك لتسجيل أول عملية بيع أو تحصيل سداد بسهولة تامة حتى دون إنترنت."
          actionLabel="إضافة الأصناف والأسعار"
          onAction={() => navigate('products')}
        />
      ) : (
        <SurfaceCard className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-[#0F1F17] dark:text-[#E8EAE0]">
              آخر العمليات
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('reports')}
                className="min-h-[36px] text-xs font-medium text-[#3E5A3F] dark:text-[#C7CBB8] inline-flex items-center gap-1 hover:underline"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                التقارير التفصيلية
              </button>
              <button
                type="button"
                onClick={() => navigate('sales')}
                className="min-h-[36px] text-xs font-medium text-[#3E5A3F] dark:text-[#C7CBB8] hover:underline"
              >
                كل المبيعات
              </button>
            </div>
          </div>

          {metrics.recentOps.length === 0 ? (
            <p className="text-sm text-[#6B7F67] py-6 text-center">لا توجد عمليات مسجلة بعد</p>
          ) : (
            <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E]">
              {metrics.recentOps.map((op) => (
                <button
                  key={op.id}
                  type="button"
                  onClick={() =>
                    op.type === 'sale'
                      ? navigate('sale_detail', { saleId: op.id })
                      : navigate('receipt', { paymentId: op.id, receiptType: 'payment' })
                  }
                  className="w-full min-h-[64px] py-3 flex items-center justify-between gap-3 text-right hover:bg-[#F9FAF7] dark:hover:bg-[#193024] px-2 -mx-2 rounded-2xl transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-10 w-10 rounded-2xl bg-[#EFF1EA] dark:bg-[#1E3A2E] flex items-center justify-center shrink-0">
                      {op.type === 'sale' ? (
                        <ArrowUpRight className="h-4 w-4 text-[#1E3A2E] dark:text-[#C7CBB8]" />
                      ) : (
                        <ArrowDownLeft className="h-4 w-4 text-[#3E5A3F] dark:text-[#8FB98D]" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#0F1F17] dark:text-[#E8EAE0] truncate">
                        {op.title}
                      </div>
                      <div className="text-xs text-[#6B7F67] truncate mt-0.5">
                        {op.sub} · {formatDateArabic(op.date, org.dateFormat, true)}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`text-sm font-bold tabular-nums shrink-0 ${
                      op.status === 'reversed'
                        ? 'line-through text-red-600'
                        : op.type === 'payment'
                        ? 'text-[#1E3A2E] dark:text-[#8FB98D]'
                        : 'text-[#0F1F17] dark:text-[#E8EAE0]'
                    }`}
                  >
                    {fmt(op.amount)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}
    </div>
  );
};

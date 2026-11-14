import React, { useMemo } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Bell,
  Database,
  Layers,
  MessageSquare,
  Package,
  Plus,
  Settings,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useQatshi } from '../context/QatshiContext';
import { computeDailyCloseSummary } from '../domain/accounting';
import { formatCommercialRef } from '../domain/formatters';
import { formatDateArabic, formatMoney, toLocalDateKey } from '../domain/money';
import { hasPermission, type Permission } from '../domain/types';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { EmptyState, SurfaceCard } from '../components/ui/LuxuryUI';
import emblemImg from '../assets/images/qatshi_brand_emblem_1794643391707.jpg';

export const DashboardView: React.FC = () => {
  const {
    org,
    activeUser,
    customers,
    sales,
    payments,
    expenses,
    cashboxSessions,
    messageLogs,
    syncOps,
    orgCounts,
    totalReceivables,
    debtorsCount,
    navigate,
  } = useQatshi();
  const isOnline = useOnlineStatus();

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

    const collectionRate =
      dailyClose.totalSales > 0
        ? Math.min(100, Math.round((dailyClose.cashSalesReceipts / dailyClose.totalSales) * 100))
        : dailyClose.totalCashIn > 0
        ? 100
        : 0;

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
      .slice(0, 4);

    const overLimitCount = customers.filter((c) => c.creditLimit > 0 && c.cachedBalance > c.creditLimit).length;
    const pendingSmsCount = messageLogs.filter(
      (m) => m.status === 'pending' || m.status === 'sending' || m.status === 'failed'
    ).length;
    const pendingSyncCount = syncOps.filter((s) => s.status === 'pending' || s.status === 'conflict').length;
    const alertsCount = overLimitCount + pendingSmsCount + pendingSyncCount;

    return {
      dailyClose,
      collectionRate,
      recentOps,
      pendingSmsCount,
      alertsCount,
    };
  }, [org, customers, sales, payments, expenses, cashboxSessions, messageLogs, syncOps, todayKey]);

  if (!org || !metrics) return null;

  const fmt = (val: number) => formatMoney(val, org.currency, org.currencyDecimals, org.numberLocale);
  const hasAnyData = orgCounts.customers > 0 || orgCounts.sales > 0 || orgCounts.payments > 0;

  const allServices: Array<{
    id: string;
    title: string;
    desc: string;
    icon: React.ReactNode;
    tint: string;
    permission?: Permission;
    onClick: () => void;
  }> = [
    {
      id: 'srv-sale',
      title: 'بيع جديد',
      desc: 'فاتورة فورية',
      icon: <Plus className="h-5 w-5" />,
      tint: 'bg-[#E8EFE9] text-[#1E4230] dark:bg-[#193325] dark:text-[#86C89B]',
      permission: 'create_sale',
      onClick: () => navigate('new_sale'),
    },
    {
      id: 'srv-accounts',
      title: 'الحسابات',
      desc: `${orgCounts.customers} عميل`,
      icon: <Users className="h-5 w-5" />,
      tint: 'bg-[#F5EFE3] text-[#8E621C] dark:bg-[#2F2513] dark:text-[#EBB354]',
      onClick: () => navigate('customers'),
    },
    {
      id: 'srv-debts',
      title: 'الديون',
      desc: `${debtorsCount} مدين`,
      icon: <Layers className="h-5 w-5" />,
      tint: 'bg-[#FBEAE8] text-[#B93829] dark:bg-[#361815] dark:text-[#F07D70]',
      onClick: () => navigate('debts'),
    },
    {
      id: 'srv-collection',
      title: 'سند قبض',
      desc: 'تسجيل سداد',
      icon: <Banknote className="h-5 w-5" />,
      tint: 'bg-[#E8EFE9] text-[#1E5638] dark:bg-[#193325] dark:text-[#86C89B]',
      permission: 'create_payment',
      onClick: () => navigate('collection'),
    },
    {
      id: 'srv-cashbox',
      title: 'الصندوق',
      desc: 'الجرد اليومي',
      icon: <Wallet className="h-5 w-5" />,
      tint: 'bg-[#F1ECE6] text-[#5E472D] dark:bg-[#292118] dark:text-[#D5B994]',
      permission: 'manage_cashbox',
      onClick: () => navigate('cashbox'),
    },
    {
      id: 'srv-products',
      title: 'الأصناف',
      desc: 'الأسعار والأنواع',
      icon: <Package className="h-5 w-5" />,
      tint: 'bg-[#EAF0F6] text-[#244E78] dark:bg-[#16293C] dark:text-[#89BCEE]',
      permission: 'manage_products',
      onClick: () => navigate('products'),
    },
    {
      id: 'srv-reports',
      title: 'التقارير',
      desc: 'الأرباح والأداء',
      icon: <BarChart3 className="h-5 w-5" />,
      tint: 'bg-[#EFECE4] text-[#3F4A42] dark:bg-[#1E2E24] dark:text-[#C5D8CA]',
      permission: 'view_reports',
      onClick: () => navigate('reports'),
    },
    {
      id: 'srv-sms',
      title: 'رسالة جماعية',
      desc: 'إرسال سريع',
      icon: <MessageSquare className="h-5 w-5" />,
      tint: 'bg-[#EAF0F6] text-[#244E78] dark:bg-[#16293C] dark:text-[#89BCEE]',
      permission: 'manage_messaging',
      onClick: () => window.dispatchEvent(new CustomEvent('qatshi:open-bulk-sms')),
    },
    {
      id: 'srv-backup',
      title: 'النسخ الآمن',
      desc: 'حفظ واستعادة',
      icon: <Database className="h-5 w-5" />,
      tint: 'bg-[#EFECE4] text-[#3F4A42] dark:bg-[#1E2E24] dark:text-[#C5D8CA]',
      permission: 'manage_backup',
      onClick: () => navigate('backup'),
    },
  ];
  const services = allServices.filter(
    (item) => !item.permission || hasPermission(activeUser?.role, item.permission)
  );

  return (
    <div className="space-y-4">
      {/* 1. Prominent Curved-Bottom Top Header Card with Center Emblem & Hanging Circular Quick Buttons */}
      <div className="relative pb-5">
        <header className="pt-safe bg-gradient-to-br from-[#183526] via-[#1E4230] to-[#26523B] text-white rounded-b-[28px] px-4 pt-4 pb-8 shadow-[0_6px_22px_rgba(22,40,30,0.18)]">
          <div className="grid grid-cols-3 items-center gap-2">
            {/* RTL Start (Right): Shop Info & Date */}
            <div className="text-right min-w-0">
              <div className="text-xs font-extrabold text-white truncate">{org.name}</div>
              <div className="text-[10px] text-white/75 truncate mt-0.5">
                {formatDateArabic(new Date().toISOString(), org.dateFormat)}
              </div>
              {activeUser && (
                <div className="text-[10px] text-[#E6C98F] truncate mt-0.5">
                  {activeUser.name}
                </div>
              )}
            </div>

            {/* Center: Raised Square Logo Box */}
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-[18px] bg-white p-1 shadow-lg border border-[#E6C98F]/40 overflow-hidden">
                <img
                  src={emblemImg}
                  alt="شعار قاتشي"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover rounded-[13px]"
                />
              </div>
            </div>

            {/* RTL End (Left): System Name & Slogan */}
            <div className="text-left min-w-0">
              <div className="font-display text-base font-extrabold text-white tracking-tight">
                قاتشي
              </div>
              <div className="text-[10px] text-white/80 truncate">نظام الحسابات الذكي</div>
            </div>
          </div>
        </header>

        {/* Two Hanging Circular Quick-Access Buttons at Bottom Center */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('settings')}
            aria-label="الإعدادات"
            title="الإعدادات"
            className="h-10 w-10 rounded-full bg-white dark:bg-[#162B20] border border-[#E2DDD0] dark:border-[#2A4636] text-[#1E4230] dark:text-[#EEF2EC] shadow-md flex items-center justify-center hover:bg-[#FAF8F4] active:scale-[0.94] transition-transform"
          >
            <Settings className="h-4.5 w-4.5" />
          </button>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('qatshi:open-notifications'))}
            aria-label="الإشعارات"
            title="الإشعارات"
            className="relative h-10 w-10 rounded-full bg-white dark:bg-[#162B20] border border-[#E2DDD0] dark:border-[#2A4636] text-[#1E4230] dark:text-[#EEF2EC] shadow-md flex items-center justify-center hover:bg-[#FAF8F4] active:scale-[0.94] transition-transform"
          >
            <Bell className="h-4.5 w-4.5" />
            {metrics.alertsCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-1 rounded-full bg-[#B93829] text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                {metrics.alertsCount > 9 ? '9+' : metrics.alertsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Dashboard Body */}
      <div className="px-4 space-y-4">
        {/* 2. Three Compact Horizontal Status Badges */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => navigate('debts')}
            className="min-h-[34px] px-2 py-1.5 rounded-full bg-white dark:bg-[#12231A] border border-[#E4DFD4] dark:border-[#22382B] text-[11px] font-bold text-[#16281E] dark:text-[#EEF2EC] flex items-center justify-center gap-1 whitespace-nowrap truncate"
          >
            <span className={`h-2 w-2 rounded-full shrink-0 ${debtorsCount > 0 ? 'bg-[#B93829]' : 'bg-[#2E6046]'}`} />
            <span className="truncate tabular-nums">{debtorsCount} مدينون</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('sync')}
            className="min-h-[34px] px-2 py-1.5 rounded-full bg-[#E8EFE9] dark:bg-[#193325] border border-[#D4E0D6] dark:border-[#284C38] text-[11px] font-bold text-[#1E4230] dark:text-[#86C89B] flex items-center justify-center gap-1 whitespace-nowrap truncate"
          >
            {isOnline ? <Wifi className="h-3 w-3 shrink-0" /> : <WifiOff className="h-3 w-3 shrink-0 text-[#9E6A14]" />}
            <span className="truncate">{isOnline ? 'متصل · محفوظ' : 'دون إنترنت'}</span>
          </button>

          <button
            type="button"
            onClick={() => navigate(metrics.pendingSmsCount > 0 ? 'message_log' : 'cashbox')}
            className="min-h-[34px] px-2 py-1.5 rounded-full bg-white dark:bg-[#12231A] border border-[#E4DFD4] dark:border-[#22382B] text-[11px] font-bold text-[#16281E] dark:text-[#EEF2EC] flex items-center justify-center gap-1 whitespace-nowrap truncate"
          >
            <span className="truncate tabular-nums">
              {metrics.pendingSmsCount > 0 ? `${metrics.pendingSmsCount} رسالة معلقة` : 'الصندوق جاهز'}
            </span>
          </button>
        </div>

        {/* 3. Hero KPI Card */}
        <section className="rounded-[22px] bg-gradient-to-br from-[#1C3D2C] to-[#27513B] text-white p-4 shadow-[0_8px_24px_rgba(24,53,38,0.18)] space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-white/80">مبيعات اليوم</div>
              <div className="font-display text-2xl font-extrabold tabular-nums mt-0.5 truncate">
                {fmt(metrics.dailyClose.totalSales)}
              </div>
              <div className="text-[11px] text-[#E6C98F] mt-0.5 tabular-nums">
                نقداً: {fmt(metrics.dailyClose.cashSalesReceipts)} · تحصيل: {fmt(metrics.dailyClose.oldDebtCollections)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('cashbox')}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/20 text-[11px] font-bold text-white whitespace-nowrap shrink-0 transition-colors"
            >
              الصندوق: {fmt(metrics.dailyClose.expectedClosingBalance)}
            </button>
          </div>

          {/* 2 Mini Comparison Boxes */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => navigate('customers')}
              className="p-2.5 rounded-[14px] bg-white/10 hover:bg-white/15 text-right transition-colors"
            >
              <div className="text-[11px] text-white/75">إجمالي الحسابات</div>
              <div className="font-display text-base font-extrabold tabular-nums mt-0.5">
                {orgCounts.customers} عميل
              </div>
            </button>
            <button
              type="button"
              onClick={() => navigate('debts')}
              className="p-2.5 rounded-[14px] bg-white/10 hover:bg-white/15 text-right transition-colors"
            >
              <div className="text-[11px] text-white/75">ديون العملاء القائمة</div>
              <div className="font-display text-base font-extrabold tabular-nums text-[#F8D79C] mt-0.5 truncate">
                {fmt(totalReceivables)}
              </div>
            </button>
          </div>

          {/* Thin Visual Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-white/80 tabular-nums">
              <span>نسبة التحصيل النقدي لمبيعات اليوم</span>
              <span className="font-bold text-white">{metrics.collectionRate}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#E6C98F] transition-all duration-300"
                style={{ width: `${metrics.collectionRate}%` }}
              />
            </div>
          </div>
        </section>

        {/* 4. Three-Column Services Grid */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="font-display text-sm font-extrabold text-[#16281E] dark:text-[#EEF2EC]">
              أقسام النظام
            </h2>
            <span className="text-[11px] text-[#657369] dark:text-[#98A89C]">
              وصول سريع للعمليات
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {services.map((srv) => (
              <button
                key={srv.id}
                type="button"
                onClick={srv.onClick}
                className="min-h-[104px] p-3 rounded-[18px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] hover:border-[#2E6046] active:scale-[0.97] transition-all flex flex-col items-center justify-center gap-2 text-center shadow-[0_1px_6px_rgba(22,40,30,0.03)]"
              >
                <span className={`h-10 w-10 rounded-[13px] flex items-center justify-center shrink-0 ${srv.tint}`}>
                  {srv.icon}
                </span>
                <div className="min-w-0 w-full">
                  <div className="font-display text-xs font-extrabold text-[#16281E] dark:text-[#EEF2EC] truncate">
                    {srv.title}
                  </div>
                  <div className="text-[10px] text-[#657369] dark:text-[#98A89C] truncate mt-0.5">
                    {srv.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* 5. Recent Operations OR Clean Empty State */}
        {!hasAnyData ? (
          <EmptyState
            title="ابدأ العمل في قاتشي"
            description="أضف أصناف القات وعملاءك لتسجيل أول فاتورة بيع أو سند سداد بدقة محاسبية كاملة."
            actionLabel="إضافة الأصناف والأسعار"
            onAction={() => navigate('products')}
          />
        ) : (
          <SurfaceCard className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-extrabold text-[#16281E] dark:text-[#EEF2EC]">
                آخر العمليات المسجلة
              </h2>
              <button
                type="button"
                onClick={() => navigate('sales')}
                className="text-xs font-bold text-[#1E4230] dark:text-[#86C89B] hover:underline"
              >
                عرض الكل
              </button>
            </div>

            {metrics.recentOps.length === 0 ? (
              <p className="text-xs text-[#657369] py-4 text-center">لا توجد عمليات مسجلة بعد</p>
            ) : (
              <div className="divide-y divide-[#EFEBE2] dark:divide-[#203529]">
                {metrics.recentOps.map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() =>
                      op.type === 'sale'
                        ? navigate('sale_detail', { saleId: op.id })
                        : navigate('receipt', { paymentId: op.id, receiptType: 'payment' })
                    }
                    className="w-full py-2.5 flex items-center justify-between gap-2.5 text-right hover:bg-[#FAF8F4] dark:hover:bg-[#193325] px-1.5 -mx-1.5 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="h-9 w-9 rounded-[12px] bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#86C89B] flex items-center justify-center shrink-0">
                        {op.type === 'sale' ? (
                          <ArrowUpRight className="h-4 w-4" />
                        ) : (
                          <ArrowDownLeft className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#16281E] dark:text-[#EEF2EC] truncate">
                          {op.title}
                        </div>
                        <div className="text-[11px] text-[#657369] dark:text-[#98A89C] truncate mt-0.5">
                          {op.sub}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`text-xs font-extrabold tabular-nums shrink-0 ${
                        op.status === 'reversed'
                          ? 'line-through text-[#B93829]'
                          : op.type === 'payment'
                          ? 'text-[#1E5638] dark:text-[#86C89B]'
                          : 'text-[#16281E] dark:text-[#EEF2EC]'
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
    </div>
  );
};

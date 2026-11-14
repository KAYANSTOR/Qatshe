import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Download,
  FileSpreadsheet,
  Lock,
  MessageSquare,
  Package,
  Plus,
  Receipt,
  RotateCcw,
  Unlock,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useQatshi } from '../context/QatshiContext';
import { computeDailyCloseSummary, computeProfitReport } from '../domain/accounting';
import {
  buildCleanExportFileName,
  formatCommercialRef,
  formatPaymentMethodArabic,
  formatSequentialDocumentNumber,
} from '../domain/formatters';
import { formatDateArabic, formatMoney, toLocalDateKey } from '../domain/money';
import type { PaymentMethod } from '../domain/types';
import {
  createExpenseTransaction,
  reverseExpenseTransaction,
  saveCashboxSession,
} from '../services/accountingService';
import { generateUuid } from '../services/device';
import { SalesCollectionChart } from '../components/charts/SalesCollectionChart';
import {
  BottomSheet,
  EmptyState,
  HeaderCircleButton,
  KpiMetric,
  PageHeader,
  PrimaryButton,
  SurfaceCard,
} from '../components/ui/LuxuryUI';

export const CashboxView: React.FC = () => {
  const { org, activeUser, sales, payments, expenses, cashboxSessions, navigate, refreshData, showToast } = useQatshi();
  const [selectedDate, setSelectedDate] = useState(toLocalDateKey());
  const session = cashboxSessions.find((s) => s.date === selectedDate);
  const [openingInput, setOpeningInput] = useState(String(session?.openingBalance ?? 0));
  const [closeNotes, setCloseNotes] = useState(session?.notes || '');

  useEffect(() => {
    setOpeningInput(String(session?.openingBalance ?? 0));
    setCloseNotes(session?.notes || '');
  }, [selectedDate, session?.id, session?.openingBalance, session?.notes]);

  const summary = useMemo(() => {
    if (!org) return null;
    const daySales = sales.filter((s) => s.status === 'active' && toLocalDateKey(s.createdAt) === selectedDate);
    const dayPayments = payments.filter((p) => p.status === 'active' && toLocalDateKey(p.createdAt) === selectedDate);
    const dayExpenses = expenses.filter((e) => e.status === 'active' && e.date === selectedDate);
    return computeDailyCloseSummary({
      daySales,
      dayPayments,
      dayExpenses,
      openingBalance: session?.openingBalance ?? (Number(openingInput) || 0),
      decimals: org.currencyDecimals,
    });
  }, [org, sales, payments, expenses, selectedDate, session, openingInput]);

  if (!org || !activeUser || !summary) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const handleSaveSession = async (status: 'open' | 'closed') => {
    try {
      await saveCashboxSession({
        org,
        user: activeUser,
        date: selectedDate,
        openingBalance: Number(openingInput) || 0,
        closingBalance: status === 'closed' ? summary.expectedClosingBalance : undefined,
        status,
        notes: closeNotes,
      });
      await refreshData();
      showToast(
        status === 'closed'
          ? `تم إقفال صندوق يوم ${selectedDate} بنجاح`
          : session?.status === 'closed'
          ? `تمت إعادة فتح صندوق يوم ${selectedDate}`
          : 'تم تحديث الرصيد الافتتاحي'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ حالة الصندوق', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="الصندوق والإقفال اليومي"
        subtitle="فصل محاسبي تام بين مبيعات اليوم وتحصيل الديون"
        icon={<Wallet className="h-5 w-5" />}
        backAction={() => navigate('reports')}
        action={
          <PrimaryButton variant="secondary" onClick={() => navigate('expenses')} className="min-h-[40px] px-3 text-xs">
            المصروفات
          </PrimaryButton>
        }
      />

      <SurfaceCard className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-[#6B7F67]">تاريخ الجرد والإقفال</div>
          <div className="text-sm font-bold text-[#0F1F17] dark:text-[#E8EAE0]">
            {session?.status === 'closed' ? 'صندوق اليوم مغلق' : 'صندوق اليوم مفتوح'}
          </div>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          aria-label="تاريخ الصندوق"
          className="min-h-[44px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-xs tabular-nums"
        />
      </SurfaceCard>

      <div className="grid grid-cols-2 gap-2.5">
        <KpiMetric label="الرصيد الافتتاحي" value={fmt(summary.openingBalance)} />
        <KpiMetric label="مبيعات اليوم النقدية" value={fmt(summary.cashSalesReceipts)} tone="positive" />
        <KpiMetric label="تحصيل الديون القديمة" value={fmt(summary.oldDebtCollections)} tone="positive" />
        <KpiMetric label="المبيعات الآجلة (ذمم)" value={fmt(summary.creditSalesGenerated)} tone="warning" />
        <KpiMetric label="المصروفات اليومية" value={fmt(summary.totalExpenses)} tone="danger" />
        <KpiMetric label="الرصيد الختامي المتوقع" value={fmt(summary.expectedClosingBalance)} tone="positive" />
      </div>

      <SurfaceCard className="space-y-4">
        <h2 className="font-display text-base font-bold">إدارة حركة وإقفال الصندوق</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="cashbox-open" className="block text-sm font-medium mb-1.5">
              الرصيد الافتتاحي لليوم
            </label>
            <input
              id="cashbox-open"
              type="number"
              min="0"
              value={openingInput}
              onChange={(e) => setOpeningInput(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-base font-bold tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="cashbox-notes" className="block text-sm font-medium mb-1.5">
              ملاحظات الإقفال
            </label>
            <input
              id="cashbox-notes"
              type="text"
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              placeholder="مثال: جرد الصندوق مطابق"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#F4F5F0] dark:bg-[#0B1610] text-sm flex flex-wrap items-center justify-between gap-2">
          <span className="text-[#6B7F67]">صافي حركة اليوم النقدية</span>
          <strong className="tabular-nums text-[#0F1F17] dark:text-[#E8EAE0]">
            {fmt(summary.netCashMovement)}
          </strong>
          {session?.status === 'closed' && session.closedBy && (
            <span className="w-full text-xs text-[#6B7F67]">أُقفل بواسطة: {session.closedBy}</span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          {session?.status === 'closed' ? (
            (activeUser.role === 'owner' || activeUser.role === 'manager') && (
              <PrimaryButton variant="secondary" onClick={() => handleSaveSession('open')} className="w-full sm:w-auto">
                <Unlock className="h-4 w-4" />
                إعادة فتح اليوم
              </PrimaryButton>
            )
          ) : (
            <>
              <PrimaryButton variant="secondary" onClick={() => handleSaveSession('open')} className="w-full sm:w-auto">
                حفظ الرصيد الافتتاحي
              </PrimaryButton>
              <PrimaryButton onClick={() => handleSaveSession('closed')} className="w-full sm:w-auto sm:flex-1">
                <Lock className="h-4 w-4" />
                إقفال الصندوق اليومي
              </PrimaryButton>
            </>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
};

export const ExpensesView: React.FC = () => {
  const { org, activeUser, expenses, navigate, refreshData, showToast } = useQatshi();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('تشغيل ونقل');
  const [date, setDate] = useState(toLocalDateKey());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const submitLockRef = useRef(false);
  const idempotencyRef = useRef(generateUuid());

  if (!org || !activeUser) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || saving) return;
    submitLockRef.current = true;
    setSaving(true);
    try {
      await createExpenseTransaction({
        org,
        user: activeUser,
        title,
        amount: Number(amount),
        category,
        date,
        paymentMethod: method,
        notes,
        idempotencyKey: idempotencyRef.current,
      });
      idempotencyRef.current = generateUuid();
      setTitle('');
      setAmount('');
      setNotes('');
      await refreshData();
      showToast('تم تسجيل سند المصروف بنجاح');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تسجيل المصروف', 'error');
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="المصروفات اليومية"
        subtitle="توثيق كافة المصروفات التشغيلية وربطها بالصندوق"
        icon={<Receipt className="h-5 w-5" />}
        backAction={() => navigate('cashbox')}
      />

      <SurfaceCard>
        <form onSubmit={handleAdd} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="exp-title" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                اسم المصروف *
              </label>
              <input
                id="exp-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: تغليف، نقل، ضيافة..."
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label htmlFor="exp-amount" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                المبلغ *
              </label>
              <input
                id="exp-amount"
                type="number"
                min="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-base font-bold tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="exp-cat" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                التصنيف
              </label>
              <select
                id="exp-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              >
                <option value="تشغيل ونقل">تشغيل ونقل</option>
                <option value="مستلزمات بيع">مستلزمات بيع</option>
                <option value="إيجار وكهرباء">إيجار وكهرباء</option>
                <option value="رواتب وحوافز">رواتب وحوافز</option>
                <option value="أخرى">أخرى</option>
              </select>
            </div>
            <div>
              <label htmlFor="exp-method" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                طريقة الدفع
              </label>
              <select
                id="exp-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              >
                <option value="cash">نقداً من الصندوق</option>
                <option value="transfer">حوالة بنكية / صرافة</option>
                <option value="wallet">محفظة إلكترونية</option>
              </select>
            </div>
            <div>
              <label htmlFor="exp-date" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                التاريخ
              </label>
              <input
                id="exp-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="exp-notes" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                ملاحظات (اختياري)
              </label>
              <input
                id="exp-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="تفاصيل إضافية"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>
          </div>

          <PrimaryButton type="submit" disabled={saving} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            {saving ? 'جاري التسجيل...' : 'تسجيل سند مصروف'}
          </PrimaryButton>
        </form>
      </SurfaceCard>

      <div className="space-y-2.5">
        <h2 className="font-display text-base font-bold px-1">سجل سندات المصروفات</h2>
        {expenses.length === 0 ? (
          <EmptyState
            title="لا توجد مصروفات مسجلة بعد"
            description="سجل المصروفات اليومية مثل النقل والتغليف والكهرباء لمتابعة صافي الصندوق."
          />
        ) : (
          expenses.map((exp, idx) => {
            const voucherLabel = formatSequentialDocumentNumber('EXP', expenses.length - idx);
            return (
              <SurfaceCard key={exp.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="text-[11px] font-medium text-[#6B7F67]">{voucherLabel}</div>
                  <div className={`font-semibold text-sm truncate ${exp.status === 'reversed' ? 'line-through text-red-600' : ''}`}>
                    {exp.title}
                  </div>
                  <div className="text-xs text-[#6B7F67]">
                    {exp.category} · {exp.date} · {formatPaymentMethodArabic(exp.paymentMethod)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold text-sm tabular-nums text-red-700 dark:text-red-400">
                    {fmt(exp.amount)}
                  </span>
                  {exp.status === 'active' && (
                    <button
                      type="button"
                      aria-label={`عكس ${exp.title}`}
                      onClick={async () => {
                        try {
                          await reverseExpenseTransaction({ org, user: activeUser, expenseId: exp.id });
                          await refreshData();
                          showToast('تم عكس سند المصروف');
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : 'تعذر عكس المصروف', 'error');
                        }
                      }}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-2xl text-[#6B7F67] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </SurfaceCard>
            );
          })
        )}
      </div>
    </div>
  );
};

type ReportKind = 'sales_profit' | 'collections_debts' | 'top_products' | 'sms_summary';
type PeriodPreset = 'all' | 'today' | 'last7' | 'month';

export const ReportsView: React.FC = () => {
  const { org, customers, products, sales, payments, expenses, messageLogs, navigate, showToast } = useQatshi();
  const [activeReport, setActiveReport] = useState<ReportKind | null>(null);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');

  const todayKey = toLocalDateKey();
  const monthPrefix = todayKey.slice(0, 7);

  const overview = useMemo(() => {
    const completedCount = sales.filter((s) => s.status === 'active' && s.remainingAmount <= 0).length;
    const pendingCreditCount = sales.filter((s) => s.status === 'active' && s.remainingAmount > 0).length;
    const reversedCount = sales.filter((s) => s.status === 'reversed').length;

    const todaySales = sales.filter((s) => s.status === 'active' && toLocalDateKey(s.createdAt) === todayKey);
    const monthSales = sales.filter(
      (s) => s.status === 'active' && toLocalDateKey(s.createdAt).startsWith(monthPrefix)
    );

    return {
      completedCount,
      pendingCreditCount,
      reversedCount,
      todayTotal: todaySales.reduce((sum, s) => sum + s.total, 0),
      todayCount: todaySales.length,
      monthTotal: monthSales.reduce((sum, s) => sum + s.total, 0),
      monthCount: monthSales.length,
    };
  }, [sales, todayKey, monthPrefix]);

  const { fromDate, toDate } = useMemo(() => {
    if (periodPreset === 'today') return { fromDate: todayKey, toDate: todayKey };
    if (periodPreset === 'last7') {
      const start = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      return { fromDate: toLocalDateKey(start), toDate: todayKey };
    }
    if (periodPreset === 'month') {
      const d = new Date();
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      return { fromDate: toLocalDateKey(first), toDate: todayKey };
    }
    return { fromDate: '', toDate: '' };
  }, [periodPreset, todayKey]);

  const reportData = useMemo(() => {
    if (!org) return null;
    const filteredSales = sales.filter((s) => {
      if (s.status !== 'active') return false;
      const d = toLocalDateKey(s.createdAt);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });

    const filteredPayments = payments.filter((p) => {
      if (p.status !== 'active') return false;
      const d = toLocalDateKey(p.createdAt);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });

    const filteredExpenses = expenses.filter((e) => {
      if (e.status !== 'active') return false;
      if (fromDate && e.date < fromDate) return false;
      if (toDate && e.date > toDate) return false;
      return true;
    });

    const profit = computeProfitReport(filteredSales, products, org.currencyDecimals);
    const totalDebtCollections = filteredPayments.reduce((s, p) => s + p.amount, 0);
    const totalCashSales = filteredSales.reduce((s, x) => s + x.paidAmount, 0);
    const totalExpenses = filteredExpenses.reduce((s, x) => s + x.amount, 0);
    const totalOpenDebts = customers.reduce((s, c) => s + Math.max(0, c.cachedBalance), 0);

    const productRanking = new Map<string, { name: string; qty: number; rev: number }>();
    for (const s of filteredSales) {
      for (const i of s.items) {
        const cur = productRanking.get(i.productId) || { name: `${i.productName} (${i.grade})`, qty: 0, rev: 0 };
        cur.qty += i.quantity;
        cur.rev += i.lineTotal;
        productRanking.set(i.productId, cur);
      }
    }

    return {
      filteredSales,
      filteredPayments,
      filteredExpenses,
      profit,
      totalDebtCollections,
      totalCashSales,
      totalExpenses,
      totalOpenDebts,
      topProducts: [...productRanking.values()].sort((a, b) => b.rev - a.rev),
      sentMessagesCount: messageLogs.filter(
        (m) => m.status === 'sent_to_network' || m.status === 'delivered'
      ).length,
      deliveredMessagesCount: messageLogs.filter((m) => m.status === 'delivered').length,
      queuedMessagesCount: messageLogs.filter(
        (m) => m.status === 'pending' || m.status === 'sending'
      ).length,
      failedMessagesCount: messageLogs.filter((m) => m.status === 'failed').length,
    };
  }, [org, sales, payments, expenses, products, customers, messageLogs, fromDate, toDate]);

  if (!org || !reportData) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const exportReportWorkbook = (format: 'xlsx' | 'csv', label = 'المبيعات') => {
    const rows = reportData.filteredSales.map((s) => ({
      'رقم الفاتورة': formatCommercialRef(s.invoiceNumber, 'sale'),
      'التاريخ': formatDateArabic(s.createdAt, org.dateFormat),
      'العميل': s.customerName,
      'الإجمالي': s.total,
      'المدفوع': s.paidAmount,
      'المتبقي': s.remainingAmount,
      'طريقة الدفع': formatPaymentMethodArabic(s.paymentMethod),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير المبيعات');
    const fileName = buildCleanExportFileName(['تقرير', label, toLocalDateKey()], format);
    XLSX.writeFile(wb, fileName, { bookType: format });
    showToast(`تم تصدير التقرير (${label})`);
  };

  const reportTitles: Record<ReportKind, string> = {
    sales_profit: 'تقرير المبيعات والأرباح',
    collections_debts: 'تقرير التحصيل والديون',
    top_products: 'الأصناف الأكثر مبيعاً',
    sms_summary: 'ملخص الرسائل النصية',
  };

  const groups: Array<{
    heading: string;
    items: Array<{
      id: string;
      title: string;
      desc: string;
      icon: React.ReactNode;
      tint: string;
      onClick: () => void;
    }>;
  }> = [
    {
      heading: 'التقارير المالية والمبيعات',
      items: [
        {
          id: 'rep-sales',
          title: 'تقرير المبيعات والأرباح',
          desc: 'تحليل المبيعات والنقد المحصل والأرباح بالرسم البياني',
          icon: <BarChart3 className="h-4.5 w-4.5" />,
          tint: 'bg-[#E8EFE9] text-[#1E4230] dark:bg-[#193325] dark:text-[#86C89B]',
          onClick: () => setActiveReport('sales_profit'),
        },
        {
          id: 'rep-debts',
          title: 'تقرير التحصيل والديون',
          desc: 'مقارنة التحصيل النقدي والديون القائمة والمصروفات',
          icon: <Wallet className="h-4.5 w-4.5" />,
          tint: 'bg-[#F5EFE3] text-[#8E621C] dark:bg-[#2F2513] dark:text-[#EBB354]',
          onClick: () => setActiveReport('collections_debts'),
        },
        {
          id: 'rep-cashbox',
          title: 'الصندوق والإقفال اليومي',
          desc: 'جرد الصندوق اليومي والرصيد الافتتاحي والختامي',
          icon: <Receipt className="h-4.5 w-4.5" />,
          tint: 'bg-[#F1ECE6] text-[#5E472D] dark:bg-[#292118] dark:text-[#D5B994]',
          onClick: () => navigate('cashbox'),
        },
        {
          id: 'rep-expenses',
          title: 'سجل المصروفات التشغيلية',
          desc: 'تتبع المصروفات اليومية وعكس السندات',
          icon: <FileSpreadsheet className="h-4.5 w-4.5" />,
          tint: 'bg-[#FBEAE8] text-[#B93829] dark:bg-[#361815] dark:text-[#F07D70]',
          onClick: () => navigate('expenses'),
        },
      ],
    },
    {
      heading: 'تقارير الأصناف والتواصل',
      items: [
        {
          id: 'rep-products',
          title: 'الأصناف الأكثر مبيعاً',
          desc: 'ترتيب أنواع القات حسب الكميات المباعة والعائد',
          icon: <Package className="h-4.5 w-4.5" />,
          tint: 'bg-[#EAF0F6] text-[#244E78] dark:bg-[#16293C] dark:text-[#89BCEE]',
          onClick: () => setActiveReport('top_products'),
        },
        {
          id: 'rep-sms',
          title: 'ملخص الرسائل النصية',
          desc: 'إحصائيات الرسائل المرسلة والمؤكدة والمعلقة',
          icon: <MessageSquare className="h-4.5 w-4.5" />,
          tint: 'bg-[#E8EFE9] text-[#1E5638] dark:bg-[#193325] dark:text-[#86C89B]',
          onClick: () => setActiveReport('sms_summary'),
        },
        {
          id: 'rep-export',
          title: 'تصدير بيانات المبيعات (Excel)',
          desc: 'تنزيل سجل الفواتير كاملاً بصيغة XLSX للمراجعة',
          icon: <Download className="h-4.5 w-4.5" />,
          tint: 'bg-[#EFECE4] text-[#3F4A42] dark:bg-[#1E2E24] dark:text-[#C5D8CA]',
          onClick: () => exportReportWorkbook('xlsx', 'سجل_المبيعات'),
        },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="التقارير والمراقبة"
        subtitle="متابعة حركة العمليات ومقارنة الأداء"
        icon={<BarChart3 className="h-5 w-5" />}
        action={
          <HeaderCircleButton
            label="تصدير إكسل"
            onClick={() => exportReportWorkbook('xlsx', 'ملخص_المبيعات')}
          >
            <Download className="h-4 w-4" />
          </HeaderCircleButton>
        }
      />

      {/* 1. Three-Column Status Metric Cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-[18px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] p-3 text-center space-y-1.5 shadow-[0_1px_6px_rgba(22,40,30,0.03)]">
          <div className="h-9 w-9 mx-auto rounded-xl bg-[#E8EFE9] dark:bg-[#193325] text-[#1E5638] dark:text-[#86C89B] flex items-center justify-center">
            <CheckCircle2 className="h-4.5 w-4.5" />
          </div>
          <div className="font-display text-lg font-extrabold tabular-nums text-[#16281E] dark:text-[#EEF2EC]">
            {overview.completedCount}
          </div>
          <div className="text-[11px] font-medium text-[#657369] dark:text-[#98A89C] truncate">
            فواتير مسددة
          </div>
        </div>

        <div className="rounded-[18px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] p-3 text-center space-y-1.5 shadow-[0_1px_6px_rgba(22,40,30,0.03)]">
          <div className="h-9 w-9 mx-auto rounded-xl bg-[#F5EFE3] dark:bg-[#2F2513] text-[#9E6A14] dark:text-[#EBB354] flex items-center justify-center">
            <Clock className="h-4.5 w-4.5" />
          </div>
          <div className="font-display text-lg font-extrabold tabular-nums text-[#16281E] dark:text-[#EEF2EC]">
            {overview.pendingCreditCount}
          </div>
          <div className="text-[11px] font-medium text-[#657369] dark:text-[#98A89C] truncate">
            فواتير آجلة
          </div>
        </div>

        <div className="rounded-[18px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] p-3 text-center space-y-1.5 shadow-[0_1px_6px_rgba(22,40,30,0.03)]">
          <div className="h-9 w-9 mx-auto rounded-xl bg-[#FBEAE8] dark:bg-[#361815] text-[#B93829] dark:text-[#F07D70] flex items-center justify-center">
            <XCircle className="h-4.5 w-4.5" />
          </div>
          <div className="font-display text-lg font-extrabold tabular-nums text-[#16281E] dark:text-[#EEF2EC]">
            {overview.reversedCount}
          </div>
          <div className="text-[11px] font-medium text-[#657369] dark:text-[#98A89C] truncate">
            عمليات معكوسة
          </div>
        </div>
      </div>

      {/* 2. Vertically Split Sales Comparison Card (Today vs Month) */}
      <SurfaceCard className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#EFEBE2] dark:border-[#203529] flex items-center justify-between">
          <span className="font-display text-xs font-extrabold text-[#16281E] dark:text-[#EEF2EC]">
            مقارنة أداء المبيعات
          </span>
          <span className="text-[11px] text-[#657369] dark:text-[#98A89C]">
            اليوم مقابل الشهر الحالي
          </span>
        </div>

        <div className="grid grid-cols-2">
          <div className="p-4 text-right space-y-1 border-l border-[#EFEBE2] dark:border-[#203529]">
            <div className="text-[11px] font-medium text-[#657369] dark:text-[#98A89C]">
              مبيعات اليوم
            </div>
            <div className="font-display text-base font-extrabold tabular-nums text-[#1E4230] dark:text-[#86C89B] truncate">
              {fmt(overview.todayTotal)}
            </div>
            <div className="text-[11px] text-[#7A877D] dark:text-[#88988C] tabular-nums">
              {overview.todayCount} عملية نشطة
            </div>
          </div>

          <div className="p-4 text-right space-y-1">
            <div className="text-[11px] font-medium text-[#657369] dark:text-[#98A89C]">
              مبيعات الشهر
            </div>
            <div className="font-display text-base font-extrabold tabular-nums text-[#16281E] dark:text-[#EEF2EC] truncate">
              {fmt(overview.monthTotal)}
            </div>
            <div className="text-[11px] text-[#7A877D] dark:text-[#88988C] tabular-nums">
              {overview.monthCount} عملية نشطة
            </div>
          </div>
        </div>
      </SurfaceCard>

      {/* 3. Grouped Navigation Lists */}
      {groups.map((grp) => (
        <section key={grp.heading} className="space-y-2">
          <h2 className="font-display text-xs font-extrabold text-[#657369] dark:text-[#98A89C] px-1">
            {grp.heading}
          </h2>
          <SurfaceCard className="p-0 overflow-hidden divide-y divide-[#EFEBE2] dark:divide-[#203529]">
            {grp.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className="w-full px-3.5 py-3 flex items-center justify-between gap-3 text-right hover:bg-[#FAF8F4] dark:hover:bg-[#193325] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={`h-10 w-10 rounded-[13px] flex items-center justify-center shrink-0 ${item.tint}`}>
                    {item.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-sm font-bold text-[#16281E] dark:text-[#EEF2EC] truncate">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[#657369] dark:text-[#98A89C] truncate mt-0.5">
                      {item.desc}
                    </div>
                  </div>
                </div>
                <ChevronLeft className="h-4.5 w-4.5 text-[#8D9990] shrink-0" />
              </button>
            ))}
          </SurfaceCard>
        </section>
      ))}

      {/* Interactive Report Detail Bottom Sheet */}
      <BottomSheet
        open={Boolean(activeReport)}
        onClose={() => setActiveReport(null)}
        title={activeReport ? reportTitles[activeReport] : ''}
        subtitle={fromDate || toDate ? `الفترة: ${fromDate} إلى ${toDate}` : 'كامل السجل المسجل'}
        headerIcon={<BarChart3 className="h-5 w-5" />}
        footer={
          activeReport && (
            <div className="flex items-center gap-2">
              <PrimaryButton
                onClick={() => exportReportWorkbook('xlsx', reportTitles[activeReport])}
                className="flex-1"
              >
                <Download className="h-4 w-4" />
                تصدير إكسل
              </PrimaryButton>
              <PrimaryButton
                variant="secondary"
                onClick={() => exportReportWorkbook('csv', reportTitles[activeReport])}
              >
                CSV
              </PrimaryButton>
            </div>
          )
        }
      >
        {/* Quick Period Filter Pills inside Report Modal */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {[
            { id: 'all' as PeriodPreset, label: 'كامل السجل' },
            { id: 'today' as PeriodPreset, label: 'اليوم' },
            { id: 'last7' as PeriodPreset, label: 'آخر 7 أيام' },
            { id: 'month' as PeriodPreset, label: 'هذا الشهر' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriodPreset(p.id)}
              className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap shrink-0 border ${
                periodPreset === p.id
                  ? 'bg-[#1E4230] text-white border-[#1E4230] dark:bg-[#2E6046] dark:border-[#2E6046]'
                  : 'bg-[#FAF8F4] dark:bg-[#0D1A13] border-[#E4DFD4] dark:border-[#22382B] text-[#4C5850] dark:text-[#C5D8CA]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {activeReport === 'sales_profit' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <KpiMetric label="إجمالي المبيعات" value={fmt(reportData.profit.totalRevenue)} />
              <KpiMetric
                label="النقد المحصل"
                value={fmt(reportData.totalCashSales + reportData.totalDebtCollections)}
                tone="positive"
              />
              <KpiMetric label="المصروفات" value={fmt(reportData.totalExpenses)} tone="danger" />
              <KpiMetric
                label="الربح الفعلي"
                value={fmt(reportData.profit.actualProfitOnCostedItems)}
                tone="positive"
                meta={
                  reportData.profit.hasUncostedItems
                    ? `${fmt(reportData.profit.uncostedRevenue)} دون تكلفة`
                    : 'الأصناف مسجلة التكلفة'
                }
              />
            </div>

            <div className="rounded-[18px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E4DFD4] dark:border-[#22382B] p-3">
              <SalesCollectionChart
                sales={reportData.filteredSales}
                payments={reportData.filteredPayments}
                org={org}
              />
            </div>
          </div>
        )}

        {activeReport === 'collections_debts' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <KpiMetric label="تحصيل فواتير اليوم" value={fmt(reportData.totalCashSales)} tone="positive" />
              <KpiMetric label="تحصيل ديون قديمة" value={fmt(reportData.totalDebtCollections)} tone="positive" />
              <KpiMetric label="الديون القائمة حالياً" value={fmt(reportData.totalOpenDebts)} tone="warning" />
              <KpiMetric label="إجمالي المصروفات" value={fmt(reportData.totalExpenses)} tone="danger" />
            </div>

            <div className="rounded-[18px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E4DFD4] dark:border-[#22382B] p-3 space-y-2">
              <div className="text-xs font-bold">سندات التحصيل في الفترة</div>
              {reportData.filteredPayments.length === 0 ? (
                <p className="text-xs text-[#657369] py-3 text-center">لا توجد عمليات تحصيل في هذه الفترة.</p>
              ) : (
                <div className="divide-y divide-[#EFEBE2] dark:divide-[#203529]">
                  {reportData.filteredPayments.slice(0, 15).map((p) => (
                    <div key={p.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-bold truncate">{p.customerName}</div>
                        <div className="text-[11px] text-[#657369]">
                          {formatCommercialRef(p.receiptNumber, 'payment')} · {formatPaymentMethodArabic(p.paymentMethod)}
                        </div>
                      </div>
                      <span className="font-extrabold tabular-nums text-[#1E5638] dark:text-[#86C89B] shrink-0">
                        {fmt(p.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeReport === 'top_products' && (
          <div className="rounded-[18px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E4DFD4] dark:border-[#22382B] p-3 space-y-2">
            {reportData.topProducts.length === 0 ? (
              <p className="text-xs text-[#657369] py-4 text-center">لا توجد مبيعات مسجلة خلال هذه الفترة.</p>
            ) : (
              <div className="divide-y divide-[#EFEBE2] dark:divide-[#203529]">
                {reportData.topProducts.map((p, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-bold truncate">{p.name}</div>
                      <div className="text-[11px] text-[#657369]">{p.qty} وحدة مباعة</div>
                    </div>
                    <span className="font-extrabold tabular-nums shrink-0">{fmt(p.rev)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeReport === 'sms_summary' && (
          <div className="grid grid-cols-2 gap-2.5">
            <KpiMetric label="رسائل مرسلة للشبكة" value={String(reportData.sentMessagesCount)} tone="positive" />
            <KpiMetric label="تم تأكيد التسليم" value={String(reportData.deliveredMessagesCount)} tone="positive" />
            <KpiMetric label="بانتظار الإرسال" value={String(reportData.queuedMessagesCount)} tone="warning" />
            <KpiMetric label="تعذر إرسالها" value={String(reportData.failedMessagesCount)} tone="danger" />
          </div>
        )}
      </BottomSheet>
    </div>
  );
};

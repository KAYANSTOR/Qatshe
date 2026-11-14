import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  BarChart3,
  Download,
  Lock,
  MessageSquare,
  Package,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Unlock,
  Wallet,
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
  EmptyState,
  KpiMetric,
  PageHeader,
  PrimaryButton,
  StepProgress,
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
        subtitle="فصل محاسبي تام بين مبيعات اليوم وتحصيل الديون القديمة"
        backAction={() => navigate('dashboard')}
        action={
          <PrimaryButton variant="secondary" onClick={() => navigate('expenses')}>
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
          className="min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
        />
      </SurfaceCard>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
type PeriodPreset = 'all' | 'today' | 'last7' | 'month' | 'custom';

export const ReportsView: React.FC = () => {
  const { org, customers, products, sales, payments, expenses, messageLogs, navigate, showToast } = useQatshi();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reportType, setReportType] = useState<ReportKind>('sales_profit');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');

  const applyPeriodPreset = (preset: PeriodPreset) => {
    setPeriodPreset(preset);
    const today = toLocalDateKey();
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
    } else if (preset === 'today') {
      setFromDate(today);
      setToDate(today);
    } else if (preset === 'last7') {
      const start = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      setFromDate(toLocalDateKey(start));
      setToDate(today);
    } else if (preset === 'month') {
      const d = new Date();
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      setFromDate(toLocalDateKey(first));
      setToDate(today);
    }
  };

  const reportData = useMemo(() => {
    if (!org) return null;
    const filteredSales = sales.filter((s) => {
      if (s.status !== 'active') return false;
      const d = toLocalDateKey(s.createdAt);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      if (customerId && s.customerId !== customerId) return false;
      if (productId && !s.items.some((i) => i.productId === productId)) return false;
      return true;
    });

    const filteredPayments = payments.filter((p) => {
      if (p.status !== 'active') return false;
      const d = toLocalDateKey(p.createdAt);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      if (customerId && p.customerId !== customerId) return false;
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
        if (productId && i.productId !== productId) continue;
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
  }, [org, sales, payments, expenses, products, customers, messageLogs, fromDate, toDate, customerId, productId]);

  if (!org || !reportData) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const reportOptions: Array<{
    id: ReportKind;
    title: string;
    desc: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    {
      id: 'sales_profit',
      title: 'المبيعات والأرباح',
      desc: 'تحليل إجمالي المبيعات، النقد المحصل، والأرباح الفعلية',
      icon: BarChart3,
    },
    {
      id: 'collections_debts',
      title: 'التحصيل والديون',
      desc: 'متابعة السداد النقدي والديون القائمة والمصروفات',
      icon: Wallet,
    },
    {
      id: 'top_products',
      title: 'الأصناف الأكثر مبيعاً',
      desc: 'ترتيب أصناف القات حسب الكميات المباعة والعائد',
      icon: Package,
    },
    {
      id: 'sms_summary',
      title: 'ملخص الرسائل النصية',
      desc: 'تقرير حالة الرسائل المرسلة والمؤكدة عبر شريحة الهاتف',
      icon: MessageSquare,
    },
  ];

  const activeReportMeta = reportOptions.find((r) => r.id === reportType) || reportOptions[0];

  const exportReportWorkbook = (format: 'xlsx' | 'csv') => {
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
    const fileName = buildCleanExportFileName(['تقرير', activeReportMeta.title, toLocalDateKey()], format);
    XLSX.writeFile(wb, fileName, { bookType: format });
    showToast(`تم تصدير التقرير (${activeReportMeta.title})`);
  };

  const stepTitles = [
    '1. اختيار نوع التقرير',
    '2. تحديد الفترة والتصفية',
    `3. نتائج: ${activeReportMeta.title}`,
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="مركز التقارير"
        subtitle="تقارير واضحة ومبسطة خطوة بخطوة مع تصدير الجداول"
        backAction={() => {
          if (step > 1) setStep((s) => (s === 3 ? 2 : 1));
          else navigate('dashboard');
        }}
      />

      <StepProgress currentStep={step} totalSteps={3} stepTitle={stepTitles[step - 1]} />

      {step === 1 && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {reportOptions.map((opt) => {
              const Icon = opt.icon;
              const selected = reportType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setReportType(opt.id);
                    setStep(2);
                  }}
                  className={`min-h-[84px] text-right rounded-3xl p-4 sm:p-5 border transition-all flex items-start gap-3.5 active:scale-[0.985] ${
                    selected
                      ? 'bg-[#EFF3EB] dark:bg-[#193024] border-[#1E3A2E] dark:border-[#8FB98D]'
                      : 'bg-white dark:bg-[#12241B] border-[#C7CBB8]/65 dark:border-[#243B2E]'
                  }`}
                >
                  <div className="h-11 w-11 rounded-2xl bg-[#0F1F17] dark:bg-[#3E5A3F] text-white flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-bold text-base text-[#0F1F17] dark:text-[#E8EAE0]">
                      {opt.title}
                    </div>
                    <p className="mt-1 text-xs text-[#6B7F67] dark:text-[#9AA896] leading-relaxed">
                      {opt.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <PrimaryButton type="button" onClick={() => setStep(2)} className="w-full">
            التالي: تحديد الفترة والتصفية
            <ArrowLeft className="h-4 w-4" />
          </PrimaryButton>
        </div>
      )}

      {step === 2 && (
        <SurfaceCard className="space-y-5">
          <div>
            <div className="text-sm font-bold mb-2.5">اختر الفترة الزمنية</div>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all' as PeriodPreset, label: 'جميع الفترات' },
                { id: 'today' as PeriodPreset, label: 'اليوم' },
                { id: 'last7' as PeriodPreset, label: 'آخر 7 أيام' },
                { id: 'month' as PeriodPreset, label: 'هذا الشهر' },
                { id: 'custom' as PeriodPreset, label: 'فترة مخصصة' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPeriodPreset(p.id)}
                  className={`min-h-[44px] px-4 py-2 rounded-2xl text-xs sm:text-sm font-medium transition-colors ${
                    periodPreset === p.id
                      ? 'bg-[#0F1F17] text-white dark:bg-[#3E5A3F]'
                      : 'bg-[#EFF1EA] dark:bg-[#0B1610] text-[#3D4337] dark:text-[#C7CBB8]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {(periodPreset === 'custom' || fromDate || toDate) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="rep-from" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                  من تاريخ
                </label>
                <input
                  id="rep-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setPeriodPreset('custom');
                    setFromDate(e.target.value);
                  }}
                  className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="rep-to" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                  إلى تاريخ
                </label>
                <input
                  id="rep-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setPeriodPreset('custom');
                    setToDate(e.target.value);
                  }}
                  className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
                />
              </div>
            </div>
          )}

          {reportType !== 'sms_summary' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="rep-cust" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                  تصفية حسب العميل (اختياري)
                </label>
                <select
                  id="rep-cust"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                >
                  <option value="">جميع العملاء</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="rep-prod" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                  تصفية حسب الصنف (اختياري)
                </label>
                <select
                  id="rep-prod"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                >
                  <option value="">جميع الأصناف</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.grade})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
            <PrimaryButton type="button" variant="secondary" onClick={() => setStep(1)} className="w-full sm:w-auto">
              السابق
            </PrimaryButton>
            <PrimaryButton type="button" onClick={() => setStep(3)} className="w-full sm:flex-1">
              عرض نتائج التقرير
            </PrimaryButton>
          </div>
        </SurfaceCard>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <SurfaceCard className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-[#6B7F67]">التقرير المعروض</div>
              <div className="font-display font-bold text-base">
                {activeReportMeta.title}
                {fromDate || toDate ? ` (${fromDate || '...'} إلى ${toDate || '...'})` : ' (كامل السجل)'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton variant="secondary" onClick={() => setStep(2)}>
                <SlidersHorizontal className="h-4 w-4" />
                تغيير الفلاتر
              </PrimaryButton>
              <PrimaryButton variant="secondary" onClick={() => exportReportWorkbook('csv')}>
                تصدير جدول
              </PrimaryButton>
              <PrimaryButton onClick={() => exportReportWorkbook('xlsx')}>
                <Download className="h-4 w-4" />
                تصدير إكسل
              </PrimaryButton>
            </div>
          </SurfaceCard>

          {reportType === 'sales_profit' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                      ? `يوجد ${fmt(reportData.profit.uncostedRevenue)} دون تكلفة مسجلة`
                      : 'كافة الأصناف مسجلة التكلفة'
                  }
                />
              </div>

              <SurfaceCard>
                <SalesCollectionChart
                  sales={reportData.filteredSales}
                  payments={reportData.filteredPayments}
                  org={org}
                />
              </SurfaceCard>
            </>
          )}

          {reportType === 'collections_debts' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiMetric label="تحصيل فواتير اليوم" value={fmt(reportData.totalCashSales)} tone="positive" />
                <KpiMetric label="تحصيل ديون قديمة" value={fmt(reportData.totalDebtCollections)} tone="positive" />
                <KpiMetric label="الديون القائمة حالياً" value={fmt(reportData.totalOpenDebts)} tone="warning" />
                <KpiMetric label="إجمالي المصروفات" value={fmt(reportData.totalExpenses)} tone="danger" />
              </div>

              <SurfaceCard className="space-y-3">
                <h3 className="font-display text-base font-bold">سندات التحصيل في الفترة</h3>
                {reportData.filteredPayments.length === 0 ? (
                  <p className="text-sm text-[#6B7F67] py-4 text-center">لا توجد عمليات تحصيل في هذه الفترة.</p>
                ) : (
                  <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E]">
                    {reportData.filteredPayments.slice(0, 20).map((p) => (
                      <div key={p.id} className="py-3 flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{p.customerName}</div>
                          <div className="text-xs text-[#6B7F67]">
                            {formatCommercialRef(p.receiptNumber, 'payment')} · {formatPaymentMethodArabic(p.paymentMethod)}
                          </div>
                        </div>
                        <span className="font-bold tabular-nums text-[#1E3A2E] dark:text-[#8FB98D] shrink-0">
                          {fmt(p.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SurfaceCard>
            </>
          )}

          {reportType === 'top_products' && (
            <SurfaceCard className="space-y-3">
              <h3 className="font-display text-base font-bold">ترتيب الأصناف الأكثر مبيعاً</h3>
              {reportData.topProducts.length === 0 ? (
                <p className="text-sm text-[#6B7F67] py-6 text-center">لا توجد مبيعات مسجلة خلال هذه الفترة.</p>
              ) : (
                <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E]">
                  {reportData.topProducts.map((p, idx) => (
                    <div key={idx} className="py-3 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{p.name}</div>
                        <div className="text-xs text-[#6B7F67]">{p.qty} وحدة مباعة</div>
                      </div>
                      <span className="font-bold tabular-nums shrink-0">{fmt(p.rev)}</span>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>
          )}

          {reportType === 'sms_summary' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiMetric label="رسائل مرسلة للشبكة" value={String(reportData.sentMessagesCount)} tone="positive" />
              <KpiMetric label="تم تأكيد التسليم" value={String(reportData.deliveredMessagesCount)} tone="positive" />
              <KpiMetric label="بانتظار الإرسال" value={String(reportData.queuedMessagesCount)} tone="warning" />
              <KpiMetric label="تعذر إرسالها" value={String(reportData.failedMessagesCount)} tone="danger" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

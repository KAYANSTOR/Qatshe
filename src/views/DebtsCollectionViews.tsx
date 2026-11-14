import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Download, HandCoins, Printer, ReceiptText, RotateCcw, Search, Share2 } from 'lucide-react';
import { useQatshi } from '../context/QatshiContext';
import { classifyDebtAging, computeOpenSaleRemainingMap } from '../domain/accounting';
import { formatCommercialRef } from '../domain/formatters';
import { formatDateArabic, formatMoney, roundMoney, toLocalDateKey } from '../domain/money';
import { hasPermission, type Payment, type PaymentAllocation, type PaymentMethod, type Sale } from '../domain/types';
import {
  createPaymentTransaction,
  queryCustomerFinancialProfile,
  reversePaymentTransaction,
} from '../services/accountingService';
import { generateUuid } from '../services/device';
import { generateReceiptPdf, triggerBlobDownload } from '../services/pdfGenerator';
import { sharePdfDocument } from '../services/shareService';
import { EmptyState, KpiMetric, PageHeader, PrimaryButton, SurfaceCard } from '../components/ui/LuxuryUI';

export const DebtsView: React.FC = () => {
  const { org, customers, sales, payments, navigate } = useQatshi();
  const [filterMode, setFilterMode] = useState<'all' | 'over_limit' | 'overdue'>('all');

  const debtData = useMemo(() => {
    if (!org) return null;
    const openMap = computeOpenSaleRemainingMap(sales, payments, org.currencyDecimals);
    const openSales = sales
      .filter((s) => openMap.has(s.id))
      .map((s) => ({
        ...s,
        openRemaining: openMap.get(s.id)!,
      }));

    const aging = classifyDebtAging(
      openSales.map((s) => ({ id: s.id, remainingAmount: s.openRemaining, createdAt: s.createdAt })),
      new Date().toISOString(),
      org.currencyDecimals
    );

    const todayPrefix = toLocalDateKey();
    const newDebtsToday = sales
      .filter((s) => s.status === 'active' && toLocalDateKey(s.createdAt) === todayPrefix)
      .reduce((sum, s) => sum + s.remainingAmount, 0);

    const debtors = customers
      .filter((c) => c.cachedBalance > 0)
      .sort((a, b) => b.cachedBalance - a.cachedBalance);

    const overdueCustomerIds = new Set(
      openSales
        .filter((s) => (Date.now() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60 * 24) > 7)
        .map((s) => s.customerId)
    );

    const filteredDebtors = debtors.filter((c) => {
      if (filterMode === 'over_limit') return c.creditLimit > 0 && c.cachedBalance > c.creditLimit;
      if (filterMode === 'overdue') return overdueCustomerIds.has(c.id);
      return true;
    });

    return {
      aging,
      newDebtsToday,
      totalDebt: debtors.reduce((sum, c) => sum + c.cachedBalance, 0),
      overLimitCount: debtors.filter((c) => c.creditLimit > 0 && c.cachedBalance > c.creditLimit).length,
      filteredDebtors,
      overdueCustomerIds,
    };
  }, [org, customers, sales, payments, filterMode]);

  if (!org || !debtData) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  return (
    <div className="space-y-4">
      <PageHeader
        title="الديون والتحصيل"
        subtitle={`${debtData.filteredDebtors.length} عميل عليه رصيد مستحق`}
        icon={<HandCoins className="h-5 w-5" />}
        action={
          <PrimaryButton onClick={() => navigate('collection')}>
            <Banknote className="h-4 w-4" />
            سداد
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <KpiMetric label="إجمالي الديون المستحقة" value={fmt(debtData.totalDebt)} tone="danger" />
        <KpiMetric label="ديون جديدة اليوم" value={fmt(debtData.newDebtsToday)} tone="warning" />
        <KpiMetric label="فواتير متأخرة (+7 أيام)" value={String(debtData.aging.overdueCount)} tone="warning" />
        <KpiMetric label="تجاوزوا الحد الائتماني" value={String(debtData.overLimitCount)} tone="danger" />
      </div>

      <SurfaceCard className="space-y-3">
        <h2 className="font-display text-sm font-bold">أعمار الديون</h2>
        <div className="grid grid-cols-2 gap-2.5">
          <KpiMetric label="1 إلى 7 أيام" value={fmt(debtData.aging.bucket1_7)} />
          <KpiMetric label="8 إلى 30 يوماً" value={fmt(debtData.aging.bucket8_30)} tone="warning" />
          <KpiMetric label="31 إلى 60 يوماً" value={fmt(debtData.aging.bucket31_60)} tone="warning" />
          <KpiMetric label="أكثر من 60 يوماً" value={fmt(debtData.aging.bucketOver60)} tone="danger" />
        </div>
      </SurfaceCard>

      <SurfaceCard className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold">العملاء المدينون</h2>
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-[#EFF1EA] dark:bg-[#0B1610]">
            {[
              { id: 'all', label: 'الكل' },
              { id: 'overdue', label: 'متأخرون' },
              { id: 'over_limit', label: 'تجاوزوا الحد' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id as typeof filterMode)}
                className={`min-h-[38px] px-3 py-1 rounded-xl text-xs font-medium transition-colors ${
                  filterMode === tab.id
                    ? 'bg-white dark:bg-[#1E3A2E] text-[#0F1F17] dark:text-white'
                    : 'text-[#3D4337] dark:text-[#9AA896]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {debtData.filteredDebtors.length === 0 ? (
          <EmptyState
            title="لا توجد مديونيات مستحقة"
            description="جميع حسابات العملاء مسددة حالياً."
          />
        ) : (
          <div className="space-y-2.5">
            {debtData.filteredDebtors.map((c) => {
              const overLimit = c.creditLimit > 0 && c.cachedBalance > c.creditLimit;
              return (
                <div
                  key={c.id}
                  className="p-3.5 rounded-2xl border border-[#C7CBB8]/55 dark:border-[#243B2E] bg-[#F9FAF7]/60 dark:bg-[#0B1610]/50 space-y-3"
                >
                  <button
                    type="button"
                    onClick={() => navigate('customer_profile', { customerId: c.id })}
                    className="w-full flex items-center justify-between gap-3 text-right"
                  >
                    <div className="min-w-0">
                      <div className="font-display font-bold text-sm sm:text-base truncate">{c.fullName}</div>
                      <div className="text-xs text-[#6B7F67]">
                        {c.phone}
                        {overLimit ? ' · متجاوز للحد الائتماني' : ''}
                        {debtData.overdueCustomerIds.has(c.id) ? ' · لديه فواتير متأخرة' : ''}
                      </div>
                    </div>
                    <div className="text-sm sm:text-base font-bold tabular-nums text-red-700 dark:text-red-400 shrink-0">
                      {fmt(c.cachedBalance)}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 pt-2 border-t border-[#C7CBB8]/35 dark:border-[#243B2E]">
                    <PrimaryButton
                      variant="secondary"
                      onClick={() => navigate('customer_statement', { customerId: c.id })}
                      className="flex-1 min-h-[42px]"
                    >
                      كشف حساب
                    </PrimaryButton>
                    <PrimaryButton
                      onClick={() => navigate('collection', { customerId: c.id })}
                      className="flex-1 min-h-[42px]"
                    >
                      تحصيل سداد
                    </PrimaryButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

export const CollectionView: React.FC = () => {
  const { org, activeUser, customers, sales, payments, screenParams, navigate, refreshData, showToast } = useQatshi();
  const debtors = customers.filter((c) => c.cachedBalance > 0);
  const [customerId, setCustomerId] = useState(
    screenParams.customerId || debtors[0]?.id || customers[0]?.id || ''
  );
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [allocationMode, setAllocationMode] = useState<'auto' | 'manual'>('auto');
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({});
  const [allowExcess, setAllowExcess] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef(generateUuid());
  const [custProfile, setCustProfile] = useState<{ sales: Sale[]; payments: Payment[] } | null>(null);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.filter((c) => c.cachedBalance > 0 || c.id === customerId);
    if (!q) return list;
    return list.filter((c) => c.fullName.toLowerCase().includes(q) || c.phone.includes(q));
  }, [customers, customerId, search]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  useEffect(() => {
    let active = true;
    if (!org || !selectedCustomer) {
      setCustProfile(null);
      return;
    }
    queryCustomerFinancialProfile(org.id, selectedCustomer.id)
      .then((res) => {
        if (active) setCustProfile({ sales: res.sales, payments: res.payments });
      })
      .catch(() => {
        if (active) setCustProfile(null);
      });
    return () => {
      active = false;
    };
  }, [org, selectedCustomer?.id, sales, payments]);

  const openSales = useMemo(() => {
    if (!org || !selectedCustomer) return [];
    const custSales = custProfile?.sales ?? sales.filter((s) => s.customerId === selectedCustomer.id);
    const custPayments = custProfile?.payments ?? payments.filter((p) => p.customerId === selectedCustomer.id);
    const openMap = computeOpenSaleRemainingMap(custSales, custPayments, org.currencyDecimals);
    return custSales
      .filter((s) => openMap.has(s.id))
      .map((s) => ({
        ...s,
        openRemaining: openMap.get(s.id)!,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [org, selectedCustomer, custProfile, sales, payments]);

  if (!org || !activeUser) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const numericAmount = Number(amount) || 0;
  const projectedRemaining = selectedCustomer
    ? Math.max(0, roundMoney(selectedCustomer.cachedBalance - numericAmount, org.currencyDecimals))
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || submitting || !selectedCustomer) return;
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const manualAllocations: PaymentAllocation[] =
        allocationMode === 'manual'
          ? openSales
              .map((s) => ({
                saleId: s.id,
                invoiceNumber: s.invoiceNumber,
                amount: Number(manualAmounts[s.id] || 0),
              }))
              .filter((a) => a.amount > 0)
          : [];

      const payment = await createPaymentTransaction({
        org,
        user: activeUser,
        customerId: selectedCustomer.id,
        amount: numericAmount,
        paymentMethod,
        allocationMode,
        manualAllocations,
        allowExcessCredit: allowExcess,
        notes,
        idempotencyKey: idempotencyKeyRef.current,
      });

      await refreshData();
      idempotencyKeyRef.current = generateUuid();
      showToast(`تم اعتماد ${formatCommercialRef(payment.receiptNumber, 'payment')} بنجاح`);
      navigate('receipt', { paymentId: payment.id, receiptType: 'payment' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'فشل تسجيل السداد', 'error');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="تسجيل سداد"
        subtitle="تحصيل سريع مع احتساب الرصيد المتبقي فوراً"
        icon={<Banknote className="h-5 w-5" />}
        backAction={() => navigate('debts')}
      />

      {customers.length === 0 ? (
        <EmptyState
          title="لا يوجد عملاء بعد"
          description="أضف عميلاً أولاً لتسجيل عمليات السداد وإصدار سندات القبض."
          actionLabel="إضافة عميل"
          onAction={() => navigate('customer_form')}
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <SurfaceCard className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <Search className="h-4 w-4 text-[#6B7F67] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="coll-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث عن عميل..."
                  aria-label="بحث عن عميل"
                  className="w-full min-h-[46px] pr-10 pl-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                />
              </div>
              <select
                id="coll-cust"
                aria-label="اختيار العميل"
                required
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setAmount('');
                  setManualAmounts({});
                }}
                className="w-full min-h-[46px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm font-medium"
              >
                {filteredCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} — {fmt(c.cachedBalance)}
                  </option>
                ))}
              </select>
            </div>

            {selectedCustomer && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <KpiMetric
                  label="المديونية الحالية"
                  value={fmt(selectedCustomer.cachedBalance)}
                  tone={selectedCustomer.cachedBalance > 0 ? 'danger' : 'positive'}
                />
                <KpiMetric
                  label="المتبقي بعد السداد"
                  value={fmt(projectedRemaining)}
                  tone={projectedRemaining === 0 ? 'positive' : 'warning'}
                />
              </div>
            )}
          </SurfaceCard>

          {selectedCustomer && (
            <SurfaceCard className="space-y-4">
              {/* Quick Preset Buttons */}
              {selectedCustomer.cachedBalance > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAmount(String(selectedCustomer.cachedBalance))}
                    className="min-h-[46px] px-2 py-2 rounded-2xl bg-[#0F1F17] text-white dark:bg-[#3E5A3F] text-xs font-semibold active:scale-[0.97] transition-transform"
                  >
                    سداد كامل
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAmount(
                        String(roundMoney(selectedCustomer.cachedBalance / 2, org.currencyDecimals))
                      )
                    }
                    className="min-h-[46px] px-2 py-2 rounded-2xl bg-[#EFF1EA] dark:bg-[#1E3A2E] text-[#0F1F17] dark:text-[#E8EAE0] text-xs font-semibold active:scale-[0.97] transition-transform"
                  >
                    سداد نصف المبلغ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAmount('');
                      amountInputRef.current?.focus();
                    }}
                    className="min-h-[46px] px-2 py-2 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] text-xs font-semibold active:scale-[0.97] transition-transform"
                  >
                    مبلغ آخر
                  </button>
                </div>
              )}

              <div>
                <label htmlFor="coll-amount" className="block text-sm font-medium mb-1.5">
                  مبلغ السداد *
                </label>
                <input
                  ref={amountInputRef}
                  id="coll-amount"
                  type="number"
                  min="1"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="أدخل المبلغ المسدد الآن"
                  className="w-full min-h-[54px] px-4 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-lg font-mono font-bold text-center"
                />
              </div>

              {numericAmount > selectedCustomer.cachedBalance && (
                <label className="flex items-center gap-2.5 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowExcess}
                    onChange={(e) => setAllowExcess(e.target.checked)}
                    className="h-4 w-4"
                  />
                  المبلغ أكبر من المستحق ({fmt(selectedCustomer.cachedBalance)}). تأكيد تسجيل الفائض كرصيد دائن للعميل.
                </label>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="coll-method" className="block text-xs text-[#6B7F67] mb-1">
                    وسيلة السداد
                  </label>
                  <select
                    id="coll-method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full min-h-[46px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                  >
                    <option value="cash">نقداً (الصندوق)</option>
                    <option value="transfer">حوالة بنكية / صرافة</option>
                    <option value="wallet">محفظة إلكترونية</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="coll-notes" className="block text-xs text-[#6B7F67] mb-1">
                    ملاحظة اختيارية
                  </label>
                  <input
                    id="coll-notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="مثال: سداد جزئي نقدي"
                    className="w-full min-h-[46px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                  />
                </div>
              </div>

              {openSales.length > 0 && (
                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#6B7F67]">توزيع السداد على الفواتير</span>
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFF1EA] dark:bg-[#0B1610]">
                      <button
                        type="button"
                        onClick={() => setAllocationMode('auto')}
                        className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg ${
                          allocationMode === 'auto'
                            ? 'bg-white dark:bg-[#1E3A2E] text-[#0F1F17] dark:text-white'
                            : 'text-[#6B7F67]'
                        }`}
                      >
                        تلقائي (الأقدم)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAllocationMode('manual')}
                        className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg ${
                          allocationMode === 'manual'
                            ? 'bg-white dark:bg-[#1E3A2E] text-[#0F1F17] dark:text-white'
                            : 'text-[#6B7F67]'
                        }`}
                      >
                        يدوي
                      </button>
                    </div>
                  </div>

                  {allocationMode === 'manual' && (
                    <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E] border border-[#C7CBB8]/50 dark:border-[#243B2E] rounded-2xl px-3">
                      {openSales.map((s) => (
                        <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold">{formatCommercialRef(s.invoiceNumber, 'sale')}</div>
                            <div className="text-[11px] text-[#6B7F67]">
                              {formatDateArabic(s.createdAt, org.dateFormat)} · متبقي: {fmt(s.openRemaining)}
                            </div>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={s.openRemaining}
                            value={manualAmounts[s.id] || ''}
                            onChange={(e) =>
                              setManualAmounts((prev) => ({ ...prev, [s.id]: e.target.value }))
                            }
                            placeholder="0"
                            className="w-28 min-h-[40px] px-2.5 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-xs font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <PrimaryButton type="submit" disabled={submitting} className="w-full min-h-[52px] text-base">
                {submitting ? 'جاري الاعتماد...' : 'اعتماد السداد'}
              </PrimaryButton>
            </SurfaceCard>
          )}
        </form>
      )}
    </div>
  );
};

export const ReceiptView: React.FC = () => {
  const { org, activeUser, payments, customers, screenParams, navigate, refreshData, showToast } = useQatshi();
  const payment = payments.find((p) => p.id === screenParams.paymentId) || payments[0];
  const [reason, setReason] = useState('');
  const [showReverse, setShowReverse] = useState(false);

  if (!org || !activeUser) return null;
  if (!payment) {
    return (
      <EmptyState
        title="لا يوجد سند قبض محدد"
        description="قم بتسجيل سداد جديد لإصدار إيصال قبض."
        actionLabel="شاشة السداد"
        onAction={() => navigate('collection')}
      />
    );
  }

  const customer = customers.find((c) => c.id === payment.customerId);
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);
  const displayNumber = formatCommercialRef(payment.receiptNumber, 'payment');

  const handleDownloadPdf = async (shareMode = false) => {
    try {
      const { blob, fileName } = await generateReceiptPdf({
        org,
        type: 'payment',
        payment,
        customerRemainingBalance: customer?.cachedBalance,
      });
      if (shareMode) {
        const res = await sharePdfDocument({
          blob,
          fileName,
          title: displayNumber,
          text: `${displayNumber} — ${payment.customerName}`,
        });
        showToast(res.message);
        return;
      }
      triggerBlobDownload(blob, fileName);
      showToast('تم تحميل سند القبض بصيغة PDF');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر مشاركة السند', 'error');
    }
  };

  const handleReverse = async () => {
    try {
      await reversePaymentTransaction({
        org,
        user: activeUser,
        paymentId: payment.id,
        reason: reason.trim() || 'تصحيح سند سداد',
      });
      await refreshData();
      setShowReverse(false);
      showToast('تم عكس سند القبض وتحديث رصيد العميل');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر عكس السند', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={displayNumber}
        subtitle={`${payment.customerName} · ${formatDateArabic(payment.createdAt, org.dateFormat, true)}`}
        icon={<ReceiptText className="h-5 w-5" />}
        backAction={() => navigate('collection')}
      />

      <div className="grid grid-cols-3 gap-2 no-print">
        <PrimaryButton variant="secondary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          طباعة
        </PrimaryButton>
        <PrimaryButton variant="secondary" onClick={() => handleDownloadPdf(true)}>
          <Share2 className="h-4 w-4" />
          مشاركة
        </PrimaryButton>
        <PrimaryButton onClick={() => handleDownloadPdf(false)}>
          <Download className="h-4 w-4" />
          PDF
        </PrimaryButton>
      </div>

      <SurfaceCard className="space-y-4">
        <div className="flex justify-between items-start pb-4 border-b border-[#C7CBB8]/60 dark:border-[#243B2E]">
          <div>
            <div className="font-display font-bold text-lg">{org.name}</div>
            <div className="text-xs text-[#6B7F67]">{org.phone} · {org.address}</div>
          </div>
          <div className="text-left">
            <div className="text-sm font-bold">{displayNumber}</div>
            <div className={`text-xs font-medium ${payment.status === 'reversed' ? 'text-red-600' : 'text-[#1E3A2E] dark:text-[#8FB98D]'}`}>
              {payment.status === 'reversed' ? 'ملغى بقيد عكسي' : 'سند معتمد'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <KpiMetric label="المبلغ المستلم" value={fmt(payment.amount)} tone="positive" />
          <KpiMetric
            label="الرصيد المتبقي"
            value={fmt(customer?.cachedBalance ?? 0)}
            tone={(customer?.cachedBalance ?? 0) > 0 ? 'warning' : 'positive'}
          />
        </div>

        <div className="text-sm space-y-1.5 text-[#3D4337] dark:text-[#C7CBB8]">
          <div>العميل: <strong>{payment.customerName}</strong></div>
          <div>الموظف المستلم: <strong>{payment.createdByName}</strong></div>
          {payment.allocations.length > 0 && (
            <div>
              الفواتير المسددة:{' '}
              {payment.allocations
                .map((a) => `${formatCommercialRef(a.invoiceNumber, 'sale')} (${fmt(a.amount)})`)
                .join('، ')}
            </div>
          )}
          {payment.notes && <div>ملاحظات: {payment.notes}</div>}
        </div>

        {payment.status === 'active' && hasPermission(activeUser.role, 'reverse_payment') && (
          <div className="pt-4 border-t border-[#C7CBB8]/60 dark:border-[#243B2E] no-print">
            {!showReverse ? (
              <PrimaryButton variant="danger" onClick={() => setShowReverse(true)}>
                <RotateCcw className="h-4 w-4" />
                عكس سند القبض
              </PrimaryButton>
            ) : (
              <div className="space-y-3 p-4 rounded-2xl bg-red-50 dark:bg-red-950/25 border border-red-200 dark:border-red-900">
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="سبب القيد العكسي..."
                  className="w-full min-h-[46px] px-3 rounded-xl border border-red-300 bg-white dark:bg-[#0B1610] text-sm"
                />
                <div className="flex gap-2">
                  <PrimaryButton variant="danger" onClick={handleReverse}>
                    تأكيد العكس
                  </PrimaryButton>
                  <PrimaryButton variant="secondary" onClick={() => setShowReverse(false)}>
                    إلغاء
                  </PrimaryButton>
                </div>
              </div>
            )}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { useQatshi } from '../context/QatshiContext';
import { calculateSaleTotals } from '../domain/accounting';
import { formatCommercialRef, formatPaymentMethodArabic } from '../domain/formatters';
import { formatDateArabic, formatMoney, toLocalDateKey } from '../domain/money';
import { hasPermission, type PaymentMethod, type PaymentMode, type Sale } from '../domain/types';
import { createSaleTransaction, reverseSaleTransaction } from '../services/accountingService';
import { generateUuid } from '../services/device';
import { generateReceiptPdf, triggerBlobDownload } from '../services/pdfGenerator';
import { sharePdfDocument } from '../services/shareService';
import {
  EmptyState,
  KpiMetric,
  PageHeader,
  PrimaryButton,
  StepProgress,
  SurfaceCard,
} from '../components/ui/LuxuryUI';

export const DailySalesView: React.FC = () => {
  const { org, sales, navigate } = useQatshi();
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | PaymentMode>('all');
  const [dateFilter, setDateFilter] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      const displayNum = formatCommercialRef(s.invoiceNumber, 'sale').toLowerCase();
      if (
        q &&
        !s.invoiceNumber.toLowerCase().includes(q) &&
        !displayNum.includes(q) &&
        !s.customerName.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (modeFilter !== 'all' && s.paymentMode !== modeFilter) return false;
      if (dateFilter && toLocalDateKey(s.createdAt) !== dateFilter) return false;
      return true;
    });
  }, [sales, search, modeFilter, dateFilter]);

  if (!org) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const activeSales = filtered.filter((s) => s.status === 'active');
  const totalAmount = activeSales.reduce((sum, s) => sum + s.total, 0);
  const totalCash = activeSales.reduce((sum, s) => sum + s.paidAmount, 0);
  const totalCredit = activeSales.reduce((sum, s) => sum + s.remainingAmount, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="المبيعات"
        subtitle={`${activeSales.length} فاتورة · الإجمالي ${fmt(totalAmount)}`}
        action={
          <PrimaryButton onClick={() => navigate('new_sale')}>
            <Plus className="h-4 w-4" />
            بيع جديد
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <KpiMetric label="إجمالي المبيعات" value={fmt(totalAmount)} />
        <KpiMetric label="المحصل نقداً" value={fmt(totalCash)} tone="positive" />
        <KpiMetric label="المتبقي آجل" value={fmt(totalCredit)} tone="warning" />
      </div>

      <SurfaceCard className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div className="relative">
            <Search className="h-4 w-4 text-[#6B7F67] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم الفاتورة أو العميل..."
              aria-label="بحث في المبيعات"
              className="w-full min-h-[46px] pr-10 pl-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)}
            aria-label="تصفية حسب نوع البيع"
            className="w-full min-h-[46px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
          >
            <option value="all">جميع أنواع البيع</option>
            <option value="cash">بيع نقدي</option>
            <option value="credit">بيع آجل</option>
            <option value="partial">بيع جزئي</option>
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="تصفية بالتاريخ"
            className="w-full min-h-[46px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm font-mono"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="لا توجد مبيعات مسجلة"
            description="سجّل أول عملية بيع جديدة أو عدّل خيارات البحث."
            actionLabel="تسجيل بيع جديد"
            onAction={() => navigate('new_sale')}
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.slice(0, 60).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => navigate('sale_detail', { saleId: s.id })}
                className="w-full p-3.5 rounded-2xl border border-[#C7CBB8]/50 dark:border-[#243B2E] bg-[#F9FAF7]/60 dark:bg-[#0B1610]/50 hover:bg-[#EFF1EA] dark:hover:bg-[#193024] flex items-center justify-between gap-3 text-right transition-colors"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-semibold text-[#3E5A3F] dark:text-[#8FB98D]">
                    {formatCommercialRef(s.invoiceNumber, 'sale')}
                  </div>
                  <div className={`font-display font-bold text-sm truncate ${s.status === 'reversed' ? 'line-through text-red-600' : ''}`}>
                    {s.customerName}
                  </div>
                  <div className="text-xs text-[#6B7F67] truncate">
                    {s.items.map((i) => `${i.productName} × ${i.quantity}`).join('، ')} ·{' '}
                    {formatDateArabic(s.createdAt, org.dateFormat, true)}
                  </div>
                </div>
                <div className="text-left shrink-0 space-y-0.5">
                  <div className={`text-sm sm:text-base font-bold tabular-nums ${s.status === 'reversed' ? 'line-through text-red-600' : ''}`}>
                    {fmt(s.total)}
                  </div>
                  <div className="text-[11px] text-[#6B7F67] tabular-nums">
                    {s.status === 'reversed'
                      ? 'ملغاة بقيد عكسي'
                      : s.remainingAmount > 0
                      ? `متبقي: ${fmt(s.remainingAmount)}`
                      : 'مدفوعة بالكامل'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

const SALE_STEP_TITLES = [
  'اختيار العميل',
  'الأصناف والكميات والأسعار',
  'طريقة الدفع والحساب',
  'مراجعة العملية والإجمالي',
  'اعتماد وحفظ الفاتورة',
];

export const NewSaleView: React.FC = () => {
  const { org, activeUser, customers, products, screenParams, navigate, refreshData, showToast } = useQatshi();
  const activeProducts = products.filter((p) => p.active);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(screenParams.customerId ? 2 : 1);
  const [customerId, setCustomerId] = useState(screenParams.customerId || '');
  const [customerQuery, setCustomerQuery] = useState('');
  const [cartItems, setCartItems] = useState<
    Array<{
      productId: string;
      productName: string;
      grade: string;
      unitName: string;
      quantity: number;
      unitPrice: number;
      costPrice?: number;
    }>
  >(() =>
    activeProducts[0]
      ? [
          {
            productId: activeProducts[0].id,
            productName: activeProducts[0].name,
            grade: activeProducts[0].grade,
            unitName: activeProducts[0].unitName,
            quantity: 1,
            unitPrice: activeProducts[0].unitPrice,
            costPrice: activeProducts[0].costPrice,
          },
        ]
      : []
  );
  const [discount, setDiscount] = useState('0');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [allowLimitOverride, setAllowLimitOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const [savedSale, setSavedSale] = useState<Sale | null>(null);
  const idempotencyKeyRef = useRef(generateUuid());

  const matchingCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    const active = customers.filter((c) => c.status === 'active');
    if (!q) return active;
    return active.filter((c) => c.fullName.toLowerCase().includes(q) || c.phone.includes(q));
  }, [customers, customerQuery]);

  if (!org || !activeUser) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const subtotal = cartItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const discNum = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, subtotal - discNum);
  const effectivePaid =
    paymentMode === 'cash' ? total : paymentMode === 'credit' ? 0 : Math.max(0, Number(paidAmount) || 0);
  const remaining = Math.max(0, total - effectivePaid);
  const selectedCustomer = customers.find((c) => c.id === customerId);

  const addProductToCart = (prodId: string) => {
    const prod = activeProducts.find((p) => p.id === prodId);
    if (!prod) return;
    setCartItems((prev) => {
      const existingIdx = prev.findIndex((i) => i.productId === prod.id && i.unitPrice === prod.unitPrice);
      if (existingIdx >= 0) {
        return prev.map((row, idx) =>
          idx === existingIdx ? { ...row, quantity: row.quantity + 1 } : row
        );
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          grade: prod.grade,
          unitName: prod.unitName,
          quantity: 1,
          unitPrice: prod.unitPrice,
          costPrice: prod.costPrice,
        },
      ];
    });
  };

  const resetForNewSale = () => {
    setSavedSale(null);
    setStep(1);
    setCustomerId('');
    setDiscount('0');
    setPaymentMode('cash');
    setPaidAmount('');
    setNotes('');
    setAllowLimitOverride(false);
    setCartItems(
      activeProducts[0]
        ? [
            {
              productId: activeProducts[0].id,
              productName: activeProducts[0].name,
              grade: activeProducts[0].grade,
              unitName: activeProducts[0].unitName,
              quantity: 1,
              unitPrice: activeProducts[0].unitPrice,
              costPrice: activeProducts[0].costPrice,
            },
          ]
        : []
    );
  };

  const handleSaveSale = async () => {
    if (submitLockRef.current || submitting) return;
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      calculateSaleTotals({
        items: cartItems,
        discount: discNum,
        paymentMode,
        paidAmount: effectivePaid,
        decimals: org.currencyDecimals,
      });

      const sale = await createSaleTransaction({
        org,
        user: activeUser,
        customerId: customerId || undefined,
        items: cartItems,
        discount: discNum,
        paymentMode,
        paidAmount: effectivePaid,
        paymentMethod,
        notes,
        idempotencyKey: idempotencyKeyRef.current,
        allowCreditLimitOverride: allowLimitOverride,
      });

      await refreshData();
      idempotencyKeyRef.current = generateUuid();
      setSavedSale(sale);
      setStep(5);
      showToast(`تم اعتماد ${formatCommercialRef(sale.invoiceNumber, 'sale')} بنجاح`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل حفظ عملية البيع';
      if (msg.startsWith('CREDIT_LIMIT_EXCEEDED:')) {
        showToast(msg.replace('CREDIT_LIMIT_EXCEEDED:', '') + ' — فعّل خيار تجاوز الحد إن رغبت بالمتابعة', 'error');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handlePdf = async (shareMode: boolean) => {
    if (!savedSale) return;
    try {
      const { blob, fileName } = await generateReceiptPdf({ org, type: 'sale', sale: savedSale });
      if (shareMode) {
        const res = await sharePdfDocument({
          blob,
          fileName,
          title: formatCommercialRef(savedSale.invoiceNumber, 'sale'),
          text: `${formatCommercialRef(savedSale.invoiceNumber, 'sale')} — ${savedSale.customerName}`,
        });
        showToast(res.message);
        return;
      }
      triggerBlobDownload(blob, fileName);
      showToast('تم تنزيل الفاتورة بصيغة PDF');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تصدير الفاتورة', 'error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="تسجيل عملية بيع"
        subtitle={savedSale ? formatCommercialRef(savedSale.invoiceNumber, 'sale') : 'خطوات واضحة وسريعة'}
        backAction={() => (step > 1 && step < 5 ? setStep((s) => (s - 1) as 1 | 2 | 3 | 4) : navigate('sales'))}
      />

      <StepProgress currentStep={step} totalSteps={5} stepTitle={SALE_STEP_TITLES[step - 1]} />

      {/* STEP 1: Customer Selection */}
      {step === 1 && (
        <SurfaceCard className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setCustomerId('');
              setPaymentMode('cash');
              setStep(2);
            }}
            className={`w-full min-h-[58px] p-4 rounded-2xl border-2 flex items-center justify-between text-right transition-colors ${
              !customerId
                ? 'border-[#0F1F17] bg-[#EFF1EA] dark:border-[#8FB98D] dark:bg-[#1E3A2E]'
                : 'border-[#C7CBB8]/60 dark:border-[#243B2E]'
            }`}
          >
            <div>
              <div className="font-display font-bold text-sm">عميل نقدي سريع (بدون حساب)</div>
              <div className="text-xs text-[#6B7F67]">للبيع النقدي الفوري دون تسجيل مديونية</div>
            </div>
            <ChevronLeft className="h-5 w-5 text-[#3E5A3F] shrink-0" />
          </button>

          <div className="relative">
            <Search className="h-4 w-4 text-[#6B7F67] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="ابحث عن عميل بالاسم أو الهاتف..."
              aria-label="بحث عن عميل"
              className="w-full min-h-[46px] pr-10 pl-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>

          {matchingCustomers.length === 0 ? (
            <EmptyState
              title="لا يوجد عملاء مطابقون"
              description="يمكنك المتابعة كعميل نقدي سريع أو إضافة عميل جديد."
              actionLabel="إضافة عميل جديد"
              onAction={() => navigate('customer_form')}
            />
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto">
              {matchingCustomers.map((c) => {
                const selected = customerId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCustomerId(c.id);
                      setStep(2);
                    }}
                    className={`w-full min-h-[60px] p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-right transition-colors ${
                      selected
                        ? 'border-[#0F1F17] bg-[#EFF1EA] dark:border-[#8FB98D] dark:bg-[#1E3A2E]'
                        : 'border-[#C7CBB8]/60 dark:border-[#243B2E] hover:bg-[#F9FAF7] dark:hover:bg-[#193024]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-display font-bold text-sm truncate">{c.fullName}</div>
                      <div className="text-xs text-[#6B7F67] font-mono">{c.phone}</div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="text-[11px] text-[#6B7F67]">الرصيد</div>
                      <div className={`text-xs font-bold tabular-nums ${c.cachedBalance > 0 ? 'text-red-700 dark:text-red-400' : 'text-[#1E3A2E] dark:text-[#8FB98D]'}`}>
                        {fmt(c.cachedBalance)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      )}

      {/* STEP 2: Products & Quantities */}
      {step === 2 && (
        <div className="space-y-4">
          <SurfaceCard className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-[#6B7F67]">
                العميل: <strong className="text-[#0F1F17] dark:text-white">{selectedCustomer ? selectedCustomer.fullName : 'عميل نقدي سريع'}</strong>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs font-medium text-[#3E5A3F] dark:text-[#8FB98D] hover:underline"
              >
                تغيير العميل
              </button>
            </div>

            {activeProducts.length === 0 ? (
              <EmptyState
                title="لا توجد أصناف مسجلة بعد"
                description="أضف أصناف القات وأسعارها أولاً من شاشة الأصناف لبدء البيع."
                actionLabel="إضافة أصناف الآن"
                onAction={() => navigate('products')}
              />
            ) : (
              <>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[#6B7F67]">إضافة صنف باللمس:</div>
                  <div className="flex flex-wrap gap-2">
                    {activeProducts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProductToCart(p.id)}
                        className="min-h-[42px] px-3.5 py-2 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-xs font-medium hover:bg-[#EFF1EA] dark:hover:bg-[#1E3A2E] active:scale-[0.97] transition-all"
                      >
                        + {p.name} ({p.grade}) · {fmt(p.unitPrice)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  {cartItems.map((item, idx) => (
                    <div
                      key={`${item.productId}-${idx}`}
                      className="p-3.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8]/55 dark:border-[#243B2E] space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <select
                          value={item.productId}
                          aria-label="اختيار الصنف"
                          onChange={(e) => {
                            const p = activeProducts.find((pr) => pr.id === e.target.value);
                            if (!p) return;
                            setCartItems((prev) =>
                              prev.map((row, i) =>
                                i === idx
                                  ? {
                                      ...row,
                                      productId: p.id,
                                      productName: p.name,
                                      grade: p.grade,
                                      unitName: p.unitName,
                                      unitPrice: p.unitPrice,
                                      costPrice: p.costPrice,
                                    }
                                  : row
                              )
                            );
                          }}
                          className="flex-1 min-h-[44px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm font-medium"
                        >
                          {activeProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — {p.grade}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label="حذف الصنف"
                          disabled={cartItems.length <= 1}
                          onClick={() => setCartItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3 items-end">
                        <div>
                          <label className="block text-[11px] text-[#6B7F67] mb-1">
                            الكمية ({item.unitName})
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label="إنقاص الكمية"
                              onClick={() =>
                                setCartItems((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, quantity: Math.max(0.25, row.quantity - 0.5) } : row
                                  )
                                )
                              }
                              className="min-h-[44px] min-w-[44px] rounded-xl bg-white dark:bg-[#12241B] border border-[#C7CBB8] dark:border-[#2C4235] inline-flex items-center justify-center"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <input
                              type="number"
                              min="0.25"
                              step="0.25"
                              value={item.quantity}
                              onChange={(e) => {
                                const q = Number(e.target.value) || 0;
                                setCartItems((prev) => prev.map((row, i) => (i === idx ? { ...row, quantity: q } : row)));
                              }}
                              className="w-full min-h-[44px] px-2 text-center rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm font-mono font-bold"
                            />
                            <button
                              type="button"
                              aria-label="زيادة الكمية"
                              onClick={() =>
                                setCartItems((prev) =>
                                  prev.map((row, i) => (i === idx ? { ...row, quantity: row.quantity + 0.5 } : row))
                                )
                              }
                              className="min-h-[44px] min-w-[44px] rounded-xl bg-white dark:bg-[#12241B] border border-[#C7CBB8] dark:border-[#2C4235] inline-flex items-center justify-center"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] text-[#6B7F67] mb-1">سعر الوحدة</label>
                          <input
                            type="number"
                            min="0"
                            value={item.unitPrice}
                            onChange={(e) => {
                              const pr = Number(e.target.value) || 0;
                              setCartItems((prev) => prev.map((row, i) => (i === idx ? { ...row, unitPrice: pr } : row)));
                            }}
                            className="w-full min-h-[44px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm font-mono font-bold"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-[#C7CBB8]/35 dark:border-[#243B2E]">
                        <span className="text-[#6B7F67]">مجموع السطر</span>
                        <strong className="text-sm tabular-nums">{fmt(item.quantity * item.unitPrice)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </SurfaceCard>

          {activeProducts.length > 0 && (
            <SurfaceCard className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-[#6B7F67]">الإجمالي المبدئي</div>
                <div className="font-display text-xl font-bold tabular-nums">{fmt(subtotal)}</div>
              </div>
              <div className="flex gap-2">
                <PrimaryButton variant="secondary" type="button" onClick={() => setStep(1)}>
                  <ChevronRight className="h-4 w-4" />
                  رجوع
                </PrimaryButton>
                <PrimaryButton
                  type="button"
                  disabled={cartItems.length === 0 || subtotal <= 0}
                  onClick={() => setStep(3)}
                >
                  التالي
                  <ChevronLeft className="h-4 w-4" />
                </PrimaryButton>
              </div>
            </SurfaceCard>
          )}
        </div>
      )}

      {/* STEP 3: Payment Mode & Discount */}
      {step === 3 && (
        <div className="space-y-4">
          <SurfaceCard className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">اختر طريقة الدفع</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'cash', label: 'نقدي بالكامل', disabled: false },
                  { id: 'credit', label: 'آجل (دين)', disabled: !customerId },
                  { id: 'partial', label: 'دفع جزئي', disabled: !customerId },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={m.disabled}
                    onClick={() => setPaymentMode(m.id as PaymentMode)}
                    className={`min-h-[50px] px-2 py-2.5 rounded-2xl border text-xs sm:text-sm font-semibold transition-colors disabled:opacity-40 ${
                      paymentMode === m.id
                        ? 'bg-[#0F1F17] text-white border-[#0F1F17] dark:bg-[#3E5A3F] dark:border-[#3E5A3F]'
                        : 'bg-[#F9FAF7] dark:bg-[#0B1610] border-[#C7CBB8] dark:border-[#2C4235]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {!customerId && (
                <p className="text-xs text-[#6B7F67] mt-1.5">
                  للبيع الآجل أو الجزئي، ارجع للخطوة الأولى واختر عميلاً محدداً.
                </p>
              )}
            </div>

            {paymentMode === 'partial' && (
              <div>
                <label htmlFor="sale-paid" className="block text-sm font-medium mb-1.5">
                  المبلغ المدفوع مقدماً *
                </label>
                <input
                  id="sale-paid"
                  type="number"
                  min="1"
                  max={total}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="أدخل المبلغ المدفوع الآن"
                  className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-base font-mono font-bold"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sale-discount" className="block text-xs font-medium text-[#6B7F67] mb-1">
                  الخصم (اختياري)
                </label>
                <input
                  id="sale-discount"
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-full min-h-[46px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm font-mono"
                />
              </div>

              <div>
                <label htmlFor="sale-method" className="block text-xs font-medium text-[#6B7F67] mb-1">
                  وسيلة الاستلام
                </label>
                <select
                  id="sale-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full min-h-[46px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                >
                  <option value="cash">نقداً (الصندوق)</option>
                  <option value="transfer">حوالة بنكية / صرافة</option>
                  <option value="wallet">محفظة إلكترونية</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="sale-notes" className="block text-xs font-medium text-[#6B7F67] mb-1">
                ملاحظة على الفاتورة (اختياري)
              </label>
              <input
                id="sale-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: تسليم مسائي أو ملاحظة تغليف"
                className="w-full min-h-[46px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>

            {selectedCustomer &&
              remaining > 0 &&
              selectedCustomer.creditLimit > 0 &&
              selectedCustomer.cachedBalance + remaining > selectedCustomer.creditLimit && (
                <label className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowLimitOverride}
                    onChange={(e) => setAllowLimitOverride(e.target.checked)}
                    className="h-4 w-4"
                  />
                  سيتجاوز العميل الحد الائتماني ({fmt(selectedCustomer.creditLimit)}). أوافق على المتابعة لهذه الفاتورة.
                </label>
              )}
          </SurfaceCard>

          <SurfaceCard className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-[#6B7F67]">الصافي المطلوب</div>
              <div className="font-display text-xl font-bold tabular-nums">{fmt(total)}</div>
            </div>
            <div className="flex gap-2">
              <PrimaryButton variant="secondary" type="button" onClick={() => setStep(2)}>
                <ChevronRight className="h-4 w-4" />
                رجوع
              </PrimaryButton>
              <PrimaryButton
                type="button"
                disabled={paymentMode === 'partial' && (effectivePaid <= 0 || effectivePaid >= total)}
                onClick={() => setStep(4)}
              >
                مراجعة العملية
                <ChevronLeft className="h-4 w-4" />
              </PrimaryButton>
            </div>
          </SurfaceCard>
        </div>
      )}

      {/* STEP 4: Final Review & Confirm */}
      {step === 4 && (
        <SurfaceCard className="space-y-4">
          <div className="space-y-2 pb-3 border-b border-[#C7CBB8]/50 dark:border-[#243B2E]">
            <div className="text-xs text-[#6B7F67]">العميل</div>
            <div className="font-display font-bold text-base">
              {selectedCustomer ? selectedCustomer.fullName : 'عميل نقدي مباشر'}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#6B7F67]">الأصناف ({cartItems.length})</div>
            {cartItems.map((it, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-sm py-2 border-b border-[#C7CBB8]/30 dark:border-[#243B2E] last:border-0"
              >
                <div>
                  <span className="font-medium">{it.productName}</span>{' '}
                  <span className="text-xs text-[#6B7F67]">
                    ({it.quantity} {it.unitName} × {fmt(it.unitPrice)})
                  </span>
                </div>
                <strong className="tabular-nums">{fmt(it.quantity * it.unitPrice)}</strong>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
            <KpiMetric label="الإجمالي" value={fmt(total)} />
            <KpiMetric label="الخصم" value={fmt(discNum)} />
            <KpiMetric label="المدفوع الآن" value={fmt(effectivePaid)} tone="positive" />
            <KpiMetric
              label="المتبقي ديناً"
              value={fmt(remaining)}
              tone={remaining > 0 ? 'danger' : 'positive'}
            />
          </div>

          <div className="text-xs text-[#6B7F67]">
            وسيلة الدفع: {formatPaymentMethodArabic(paymentMethod)}
            {notes ? ` · ملاحظة: ${notes}` : ''}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
            <PrimaryButton variant="secondary" type="button" onClick={() => setStep(3)}>
              <ChevronRight className="h-4 w-4" />
              تعديل الدفع
            </PrimaryButton>
            <PrimaryButton
              type="button"
              disabled={submitting}
              onClick={handleSaveSale}
              className="flex-1 min-h-[50px]"
            >
              <UserCheck className="h-5 w-5" />
              {submitting ? 'جاري اعتماد الفاتورة...' : 'تأكيد وحفظ الفاتورة'}
            </PrimaryButton>
          </div>
        </SurfaceCard>
      )}

      {/* STEP 5: Saved Receipt Celebration */}
      {step === 5 && savedSale && (
        <SurfaceCard className="space-y-5">
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-[#EFF1EA] dark:bg-[#1E3A2E]">
            <CheckCircle2 className="h-8 w-8 text-[#1E3A2E] dark:text-[#8FB98D] shrink-0" />
            <div>
              <div className="font-display font-bold text-base text-[#0F1F17] dark:text-white">
                تم حفظ {formatCommercialRef(savedSale.invoiceNumber, 'sale')} بنجاح
              </div>
              <div className="text-xs text-[#3D4337] dark:text-[#C7CBB8]">
                {savedSale.customerName} · الإجمالي {fmt(savedSale.total)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <KpiMetric label="المدفوع" value={fmt(savedSale.paidAmount)} tone="positive" />
            <KpiMetric
              label="المتبقي آجل"
              value={fmt(savedSale.remainingAmount)}
              tone={savedSale.remainingAmount > 0 ? 'danger' : 'positive'}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <PrimaryButton onClick={() => handlePdf(true)}>
              <Share2 className="h-4 w-4" />
              مشاركة الفاتورة PDF
            </PrimaryButton>
            <PrimaryButton variant="secondary" onClick={() => handlePdf(false)}>
              <Download className="h-4 w-4" />
              تحميل الفاتورة PDF
            </PrimaryButton>
            <PrimaryButton
              variant="secondary"
              onClick={() => navigate('sale_detail', { saleId: savedSale.id })}
            >
              عرض الفاتورة الكاملة
            </PrimaryButton>
            <PrimaryButton variant="secondary" onClick={resetForNewSale}>
              <Plus className="h-4 w-4" />
              تسجيل بيع جديد
            </PrimaryButton>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
};

export const SaleDetailView: React.FC = () => {
  const { org, activeUser, sales, screenParams, navigate, refreshData, showToast } = useQatshi();
  const sale = sales.find((s) => s.id === screenParams.saleId) || sales[0];
  const [reason, setReason] = useState('');
  const [showReverseBox, setShowReverseBox] = useState(false);

  if (!org || !activeUser) return null;
  if (!sale) {
    return (
      <EmptyState
        title="لا توجد فاتورة محددة"
        description="اختر فاتورة من سجل المبيعات لعرض تفاصيلها."
        actionLabel="سجل المبيعات"
        onAction={() => navigate('sales')}
      />
    );
  }

  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);
  const displayNumber = formatCommercialRef(sale.invoiceNumber, 'sale');

  const handleDownloadPdf = async (shareMode = false) => {
    try {
      const { blob, fileName } = await generateReceiptPdf({ org, type: 'sale', sale });
      if (shareMode) {
        const res = await sharePdfDocument({
          blob,
          fileName,
          title: displayNumber,
          text: `${displayNumber} — ${sale.customerName}`,
        });
        showToast(res.message);
        return;
      }
      triggerBlobDownload(blob, fileName);
      showToast('تم تنزيل فاتورة البيع بصيغة PDF');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر مشاركة الفاتورة', 'error');
    }
  };

  const handleReverse = async () => {
    try {
      await reverseSaleTransaction({
        org,
        user: activeUser,
        saleId: sale.id,
        reason: reason.trim() || 'تسوية وعكس فاتورة',
      });
      await refreshData();
      setShowReverseBox(false);
      showToast('تم إنشاء قيد عكسي وإلغاء أثر الفاتورة دون حذف السجل');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر عكس الفاتورة', 'error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader
        title={displayNumber}
        subtitle={`${sale.customerName} · ${formatDateArabic(sale.createdAt, org.dateFormat, true)}`}
        backAction={() => navigate('sales')}
        action={
          <div className="flex flex-wrap gap-2 no-print">
            <PrimaryButton variant="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              طباعة
            </PrimaryButton>
            <PrimaryButton variant="secondary" onClick={() => handleDownloadPdf(true)}>
              <Share2 className="h-4 w-4" />
              مشاركة PDF
            </PrimaryButton>
            <PrimaryButton onClick={() => handleDownloadPdf(false)}>
              <Download className="h-4 w-4" />
              تنزيل PDF
            </PrimaryButton>
          </div>
        }
      />

      <SurfaceCard className="space-y-5">
        <div className="flex flex-wrap justify-between gap-4 pb-4 border-b border-[#C7CBB8]/60 dark:border-[#243B2E]">
          <div>
            <div className="text-xs text-[#6B7F67]">المحل</div>
            <div className="font-display font-bold">{org.name}</div>
            <div className="text-xs text-[#6B7F67]">الموظف: {sale.createdByName}</div>
          </div>
          <div className="text-left">
            <div className="text-xs text-[#6B7F67]">الحالة</div>
            <div className={`font-bold text-sm ${sale.status === 'reversed' ? 'text-red-600' : 'text-[#1E3A2E] dark:text-[#8FB98D]'}`}>
              {sale.status === 'reversed' ? 'ملغاة بقيد عكسي' : 'معتمدة محاسبياً'}
            </div>
          </div>
        </div>

        {/* Mobile Cards + Desktop Clean Table */}
        <div className="space-y-2.5 sm:hidden">
          {sale.items.map((item, i) => (
            <div
              key={i}
              className="p-3 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8]/45 dark:border-[#243B2E] flex items-center justify-between gap-3"
            >
              <div>
                <div className="font-medium text-sm">{item.productName}</div>
                <div className="text-xs text-[#6B7F67]">
                  {item.grade} · {item.quantity} {item.unitName} × {fmt(item.unitPrice)}
                </div>
              </div>
              <div className="font-bold text-sm tabular-nums">{fmt(item.lineTotal)}</div>
            </div>
          ))}
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#C7CBB8]/60 dark:border-[#243B2E] text-xs text-[#6B7F67]">
                <th className="py-2 text-right font-medium">الصنف</th>
                <th className="py-2 text-right font-medium">الدرجة</th>
                <th className="py-2 text-right font-medium">الكمية</th>
                <th className="py-2 text-left font-medium">سعر الوحدة</th>
                <th className="py-2 text-left font-medium">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C7CBB8]/35 dark:divide-[#243B2E]">
              {sale.items.map((item, i) => (
                <tr key={i}>
                  <td className="py-2.5 font-medium">{item.productName}</td>
                  <td className="py-2.5 text-xs text-[#6B7F67]">{item.grade}</td>
                  <td className="py-2.5 tabular-nums">{item.quantity} {item.unitName}</td>
                  <td className="py-2.5 text-left tabular-nums">{fmt(item.unitPrice)}</td>
                  <td className="py-2.5 text-left font-bold tabular-nums">{fmt(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-[#C7CBB8]/60 dark:border-[#243B2E]">
          <KpiMetric label="المجموع الفرعي" value={fmt(sale.subtotal)} />
          <KpiMetric label="الخصم" value={fmt(sale.discount)} />
          <KpiMetric label="المدفوع" value={fmt(sale.paidAmount)} tone="positive" />
          <KpiMetric label="المتبقي ديناً" value={fmt(sale.remainingAmount)} tone={sale.remainingAmount > 0 ? 'danger' : 'positive'} />
        </div>

        {sale.status === 'active' && hasPermission(activeUser.role, 'reverse_sale') && (
          <div className="pt-4 border-t border-[#C7CBB8]/60 dark:border-[#243B2E] no-print">
            {!showReverseBox ? (
              <PrimaryButton variant="danger" onClick={() => setShowReverseBox(true)}>
                <RotateCcw className="h-4 w-4" />
                إلغاء الفاتورة بقيد عكسي
              </PrimaryButton>
            ) : (
              <div className="space-y-3 p-4 rounded-2xl bg-red-50 dark:bg-red-950/25 border border-red-200 dark:border-red-900">
                <p className="text-xs text-red-800 dark:text-red-200">
                  القواعد المحاسبية تمنع حذف الفواتير المسجلة؛ سيتم إنشاء قيد عكسي موثق يعيد الرصيد كما كان.
                </p>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="سبب العكس أو التسوية..."
                  className="w-full min-h-[46px] px-3 rounded-xl border border-red-300 bg-white dark:bg-[#0B1610] text-sm"
                />
                <div className="flex gap-2">
                  <PrimaryButton variant="danger" onClick={handleReverse}>
                    تأكيد القيد العكسي
                  </PrimaryButton>
                  <PrimaryButton variant="secondary" onClick={() => setShowReverseBox(false)}>
                    تراجع
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

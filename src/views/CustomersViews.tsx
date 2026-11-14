import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  FileText,
  MessageSquare,
  MoreVertical,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Share2,
  ShoppingBag,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { db } from '../db/qatshiDb';
import { useQatshi } from '../context/QatshiContext';
import { computeCustomerLedgerStatement } from '../domain/accounting';
import { formatCommercialRef, sanitizeCommercialText } from '../domain/formatters';
import { formatDateArabic, formatMoney } from '../domain/money';
import { getSmsStatusLabel } from '../domain/sms';
import { hasPermission, type Customer, type CustomerCategory, type LedgerEntry, type Payment, type Sale } from '../domain/types';
import { createAdjustmentTransaction, queryCustomerFinancialProfile } from '../services/accountingService';
import {
  exportCustomersToWorkbook,
  importCustomersFromFile,
  saveCustomer,
} from '../services/customerService';
import { generateUuid } from '../services/device';
import { generateCustomerStatementPdf, triggerBlobDownload } from '../services/pdfGenerator';
import { sharePdfDocument } from '../services/shareService';
import {
  BottomSheet,
  EmptyState,
  HeaderCircleButton,
  KpiMetric,
  PageHeader,
  PrimaryButton,
  SurfaceCard,
} from '../components/ui/LuxuryUI';

const PAGE_SIZE = 20;

export const CustomersListView: React.FC = () => {
  const { org, activeUser, customers, orgCounts, navigate, refreshData, showToast } = useQatshi();
  const [query, setQuery] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'debtor' | 'creditor' | 'zero'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'debt_desc' | 'purchases_desc' | 'name'>('recent');
  const [page, setPage] = useState(1);
  const [indexedSearchResults, setIndexedSearchResults] = useState<Customer[] | null>(null);
  const [menuCustomer, setMenuCustomer] = useState<Customer | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    const q = query.trim().toLowerCase();
    if (!org || !q || orgCounts.customers <= customers.length) {
      setIndexedSearchResults(null);
      return;
    }
    db.customers
      .where('orgId')
      .equals(org.id)
      .filter((c) => c.fullName.toLowerCase().includes(q) || c.phone.includes(q))
      .limit(200)
      .toArray()
      .then((res) => {
        if (active) setIndexedSearchResults(res);
      })
      .catch(() => {
        if (active) setIndexedSearchResults(null);
      });
    return () => {
      active = false;
    };
  }, [org, query, orgCounts.customers, customers.length]);

  const stats = useMemo(() => {
    let debtorsTotal = 0;
    let creditorsTotal = 0;
    let debtorsCount = 0;
    let creditorsCount = 0;
    let zeroCount = 0;

    for (const c of customers) {
      if (c.cachedBalance > 0) {
        debtorsTotal += c.cachedBalance;
        debtorsCount += 1;
      } else if (c.cachedBalance < 0) {
        creditorsTotal += Math.abs(c.cachedBalance);
        creditorsCount += 1;
      } else {
        zeroCount += 1;
      }
    }

    const totalAccounts = Math.max(1, customers.length);
    const debtorPct = Math.round((debtorsCount / totalAccounts) * 100);
    const creditorPct = Math.round((creditorsCount / totalAccounts) * 100);
    const zeroPct = Math.max(0, 100 - debtorPct - creditorPct);

    return {
      debtorsTotal,
      creditorsTotal,
      debtorsCount,
      creditorsCount,
      zeroCount,
      debtorPct,
      creditorPct,
      zeroPct,
    };
  }, [customers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = indexedSearchResults !== null && q ? indexedSearchResults : customers;
    let list = source.filter((c) => {
      if (q && !c.fullName.toLowerCase().includes(q) && !c.phone.includes(q)) return false;
      if (balanceFilter === 'debtor') return c.cachedBalance > 0;
      if (balanceFilter === 'creditor') return c.cachedBalance < 0;
      if (balanceFilter === 'zero') return c.cachedBalance === 0;
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === 'debt_desc') return b.cachedBalance - a.cachedBalance;
      if (sortBy === 'purchases_desc') return b.cachedTotalPurchases - a.cachedTotalPurchases;
      if (sortBy === 'name') return a.fullName.localeCompare(b.fullName, 'ar');
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return list;
  }, [customers, indexedSearchResults, query, balanceFilter, sortBy]);

  if (!org || !activeUser) return null;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await importCustomersFromFile({ file, org, user: activeUser });
      await refreshData();
      showToast(`تم استيراد ${res.imported} عميل بنجاح (تم تخطي ${res.skipped})`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'فشل استيراد الملف', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const categoryLabel = (cat: CustomerCategory) =>
    cat === 'vip' ? 'مميز' : cat === 'wholesale' ? 'جملة' : 'عادي';

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleImport}
        className="hidden"
      />

      {/* Clean Inner Header */}
      <PageHeader
        title="الحسابات والعملاء"
        subtitle={`${orgCounts.customers} حساب مسجل في الدفتر`}
        icon={<Users className="h-5 w-5" />}
        action={
          <>
            <HeaderCircleButton
              label="استيراد عملاء"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
            </HeaderCircleButton>
            <HeaderCircleButton
              label="تصدير كشف العملاء"
              onClick={() => exportCustomersToWorkbook(filtered, 'xlsx')}
            >
              <Download className="h-4 w-4" />
            </HeaderCircleButton>
          </>
        }
      />

      {/* 1. Summary Stat Card (2-col grid + Interactive Distribution Bar) */}
      <SurfaceCard className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-[16px] bg-[#FBEAE8]/55 dark:bg-[#361815]/40 border border-[#F2CFCB] dark:border-[#4D2420]">
            <div className="text-[11px] font-medium text-[#7C2B22] dark:text-[#F0998E]">
              إجمالي المستحقات (مدين)
            </div>
            <div className="font-display text-base font-extrabold tabular-nums text-[#B93829] dark:text-[#F07D70] mt-0.5 truncate">
              {fmt(stats.debtorsTotal)}
            </div>
            <div className="text-[10px] text-[#8E4941] dark:text-[#D58C83] mt-0.5 tabular-nums">
              {stats.debtorsCount} حساب مدين
            </div>
          </div>

          <div className="p-3 rounded-[16px] bg-[#E8EFE9]/75 dark:bg-[#193325]/60 border border-[#D4E0D6] dark:border-[#284C38]">
            <div className="text-[11px] font-medium text-[#2A533C] dark:text-[#9FD3AD]">
              الأرصدة الدائنة (فائض)
            </div>
            <div className="font-display text-base font-extrabold tabular-nums text-[#1E5638] dark:text-[#86C89B] mt-0.5 truncate">
              {fmt(stats.creditorsTotal)}
            </div>
            <div className="text-[10px] text-[#4A6E58] dark:text-[#8FB89D] mt-0.5 tabular-nums">
              {stats.creditorsCount} دائن · {stats.zeroCount} رصيد صفر
            </div>
          </div>
        </div>

        {/* Interactive Distribution Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[#657369] dark:text-[#98A89C]">
            <span>توزيع حالات الحسابات</span>
            <span className="tabular-nums font-semibold">
              مدين {stats.debtorPct}% · مصفى {stats.zeroPct}%
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-[#EFECE4] dark:bg-[#1B3326] overflow-hidden flex">
            {stats.debtorPct > 0 && (
              <button
                type="button"
                aria-label="تصفية الحسابات المدينة"
                onClick={() => {
                  setBalanceFilter('debtor');
                  setPage(1);
                }}
                style={{ width: `${stats.debtorPct}%` }}
                className="h-full bg-[#B93829] transition-all"
              />
            )}
            {stats.creditorPct > 0 && (
              <button
                type="button"
                aria-label="تصفية الحسابات الدائنة"
                onClick={() => {
                  setBalanceFilter('creditor');
                  setPage(1);
                }}
                style={{ width: `${stats.creditorPct}%` }}
                className="h-full bg-[#1E5638] transition-all"
              />
            )}
            {stats.zeroPct > 0 && (
              <button
                type="button"
                aria-label="تصفية الحسابات الصفرية"
                onClick={() => {
                  setBalanceFilter('zero');
                  setPage(1);
                }}
                style={{ width: `${stats.zeroPct}%` }}
                className="h-full bg-[#A8A396] dark:bg-[#496354] transition-all"
              />
            )}
          </div>
        </div>
      </SurfaceCard>

      {/* 2. Two Equal 50%-Width Direct Action Buttons */}
      <div className="grid grid-cols-2 gap-2.5">
        <PrimaryButton
          onClick={() => navigate('customer_form')}
          className="w-full min-h-[48px] text-xs sm:text-sm"
        >
          <UserPlus className="h-4 w-4 shrink-0" />
          إضافة عميل جديد
        </PrimaryButton>
        <PrimaryButton
          variant="secondary"
          onClick={() => window.dispatchEvent(new CustomEvent('qatshi:open-bulk-sms'))}
          className="w-full min-h-[48px] text-xs sm:text-sm"
        >
          <MessageSquare className="h-4 w-4 shrink-0" />
          رسائل جماعية
        </PrimaryButton>
      </div>

      {/* 3. Search Bar & Horizontally Scrollable Filter Pills */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <label htmlFor="customer-search" className="sr-only">
              البحث بالاسم أو رقم الهاتف
            </label>
            <Search className="h-4 w-4 text-[#657369] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="customer-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="ابحث بالاسم أو رقم الهاتف..."
              className="w-full min-h-[46px] pr-10 pl-3 rounded-[16px] border border-[#E2DDD0] dark:border-[#22382B] bg-white dark:bg-[#12231A] text-sm"
            />
          </div>

          <select
            id="customer-sort"
            aria-label="ترتيب الحسابات"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="min-h-[46px] px-2.5 rounded-[16px] border border-[#E2DDD0] dark:border-[#22382B] bg-white dark:bg-[#12231A] text-xs font-semibold shrink-0"
          >
            <option value="recent">الأحدث</option>
            <option value="debt_desc">الأعلى ديناً</option>
            <option value="purchases_desc">الأكثر شراءً</option>
            <option value="name">أبجدياً</option>
          </select>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {[
            { id: 'all' as const, label: `الكل (${customers.length})` },
            { id: 'debtor' as const, label: `مدين (${stats.debtorsCount})` },
            { id: 'creditor' as const, label: `دائن (${stats.creditorsCount})` },
            { id: 'zero' as const, label: `رصيد صفر (${stats.zeroCount})` },
          ].map((pill) => {
            const active = balanceFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => {
                  setBalanceFilter(pill.id);
                  setPage(1);
                }}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 border transition-colors ${
                  active
                    ? 'bg-[#1E4230] text-white border-[#1E4230] dark:bg-[#2E6046] dark:border-[#2E6046]'
                    : 'bg-white dark:bg-[#12231A] text-[#4C5850] dark:text-[#C5D8CA] border-[#E4DFD4] dark:border-[#22382B]'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Independent Account List Cards */}
      {paged.length === 0 ? (
        <EmptyState
          title="لا توجد حسابات مطابقة"
          description="أضف عميلاً جديداً بالاسم ورقم الهاتف أو عدّل خيارات البحث والتصفية."
          actionLabel="إضافة عميل جديد"
          onAction={() => navigate('customer_form')}
        />
      ) : (
        <div className="space-y-2.5">
          {paged.map((c) => {
            const initial = c.fullName.trim().charAt(0) || 'ع';
            const isDebtor = c.cachedBalance > 0;
            const isCreditor = c.cachedBalance < 0;
            const badgeStyle = isDebtor
              ? 'bg-[#FBEAE8] text-[#B93829] dark:bg-[#361815] dark:text-[#F07D70]'
              : isCreditor
              ? 'bg-[#E8EFE9] text-[#1E5638] dark:bg-[#193325] dark:text-[#86C89B]'
              : 'bg-[#F1EFE9] text-[#5C665E] dark:bg-[#1A2D22] dark:text-[#98A89C]';

            return (
              <div
                key={c.id}
                className="rounded-[18px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] p-3.5 flex items-center justify-between gap-2.5 shadow-[0_1px_6px_rgba(22,40,30,0.03)]"
              >
                {/* Right Side (RTL Start): Circular Initial Avatar + Status Dot + Name & Phone & Tags */}
                <button
                  type="button"
                  onClick={() => navigate('customer_profile', { customerId: c.id })}
                  className="flex items-center gap-3 min-w-0 flex-1 text-right"
                >
                  <div className="relative h-11 w-11 rounded-full bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#86C89B] font-display font-extrabold text-base flex items-center justify-center shrink-0">
                    <span>{initial}</span>
                    <span
                      className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#12231A] ${
                        c.status === 'active' ? 'bg-[#2E6046]' : 'bg-[#98A29B]'
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-bold text-sm text-[#16281E] dark:text-[#EEF2EC] truncate">
                      {c.fullName}
                    </div>
                    <div className="text-xs text-[#657369] dark:text-[#98A89C] tabular-nums truncate mt-0.5">
                      {c.phone}
                      {c.category !== 'regular' ? ` · ${categoryLabel(c.category)}` : ''}
                    </div>
                  </div>
                </button>

                {/* Left Side (RTL End): Colored Balance Capsule + 3-Dots Options Button */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => navigate('customer_statement', { customerId: c.id })}
                    className={`px-2.5 py-1.5 rounded-full text-xs font-extrabold tabular-nums whitespace-nowrap ${badgeStyle}`}
                  >
                    {isCreditor ? `${fmt(Math.abs(c.cachedBalance))} له` : fmt(c.cachedBalance)}
                  </button>

                  <button
                    type="button"
                    aria-label={`خيارات حساب ${c.fullName}`}
                    onClick={() => setMenuCustomer(c)}
                    className="h-9 w-9 rounded-full inline-flex items-center justify-center text-[#5B685E] dark:text-[#98A89C] hover:bg-[#EFECE4] dark:hover:bg-[#1B3326]"
                  >
                    <MoreVertical className="h-4.5 w-4.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <PrimaryButton
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            السابق
          </PrimaryButton>
          <span className="text-xs text-[#657369] tabular-nums">
            صفحة {page} من {totalPages}
          </span>
          <PrimaryButton
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            التالي
          </PrimaryButton>
        </div>
      )}

      {/* Account 3-Dots Options Bottom Sheet */}
      <BottomSheet
        open={Boolean(menuCustomer)}
        onClose={() => setMenuCustomer(null)}
        title={menuCustomer?.fullName || 'خيارات الحساب'}
        subtitle={menuCustomer ? `${menuCustomer.phone} · الرصيد ${fmt(menuCustomer.cachedBalance)}` : undefined}
      >
        {menuCustomer && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                const id = menuCustomer.id;
                setMenuCustomer(null);
                navigate('new_sale', { customerId: id });
              }}
              className="w-full p-3.5 rounded-[16px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E5E0D4] dark:border-[#22382B] flex items-center gap-3 text-right hover:border-[#2E6046]"
            >
              <ShoppingBag className="h-4.5 w-4.5 text-[#1E4230] dark:text-[#86C89B]" />
              <span className="text-sm font-bold">تسجيل عملية بيع</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const id = menuCustomer.id;
                setMenuCustomer(null);
                navigate('collection', { customerId: id });
              }}
              className="w-full p-3.5 rounded-[16px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E5E0D4] dark:border-[#22382B] flex items-center gap-3 text-right hover:border-[#2E6046]"
            >
              <Banknote className="h-4.5 w-4.5 text-[#1E5638] dark:text-[#86C89B]" />
              <span className="text-sm font-bold">تسجيل سداد / قبض</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const id = menuCustomer.id;
                setMenuCustomer(null);
                navigate('customer_statement', { customerId: id });
              }}
              className="w-full p-3.5 rounded-[16px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E5E0D4] dark:border-[#22382B] flex items-center gap-3 text-right hover:border-[#2E6046]"
            >
              <FileText className="h-4.5 w-4.5 text-[#244E78] dark:text-[#89BCEE]" />
              <span className="text-sm font-bold">كشف الحساب PDF</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const id = menuCustomer.id;
                setMenuCustomer(null);
                window.dispatchEvent(new CustomEvent('qatshi:open-bulk-sms', { detail: { customerId: id } }));
              }}
              className="w-full p-3.5 rounded-[16px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E5E0D4] dark:border-[#22382B] flex items-center gap-3 text-right hover:border-[#2E6046]"
            >
              <MessageSquare className="h-4.5 w-4.5 text-[#8E621C] dark:text-[#EBB354]" />
              <span className="text-sm font-bold">إرسال رسالة تذكير SMS</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const id = menuCustomer.id;
                setMenuCustomer(null);
                navigate('customer_form', { customerId: id });
              }}
              className="w-full p-3.5 rounded-[16px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E5E0D4] dark:border-[#22382B] flex items-center gap-3 text-right hover:border-[#2E6046]"
            >
              <Edit3 className="h-4.5 w-4.5 text-[#4C5850] dark:text-[#C5D8CA]" />
              <span className="text-sm font-bold">تعديل بيانات العميل</span>
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};

export const CustomerFormView: React.FC = () => {
  const { org, activeUser, customers, screenParams, navigate, refreshData, showToast } = useQatshi();
  const editing = customers.find((c) => c.id === screenParams.customerId);

  const [fullName, setFullName] = useState(editing?.fullName || '');
  const [phone, setPhone] = useState(editing?.phone || '');
  const [showOptional, setShowOptional] = useState(Boolean(editing));
  const [address, setAddress] = useState(editing?.address || '');
  const [category, setCategory] = useState<CustomerCategory>(editing?.category || 'regular');
  const [creditLimit, setCreditLimit] = useState(String(editing?.creditLimit ?? 50000));
  const [status, setStatus] = useState<'active' | 'inactive'>(editing?.status || 'active');
  const [marketingOptOut, setMarketingOptOut] = useState(editing?.marketingOptOut || false);
  const [openingBalance, setOpeningBalance] = useState('0');
  const [notes, setNotes] = useState(editing?.notes || '');
  const [saving, setSaving] = useState(false);
  const [savedCustomer, setSavedCustomer] = useState<Customer | null>(null);
  const submitLockRef = useRef(false);

  if (!org || !activeUser) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSaving(true);
    try {
      const saved = await saveCustomer({
        org,
        user: activeUser,
        customerId: editing?.id,
        fullName,
        phone,
        whatsapp: phone,
        address,
        category,
        creditLimit: Number(creditLimit) || 0,
        status,
        marketingOptOut,
        notes,
        openingBalance: !editing ? Number(openingBalance) || 0 : undefined,
      });
      await refreshData();
      showToast(editing ? 'تم تحديث بيانات العميل' : 'تم حفظ العميل بنجاح');
      if (editing) {
        navigate('customer_profile', { customerId: saved.id });
      } else {
        setSavedCustomer(saved);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ بيانات العميل', 'error');
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  };

  if (savedCustomer) {
    return (
      <div className="max-w-xl mx-auto space-y-5">
        <PageHeader title="تم إضافة العميل" backAction={() => navigate('customers')} />
        <SurfaceCard className="space-y-5 text-center">
          <div className="mx-auto h-14 w-14 rounded-3xl bg-[#EFF1EA] dark:bg-[#1E3A2E] flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-[#1E3A2E] dark:text-[#8FB98D]" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-[#0F1F17] dark:text-white">
              {savedCustomer.fullName}
            </h2>
            <p className="text-sm text-[#6B7F67] font-mono mt-1">{savedCustomer.phone}</p>
          </div>
          <div className="space-y-2.5 pt-2">
            <PrimaryButton
              onClick={() => navigate('new_sale', { customerId: savedCustomer.id })}
              className="w-full min-h-[50px]"
            >
              تسجيل عملية بيع
            </PrimaryButton>
            <PrimaryButton
              variant="secondary"
              onClick={() => navigate('customer_profile', { customerId: savedCustomer.id })}
              className="w-full min-h-[48px]"
            >
              فتح ملف العميل
            </PrimaryButton>
            <PrimaryButton
              variant="ghost"
              onClick={() => navigate('customers')}
              className="w-full min-h-[46px]"
            >
              العودة إلى العملاء
            </PrimaryButton>
          </div>
        </SurfaceCard>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <PageHeader
        title={editing ? `تعديل ملف: ${editing.fullName}` : 'إضافة عميل جديد'}
        subtitle={editing ? 'تحديث البيانات الأساسية والائتمانية' : 'أدخل الاسم ورقم الهاتف فقط للبدء الفوري'}
        backAction={() => navigate(editing ? 'customer_profile' : 'customers', editing ? { customerId: editing.id } : {})}
      />

      <SurfaceCard>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Primary Fields ONLY */}
          <div>
            <label htmlFor="cust-fullname" className="block text-sm font-medium mb-1.5">
              اسم العميل *
            </label>
            <input
              id="cust-fullname"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="مثال: عبد الله محمد الحرازي"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>

          <div>
            <label htmlFor="cust-phone" className="block text-sm font-medium mb-1.5">
              رقم الهاتف *
            </label>
            <input
              id="cust-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="777000000"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm font-mono"
            />
          </div>

          {/* Expandable Optional Data Accordion */}
          <div className="rounded-2xl border border-[#C7CBB8]/60 dark:border-[#243B2E] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowOptional((v) => !v)}
              className="w-full min-h-[48px] px-4 py-2.5 flex items-center justify-between text-sm font-medium bg-[#F9FAF7] dark:bg-[#0B1610] text-[#3D4337] dark:text-[#C7CBB8]"
            >
              <span>بيانات إضافية اختيارية</span>
              {showOptional ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showOptional && (
              <div className="p-4 space-y-4 border-t border-[#C7CBB8]/50 dark:border-[#243B2E]">
                <div>
                  <label htmlFor="cust-address" className="block text-xs font-medium text-[#6B7F67] mb-1">
                    العنوان / المنطقة
                  </label>
                  <input
                    id="cust-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="الحي أو الشارع"
                    className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="cust-category" className="block text-xs font-medium text-[#6B7F67] mb-1">
                      تصنيف العميل
                    </label>
                    <select
                      id="cust-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as CustomerCategory)}
                      className="w-full min-h-[46px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                    >
                      <option value="regular">عادي</option>
                      <option value="vip">عميل مميز</option>
                      <option value="wholesale">عميل جملة</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cust-limit" className="block text-xs font-medium text-[#6B7F67] mb-1">
                      الحد الائتماني
                    </label>
                    <input
                      id="cust-limit"
                      type="number"
                      min="0"
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
                      className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="cust-status" className="block text-xs font-medium text-[#6B7F67] mb-1">
                      الحالة
                    </label>
                    <select
                      id="cust-status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                      className="w-full min-h-[46px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                    >
                      <option value="active">نشط</option>
                      <option value="inactive">غير نشط</option>
                    </select>
                  </div>
                </div>

                {!editing && (
                  <div>
                    <label htmlFor="cust-opening" className="block text-xs font-medium text-[#6B7F67] mb-1">
                      الرصيد الافتتاحي المسبق (إن وجد)
                    </label>
                    <input
                      id="cust-opening"
                      type="number"
                      min="0"
                      step="any"
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      placeholder="0"
                      className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm font-mono"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="cust-notes" className="block text-xs font-medium text-[#6B7F67] mb-1">
                    ملاحظات خاصة
                  </label>
                  <textarea
                    id="cust-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full p-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
                  />
                </div>

                <label className="flex items-center gap-2.5 text-xs sm:text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={marketingOptOut}
                    onChange={(e) => setMarketingOptOut(e.target.checked)}
                    className="h-4 w-4 rounded accent-[#1E3A2E]"
                  />
                  استبعاد العميل من الرسائل الترويجية
                </label>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 pt-2">
            <PrimaryButton type="submit" disabled={saving} className="flex-1 min-h-[48px]">
              <UserCheck className="h-4 w-4" />
              {saving ? 'جاري الحفظ...' : 'حفظ بيانات العميل'}
            </PrimaryButton>
            <PrimaryButton variant="secondary" type="button" onClick={() => navigate('customers')}>
              إلغاء
            </PrimaryButton>
          </div>
        </form>
      </SurfaceCard>
    </div>
  );
};

type ProfileTab = 'overview' | 'statement' | 'sales' | 'payments' | 'activity';

export const CustomerProfileView: React.FC = () => {
  const { org, activeUser, customers, ledgerEntries, messageLogs, screenParams, navigate, refreshData, showToast } =
    useQatshi();
  const customer = customers.find((c) => c.id === screenParams.customerId) || customers[0];
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [profileData, setProfileData] = useState<{
    entries: LedgerEntry[];
    sales: Sale[];
    payments: Payment[];
  } | null>(null);
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [adjDirection, setAdjDirection] = useState<'credit' | 'debit'>('credit');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjSaving, setAdjSaving] = useState(false);
  const adjLockRef = useRef(false);
  const adjIdempRef = useRef(generateUuid());

  useEffect(() => {
    let active = true;
    if (!org || !customer) {
      setProfileData(null);
      return;
    }
    queryCustomerFinancialProfile(org.id, customer.id)
      .then((res) => {
        if (active) setProfileData(res);
      })
      .catch(() => {
        if (active) setProfileData(null);
      });
    return () => {
      active = false;
    };
  }, [org, customer?.id, ledgerEntries]);

  if (!org || !activeUser) return null;
  if (!customer) {
    return (
      <EmptyState
        title="لا يوجد عميل محدد"
        description="اختر عميلاً من قائمة العملاء لعرض ملفه المالي."
        actionLabel="قائمة العملاء"
        onAction={() => navigate('customers')}
      />
    );
  }

  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);
  const custEntries = profileData?.entries ?? ledgerEntries.filter((e) => e.customerId === customer.id);
  const custSales = (profileData?.sales ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const custPayments = (profileData?.payments ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const custMessages = messageLogs.filter((m) => m.customerId === customer.id);

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adjLockRef.current) return;
    adjLockRef.current = true;
    setAdjSaving(true);
    try {
      await createAdjustmentTransaction({
        org,
        user: activeUser,
        customerId: customer.id,
        direction: adjDirection,
        amount: Number(adjAmount),
        reason: adjReason,
        idempotencyKey: adjIdempRef.current,
      });
      adjIdempRef.current = generateUuid();
      setAdjAmount('');
      setAdjReason('');
      setShowAdjustment(false);
      await refreshData();
      const updated = await queryCustomerFinancialProfile(org.id, customer.id);
      setProfileData(updated);
      showToast('تم تسجيل قيد التسوية / المرتجع وتحديث الرصيد');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تسجيل التسوية', 'error');
    } finally {
      adjLockRef.current = false;
      setAdjSaving(false);
    }
  };

  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: 'overview', label: 'نظرة عامة' },
    { id: 'statement', label: 'كشف الحساب' },
    { id: 'sales', label: `المشتريات (${custSales.length})` },
    { id: 'payments', label: `السداد (${custPayments.length})` },
    { id: 'activity', label: 'سجل النشاط' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.fullName}
        subtitle={`${customer.phone}${customer.address ? ` · ${customer.address}` : ''}`}
        backAction={() => navigate('customers')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton variant="secondary" onClick={() => navigate('new_sale', { customerId: customer.id })}>
              <Plus className="h-4 w-4" />
              بيع جديد
            </PrimaryButton>
            <PrimaryButton onClick={() => navigate('collection', { customerId: customer.id })}>
              تسجيل سداد
            </PrimaryButton>
          </div>
        }
      />

      {/* Horizontal Clean Scrollable Material 3 Tab Strip */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[42px] px-4 py-2 rounded-2xl text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
              activeTab === tab.id
                ? 'bg-[#0F1F17] text-white dark:bg-[#3E5A3F]'
                : 'bg-white dark:bg-[#12241B] border border-[#C7CBB8]/60 dark:border-[#243B2E] text-[#3D4337] dark:text-[#C7CBB8]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5">
            <KpiMetric
              label="المديونية الحالية"
              value={fmt(customer.cachedBalance)}
              tone={customer.cachedBalance > 0 ? 'danger' : 'positive'}
              meta={`الحد: ${fmt(customer.creditLimit)}`}
            />
            <KpiMetric
              label="إجمالي المشتريات"
              value={fmt(customer.cachedTotalPurchases)}
              meta={`${customer.purchaseCount} فاتورة`}
            />
            <KpiMetric
              label="إجمالي المدفوعات"
              value={fmt(customer.cachedTotalPaid)}
              tone="positive"
            />
            <KpiMetric
              label="آخر شراء"
              value={formatDateArabic(customer.lastPurchaseAt, org.dateFormat)}
              meta={customer.marketingOptOut ? 'مستبعد من الترويج' : 'مفعّل للعروض'}
            />
          </div>

          <SurfaceCard className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold">إجراءات الملف</h2>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton
                  variant="secondary"
                  onClick={() => navigate('customer_form', { customerId: customer.id })}
                >
                  تعديل البيانات
                </PrimaryButton>
                <PrimaryButton
                  variant="secondary"
                  onClick={() => navigate('customer_statement', { customerId: customer.id })}
                >
                  <FileText className="h-4 w-4" />
                  كشف حساب PDF
                </PrimaryButton>
                {hasPermission(activeUser.role, 'create_adjustment') && (
                  <PrimaryButton variant="secondary" onClick={() => setShowAdjustment((v) => !v)}>
                    <RotateCcw className="h-4 w-4" />
                    تسوية / مرتجع
                  </PrimaryButton>
                )}
              </div>
            </div>

            {customer.notes && (
              <div className="p-3.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] text-sm text-[#3D4337] dark:text-[#C7CBB8]">
                ملاحظات: {customer.notes}
              </div>
            )}

            {showAdjustment && (
              <form
                onSubmit={handleCreateAdjustment}
                className="p-4 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8]/60 dark:border-[#243B2E] space-y-3"
              >
                <h3 className="font-display text-sm font-bold">إضافة قيد تسوية أو مرتجع محاسبي</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <select
                    aria-label="نوع القيد"
                    value={adjDirection}
                    onChange={(e) => setAdjDirection(e.target.value as 'credit' | 'debit')}
                    className="min-h-[46px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm"
                  >
                    <option value="credit">إشعار دائن / مرتجع (يخفض المديونية)</option>
                    <option value="debit">تسوية مدينة (تزيد المديونية)</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    placeholder="المبلغ *"
                    className="min-h-[46px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm font-mono"
                  />
                  <input
                    type="text"
                    required
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    placeholder="سبب التسوية *"
                    className="min-h-[46px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <PrimaryButton type="submit" disabled={adjSaving}>
                    {adjSaving ? 'جاري الاعتماد...' : 'اعتماد القيد'}
                  </PrimaryButton>
                  <PrimaryButton variant="secondary" type="button" onClick={() => setShowAdjustment(false)}>
                    إلغاء
                  </PrimaryButton>
                </div>
              </form>
            )}
          </SurfaceCard>
        </div>
      )}

      {/* TAB 2: Statement */}
      {activeTab === 'statement' && (
        <SurfaceCard className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold">الحركات المالية في الحساب</h2>
            <PrimaryButton
              variant="secondary"
              onClick={() => navigate('customer_statement', { customerId: customer.id })}
            >
              <Download className="h-4 w-4" />
              تصدير كشف PDF كامل
            </PrimaryButton>
          </div>

          {custEntries.length === 0 ? (
            <p className="text-sm text-[#6B7F67] py-6 text-center">لا توجد حركات مالية لهذا العميل بعد.</p>
          ) : (
            <div className="space-y-2.5">
              {custEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8]/45 dark:border-[#243B2E] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-xs font-semibold text-[#3E5A3F] dark:text-[#8FB98D]">
                      {formatCommercialRef(entry.refNumber, entry.refType)}
                    </div>
                    <div className="text-sm font-medium truncate">
                      {sanitizeCommercialText(entry.description)}
                    </div>
                    <div className="text-[11px] text-[#6B7F67]">
                      {formatDateArabic(entry.createdAt, org.dateFormat, true)}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    {entry.debit > 0 && (
                      <div className="text-sm font-bold tabular-nums text-red-700 dark:text-red-400">
                        + {fmt(entry.debit)}
                      </div>
                    )}
                    {entry.credit > 0 && (
                      <div className="text-sm font-bold tabular-nums text-[#1E3A2E] dark:text-[#8FB98D]">
                        - {fmt(entry.credit)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}

      {/* TAB 3: Purchases */}
      {activeTab === 'sales' && (
        <SurfaceCard className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">فواتير المشتريات</h2>
            <PrimaryButton variant="secondary" onClick={() => navigate('new_sale', { customerId: customer.id })}>
              <Plus className="h-4 w-4" />
              بيع جديد
            </PrimaryButton>
          </div>
          {custSales.length === 0 ? (
            <p className="text-sm text-[#6B7F67] py-6 text-center">لا توجد فواتير شراء لهذا العميل بعد.</p>
          ) : (
            <div className="space-y-2.5">
              {custSales.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate('sale_detail', { saleId: s.id })}
                  className="w-full p-3.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8]/45 dark:border-[#243B2E] flex items-center justify-between gap-3 text-right"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#3E5A3F] dark:text-[#8FB98D]">
                      {formatCommercialRef(s.invoiceNumber, 'sale')}
                    </div>
                    <div className="text-xs text-[#6B7F67] truncate mt-0.5">
                      {s.items.map((i) => `${i.productName} × ${i.quantity}`).join('، ')}
                    </div>
                    <div className="text-[11px] text-[#6B7F67]">
                      {formatDateArabic(s.createdAt, org.dateFormat, true)}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className={`text-sm font-bold tabular-nums ${s.status === 'reversed' ? 'line-through text-red-600' : ''}`}>
                      {fmt(s.total)}
                    </div>
                    <div className="text-[11px] text-[#6B7F67]">
                      {s.status === 'reversed' ? 'ملغاة' : s.remainingAmount > 0 ? `متبقي: ${fmt(s.remainingAmount)}` : 'مدفوعة'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}

      {/* TAB 4: Payments */}
      {activeTab === 'payments' && (
        <SurfaceCard className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">سندات السداد</h2>
            <PrimaryButton onClick={() => navigate('collection', { customerId: customer.id })}>
              تسجيل سداد
            </PrimaryButton>
          </div>
          {custPayments.length === 0 ? (
            <p className="text-sm text-[#6B7F67] py-6 text-center">لم تُسجل سندات سداد لهذا العميل بعد.</p>
          ) : (
            <div className="space-y-2.5">
              {custPayments.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate('receipt', { paymentId: p.id, receiptType: 'payment' })}
                  className="w-full p-3.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8]/45 dark:border-[#243B2E] flex items-center justify-between gap-3 text-right"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#3E5A3F] dark:text-[#8FB98D]">
                      {formatCommercialRef(p.receiptNumber, 'payment')}
                    </div>
                    <div className="text-xs text-[#6B7F67] mt-0.5">
                      {formatDateArabic(p.createdAt, org.dateFormat, true)}
                    </div>
                  </div>
                  <div className={`text-sm font-bold tabular-nums ${p.status === 'reversed' ? 'line-through text-red-600' : 'text-[#1E3A2E] dark:text-[#8FB98D]'}`}>
                    {fmt(p.amount)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}

      {/* TAB 5: Activity & SMS */}
      {activeTab === 'activity' && (
        <SurfaceCard className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">الرسائل والنشاط</h2>
            <PrimaryButton
              variant="secondary"
              onClick={() => navigate('messaging', { initialMessageCustomerId: customer.id })}
            >
              <MessageSquare className="h-4 w-4" />
              إرسال SMS
            </PrimaryButton>
          </div>
          {custMessages.length === 0 ? (
            <p className="text-sm text-[#6B7F67] py-6 text-center">لم يتم إرسال رسائل نصية لهذا العميل بعد.</p>
          ) : (
            <div className="space-y-2.5">
              {custMessages.map((m) => (
                <div
                  key={m.id}
                  className="p-3.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8]/45 dark:border-[#243B2E] space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs text-[#6B7F67]">
                    <span>{getSmsStatusLabel(m.status)}</span>
                    <span className="tabular-nums">{formatDateArabic(m.createdAt, org.dateFormat, true)}</span>
                  </div>
                  <p className="text-xs text-[#0F1F17] dark:text-[#E8EAE0] whitespace-pre-line">{m.body}</p>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}
    </div>
  );
};

export const CustomerStatementView: React.FC = () => {
  const { org, customers, ledgerEntries, screenParams, navigate, showToast } = useQatshi();
  const [selectedCustomerId, setSelectedCustomerId] = useState(
    screenParams.customerId || customers[0]?.id || ''
  );
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [exporting, setExporting] = useState(false);
  const [fullEntries, setFullEntries] = useState<LedgerEntry[] | null>(null);

  const customer = customers.find((c) => c.id === selectedCustomerId);

  useEffect(() => {
    let active = true;
    if (!org || !selectedCustomerId) {
      setFullEntries(null);
      return;
    }
    queryCustomerFinancialProfile(org.id, selectedCustomerId)
      .then((res) => {
        if (active) setFullEntries(res.entries);
      })
      .catch(() => {
        if (active) setFullEntries(null);
      });
    return () => {
      active = false;
    };
  }, [org, selectedCustomerId, ledgerEntries]);

  const statement = useMemo(() => {
    if (!org || !customer) return null;
    const entries = fullEntries ?? ledgerEntries.filter((e) => e.customerId === customer.id);
    return computeCustomerLedgerStatement(entries, fromDate || undefined, toDate || undefined, org.currencyDecimals);
  }, [org, customer, fullEntries, ledgerEntries, fromDate, toDate]);

  if (!org) return null;

  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const handleDownloadPdf = async (shareMode = false) => {
    if (!customer || !statement) return;
    setExporting(true);
    try {
      const { blob, fileName } = await generateCustomerStatementPdf({
        org,
        customer,
        statement,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });

      if (shareMode) {
        const res = await sharePdfDocument({
          blob,
          fileName,
          title: `كشف حساب ${customer.fullName}`,
          text: `كشف حساب العميل ${customer.fullName} من ${org.name}`,
        });
        showToast(res.message);
        return;
      }
      triggerBlobDownload(blob, fileName);
      showToast('تم إنشاء وتنزيل كشف الحساب بصيغة PDF');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تصدير PDF', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="كشف حساب العميل"
        subtitle="كشف حساب رسمي جاهز للطباعة والمشاركة بصيغة PDF"
        backAction={() => navigate('customers')}
        action={
          customer && statement ? (
            <div className="flex flex-wrap items-center gap-2 no-print">
              <PrimaryButton variant="secondary" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                طباعة
              </PrimaryButton>
              <PrimaryButton variant="secondary" onClick={() => handleDownloadPdf(true)} disabled={exporting}>
                <Share2 className="h-4 w-4" />
                مشاركة PDF
              </PrimaryButton>
              <PrimaryButton onClick={() => handleDownloadPdf(false)} disabled={exporting}>
                <Download className="h-4 w-4" />
                {exporting ? 'جاري التجهيز...' : 'تحميل PDF'}
              </PrimaryButton>
            </div>
          ) : null
        }
      />

      <SurfaceCard className="no-print">
        <div className="grid grid-cols-1 gap-2.5">
          <div>
            <label htmlFor="stmt-customer" className="block text-xs font-medium text-[#6B7F67] mb-1">
              العميل
            </label>
            <select
              id="stmt-customer"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="w-full min-h-[46px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName} ({fmt(c.cachedBalance)})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="stmt-from" className="block text-xs font-medium text-[#6B7F67] mb-1">
                من تاريخ
              </label>
              <input
                id="stmt-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full min-h-[46px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-xs font-mono"
              />
            </div>
            <div>
              <label htmlFor="stmt-to" className="block text-xs font-medium text-[#6B7F67] mb-1">
                إلى تاريخ
              </label>
              <input
                id="stmt-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full min-h-[46px] px-3 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-xs font-mono"
              />
            </div>
          </div>
        </div>
      </SurfaceCard>

      {customer && statement && (
        <SurfaceCard className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#C7CBB8]/60 dark:border-[#243B2E]">
            <div>
              <div className="font-display text-base font-bold">{org.name}</div>
              <div className="text-xs text-[#6B7F67]">{org.address} · {org.phone}</div>
            </div>
            <div className="text-left">
              <div className="font-display text-sm font-semibold">كشف حساب: {customer.fullName}</div>
              <div className="text-xs text-[#6B7F67]">{customer.phone}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <KpiMetric label="الرصيد الافتتاحي" value={fmt(statement.openingBalance)} />
            <KpiMetric label="إجمالي المشتريات" value={fmt(statement.totalPurchasesDebit)} />
            <KpiMetric label="إجمالي السداد" value={fmt(statement.totalPaymentsCredit)} tone="positive" />
            <KpiMetric
              label="الرصيد النهائي"
              value={fmt(statement.closingBalance)}
              tone={statement.closingBalance > 0 ? 'danger' : 'positive'}
              meta={`الخصومات: ${fmt(statement.totalDiscountsAndAdjustments)}`}
            />
          </div>

          <div className="space-y-2.5">
            {statement.rows.length === 0 ? (
              <p className="text-sm text-[#6B7F67] py-6 text-center">لا توجد حركات مالية في الفترة المحددة</p>
            ) : (
              statement.rows.map((r) => (
                <div
                  key={r.entry.id}
                  className="p-3.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8]/45 dark:border-[#243B2E] space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#3E5A3F] dark:text-[#8FB98D]">
                      {formatCommercialRef(r.entry.refNumber, r.entry.refType)}
                    </span>
                    <span className="text-[#6B7F67] tabular-nums">
                      {formatDateArabic(r.entry.createdAt, org.dateFormat)}
                    </span>
                  </div>
                  <div className="text-sm">{sanitizeCommercialText(r.entry.description)}</div>
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-[#C7CBB8]/30 dark:border-[#243B2E]">
                    <span>
                      {r.entry.debit > 0 && (
                        <strong className="text-red-700 dark:text-red-400">عليه: {fmt(r.entry.debit)}</strong>
                      )}
                      {r.entry.credit > 0 && (
                        <strong className="text-[#1E3A2E] dark:text-[#8FB98D]">له: {fmt(r.entry.credit)}</strong>
                      )}
                    </span>
                    <span className="font-bold tabular-nums">الرصيد: {fmt(r.runningBalance)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>
      )}
    </div>
  );
};

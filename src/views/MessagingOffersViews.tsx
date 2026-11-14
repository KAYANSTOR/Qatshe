import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckSquare,
  Contact,
  Edit3,
  ExternalLink,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Square,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useQatshi } from '../context/QatshiContext';
import { formatDateArabic, formatMoney } from '../domain/money';
import {
  calculateSmsSegments,
  getSmsStatusLabel,
  isValidSmsPhone,
  normalizeSmsPhoneNumber,
  resolveConfirmedSmsRecipients,
} from '../domain/sms';
import { evaluateTargetAudience, renderTemplateVariables } from '../domain/templates';
import type { AudienceFilterType, MessageStatus, MessageTemplate, TemplateCategory } from '../domain/types';
import { generateUuid } from '../services/device';
import {
  confirmManualSmsOutcome,
  deleteMessageTemplate,
  dispatchSmsViaDeviceSim,
  prepareConfirmedSmsBatch,
  saveMessageTemplate,
  saveMessagingConfig,
} from '../services/messagingService';
import {
  buildSmsDeviceIntentUri,
  capacitorSmsBridge,
  type NativeSmsEnvironmentStatus,
} from '../services/nativeSmsBridge';
import {
  BottomSheet,
  EmptyState,
  KpiMetric,
  PageHeader,
  PrimaryButton,
  StepProgress,
  SurfaceCard,
} from '../components/ui/LuxuryUI';

const VARIABLE_TOKENS = [
  { token: '{customer_name}', label: 'اسم العميل' },
  { token: '{shop_name}', label: 'اسم المحل' },
  { token: '{customer_balance}', label: 'رصيد العميل' },
  { token: '{amount_paid}', label: 'المبلغ المدفوع' },
  { token: '{remaining_balance}', label: 'المتبقي' },
  { token: '{last_purchase_date}', label: 'آخر شراء' },
  { token: '{last_payment_date}', label: 'آخر سداد' },
  { token: '{today_date}', label: 'تاريخ اليوم' },
  { token: '{shop_phone}', label: 'هاتف المحل' },
];

interface AdhocContact {
  id: string;
  name: string;
  phone: string;
}

const formatEncodingArabic = (encoding?: string) => (encoding === 'GSM-7' ? 'ترميز لاتيني' : 'ترميز عربي');

const SmsTopNav: React.FC<{ active: 'messaging' | 'templates' | 'message_log' | 'sms_settings' }> = ({ active }) => {
  const { navigate, messageLogs } = useQatshi();
  const pendingCount = messageLogs.filter((m) => m.status === 'pending' || m.status === 'sending').length;
  const tabs: Array<{ id: 'messaging' | 'templates' | 'message_log' | 'sms_settings'; label: string }> = [
    { id: 'messaging', label: 'إرسال رسائل' },
    { id: 'templates', label: 'القوالب' },
    { id: 'message_log', label: pendingCount > 0 ? `السجل (${pendingCount})` : 'السجل' },
    { id: 'sms_settings', label: 'إعدادات الشريحة' },
  ];

  return (
    <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[#EFF1EA] dark:bg-[#0B1610] border border-[#C7CBB8]/50 dark:border-[#243B2E] overflow-x-auto max-w-full">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => navigate(tab.id)}
          className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            active === tab.id
              ? 'bg-[#0F1F17] text-white dark:bg-[#3E5A3F]'
              : 'text-[#3D4337] dark:text-[#C7CBB8] hover:bg-white/70 dark:hover:bg-[#1E3A2E]/60'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export const MessagingCenterView: React.FC = () => {
  const {
    org,
    activeUser,
    customers,
    sales,
    payments,
    templates,
    messagingConfig,
    screenParams,
    navigate,
    refreshData,
    showToast,
  } = useQatshi();

  const initialTemplate =
    templates.find((t) => t.id === screenParams.initialTemplateId) || templates[0];

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [title, setTitle] = useState('حملة رسائل نصية للعملاء');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplate?.id || '');
  const [bodyTemplate, setBodyTemplate] = useState(
    initialTemplate?.body ||
      'مرحباً {customer_name}، رصيدكم لدى {shop_name} هو {customer_balance}. للاستفسار: {shop_phone}'
  );
  const [isMarketing, setIsMarketing] = useState(
    initialTemplate ? initialTemplate.category === 'offer' || initialTemplate.category === 'vip' : false
  );

  // Step 2: Recipients
  const [filterType, setFilterType] = useState<AudienceFilterType>(
    screenParams.initialMessageCustomerId ? 'all' : 'debtors'
  );
  const [minDebt, setMinDebt] = useState('20000');
  const [inactiveDays, setInactiveDays] = useState('14');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>(() =>
    screenParams.initialMessageCustomerId ? [screenParams.initialMessageCustomerId] : []
  );
  const [adhocContacts, setAdhocContacts] = useState<AdhocContact[]>([]);
  const [showAdhocForm, setShowAdhocForm] = useState(false);
  const [adhocName, setAdhocName] = useState('');
  const [adhocPhone, setAdhocPhone] = useState('');

  // Step 3 & 4: SIM & Review Sheet
  const [envStatus, setEnvStatus] = useState<NativeSmsEnvironmentStatus | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<number | undefined>(
    messagingConfig?.preferredSimSubscriptionId
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmedReviewCheck, setConfirmedReviewCheck] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  useEffect(() => {
    let active = true;
    capacitorSmsBridge.getEnvironmentStatus().then((st) => {
      if (!active) return;
      setEnvStatus(st);
      if (st.sims.length > 0 && selectedSubId === undefined) {
        setSelectedSubId(st.sims[0].subscriptionId);
      }
    });
    return () => {
      active = false;
    };
  }, [selectedSubId]);

  useEffect(() => {
    if (screenParams.initialTemplateId) {
      const t = templates.find((item) => item.id === screenParams.initialTemplateId);
      if (t) {
        setSelectedTemplateId(t.id);
        setBodyTemplate(t.body);
        setIsMarketing(t.category === 'offer' || t.category === 'vip');
      }
    }
  }, [screenParams.initialTemplateId, templates]);

  const filteredCustomers = useMemo(() => {
    const base = evaluateTargetAudience({
      customers,
      sales,
      payments,
      filter: filterType,
      minDebtThreshold: Number(minDebt) || 0,
      inactiveDays: Number(inactiveDays) || 14,
      manualCustomerIds: selectedCustomerIds,
      isMarketingCampaign: false,
    });
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
    );
  }, [customers, sales, payments, filterType, minDebt, inactiveDays, selectedCustomerIds, searchQuery]);

  const resolvedBatch = useMemo(() => {
    return resolveConfirmedSmsRecipients({
      customers,
      selectedCustomerIds,
      extraAdhocContacts: adhocContacts,
      isMarketingMessage: isMarketing,
    });
  }, [customers, selectedCustomerIds, adhocContacts, isMarketing]);

  if (!org || !activeUser || !messagingConfig) return null;

  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);
  const sampleCustomer = resolvedBatch.validRecipients[0]?.customer || customers[0];
  const sampleRecipientName =
    resolvedBatch.validRecipients[0]?.name || sampleCustomer?.fullName || 'العميل';
  const renderedSample = renderTemplateVariables(bodyTemplate, {
    customerName: sampleRecipientName,
    shopName: org.name,
    customerBalance: sampleCustomer?.cachedBalance ?? 0,
    remainingBalance: sampleCustomer?.cachedBalance ?? 0,
    lastPurchaseDate: sampleCustomer?.lastPurchaseAt,
    lastPaymentDate: sampleCustomer?.lastPaymentAt,
    shopPhone: org.phone,
    org,
  });

  const draftSegments = calculateSmsSegments(bodyTemplate);
  const sampleSegments = calculateSmsSegments(renderedSample);
  const totalEstimatedParts = resolvedBatch.validRecipients.length * Math.max(1, sampleSegments.partsCount);

  const toggleCustomerSelection = (id: string) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllFiltered = () => {
    const ids = filteredCustomers.map((c) => c.id);
    setSelectedCustomerIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const handleClearSelection = () => {
    setSelectedCustomerIds([]);
    setAdhocContacts([]);
  };

  const handlePickDeviceContact = async () => {
    if (envStatus?.isNativeAndroid) {
      try {
        const picked = await capacitorSmsBridge.pickDeviceContact();
        if (!picked) {
          showToast('تم إلغاء اختيار جهة الاتصال', 'info');
          return;
        }
        if (!isValidSmsPhone(picked.phone)) {
          showToast('الرقم المختار غير صالح للإرسال النصي', 'error');
          return;
        }
        setAdhocContacts((prev) => {
          const normalized = normalizeSmsPhoneNumber(picked.phone);
          if (prev.some((x) => normalizeSmsPhoneNumber(x.phone) === normalized)) return prev;
          return [...prev, { id: `contact-${generateUuid()}`, name: picked.name, phone: normalized }];
        });
        showToast(`تمت إضافة جهة الاتصال: ${picked.name}`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'تعذر فتح جهات اتصال الهاتف', 'error');
      }
      return;
    }
    setShowAdhocForm(true);
    showToast('يمكنك إضافة رقم هاتف يدوياً من النموذج أدناه', 'info');
  };

  const handleAddAdhocContact = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeSmsPhoneNumber(adhocPhone);
    if (!isValidSmsPhone(normalized)) {
      showToast('أدخل رقم هاتف صحيحاً (من 6 إلى 15 رقماً)', 'error');
      return;
    }
    setAdhocContacts((prev) => [
      ...prev,
      {
        id: `adhoc-${generateUuid()}`,
        name: adhocName.trim() || normalized,
        phone: normalized,
      },
    ]);
    setAdhocName('');
    setAdhocPhone('');
    setShowAdhocForm(false);
    showToast('تمت إضافة المستلم لقائمة الإرسال');
  };

  const executeBatch = async (dispatchImmediately: boolean) => {
    if (!confirmedReviewCheck) {
      showToast('يرجى تفعيل خانة تأكيد مراجعة المستلمين والنص قبل المتابعة', 'error');
      return;
    }
    setDispatching(true);
    try {
      const selectedSim = envStatus?.sims.find((s) => s.subscriptionId === selectedSubId);
      const { logs } = await prepareConfirmedSmsBatch({
        org,
        user: activeUser,
        title,
        bodyTemplate,
        confirmedCustomerIds: selectedCustomerIds,
        extraAdhocContacts: adhocContacts,
        isMarketingMessage: isMarketing,
        templateId: selectedTemplateId || undefined,
        simSlot: selectedSim?.slotIndex,
        subscriptionId: selectedSim?.subscriptionId ?? selectedSubId,
      });

      if (dispatchImmediately) {
        let sentToNet = 0;
        let failed = 0;
        let browserFallback = 0;
        for (const item of logs) {
          const result = await dispatchSmsViaDeviceSim({
            logId: item.id,
            subscriptionId: selectedSim?.subscriptionId ?? selectedSubId,
            simSlot: selectedSim?.slotIndex,
          });
          if (result.status === 'sent_to_network' || result.status === 'delivered') sentToNet += 1;
          else if (result.dispatchMethod === 'device_intent_fallback') browserFallback += 1;
          else if (result.status === 'failed' || result.status === 'unknown') failed += 1;
        }
        await refreshData();
        setReviewOpen(false);
        if (browserFallback > 0) {
          showToast(
            `تم حفظ ${logs.length} رسالة في السجل. افتح كل رسالة في تطبيق الرسائل بالهاتف وأكّد النتيجة.`,
            'info'
          );
        } else {
          showToast(`أُرسلت للشبكة: ${sentToNet} · تعذر/فشل: ${failed}`);
        }
      } else {
        await refreshData();
        setReviewOpen(false);
        showToast(`تم حفظ ${logs.length} رسالة في قائمة الانتظار`);
      }

      navigate('message_log');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر تنفيذ الدفعة', 'error');
    } finally {
      setDispatching(false);
    }
  };

  const stepTitles = [
    '1. القالب ونص الرسالة',
    '2. اختيار المستلمين',
    '3. المعاينة وتكلفة الأجزاء',
    '4. التأكيد والإرسال',
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="مركز الرسائل النصية"
        subtitle="إرسال مباشر عبر شريحة الهاتف بدون خدمات خارجية"
        backAction={() => {
          if (step > 1) setStep((s) => (s === 4 ? 3 : s === 3 ? 2 : 1));
          else navigate('dashboard');
        }}
        action={<SmsTopNav active="messaging" />}
      />

      <StepProgress currentStep={step} totalSteps={4} stepTitle={stepTitles[step - 1]} />

      {/* Step 1: Template & Body */}
      {step === 1 && (
        <SurfaceCard className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold">تجهيز نص الرسالة</h2>
            <span className="text-xs px-2.5 py-1 rounded-xl bg-[#EFF1EA] dark:bg-[#1E3A2E] tabular-nums">
              {formatEncodingArabic(draftSegments.encoding)} · {draftSegments.charCount} حرف ·{' '}
              {Math.max(1, draftSegments.partsCount)} جزء
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="sms-batch-title" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                عنوان الحملة أو التذكير
              </label>
              <input
                id="sms-batch-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>

            <div>
              <label htmlFor="sms-template-select" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
                اختيار قالب جاهز
              </label>
              <select
                id="sms-template-select"
                value={selectedTemplateId}
                onChange={(e) => {
                  setSelectedTemplateId(e.target.value);
                  const found = templates.find((t) => t.id === e.target.value);
                  if (found) {
                    setBodyTemplate(found.body);
                    setIsMarketing(found.category === 'offer' || found.category === 'vip');
                  }
                }}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              >
                <option value="">— رسالة مخصصة —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="sms-body-input" className="block text-xs text-[#6B7F67] mb-1.5">
              نص الرسالة (النص العربي يتسع لـ 70 حرفاً للجزء الأول ثم 67 لكل جزء إضافي)
            </label>
            <textarea
              id="sms-body-input"
              rows={4}
              required
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              className="w-full p-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm leading-relaxed"
            />
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {VARIABLE_TOKENS.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  onClick={() =>
                    setBodyTemplate((prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${item.token}`)
                  }
                  className="min-h-[36px] px-2.5 py-1 rounded-xl bg-[#EFF1EA] dark:bg-[#1E3A2E] text-xs font-medium hover:bg-[#DCE0D2]"
                >
                  + {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs cursor-pointer py-1">
            <input
              type="checkbox"
              checked={isMarketing}
              onChange={(e) => setIsMarketing(e.target.checked)}
              className="h-4 w-4 accent-[#1E3A2E]"
            />
            رسالة عرض ترويجي (استبعاد العملاء غير الراغبين في العروض تلقائياً)
          </label>

          <PrimaryButton
            type="button"
            disabled={!bodyTemplate.trim()}
            onClick={() => setStep(2)}
            className="w-full"
          >
            التالي: اختيار المستلمين
            <ArrowLeft className="h-4 w-4" />
          </PrimaryButton>
        </SurfaceCard>
      )}

      {/* Step 2: Explicit Recipients */}
      {step === 2 && (
        <SurfaceCard className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold">تحديد المستلمين</h2>
            <span className="px-3 py-1 rounded-xl bg-[#0F1F17] text-white dark:bg-[#3E5A3F] text-xs font-bold tabular-nums">
              المحدّدون: {resolvedBatch.validRecipients.length}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="sms-filter" className="block text-xs text-[#6B7F67] mb-1.5">
                تصفية العملاء
              </label>
              <select
                id="sms-filter"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as AudienceFilterType)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              >
                <option value="all">جميع العملاء</option>
                <option value="debtors">العملاء الذين عليهم ديون</option>
                <option value="debt_above">ديون تتجاوز حداً معيناً</option>
                <option value="overdue">المتأخرون عن السداد</option>
                <option value="inactive">لم يشتروا منذ فترة</option>
                <option value="paid_today">سددوا اليوم</option>
                <option value="vip">عملاء مميزون</option>
                <option value="active">العملاء النشطون</option>
              </select>
            </div>
            <div>
              <label htmlFor="sms-search" className="block text-xs text-[#6B7F67] mb-1.5">
                بحث بالاسم أو الهاتف
              </label>
              <input
                id="sms-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بالاسم أو الجوال..."
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>
          </div>

          {filterType === 'debt_above' && (
            <div>
              <label htmlFor="sms-min-debt" className="block text-xs text-[#6B7F67] mb-1.5">
                الحد الأدنى للمديونية
              </label>
              <input
                id="sms-min-debt"
                type="number"
                value={minDebt}
                onChange={(e) => setMinDebt(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
          )}

          {filterType === 'inactive' && (
            <div>
              <label htmlFor="sms-inactive" className="block text-xs text-[#6B7F67] mb-1.5">
                عدد أيام الانقطاع
              </label>
              <input
                id="sms-inactive"
                type="number"
                value={inactiveDays}
                onChange={(e) => setInactiveDays(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="button" variant="secondary" onClick={handleSelectAllFiltered}>
              <CheckSquare className="h-4 w-4" />
              تحديد الكل ({filteredCustomers.length})
            </PrimaryButton>
            <PrimaryButton type="button" variant="secondary" onClick={handleClearSelection}>
              <Square className="h-4 w-4" />
              إلغاء التحديد
            </PrimaryButton>
            <PrimaryButton type="button" variant="secondary" onClick={handlePickDeviceContact}>
              <Contact className="h-4 w-4" />
              من جهات الاتصال / رقم يدوي
            </PrimaryButton>
          </div>

          {showAdhocForm && (
            <form
              onSubmit={handleAddAdhocContact}
              className="p-4 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F4F5F0] dark:bg-[#0B1610] space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">إضافة رقم هاتف مؤقت إلى الحملة</span>
                <button
                  type="button"
                  onClick={() => setShowAdhocForm(false)}
                  aria-label="إغلاق"
                  className="text-[#6B7F67] hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  value={adhocName}
                  onChange={(e) => setAdhocName(e.target.value)}
                  placeholder="الاسم (اختياري)"
                  className="min-h-[44px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm"
                />
                <input
                  type="tel"
                  value={adhocPhone}
                  onChange={(e) => setAdhocPhone(e.target.value)}
                  placeholder="رقم الهاتف"
                  className="min-h-[44px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm tabular-nums"
                />
                <PrimaryButton type="submit">إضافة للقائمة</PrimaryButton>
              </div>
            </form>
          )}

          {adhocContacts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {adhocContacts.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#EFF1EA] dark:bg-[#1E3A2E] text-xs"
                >
                  <span>
                    {c.name} ({c.phone})
                  </span>
                  <button
                    type="button"
                    onClick={() => setAdhocContacts((prev) => prev.filter((x) => x.id !== c.id))}
                    aria-label={`إزالة ${c.name}`}
                    className="text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {filteredCustomers.length === 0 ? (
            <div className="p-5 rounded-2xl border border-dashed border-[#C7CBB8] dark:border-[#2C4235] text-center text-xs text-[#6B7F67]">
              لا يوجد عملاء مطابقون للتصفية الحالية. يمكنك اختيار فلتر آخر أو إضافة رقم يدوياً.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E] rounded-2xl border border-[#C7CBB8]/60 dark:border-[#243B2E]">
              {filteredCustomers.map((c) => {
                const checked = selectedCustomerIds.includes(c.id);
                const optOutBlocked = isMarketing && c.marketingOptOut;
                const invalidPhone = !isValidSmsPhone(c.phone);
                return (
                  <label
                    key={c.id}
                    className={`min-h-[56px] flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm cursor-pointer hover:bg-[#F9FAF7] dark:hover:bg-[#0B1610] ${
                      optOutBlocked ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCustomerSelection(c.id)}
                        className="h-5 w-5 accent-[#1E3A2E] shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{c.fullName}</div>
                        <div className="text-xs text-[#6B7F67] tabular-nums">
                          {c.phone || 'بدون رقم'}
                          {optOutBlocked && ' · مستبعد تسويقياً'}
                          {invalidPhone && ' · رقم غير صالح'}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-bold tabular-nums shrink-0 text-[#1E3A2E] dark:text-[#8FB98D]">
                      {fmt(c.cachedBalance)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
            <PrimaryButton type="button" variant="secondary" onClick={() => setStep(1)} className="w-full sm:w-auto">
              السابق
            </PrimaryButton>
            <PrimaryButton
              type="button"
              disabled={resolvedBatch.validRecipients.length === 0}
              onClick={() => setStep(3)}
              className="w-full sm:flex-1"
            >
              التالي: المعاينة والتكلفة ({resolvedBatch.validRecipients.length})
              <ArrowLeft className="h-4 w-4" />
            </PrimaryButton>
          </div>
        </SurfaceCard>
      )}

      {/* Step 3: Live Preview & Cost Estimation */}
      {step === 3 && (
        <div className="space-y-4">
          <SurfaceCard className="space-y-4">
            <h2 className="font-display text-base font-bold">معاينة الرسالة وتكلفة الأجزاء</h2>

            <div className="grid grid-cols-2 gap-3">
              <KpiMetric label="المستلمون المؤكدون" value={String(resolvedBatch.validRecipients.length)} />
              <KpiMetric
                label="إجمالي أجزاء الرسالة"
                value={String(totalEstimatedParts)}
                meta={`${formatEncodingArabic(sampleSegments.encoding)} · ${sampleSegments.partsCount || 1} جزء/مستلم`}
                tone={sampleSegments.partsCount > 1 ? 'warning' : 'default'}
              />
            </div>

            {sampleSegments.partsCount > 1 && (
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-500/30 text-xs text-amber-900 dark:text-amber-300">
                تنبيه التكلفة: هذه الرسالة تتجاوز حد الرسالة الواحدة وستُحسب على شريحة الهاتف كـ{' '}
                <strong>{sampleSegments.partsCount} أجزاء</strong> لكل مستلم.
              </div>
            )}

            <div className="p-4 rounded-2xl bg-[#F4F5F0] dark:bg-[#0B1610] border border-[#C7CBB8]/60 dark:border-[#243B2E] space-y-2">
              <div className="flex items-center justify-between text-xs text-[#6B7F67]">
                <span>نموذج للعميل: {sampleRecipientName}</span>
                <span className="tabular-nums">
                  {sampleSegments.charCount} حرف · متبقي {sampleSegments.charsRemainingInCurrentPart}
                </span>
              </div>
              <p className="text-sm whitespace-pre-line leading-relaxed">{renderedSample}</p>
            </div>

            {(resolvedBatch.excludedOptOutCount > 0 ||
              resolvedBatch.excludedInvalidPhoneCount > 0 ||
              resolvedBatch.excludedDuplicateCount > 0) && (
              <div className="text-xs text-[#6B7F67] space-y-1">
                {resolvedBatch.excludedOptOutCount > 0 && (
                  <div>تم استبعاد {resolvedBatch.excludedOptOutCount} عميل رفض الرسائل الترويجية.</div>
                )}
                {resolvedBatch.excludedInvalidPhoneCount > 0 && (
                  <div>تم استبعاد {resolvedBatch.excludedInvalidPhoneCount} رقم غير صالح.</div>
                )}
                {resolvedBatch.excludedDuplicateCount > 0 && (
                  <div>تم منع التكرار لـ {resolvedBatch.excludedDuplicateCount} رقم مكرر.</div>
                )}
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard className="space-y-3">
            <h3 className="font-display text-base font-bold">شريحة الاتصال للإرسال</h3>
            {envStatus?.sims && envStatus.sims.length > 0 ? (
              <div className="space-y-2">
                {envStatus.sims.map((sim) => (
                  <label
                    key={sim.subscriptionId}
                    className="min-h-[54px] flex items-center justify-between gap-2 p-3.5 rounded-2xl border border-[#C7CBB8]/60 dark:border-[#243B2E] cursor-pointer text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="sim-slot"
                        checked={selectedSubId === sim.subscriptionId}
                        onChange={() => setSelectedSubId(sim.subscriptionId)}
                        className="h-4 w-4 accent-[#1E3A2E]"
                      />
                      <div>
                        <div className="font-semibold">
                          الشريحة {sim.slotIndex + 1} — {sim.carrierName || sim.displayName}
                        </div>
                        {sim.number && <div className="text-xs tabular-nums text-[#6B7F67]">{sim.number}</div>}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#6B7F67] leading-relaxed">
                {envStatus?.isNativeAndroid
                  ? 'لم يتم اكتشاف شرائح اتصال فعالة بعد أو لم يُمنح إذن قراءة الشريحة.'
                  : 'في متصفح الويب يتم تجهيز قائمة الرسائل لفتحها وإرسالها عبر تطبيق الرسائل بالهاتف، بينما يعمل الإرسال المباشر تلقائياً عند التثبيت كتطبيق هاتف.'}
              </p>
            )}
          </SurfaceCard>

          <div className="flex flex-col-reverse sm:flex-row gap-2.5">
            <PrimaryButton type="button" variant="secondary" onClick={() => setStep(2)} className="w-full sm:w-auto">
              السابق
            </PrimaryButton>
            <PrimaryButton
              type="button"
              onClick={() => {
                setConfirmedReviewCheck(false);
                setStep(4);
                setReviewOpen(true);
              }}
              className="w-full sm:flex-1"
            >
              <Send className="h-4 w-4" />
              الانتقال للتأكيد والإرسال ({resolvedBatch.validRecipients.length})
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Step 4: Final Summary + Review Sheet Trigger */}
      {step === 4 && (
        <SurfaceCard className="space-y-4 text-center py-6">
          <div className="h-14 w-14 mx-auto rounded-2xl bg-[#EFF3EB] dark:bg-[#1E3A2E] text-[#1E3A2E] dark:text-[#8FB98D] flex items-center justify-center">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold">جاهز للمراجعة النهائية والإرسال</h2>
            <p className="text-sm text-[#6B7F67] dark:text-[#9AA896]">
              عدد المستلمين: {resolvedBatch.validRecipients.length} · إجمالي الأجزاء: {totalEstimatedParts}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row justify-center gap-2.5 pt-2">
            <PrimaryButton
              type="button"
              onClick={() => {
                setConfirmedReviewCheck(false);
                setReviewOpen(true);
              }}
            >
              <Send className="h-4 w-4" />
              فتح شاشة التأكيد والإرسال
            </PrimaryButton>
            <PrimaryButton type="button" variant="secondary" onClick={() => setStep(3)}>
              العودة للمعاينة
            </PrimaryButton>
          </div>
        </SurfaceCard>
      )}

      {/* Pre-send Mandatory Confirmation BottomSheet */}
      <BottomSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="مراجعة وتأكيد الإرسال"
        subtitle={`${resolvedBatch.validRecipients.length} مستلم · ${totalEstimatedParts} جزء إجمالي`}
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <PrimaryButton
              type="button"
              variant="secondary"
              disabled={dispatching || !confirmedReviewCheck}
              onClick={() => executeBatch(false)}
              className="w-full sm:w-auto"
            >
              حفظ في قائمة الانتظار
            </PrimaryButton>
            <PrimaryButton
              type="button"
              disabled={dispatching || !confirmedReviewCheck}
              onClick={() => executeBatch(true)}
              className="w-full sm:flex-1"
            >
              <Send className="h-4 w-4" />
              {envStatus?.isNativeAndroid ? 'تأكيد وإرسال الآن' : 'تأكيد وتجهيز الإرسال'}
            </PrimaryButton>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2.5 text-center">
          <div className="p-3 rounded-2xl bg-[#F4F5F0] dark:bg-[#0B1610]">
            <div className="text-xs text-[#6B7F67]">عدد المستلمين</div>
            <div className="text-lg font-bold tabular-nums">{resolvedBatch.validRecipients.length}</div>
          </div>
          <div className="p-3 rounded-2xl bg-[#F4F5F0] dark:bg-[#0B1610]">
            <div className="text-xs text-[#6B7F67]">الترميز والأجزاء</div>
            <div className="text-sm font-bold tabular-nums mt-0.5">
              {formatEncodingArabic(sampleSegments.encoding)} · {Math.max(1, sampleSegments.partsCount)} جزء
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-[#6B7F67] mb-1.5">
            قائمة الأسماء والأرقام المؤكدة:
          </div>
          <div className="max-h-36 overflow-y-auto divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E] rounded-2xl border border-[#C7CBB8]/60 dark:border-[#243B2E] px-3">
            {resolvedBatch.validRecipients.map((r) => (
              <div key={r.id} className="py-2 flex items-center justify-between text-xs">
                <span className="font-medium truncate">{r.name}</span>
                <span className="tabular-nums text-[#3E5A3F] dark:text-[#8FB98D] shrink-0">{r.phone}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#F4F5F0] dark:bg-[#0B1610] text-xs space-y-1">
          <div className="font-semibold text-[#6B7F67]">نموذج النص المرسل:</div>
          <p className="whitespace-pre-line leading-relaxed">{renderedSample}</p>
        </div>

        <label className="flex items-start gap-2.5 p-3.5 rounded-2xl border border-[#C7CBB8]/70 dark:border-[#243B2E] cursor-pointer text-xs">
          <input
            type="checkbox"
            checked={confirmedReviewCheck}
            onChange={(e) => setConfirmedReviewCheck(e.target.checked)}
            className="h-5 w-5 mt-0.5 accent-[#1E3A2E] shrink-0"
          />
          <span className="leading-relaxed">
            راجعتُ الأسماء والأرقام ونص الرسالة وأؤكد الموافقة على الإرسال من رصيد الشريحة.
          </span>
        </label>
      </BottomSheet>
    </div>
  );
};

export const TemplatesView: React.FC = () => {
  const { org, templates, navigate, refreshData, showToast } = useQatshi();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('debt');
  const [body, setBody] = useState('');

  if (!org) return null;

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCategory('debt');
    setBody('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !body.trim()) return;
    await saveMessageTemplate(org.id, {
      id: editingId ?? undefined,
      name,
      category,
      body,
      isDefault: false,
    });
    resetForm();
    await refreshData();
    showToast(editingId ? 'تم تحديث القالب' : 'تم حفظ القالب الجديد');
  };

  const startEdit = (t: MessageTemplate) => {
    setEditingId(t.id);
    setName(t.name);
    setCategory(t.category);
    setBody(t.body);
  };

  const handleDelete = async (t: MessageTemplate) => {
    await deleteMessageTemplate(t.id);
    if (editingId === t.id) resetForm();
    await refreshData();
    showToast(`تم حذف القالب: ${t.name}`, 'info');
  };

  const formSeg = calculateSmsSegments(body);

  return (
    <div className="space-y-4">
      <PageHeader
        title="قوالب الرسائل"
        subtitle="إضافة وتعديل القوالب الجاهزة للتذكير والعروض"
        backAction={() => navigate('messaging')}
        action={<SmsTopNav active="templates" />}
      />

      <SurfaceCard>
        <form onSubmit={handleSave} className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold">
              {editingId ? 'تعديل القالب الحالي' : 'إضافة قالب جديد'}
            </h2>
            <span className="text-xs text-[#6B7F67] tabular-nums">
              {formatEncodingArabic(formSeg.encoding)} · {formSeg.charCount} حرف · {Math.max(1, formSeg.partsCount)} جزء
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اسم القالب (مثال: تذكير سداد، تأكيد دفعة...)"
              className="min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              className="min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            >
              <option value="debt">تذكير دين / سداد</option>
              <option value="offer">عرض يومي</option>
              <option value="welcome">ترحيب</option>
              <option value="vip">عملاء مميزون</option>
              <option value="occasion">مناسبات</option>
              <option value="general">عام</option>
            </select>
          </div>

          <textarea
            rows={4}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="نص القالب مع استخدام الحقول الذكية..."
            className="w-full p-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
          />

          <div className="flex flex-wrap gap-1.5">
            {VARIABLE_TOKENS.map((item) => (
              <button
                key={item.token}
                type="button"
                onClick={() => setBody((prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${item.token}`)}
                className="min-h-[36px] px-2.5 py-1 rounded-xl bg-[#EFF1EA] dark:bg-[#1E3A2E] text-xs font-medium"
              >
                + {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="submit">
              {editingId ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingId ? 'تحديث القالب' : 'حفظ القالب'}
            </PrimaryButton>
            {editingId && (
              <PrimaryButton type="button" variant="secondary" onClick={resetForm}>
                إلغاء التعديل
              </PrimaryButton>
            )}
          </div>
        </form>
      </SurfaceCard>

      {templates.length === 0 ? (
        <EmptyState
          title="لا توجد قوالب بعد"
          description="أضف أول قالب رسالة نصية من النموذج أعلاه لاستخدامه في تذكير الديون وتأكيد الدفعات."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {templates.map((t) => {
            const seg = calculateSmsSegments(t.body);
            return (
              <SurfaceCard key={t.id} className="space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold">{t.name}</h3>
                    <span className="text-[11px] text-[#6B7F67] tabular-nums">
                      {formatEncodingArabic(seg.encoding)} · {Math.max(1, seg.partsCount)} جزء
                    </span>
                  </div>
                  <p className="text-xs text-[#3D4337] dark:text-[#C7CBB8] whitespace-pre-line leading-relaxed">
                    {t.body}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 pt-2 border-t border-[#C7CBB8]/40 dark:border-[#243B2E]">
                  <PrimaryButton
                    variant="secondary"
                    onClick={() => navigate('messaging', { initialTemplateId: t.id })}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    استخدام
                  </PrimaryButton>
                  <PrimaryButton variant="secondary" onClick={() => startEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                    تعديل
                  </PrimaryButton>
                  <PrimaryButton variant="danger" onClick={() => handleDelete(t)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    حذف
                  </PrimaryButton>
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const MessageLogView: React.FC = () => {
  const { org, messageLogs, messagingConfig, navigate, refreshData, showToast } = useQatshi();
  const [statusFilter, setStatusFilter] = useState<'all' | MessageStatus>('all');
  const [envStatus, setEnvStatus] = useState<NativeSmsEnvironmentStatus | null>(null);
  const [acknowledgedUnknownIds, setAcknowledgedUnknownIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    capacitorSmsBridge.getEnvironmentStatus().then((st) => {
      if (active) setEnvStatus(st);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!org || !messagingConfig) return null;

  const filtered = messageLogs.filter((m) =>
    statusFilter === 'all' ? true : m.status === statusFilter
  );

  const statusTabs: Array<{ id: 'all' | MessageStatus; label: string }> = [
    { id: 'all', label: 'الكل' },
    { id: 'pending', label: 'بالانتظار' },
    { id: 'sending', label: 'قيد الإرسال' },
    { id: 'sent_to_network', label: 'أُرسلت للشبكة' },
    { id: 'delivered', label: 'تم التسليم' },
    { id: 'failed', label: 'فشل' },
    { id: 'unknown', label: 'غير محققة' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="سجل الرسائل النصية"
        subtitle="متابعة حالة كل رسالة بدقة ومنع التكرار العشوائي"
        backAction={() => navigate('messaging')}
        action={<SmsTopNav active="message_log" />}
      />

      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[#EFF1EA] dark:bg-[#0B1610] overflow-x-auto">
        {statusTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`min-h-[42px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 ${
              statusFilter === tab.id
                ? 'bg-white dark:bg-[#1E3A2E] text-[#0F1F17] dark:text-white shadow-xs'
                : 'text-[#6B7F67]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="سجل الرسائل فارغ"
          description="جهّز رسالة نصية واختر المستلمين من مركز الرسائل لعرض حالة كل رسالة."
          actionLabel="إرسال رسالة جديدة"
          onAction={() => navigate('messaging')}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((log) => {
            const isUnknown = log.status === 'unknown';
            const unknownAck = Boolean(acknowledgedUnknownIds[log.id]);
            return (
              <SurfaceCard key={log.id} className="p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-bold text-sm">{log.customerName}</span>
                    <span className="text-xs text-[#6B7F67] tabular-nums">{log.phone}</span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-lg font-medium ${
                        log.status === 'delivered'
                          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : log.status === 'sent_to_network'
                          ? 'bg-[#EFF1EA] text-[#1E3A2E] dark:bg-[#1E3A2E] dark:text-[#8FB98D]'
                          : log.status === 'failed'
                          ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300'
                          : log.status === 'unknown'
                          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                          : 'bg-[#F4F5F0] text-[#3D4337] dark:bg-[#0B1610] dark:text-[#C7CBB8]'
                      }`}
                    >
                      {getSmsStatusLabel(log.status)}
                    </span>
                  </div>
                  <span className="text-xs text-[#6B7F67] tabular-nums">
                    {formatDateArabic(log.updatedAt, org.dateFormat, true)}
                  </span>
                </div>

                <p className="text-xs text-[#3D4337] dark:text-[#C7CBB8] whitespace-pre-line leading-relaxed">
                  {log.body}
                </p>

                <div className="flex flex-wrap gap-3 text-[11px] text-[#6B7F67]">
                  <span>
                    {formatEncodingArabic(log.encoding)} · {log.partsCount || 1} جزء
                    {typeof log.simSlot === 'number' ? ` · الشريحة ${log.simSlot + 1}` : ''}
                    {log.carrierName ? ` (${log.carrierName})` : ''}
                  </span>
                  {log.sentAt && <span>وقت الشبكة: {formatDateArabic(log.sentAt, org.dateFormat, true)}</span>}
                  {log.deliveredAt && <span>وقت التسليم: {formatDateArabic(log.deliveredAt, org.dateFormat, true)}</span>}
                </div>

                {log.errorReason && (
                  <p className={`text-xs ${log.status === 'unknown' ? 'text-amber-700 dark:text-amber-300' : 'text-red-600'}`}>
                    {log.errorReason}
                  </p>
                )}

                {isUnknown && (
                  <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-500/30 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      حالة غير محققة — تم إيقاف الإرسال التلقائي لتجنب تكرار الرسالة على العميل
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={unknownAck}
                        onChange={(e) =>
                          setAcknowledgedUnknownIds((prev) => ({
                            ...prev,
                            [log.id]: e.target.checked,
                          }))
                        }
                        className="h-4 w-4 accent-[#1E3A2E]"
                      />
                      راجعتُ تطبيق الرسائل بالهاتف وتأكدت أن الرسالة لم تُرسل
                    </label>
                  </div>
                )}

                {log.status !== 'delivered' && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {envStatus?.isNativeAndroid && (log.status === 'pending' || log.status === 'failed' || isUnknown) && (
                      <PrimaryButton
                        variant="primary"
                        disabled={isUnknown && !unknownAck}
                        onClick={async () => {
                          try {
                            const updated = await dispatchSmsViaDeviceSim({
                              logId: log.id,
                              subscriptionId: log.subscriptionId ?? messagingConfig.preferredSimSubscriptionId,
                              simSlot: log.simSlot ?? messagingConfig.preferredSimSlotIndex,
                              explicitResendUnknown: isUnknown && unknownAck,
                            });
                            await refreshData();
                            showToast(
                              `الحالة: ${getSmsStatusLabel(updated.status)}`,
                              updated.status === 'failed' ? 'error' : 'success'
                            );
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : 'تعذر الإرسال عبر الشريحة', 'error');
                          }
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        إرسال عبر الشريحة
                      </PrimaryButton>
                    )}

                    {(log.status === 'pending' || log.status === 'failed' || (isUnknown && unknownAck)) && (
                      <a
                        href={buildSmsDeviceIntentUri(log.phone, log.body)}
                        className="min-h-[44px] px-3.5 py-2 rounded-2xl bg-[#0F1F17] text-white text-xs font-medium inline-flex items-center gap-1.5"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        فتح في رسائل الهاتف
                      </a>
                    )}

                    {log.status !== 'sent_to_network' && (
                      <PrimaryButton
                        variant="secondary"
                        onClick={async () => {
                          await confirmManualSmsOutcome(log.id, 'sent_to_network');
                          await refreshData();
                          showToast('تم تسجيل الإرسال للشبكة');
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                        تأكيد الإرسال
                      </PrimaryButton>
                    )}

                    <PrimaryButton
                      variant="secondary"
                      onClick={async () => {
                        await confirmManualSmsOutcome(log.id, 'delivered');
                        await refreshData();
                        showToast('تم تأكيد تسليم الرسالة');
                      }}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      تم التسليم
                    </PrimaryButton>

                    {log.status !== 'failed' && (
                      <PrimaryButton
                        variant="secondary"
                        onClick={async () => {
                          await confirmManualSmsOutcome(log.id, 'failed', 'تم تسجيل الفشل يدوياً');
                          await refreshData();
                          showToast('تم تسجيل تعذر الإرسال', 'info');
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        تسجيل فشل
                      </PrimaryButton>
                    )}
                  </div>
                )}
              </SurfaceCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const SmsSettingsView: React.FC = () => {
  const { messagingConfig, navigate, refreshData, showToast } = useQatshi();
  const [envStatus, setEnvStatus] = useState<NativeSmsEnvironmentStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const loadEnv = async () => {
    setChecking(true);
    try {
      const st = await capacitorSmsBridge.getEnvironmentStatus();
      setEnvStatus(st);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    loadEnv();
  }, []);

  if (!messagingConfig) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="إعدادات شريحة الاتصال والرسائل"
        subtitle="اختيار شريحة الإرسال الافتراضية والتحقق من جاهزية الهاتف"
        backAction={() => navigate('messaging')}
        action={<SmsTopNav active="sms_settings" />}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiMetric
          label="وضع التشغيل الحالي"
          value={envStatus?.isNativeAndroid ? 'تطبيق الهاتف المثبّت' : 'وضع المتصفح'}
          meta={envStatus?.hasTelephonyHardware ? 'يدعم عتاد الشريحة' : 'إرسال عبر تطبيق الرسائل بالهاتف'}
          tone={envStatus?.isNativeAndroid ? 'positive' : 'warning'}
        />
        <KpiMetric
          label="صلاحية إرسال الرسائل"
          value={envStatus?.sendSmsGranted ? 'مفعّلة' : 'غير مفعّلة'}
          meta={envStatus?.readPhoneStateGranted ? 'قراءة الشريحة مفعّلة' : 'قراءة الشريحة غير متاحة'}
          tone={envStatus?.sendSmsGranted ? 'positive' : 'warning'}
        />
        <KpiMetric
          label="الشبكة الخلوية"
          value={
            envStatus?.airplaneModeOn
              ? 'وضع الطيران'
              : envStatus?.hasCellularSignal
              ? 'متصل بالشبكة'
              : 'غير متاح في المتصفح'
          }
          meta={`${envStatus?.sims.length ?? 0} شريحة مكتشفة`}
        />
      </div>

      <SurfaceCard className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-bold">فحص صلاحيات الهاتف</h2>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="button" variant="secondary" disabled={checking} onClick={loadEnv}>
              <RefreshCw className="h-4 w-4" />
              إعادة الفحص
            </PrimaryButton>
            {envStatus?.isNativeAndroid && (
              <PrimaryButton
                type="button"
                onClick={async () => {
                  const res = await capacitorSmsBridge.requestPermissions();
                  await loadEnv();
                  showToast(
                    res.sendSmsGranted ? 'تم منح صلاحيات الرسائل بنجاح' : 'لم تُمنح صلاحية إرسال الرسائل',
                    res.sendSmsGranted ? 'success' : 'error'
                  );
                }}
              >
                <ShieldCheck className="h-4 w-4" />
                طلب صلاحيات الرسائل
              </PrimaryButton>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-2xl bg-[#F4F5F0] dark:bg-[#0B1610] space-y-1.5">
            <div className="font-semibold">حالة الأذونات على الهاتف:</div>
            <div>إرسال الرسائل النصية: {envStatus?.sendSmsGranted ? 'مفعل' : 'غير مفعل'}</div>
            <div>التعرف على شريحة الاتصال: {envStatus?.readPhoneStateGranted ? 'مفعل' : 'غير مفعل'}</div>
            <div>وضع الطيران: {envStatus?.airplaneModeOn ? 'مفعل (يعيق الإرسال)' : 'متوقف'}</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-[#F4F5F0] dark:bg-[#0B1610] space-y-1.5">
            <div className="font-semibold">تأكيد الإرسال من المتصفح:</div>
            <label className="flex items-center gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={messagingConfig.requireManualConfirmInWebFallback}
                onChange={async (e) => {
                  await saveMessagingConfig({
                    ...messagingConfig,
                    requireManualConfirmInWebFallback: e.target.checked,
                  });
                  await refreshData();
                  showToast('تم حفظ تفضيل التحقق اليدوي');
                }}
                className="h-4 w-4 accent-[#1E3A2E]"
              />
              <span>إلزام التأكيد اليدوي للرسائل المرسلة عبر تطبيق الهاتف الافتراضي</span>
            </label>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="space-y-3">
        <h2 className="font-display text-base font-bold">الشرائح المكتشفة في الهاتف</h2>
        {envStatus?.sims && envStatus.sims.length > 0 ? (
          <div className="space-y-2">
            {envStatus.sims.map((sim) => (
              <label
                key={sim.subscriptionId}
                className="min-h-[56px] flex items-center justify-between p-3.5 rounded-2xl border border-[#C7CBB8]/60 dark:border-[#243B2E] cursor-pointer text-sm"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="default-sim"
                    checked={messagingConfig.preferredSimSubscriptionId === sim.subscriptionId}
                    onChange={async () => {
                      await saveMessagingConfig({
                        ...messagingConfig,
                        preferredSimSubscriptionId: sim.subscriptionId,
                        preferredSimSlotIndex: sim.slotIndex,
                      });
                      await refreshData();
                      showToast(`تم تعيين الشريحة ${sim.slotIndex + 1} كشريحة افتراضية`);
                    }}
                    className="h-4 w-4 accent-[#1E3A2E]"
                  />
                  <div>
                    <div className="font-semibold">
                      الشريحة {sim.slotIndex + 1} — {sim.carrierName || sim.displayName}
                    </div>
                    {sim.number && <div className="text-xs tabular-nums text-[#6B7F67]">{sim.number}</div>}
                  </div>
                </div>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#6B7F67] leading-relaxed">
            لا توجد شرائح مقروءة في وضع المتصفح الحالي. عند استخدام نسخة الهاتف المثبّتة يتم عرض الشريحة 1 والشريحة 2 تلقائياً هنا.
          </p>
        )}
      </SurfaceCard>

      <SurfaceCard className="space-y-1.5">
        <div className="flex items-center gap-2 font-display text-sm font-bold">
          <Smartphone className="h-4 w-4 text-[#1E3A2E] dark:text-[#8FB98D]" />
          ملاحظة الإرسال حسب جهازك
        </div>
        <p className="text-xs text-[#3D4337] dark:text-[#C7CBB8] leading-relaxed">
          في تطبيق الهاتف المثبّت يعمل الإرسال المباشر من شريحة الاتصال، بينما في متصفح الويب يتم فتح تطبيق الرسائل بالهاتف بنص جاهز مع توثيق النتيجة في السجل.
        </p>
      </SurfaceCard>
    </div>
  );
};

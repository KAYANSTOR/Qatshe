import React, { useEffect, useMemo, useState } from 'react';
import { Check, MessageSquare, Send, Users } from 'lucide-react';
import { useQatshi } from '../../context/QatshiContext';
import { formatMoney } from '../../domain/money';
import {
  calculateSmsSegments,
  isValidSmsPhone,
  resolveConfirmedSmsRecipients,
} from '../../domain/sms';
import { renderTemplateVariables } from '../../domain/templates';
import {
  dispatchSmsViaDeviceSim,
  prepareConfirmedSmsBatch,
  saveMessageTemplate,
} from '../../services/messagingService';
import { capacitorSmsBridge, type NativeSmsEnvironmentStatus } from '../../services/nativeSmsBridge';
import { BottomSheet, PrimaryButton } from '../ui/LuxuryUI';

type BulkAudienceMode = 'all' | 'debtors' | 'manual';

const QUICK_VARIABLES = [
  { token: '{customer_name}', label: 'اسم العميل' },
  { token: '{customer_balance}', label: 'الرصيد' },
  { token: '{shop_name}', label: 'اسم المحل' },
  { token: '{today_date}', label: 'تاريخ اليوم' },
  { token: '{shop_phone}', label: 'هاتف المحل' },
];

export const BulkMessagingSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  initialCustomerId?: string;
}> = ({ open, onClose, initialCustomerId }) => {
  const {
    org,
    activeUser,
    customers,
    templates,
    messagingConfig,
    navigate,
    refreshData,
    showToast,
  } = useQatshi();

  const [audienceMode, setAudienceMode] = useState<BulkAudienceMode>('debtors');
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [body, setBody] = useState(
    'مرحباً {customer_name}، رصيدكم لدى {shop_name} هو {customer_balance}. للاستفسار: {shop_phone}'
  );
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [sending, setSending] = useState(false);
  const [envStatus, setEnvStatus] = useState<NativeSmsEnvironmentStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    capacitorSmsBridge.getEnvironmentStatus().then(setEnvStatus).catch(() => {});
    if (initialCustomerId) {
      setAudienceMode('manual');
      setManualIds([initialCustomerId]);
    }
  }, [open, initialCustomerId]);

  const allValidCustomers = useMemo(
    () => customers.filter((c) => isValidSmsPhone(c.phone)),
    [customers]
  );
  const debtorValidCustomers = useMemo(
    () => allValidCustomers.filter((c) => c.cachedBalance > 0),
    [allValidCustomers]
  );

  const selectedCustomerIds = useMemo(() => {
    if (audienceMode === 'all') return allValidCustomers.map((c) => c.id);
    if (audienceMode === 'debtors') return debtorValidCustomers.map((c) => c.id);
    return manualIds;
  }, [audienceMode, allValidCustomers, debtorValidCustomers, manualIds]);

  const batchSummary = useMemo(() => {
    return resolveConfirmedSmsRecipients({
      customers,
      selectedCustomerIds,
      isMarketingMessage: false,
    });
  }, [customers, selectedCustomerIds]);

  if (!org || !activeUser) return null;

  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);
  const sampleCust = batchSummary.validRecipients[0]?.customer || debtorValidCustomers[0] || allValidCustomers[0];
  const sampleText = renderTemplateVariables(body, {
    customerName: sampleCust?.fullName || 'أحمد محمد',
    shopName: org.name,
    customerBalance: sampleCust?.cachedBalance ?? 0,
    remainingBalance: sampleCust?.cachedBalance ?? 0,
    lastPurchaseDate: sampleCust?.lastPurchaseAt,
    lastPaymentDate: sampleCust?.lastPaymentAt,
    shopPhone: org.phone,
    org,
  });

  const segments = calculateSmsSegments(sampleText);
  const recipientCount = batchSummary.validRecipients.length;
  const partsPerMsg = Math.max(1, segments.partsCount);
  const totalExpectedSms = recipientCount * partsPerMsg;

  const toggleManualId = (id: string) => {
    setManualIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSend = async () => {
    if (!body.trim()) {
      showToast('يرجى كتابة نص الرسالة أولاً', 'error');
      return;
    }
    if (recipientCount === 0) {
      showToast('لا يوجد مستلمون بأرقام صالحة في هذه الفئة', 'error');
      return;
    }

    setSending(true);
    try {
      let savedTplId: string | undefined;
      if (saveAsTemplate) {
        const createdTpl = await saveMessageTemplate(org.id, {
          name: templateName.trim() || `قالب سريع (${new Date().toLocaleDateString('ar-YE')})`,
          category: audienceMode === 'debtors' ? 'debt' : 'general',
          body: body.trim(),
          isDefault: false,
        });
        savedTplId = createdTpl.id;
      }

      const subId = messagingConfig?.preferredSimSubscriptionId ?? envStatus?.sims[0]?.subscriptionId;
      const { logs } = await prepareConfirmedSmsBatch({
        org,
        user: activeUser,
        title: audienceMode === 'debtors' ? 'رسالة جماعية لأصحاب الديون' : 'رسالة جماعية للعملاء',
        bodyTemplate: body.trim(),
        confirmedCustomerIds: selectedCustomerIds,
        isMarketingMessage: false,
        templateId: savedTplId,
        subscriptionId: subId,
      });

      let sentCount = 0;
      let fallbackCount = 0;
      for (const log of logs) {
        const res = await dispatchSmsViaDeviceSim({
          logId: log.id,
          subscriptionId: subId,
        });
        if (res.status === 'sent_to_network' || res.status === 'delivered') sentCount += 1;
        else if (res.dispatchMethod === 'device_intent_fallback') fallbackCount += 1;
      }

      await refreshData();
      onClose();
      if (fallbackCount > 0) {
        showToast(`تم تجهيز ${logs.length} رسالة في السجل للإرسال عبر تطبيق الرسائل`, 'info');
      } else {
        showToast(`تم إرسال ${sentCount} رسالة بنجاح`);
      }
      navigate('message_log');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر إرسال الرسائل الجماعية', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="إرسال رسالة جماعية"
      subtitle="إرسال عبر شريحة الهاتف بأسماء وأرصدة العملاء"
      headerIcon={<MessageSquare className="h-5 w-5" />}
      footer={
        <div className="flex items-center gap-2.5">
          <PrimaryButton
            type="button"
            disabled={sending || recipientCount === 0 || !body.trim()}
            onClick={handleSend}
            className="flex-1 min-h-[48px]"
          >
            <Send className="h-4 w-4" />
            {sending ? 'جاري الإرسال...' : `إرسال (${recipientCount})`}
          </PrimaryButton>
          <PrimaryButton type="button" variant="secondary" onClick={onClose} className="min-w-[96px]">
            إلغاء
          </PrimaryButton>
        </div>
      }
    >
      {/* 1. Target Audience Selector */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#16281E] dark:text-[#EEF2EC]">
            1. الفئة المستهدفة
          </span>
          <span className="text-[11px] font-semibold text-[#5B7062] dark:text-[#86C89B] tabular-nums">
            المؤهلون: {recipientCount}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'all' as BulkAudienceMode, label: `الكل (${allValidCustomers.length})` },
            { id: 'debtors' as BulkAudienceMode, label: `أصحاب الديون (${debtorValidCustomers.length})` },
            { id: 'manual' as BulkAudienceMode, label: `تحديد يدوي (${manualIds.length})` },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setAudienceMode(opt.id)}
              className={`min-h-[42px] px-2 py-1.5 rounded-[14px] text-xs font-bold border transition-colors whitespace-nowrap ${
                audienceMode === opt.id
                  ? 'bg-[#1E4230] text-white border-[#1E4230] dark:bg-[#2E6046] dark:border-[#2E6046]'
                  : 'bg-[#FAF8F4] dark:bg-[#0D1A13] border-[#E4DFD4] dark:border-[#22382B] text-[#4C5850] dark:text-[#C5D8CA]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {audienceMode === 'manual' && (
          <div className="max-h-40 overflow-y-auto rounded-[16px] border border-[#E4DFD4] dark:border-[#22382B] divide-y divide-[#EFEBE2] dark:divide-[#1F3327]">
            {allValidCustomers.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#657369]">
                لا يوجد عملاء بأرقام هواتف صالحة
              </div>
            ) : (
              allValidCustomers.map((c) => {
                const selected = manualIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleManualId(c.id)}
                    className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-right hover:bg-[#FAF8F4] dark:hover:bg-[#193325]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`h-5 w-5 rounded-md flex items-center justify-center border shrink-0 ${
                          selected
                            ? 'bg-[#1E4230] border-[#1E4230] text-white'
                            : 'border-[#C7C2B6] dark:border-[#355442]'
                        }`}
                      >
                        {selected && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="text-xs font-semibold truncate">{c.fullName}</span>
                    </div>
                    <span className="text-[11px] font-bold tabular-nums text-[#657369] shrink-0">
                      {fmt(c.cachedBalance)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 2. Message Text Editor */}
      <div className="space-y-2.5 pt-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="bulk-sms-body" className="text-xs font-bold text-[#16281E] dark:text-[#EEF2EC]">
            2. نص الرسالة
          </label>
          {templates.length > 0 && (
            <select
              aria-label="اختيار قالب جاهز"
              onChange={(e) => {
                const found = templates.find((t) => t.id === e.target.value);
                if (found) setBody(found.body);
              }}
              defaultValue=""
              className="max-w-[165px] min-h-[34px] px-2 rounded-xl border border-[#E4DFD4] dark:border-[#22382B] bg-[#FAF8F4] dark:bg-[#0D1A13] text-[11px] font-medium"
            >
              <option value="">إدراج قالب جاهز...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <textarea
          id="bulk-sms-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="اكتب نص الرسالة هنا..."
          className="w-full p-3 rounded-[16px] border border-[#DFDAD0] dark:border-[#243B2E] bg-[#FAF8F4] dark:bg-[#0D1A13] text-sm leading-relaxed focus:outline-2 focus:outline-[#2E6046]"
        />

        <div className="flex flex-wrap gap-1.5">
          {QUICK_VARIABLES.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() =>
                setBody((prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${v.token}`)
              }
              className="min-h-[32px] px-2.5 py-1 rounded-xl bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#86C89B] text-[11px] font-semibold hover:bg-[#DCE7DE] active:scale-[0.97]"
            >
              + {v.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-[#4C5850] dark:text-[#C5D8CA] cursor-pointer">
          <input
            type="checkbox"
            checked={saveAsTemplate}
            onChange={(e) => setSaveAsTemplate(e.target.checked)}
            className="h-4 w-4 rounded accent-[#1E4230]"
          />
          <span>حفظ النص كقالب جاهز عند الإرسال</span>
        </label>

        {saveAsTemplate && (
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="اسم القالب الجديد (اختياري)..."
            className="w-full min-h-[40px] px-3 rounded-xl border border-[#DFDAD0] dark:border-[#243B2E] bg-[#FAF8F4] dark:bg-[#0D1A13] text-xs"
          />
        )}
      </div>

      {/* 3. Summary & Live Preview Card */}
      <div className="rounded-[18px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E4DFD4] dark:border-[#22382B] p-3.5 space-y-3">
        <div className="flex items-center justify-between text-xs font-bold text-[#16281E] dark:text-[#EEF2EC]">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-4 w-4 text-[#2E6046] dark:text-[#86C89B]" />
            3. ملخص الإرسال والمعاينة الحية
          </span>
          <span className="text-[11px] text-[#657369] dark:text-[#98A89C] tabular-nums">
            {segments.charCount} حرف
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white dark:bg-[#12231A] p-2 border border-[#ECE7DC] dark:border-[#1E3326]">
            <div className="text-[10px] text-[#657369]">المستهدفون</div>
            <div className="text-sm font-extrabold tabular-nums text-[#16281E] dark:text-[#EEF2EC]">
              {recipientCount}
            </div>
          </div>
          <div className="rounded-xl bg-white dark:bg-[#12231A] p-2 border border-[#ECE7DC] dark:border-[#1E3326]">
            <div className="text-[10px] text-[#657369]">أجزاء الرسالة</div>
            <div className="text-sm font-extrabold tabular-nums text-[#9E6A14] dark:text-[#EBB354]">
              {partsPerMsg}
            </div>
          </div>
          <div className="rounded-xl bg-white dark:bg-[#12231A] p-2 border border-[#ECE7DC] dark:border-[#1E3326]">
            <div className="text-[10px] text-[#657369]">إجمالي الرسائل</div>
            <div className="text-sm font-extrabold tabular-nums text-[#1E4230] dark:text-[#86C89B]">
              {totalExpectedSms}
            </div>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white dark:bg-[#12231A] border border-[#ECE7DC] dark:border-[#1E3326] space-y-1">
          <div className="text-[11px] font-semibold text-[#657369] dark:text-[#98A89C]">
            معاينة الرسالة ({sampleCust ? sampleCust.fullName : 'نموذج افتراضي'}):
          </div>
          <p className="text-xs leading-relaxed text-[#16281E] dark:text-[#EEF2EC] whitespace-pre-line">
            {sampleText}
          </p>
        </div>
      </div>
    </BottomSheet>
  );
};

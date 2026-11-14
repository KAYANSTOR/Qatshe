import React from 'react';
import { AlertTriangle, Bell, CheckCircle2, Cloud, MessageSquare, Wallet } from 'lucide-react';
import { useQatshi } from '../../context/QatshiContext';
import { formatMoney, toLocalDateKey } from '../../domain/money';
import { BottomSheet, PrimaryButton } from '../ui/LuxuryUI';

export const NotificationsSheet: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const {
    org,
    customers,
    messageLogs,
    syncOps,
    cashboxSessions,
    navigate,
  } = useQatshi();

  if (!org) return null;

  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);
  const todayKey = toLocalDateKey();
  const todayCashbox = cashboxSessions.find((s) => s.date === todayKey);

  const debtorsOverLimit = customers.filter(
    (c) => c.creditLimit > 0 && c.cachedBalance > c.creditLimit
  );
  const pendingSms = messageLogs.filter(
    (m) => m.status === 'pending' || m.status === 'sending' || m.status === 'failed'
  );
  const pendingSync = syncOps.filter((s) => s.status === 'pending' || s.status === 'conflict');

  const items: Array<{
    id: string;
    title: string;
    desc: string;
    tone: 'warning' | 'info' | 'danger';
    icon: React.ReactNode;
    onClick: () => void;
  }> = [];

  if (debtorsOverLimit.length > 0) {
    items.push({
      id: 'over-limit',
      title: `${debtorsOverLimit.length} عميل تجاوز الحد الائتماني`,
      desc: `أعلاها: ${debtorsOverLimit[0].fullName} (${fmt(debtorsOverLimit[0].cachedBalance)})`,
      tone: 'danger',
      icon: <AlertTriangle className="h-4 w-4" />,
      onClick: () => {
        onClose();
        navigate('debts');
      },
    });
  }

  if (pendingSms.length > 0) {
    items.push({
      id: 'pending-sms',
      title: `${pendingSms.length} رسالة بحاجة للمتابعة أو الإرسال`,
      desc: 'راجع سجل الرسائل لتأكيد الإرسال عبر الشريحة',
      tone: 'warning',
      icon: <MessageSquare className="h-4 w-4" />,
      onClick: () => {
        onClose();
        navigate('message_log');
      },
    });
  }

  if (pendingSync.length > 0) {
    items.push({
      id: 'pending-sync',
      title: `${pendingSync.length} عملية بانتظار المزامنة السحابية`,
      desc: 'محفوظة بأمان على الجهاز حتى يتوفر اتصال',
      tone: 'info',
      icon: <Cloud className="h-4 w-4" />,
      onClick: () => {
        onClose();
        navigate('sync');
      },
    });
  }

  if (!todayCashbox || todayCashbox.status === 'open') {
    items.push({
      id: 'cashbox-open',
      title: 'صندوق اليوم مفتوح',
      desc: 'تأكد من مراجعة وإقفال الصندوق اليومي في نهاية الدوام',
      tone: 'info',
      icon: <Wallet className="h-4 w-4" />,
      onClick: () => {
        onClose();
        navigate('cashbox');
      },
    });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="مركز التنبيهات"
      subtitle="متابعة الديون والرسائل وحالة الصندوق"
      headerIcon={<Bell className="h-5 w-5" />}
      footer={
        <PrimaryButton variant="secondary" onClick={onClose} className="w-full">
          إغلاق
        </PrimaryButton>
      }
    >
      {items.length === 0 ? (
        <div className="py-6 text-center space-y-2">
          <div className="h-12 w-12 mx-auto rounded-2xl bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#86C89B] flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="font-display font-bold text-sm">لا توجد تنبيهات عاجلة</div>
          <p className="text-xs text-[#657369]">جميع العمليات والحسابات منظمة ومحدثة.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              className="w-full p-3.5 rounded-[18px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E4DFD4] dark:border-[#22382B] flex items-start gap-3 text-right hover:border-[#2E6046] active:scale-[0.99] transition-all"
            >
              <span
                className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                  item.tone === 'danger'
                    ? 'bg-red-100 text-[#B93829] dark:bg-red-950/50 dark:text-red-300'
                    : item.tone === 'warning'
                    ? 'bg-amber-100 text-[#9E6A14] dark:bg-amber-950/50 dark:text-amber-300'
                    : 'bg-[#E8EFE9] text-[#1E4230] dark:bg-[#193325] dark:text-[#86C89B]'
                }`}
              >
                {item.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-[#16281E] dark:text-[#EEF2EC]">
                  {item.title}
                </div>
                <div className="text-xs text-[#657369] dark:text-[#98A89C] mt-0.5 leading-relaxed">
                  {item.desc}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
};

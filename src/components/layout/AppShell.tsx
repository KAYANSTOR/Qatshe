import React, { useEffect, useState } from 'react';
import {
  Banknote,
  BarChart3,
  Home,
  MessageSquare,
  Plus,
  Receipt,
  Settings,
  ShoppingBag,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { useQatshi } from '../../context/QatshiContext';
import { hasPermission, type AppScreen, type Permission } from '../../domain/types';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { BulkMessagingSheet } from '../messaging/BulkMessagingSheet';
import { InstallPromptSheet } from '../pwa/InstallPromptSheet';
import { BottomSheet, EmptyState } from '../ui/LuxuryUI';
import { NotificationsSheet } from './NotificationsSheet';

const SCREEN_PERMISSION_MAP: Partial<Record<AppScreen, Permission>> = {
  new_sale: 'create_sale',
  collection: 'create_payment',
  products: 'manage_products',
  cashbox: 'manage_cashbox',
  expenses: 'manage_expenses',
  reports: 'view_reports',
  messaging: 'manage_messaging',
  templates: 'manage_messaging',
  message_log: 'manage_messaging',
  sms_settings: 'manage_messaging',
  users: 'manage_users',
  org_profile: 'manage_org',
  backup: 'manage_backup',
  maintenance: 'manage_backup',
  sync: 'manage_sync',
  subscription: 'manage_org',
};

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { screen, navigate, activeUser, toast } = useQatshi();
  const {
    isInstallable,
    isIOS,
    shouldShowSheet,
    install,
    dismissFirstVisitPrompt,
    closeInstallSheet,
    openInstallSheet,
  } = usePWAInstall();

  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [bulkSheetOpen, setBulkSheetOpen] = useState(false);
  const [bulkCustomerId, setBulkCustomerId] = useState<string | undefined>(undefined);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    const onInstall = () => openInstallSheet();
    const onBulk = (ev: Event) => {
      const detail = (ev as CustomEvent<{ customerId?: string }>).detail;
      setBulkCustomerId(detail?.customerId);
      setQuickActionsOpen(false);
      setBulkSheetOpen(true);
    };
    const onNotif = () => setNotificationsOpen(true);

    window.addEventListener('qatshi:open-install-sheet', onInstall);
    window.addEventListener('qatshi:open-bulk-sms', onBulk);
    window.addEventListener('qatshi:open-notifications', onNotif);
    return () => {
      window.removeEventListener('qatshi:open-install-sheet', onInstall);
      window.removeEventListener('qatshi:open-bulk-sms', onBulk);
      window.removeEventListener('qatshi:open-notifications', onNotif);
    };
  }, [openInstallSheet]);

  const requiredPerm = SCREEN_PERMISSION_MAP[screen];
  const authorized = !requiredPerm || hasPermission(activeUser?.role, requiredPerm);

  const isAuthOrOnboarding = screen === 'splash' || screen === 'setup' || screen === 'login';

  const isHomeTab = screen === 'dashboard';
  const isAccountsTab =
    screen === 'customers' ||
    screen === 'customer_form' ||
    screen === 'customer_profile' ||
    screen === 'customer_statement' ||
    screen === 'debts' ||
    screen === 'collection' ||
    screen === 'receipt';
  const isReportsTab = screen === 'reports' || screen === 'cashbox' || screen === 'expenses';
  const isSalesTab = screen === 'sales' || screen === 'new_sale' || screen === 'sale_detail';

  const handleQuickNav = (target: AppScreen) => {
    setQuickActionsOpen(false);
    navigate(target);
  };

  const quickActions: Array<{
    id: string;
    title: string;
    desc: string;
    icon: React.ReactNode;
    tone: string;
    onClick: () => void;
    permission?: Permission;
  }> = [
    {
      id: 'qa-sale',
      title: 'بيع مباشر',
      desc: 'إصدار فاتورة نقدي أو آجل',
      icon: <ShoppingBag className="h-5 w-5" />,
      tone: 'bg-[#E8EFE9] text-[#1E4230] dark:bg-[#193325] dark:text-[#86C89B]',
      onClick: () => handleQuickNav('new_sale'),
      permission: 'create_sale',
    },
    {
      id: 'qa-customer',
      title: 'إضافة عميل',
      desc: 'فتح حساب عميل جديد فوراً',
      icon: <UserPlus className="h-5 w-5" />,
      tone: 'bg-[#F5EFE3] text-[#8E621C] dark:bg-[#2F2513] dark:text-[#EBB354]',
      onClick: () => handleQuickNav('customer_form'),
    },
    {
      id: 'qa-payment',
      title: 'سند قبض / سداد',
      desc: 'تحصيل دفعة وتحديث الرصيد',
      icon: <Banknote className="h-5 w-5" />,
      tone: 'bg-[#E8EFE9] text-[#1E5638] dark:bg-[#193325] dark:text-[#86C89B]',
      onClick: () => handleQuickNav('collection'),
      permission: 'create_payment',
    },
    {
      id: 'qa-bulk-sms',
      title: 'رسالة جماعية',
      desc: 'تذكير أو عرض عبر شريحة الهاتف',
      icon: <MessageSquare className="h-5 w-5" />,
      tone: 'bg-[#EAF0F6] text-[#244E78] dark:bg-[#16293C] dark:text-[#89BCEE]',
      onClick: () => {
        setQuickActionsOpen(false);
        setBulkCustomerId(undefined);
        setBulkSheetOpen(true);
      },
      permission: 'manage_messaging',
    },
    {
      id: 'qa-today',
      title: 'ملخص اليوم',
      desc: 'مراجعة الصندوق والمبيعات',
      icon: <Wallet className="h-5 w-5" />,
      tone: 'bg-[#F1ECE6] text-[#5E472D] dark:bg-[#292118] dark:text-[#D5B994]',
      onClick: () => handleQuickNav('cashbox'),
      permission: 'manage_cashbox',
    },
    {
      id: 'qa-settings',
      title: 'الإعدادات',
      desc: 'إدارة النظام والنسخ الاحتياطي',
      icon: <Settings className="h-5 w-5" />,
      tone: 'bg-[#EFECE4] text-[#3F4A42] dark:bg-[#1E2E24] dark:text-[#C5D8CA]',
      onClick: () => handleQuickNav('settings'),
    },
  ];

  const visibleQuickActions = quickActions.filter(
    (item) => !item.permission || hasPermission(activeUser?.role, item.permission)
  );

  return (
    <div className="min-h-screen bg-[#EAE6DC] dark:bg-[#060D09] flex justify-center">
      {/* Centered 480px Native Mobile App Container */}
      <div className="w-full max-w-[480px] min-h-screen bg-[#F7F4ED] dark:bg-[#0B1510] text-[#16281E] dark:text-[#EEF2EC] sm:shadow-[0_12px_48px_rgba(15,31,23,0.12)] sm:border-x border-[#DFDAD0] dark:border-[#1E3326] relative flex flex-col overflow-x-hidden">
        {/* Main Scrollable Viewport */}
        <main
          className={`flex-1 w-full animate-view-in ${
            isAuthOrOnboarding
              ? 'p-4 pt-safe pb-safe'
              : screen === 'dashboard'
              ? 'pb-28'
              : 'px-4 pt-3 pb-28 pt-safe'
          }`}
        >
          {isAuthOrOnboarding || authorized ? (
            children
          ) : (
            <EmptyState
              title="صلاحية غير متوفرة لهذا الحساب"
              description={`الحساب الحالي (${activeUser?.name}) لا يملك صلاحية الوصول إلى هذه الشاشة.`}
              actionLabel="العودة إلى الرئيسية"
              onAction={() => navigate('dashboard')}
            />
          )}
        </main>

        {/* Fixed Bottom Navigation Bar with Integrated Center Notch & Raised Circular FAB */}
        {!isAuthOrOnboarding && (
          <nav
            aria-label="شريط التنقل السفلي"
            className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-40 pb-safe no-print pointer-events-none"
          >
            <div className="relative mx-auto pointer-events-auto">
              {/* Integrated SVG Curved Notch Background */}
              <div className="relative h-[68px] w-full flex items-stretch">
                <svg
                  viewBox="0 0 480 68"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full drop-shadow-[0_-4px_14px_rgba(22,40,30,0.08)]"
                >
                  <path
                    d="M0,18 Q0,0 18,0 L186,0 C200,0 206,8 214,21 C222,34 230,38 240,38 C250,38 258,34 266,21 C274,8 280,0 294,0 L462,0 Q480,0 480,18 L480,68 L0,68 Z"
                    className="fill-white dark:fill-[#12231A]"
                  />
                  <path
                    d="M0,18 Q0,0 18,0 L186,0 C200,0 206,8 214,21 C222,34 230,38 240,38 C250,38 258,34 266,21 C274,8 280,0 294,0 L462,0 Q480,0 480,18"
                    fill="none"
                    strokeWidth="1"
                    className="stroke-[#E3DED2] dark:stroke-[#22382B]"
                  />
                </svg>

                {/* Center Raised Circular FAB */}
                <button
                  type="button"
                  onClick={() => setQuickActionsOpen(true)}
                  aria-label="إجراءات سريعة"
                  className="absolute left-1/2 -translate-x-1/2 -top-7 h-[52px] w-[52px] rounded-full bg-[#1E4230] hover:bg-[#163022] dark:bg-[#2E6046] dark:hover:bg-[#3A7557] text-white shadow-[0_8px_20px_rgba(30,66,48,0.35)] border-4 border-[#F7F4ED] dark:border-[#0B1510] inline-flex items-center justify-center active:scale-[0.94] transition-transform z-10"
                >
                  <Plus className="h-6 w-6" />
                </button>

                {/* 4 Equal Tabs + Center Spacer */}
                <div className="relative z-[1] w-full grid grid-cols-5 items-center pt-1">
                  {/* Tab 1 (Rightmost in RTL): الرئيسية */}
                  <button
                    type="button"
                    onClick={() => navigate('dashboard')}
                    className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${
                      isHomeTab
                        ? 'text-[#1E4230] dark:text-[#86C89B]'
                        : 'text-[#6A776E] dark:text-[#8E9F93]'
                    }`}
                  >
                    <Home className="h-5 w-5" />
                    <span>الرئيسية</span>
                  </button>

                  {/* Tab 2: الحسابات */}
                  <button
                    type="button"
                    onClick={() => navigate('customers')}
                    className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${
                      isAccountsTab
                        ? 'text-[#1E4230] dark:text-[#86C89B]'
                        : 'text-[#6A776E] dark:text-[#8E9F93]'
                    }`}
                  >
                    <Users className="h-5 w-5" />
                    <span>الحسابات</span>
                  </button>

                  {/* Center Notch Label */}
                  <div className="h-full flex flex-col items-center justify-end pb-1 pointer-events-none">
                    <span className="text-[10px] font-bold text-[#6A776E] dark:text-[#8E9F93]">
                      إجراء
                    </span>
                  </div>

                  {/* Tab 3: التقارير */}
                  <button
                    type="button"
                    onClick={() => navigate('reports')}
                    className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${
                      isReportsTab
                        ? 'text-[#1E4230] dark:text-[#86C89B]'
                        : 'text-[#6A776E] dark:text-[#8E9F93]'
                    }`}
                  >
                    <BarChart3 className="h-5 w-5" />
                    <span>التقارير</span>
                  </button>

                  {/* Tab 4 (Leftmost in RTL): المبيعات */}
                  <button
                    type="button"
                    onClick={() => navigate('sales')}
                    className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${
                      isSalesTab
                        ? 'text-[#1E4230] dark:text-[#86C89B]'
                        : 'text-[#6A776E] dark:text-[#8E9F93]'
                    }`}
                  >
                    <Receipt className="h-5 w-5" />
                    <span>المبيعات</span>
                  </button>
                </div>
              </div>

              {/* Safe area base strip for edge-to-edge devices */}
              <div className="bg-white dark:bg-[#12231A] h-[var(--safe-bottom)]" />
            </div>
          </nav>
        )}

        {/* Quick Actions 2x3 Bottom Sheet */}
        <BottomSheet
          open={quickActionsOpen}
          onClose={() => setQuickActionsOpen(false)}
          title="إجراءات سريعة"
          subtitle="اختصارات العمليات اليومية في قاتشي"
        >
          <div className="grid grid-cols-2 gap-3 pb-1">
            {visibleQuickActions.map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={act.onClick}
                className="p-3.5 rounded-[18px] bg-[#FAF8F4] dark:bg-[#0D1A13] border border-[#E5E0D4] dark:border-[#22382B] hover:border-[#2E6046] active:scale-[0.98] transition-all text-right flex flex-col gap-2.5"
              >
                <span className={`h-10 w-10 rounded-[13px] flex items-center justify-center ${act.tone}`}>
                  {act.icon}
                </span>
                <div className="w-full text-right">
                  <div className="font-display font-bold text-sm text-[#16281E] dark:text-[#EEF2EC]">
                    {act.title}
                  </div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C] mt-0.5 line-clamp-1">
                    {act.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </BottomSheet>

        {/* Global Bulk Messaging Bottom Sheet */}
        <BulkMessagingSheet
          open={bulkSheetOpen}
          onClose={() => setBulkSheetOpen(false)}
          initialCustomerId={bulkCustomerId}
        />

        {/* Global Notifications Bottom Sheet */}
        <NotificationsSheet
          open={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
        />

        {/* First-Visit & On-Demand PWA Install Sheet */}
        <InstallPromptSheet
          open={shouldShowSheet}
          isInstallable={isInstallable}
          isIOS={isIOS}
          onInstall={install}
          onDismissForever={dismissFirstVisitPrompt}
          onCloseTemporary={closeInstallSheet}
        />

        {/* Top-Positioned Toast Bounded Inside 480px Shell */}
        {toast && (
          <div
            role="status"
            className={`fixed top-[calc(14px+var(--safe-top))] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[448px] z-[70] px-4 py-3 rounded-[16px] text-xs sm:text-sm font-semibold shadow-xl pointer-events-none text-center ${
              toast.type === 'error'
                ? 'bg-[#B93829] text-white'
                : toast.type === 'info'
                ? 'bg-[#4C5850] text-white'
                : 'bg-[#163022] text-white dark:bg-[#2E6046]'
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
};

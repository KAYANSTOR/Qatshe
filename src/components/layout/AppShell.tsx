import React, { useEffect, useState } from 'react';
import {
  Banknote,
  BarChart3,
  Building2,
  Cloud,
  Database,
  Download,
  FileSpreadsheet,
  HelpCircle,
  Home,
  Layers,
  Lock,
  Menu,
  MessageSquare,
  Moon,
  Package,
  Plus,
  Receipt,
  Settings,
  Shield,
  Smartphone,
  Sun,
  UserPlus,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useQatshi } from '../../context/QatshiContext';
import { hasPermission, type AppScreen, type Permission } from '../../domain/types';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { InstallPromptSheet } from '../pwa/InstallPromptSheet';
import { BottomSheet, BrandLogo, EmptyState, PrimaryButton } from '../ui/LuxuryUI';

interface NavItem {
  screen: AppScreen;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPermission?: Permission;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'العمليات اليومية',
    items: [
      { screen: 'dashboard', label: 'الرئيسية', icon: Home },
      { screen: 'new_sale', label: 'بيع جديد', icon: Plus, requiredPermission: 'create_sale' },
      { screen: 'sales', label: 'سجل المبيعات', icon: Receipt },
      { screen: 'collection', label: 'تسجيل سداد', icon: Banknote, requiredPermission: 'create_payment' },
      { screen: 'debts', label: 'الديون والتحصيل', icon: Layers },
    ],
  },
  {
    title: 'العملاء والكشوفات',
    items: [
      { screen: 'customers', label: 'العملاء', icon: Users },
      { screen: 'customer_statement', label: 'كشف حساب', icon: FileSpreadsheet },
      { screen: 'products', label: 'الأصناف والأسعار', icon: Package, requiredPermission: 'manage_products' },
    ],
  },
  {
    title: 'المالية والتقارير',
    items: [
      { screen: 'cashbox', label: 'الصندوق اليومي', icon: Wallet, requiredPermission: 'manage_cashbox' },
      { screen: 'expenses', label: 'المصروفات', icon: Banknote, requiredPermission: 'manage_expenses' },
      { screen: 'reports', label: 'التقارير', icon: BarChart3, requiredPermission: 'view_reports' },
    ],
  },
  {
    title: 'الرسائل النصية',
    items: [
      { screen: 'messaging', label: 'الرسائل النصية', icon: MessageSquare, requiredPermission: 'manage_messaging' },
      { screen: 'templates', label: 'قوالب الرسائل', icon: MessageSquare, requiredPermission: 'manage_messaging' },
      { screen: 'message_log', label: 'سجل الرسائل', icon: Receipt, requiredPermission: 'manage_messaging' },
      { screen: 'sms_settings', label: 'إعدادات الشريحة', icon: Smartphone, requiredPermission: 'manage_messaging' },
    ],
  },
  {
    title: 'الإدارة والنظام',
    items: [
      { screen: 'users', label: 'الموظفون', icon: Shield, requiredPermission: 'manage_users' },
      { screen: 'org_profile', label: 'ملف المؤسسة', icon: Building2, requiredPermission: 'manage_org' },
      { screen: 'backup', label: 'النسخ الاحتياطي', icon: Database, requiredPermission: 'manage_backup' },
      { screen: 'sync', label: 'المزامنة', icon: Cloud, requiredPermission: 'manage_sync' },
      { screen: 'maintenance', label: 'سلامة البيانات', icon: Settings, requiredPermission: 'manage_backup' },
      { screen: 'subscription', label: 'المؤسسات والباقة', icon: Building2, requiredPermission: 'manage_org' },
      { screen: 'settings', label: 'الإعدادات', icon: Settings },
      { screen: 'support', label: 'المساعدة', icon: HelpCircle },
    ],
  },
];

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
  const {
    screen,
    navigate,
    org,
    activeUser,
    syncOps,
    darkMode,
    toggleDarkMode,
    toast,
    setLocked,
  } = useQatshi();
  const isOnline = useOnlineStatus();
  const {
    isInstallable,
    isInstalled,
    isIOS,
    shouldShowSheet,
    install,
    dismissFirstVisitPrompt,
    openInstallSheet,
    closeInstallSheet,
  } = usePWAInstall();
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  useEffect(() => {
    const handler = () => openInstallSheet();
    window.addEventListener('qatshi:open-install-sheet', handler);
    return () => window.removeEventListener('qatshi:open-install-sheet', handler);
  }, [openInstallSheet]);

  const pendingSyncCount = syncOps.filter((s) => s.status === 'pending').length;
  const requiredPerm = SCREEN_PERMISSION_MAP[screen];
  const authorized = !requiredPerm || hasPermission(activeUser?.role, requiredPerm);

  const handleNav = (target: AppScreen) => {
    setMoreSheetOpen(false);
    navigate(target);
  };

  if (screen === 'splash' || screen === 'setup' || screen === 'login') {
    return (
      <div className="min-h-screen bg-[#F4F5F0] dark:bg-[#0B1610] text-[#0F1F17] dark:text-[#E8EAE0] pt-safe pb-safe">
        <main className="p-4 sm:p-6">{children}</main>
        {toast && (
          <div
            role="status"
            className={`fixed top-[calc(16px+var(--safe-top))] left-4 right-4 sm:right-auto sm:w-auto sm:min-w-[300px] z-[60] px-4 py-3 rounded-2xl text-sm font-medium shadow-xl ${
              toast.type === 'error'
                ? 'bg-red-700 text-white'
                : toast.type === 'info'
                ? 'bg-[#3D4337] text-white'
                : 'bg-[#0F1F17] text-white'
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    );
  }

  const isSalesTab = screen === 'sales' || screen === 'new_sale' || screen === 'sale_detail';
  const isCustomersTab =
    screen === 'customers' ||
    screen === 'customer_form' ||
    screen === 'customer_profile' ||
    screen === 'customer_statement';
  const isDebtsTab = screen === 'debts' || screen === 'collection' || screen === 'receipt';

  // Mobile FAB contextual primary action
  const showFab =
    screen === 'dashboard' || screen === 'sales' || screen === 'customers' || screen === 'debts';
  const fabConfig =
    screen === 'customers'
      ? {
          label: 'عميل جديد',
          icon: UserPlus,
          onClick: () => navigate('customer_form'),
        }
      : screen === 'debts'
      ? {
          label: 'تسجيل سداد',
          icon: Banknote,
          onClick: () => navigate('collection'),
        }
      : {
          label: 'بيع جديد',
          icon: Plus,
          onClick: () => navigate('new_sale'),
        };
  const FabIcon = fabConfig.icon;

  return (
    <div className="min-h-screen flex bg-[#F4F5F0] dark:bg-[#0B1610] text-[#0F1F17] dark:text-[#E8EAE0]">
      {/* Desktop Sidebar (RTL Right) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[264px] shrink-0 border-l border-[#C7CBB8]/65 dark:border-[#243B2E] bg-white dark:bg-[#0F1F17] sticky top-0 h-screen overflow-y-auto no-print">
        <div className="p-5 border-b border-[#C7CBB8]/50 dark:border-[#243B2E]">
          <BrandLogo size="md" />
        </div>

        <nav aria-label="القائمة الرئيسية" className="flex-1 p-3 space-y-5">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.requiredPermission || hasPermission(activeUser?.role, item.requiredPermission)
            );
            if (!visibleItems.length) return null;
            return (
              <div key={group.title} className="space-y-1">
                <div className="px-3 text-[11px] font-semibold text-[#6B7F67]">
                  {group.title}
                </div>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = screen === item.screen;
                  return (
                    <button
                      key={item.screen}
                      type="button"
                      onClick={() => handleNav(item.screen)}
                      className={`w-full min-h-[42px] px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2.5 transition-colors text-right ${
                        active
                          ? 'bg-[#0F1F17] text-white dark:bg-[#3E5A3F]'
                          : 'text-[#3D4337] dark:text-[#C7CBB8] hover:bg-[#EFF1EA] dark:hover:bg-[#1E3A2E]/60'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#C7CBB8]/50 dark:border-[#243B2E] space-y-2 text-xs">
          <div className="font-medium truncate">{org?.name}</div>
          <div className="text-[#6B7F67] truncate">{activeUser?.name}</div>
          <button
            type="button"
            onClick={() => {
              setLocked(true);
              navigate('login');
            }}
            className="w-full min-h-[40px] px-3 rounded-xl border border-[#C7CBB8] dark:border-[#2C4235] flex items-center justify-center gap-2 hover:bg-[#EFF1EA] dark:hover:bg-[#1E3A2E]"
          >
            <Lock className="h-3.5 w-3.5" />
            تبديل المستخدم / قفل
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Compact Android Top App Bar */}
        <header className="sticky top-0 z-30 pt-safe bg-white/95 dark:bg-[#0F1F17]/95 backdrop-blur-md border-b border-[#C7CBB8]/55 dark:border-[#243B2E] no-print">
          <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="lg:hidden">
                <BrandLogo size="sm" showWordmark={false} />
              </div>
              <div className="min-w-0">
                <div className="font-display text-sm sm:text-base font-bold text-[#0F1F17] dark:text-[#E8EAE0] truncate">
                  {org?.name || 'قاتشي'}
                </div>
                <div className="lg:hidden text-[11px] text-[#6B7F67] truncate">
                  {activeUser?.name}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => navigate('sync')}
                aria-label={isOnline ? 'حالة الاتصال: متصل' : 'وضع العمل دون إنترنت'}
                className="min-h-[44px] px-2.5 rounded-2xl text-xs font-medium inline-flex items-center gap-1.5 text-[#3D4337] dark:text-[#C7CBB8] hover:bg-[#EFF1EA] dark:hover:bg-[#1E3A2E] whitespace-nowrap"
              >
                {isOnline ? (
                  <Wifi className="h-4 w-4 text-[#3E5A3F] dark:text-[#8FB98D]" />
                ) : (
                  <WifiOff className="h-4 w-4 text-amber-600" />
                )}
                <span className="hidden sm:inline">
                  {isOnline ? 'متصل' : 'دون إنترنت'}
                  {pendingSyncCount > 0 ? ` · ${pendingSyncCount}` : ''}
                </span>
              </button>

              {!isInstalled && (
                <button
                  type="button"
                  onClick={openInstallSheet}
                  aria-label="تثبيت التطبيق"
                  className="min-h-[44px] px-2.5 rounded-2xl text-xs font-medium inline-flex items-center gap-1.5 bg-[#EFF1EA] dark:bg-[#1E3A2E] text-[#0F1F17] dark:text-[#E8EAE0] whitespace-nowrap"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">تثبيت التطبيق</span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleDarkMode}
                aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-2xl hover:bg-[#EFF1EA] dark:hover:bg-[#1E3A2E]"
              >
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              <div className="hidden lg:block">
                <PrimaryButton onClick={() => navigate('new_sale')} className="min-h-[40px] py-1.5">
                  <Plus className="h-4 w-4" />
                  بيع جديد
                </PrimaryButton>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-6 pb-28 lg:pb-8 max-w-6xl w-full mx-auto animate-view-in">
          {authorized ? (
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

        {/* Mobile Floating Action Button (FAB) */}
        {showFab && (
          <button
            type="button"
            onClick={fabConfig.onClick}
            className="lg:hidden fixed left-4 bottom-[calc(76px+var(--safe-bottom))] z-30 h-13 px-4 rounded-2xl bg-[#0F1F17] dark:bg-[#3E5A3F] text-white shadow-lg shadow-[#0F1F17]/25 inline-flex items-center gap-2 text-sm font-medium active:scale-[0.96] transition-transform no-print"
          >
            <FabIcon className="h-4 w-4" />
            <span>{fabConfig.label}</span>
          </button>
        )}

        {/* Mobile Bottom Tab Bar — Exact 5 Tabs */}
        <nav
          aria-label="شريط التنقل السفلي"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#0F1F17]/95 backdrop-blur-md border-t border-[#C7CBB8]/60 dark:border-[#243B2E] pb-safe no-print"
        >
          <div className="h-16 grid grid-cols-5 items-center">
            {[
              { id: 'dashboard' as AppScreen, label: 'الرئيسية', icon: Home, active: screen === 'dashboard' },
              { id: 'sales' as AppScreen, label: 'المبيعات', icon: Receipt, active: isSalesTab },
              { id: 'customers' as AppScreen, label: 'العملاء', icon: Users, active: isCustomersTab },
              { id: 'debts' as AppScreen, label: 'الديون', icon: Layers, active: isDebtsTab },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleNav(tab.id)}
                  className={`h-full flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                    tab.active
                      ? 'text-[#0F1F17] dark:text-white font-bold'
                      : 'text-[#6B7F67] dark:text-[#9AA896]'
                  }`}
                >
                  <span
                    className={`px-3 py-1 rounded-full transition-colors ${
                      tab.active ? 'bg-[#EFF1EA] dark:bg-[#1E3A2E]' : ''
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setMoreSheetOpen(true)}
              className={`h-full flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                moreSheetOpen
                  ? 'text-[#0F1F17] dark:text-white font-bold'
                  : 'text-[#6B7F67] dark:text-[#9AA896]'
              }`}
            >
              <span
                className={`px-3 py-1 rounded-full transition-colors ${
                  moreSheetOpen ? 'bg-[#EFF1EA] dark:bg-[#1E3A2E]' : ''
                }`}
              >
                <Menu className="h-5 w-5" />
              </span>
              <span>المزيد</span>
            </button>
          </div>
        </nav>
      </div>

      {/* Android Material 3 "More" Bottom Sheet Hub */}
      <BottomSheet
        open={moreSheetOpen}
        onClose={() => setMoreSheetOpen(false)}
        title="جميع خدمات قاتشي"
        subtitle={`${org?.name || ''} · ${activeUser?.name || ''}`}
      >
        <div className="space-y-5">
          {NAV_GROUPS.slice(1).map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.requiredPermission || hasPermission(activeUser?.role, item.requiredPermission)
            );
            if (!visibleItems.length) return null;
            return (
              <div key={group.title} className="space-y-2.5">
                <div className="text-xs font-semibold text-[#6B7F67] dark:text-[#9AA896]">
                  {group.title}
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const active = screen === item.screen;
                    return (
                      <button
                        key={item.screen}
                        type="button"
                        onClick={() => handleNav(item.screen)}
                        className={`min-h-[76px] p-2.5 rounded-2xl border flex flex-col items-center justify-center gap-1.5 text-center transition-colors active:scale-[0.97] ${
                          active
                            ? 'bg-[#0F1F17] text-white border-[#0F1F17] dark:bg-[#3E5A3F] dark:border-[#3E5A3F]'
                            : 'bg-[#F9FAF7] dark:bg-[#0B1610] border-[#C7CBB8]/55 dark:border-[#243B2E] text-[#0F1F17] dark:text-[#E8EAE0]'
                        }`}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className="text-xs font-medium leading-tight">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="pt-2 border-t border-[#C7CBB8]/45 dark:border-[#243B2E] grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {!isInstalled && (
              <PrimaryButton
                type="button"
                variant="secondary"
                onClick={() => {
                  setMoreSheetOpen(false);
                  openInstallSheet();
                }}
              >
                <Download className="h-4 w-4" />
                تثبيت التطبيق على الهاتف
              </PrimaryButton>
            )}
            <PrimaryButton
              type="button"
              variant="secondary"
              onClick={() => {
                setMoreSheetOpen(false);
                setLocked(true);
                navigate('login');
              }}
            >
              <Lock className="h-4 w-4" />
              تبديل المستخدم / قفل الشاشة
            </PrimaryButton>
          </div>
        </div>
      </BottomSheet>

      {/* First-Visit & On-Demand PWA Install Sheet */}
      <InstallPromptSheet
        open={shouldShowSheet}
        isInstallable={isInstallable}
        isIOS={isIOS}
        onInstall={install}
        onDismissForever={dismissFirstVisitPrompt}
        onCloseTemporary={closeInstallSheet}
      />

      {/* Toast Feedback */}
      {toast && (
        <div
          role="status"
          className={`fixed top-[calc(64px+var(--safe-top))] left-4 right-4 sm:right-auto sm:w-auto sm:min-w-[320px] z-[60] px-4 py-3 rounded-2xl text-sm font-medium shadow-xl ${
            toast.type === 'error'
              ? 'bg-red-700 text-white'
              : toast.type === 'info'
              ? 'bg-[#3D4337] text-white'
              : 'bg-[#0F1F17] text-white dark:bg-[#3E5A3F]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

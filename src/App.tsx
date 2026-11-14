import React from 'react';
import { QatshiProvider, useQatshi } from './context/QatshiContext';
import { AppShell } from './components/layout/AppShell';
import { BrandLogo } from './components/ui/LuxuryUI';
import { AccountAuthView } from './views/AccountAuthView';
import { getCurrentAuthUser, logoutAuth, type AuthUser } from './services/authService';
import { getMeta, setMeta } from './services/device';
import {
  CustomerFormView,
  CustomerProfileView,
  CustomerStatementView,
  CustomersListView,
} from './views/CustomersViews';
import { DashboardView } from './views/DashboardView';
import { CollectionView, DebtsView, ReceiptView } from './views/DebtsCollectionViews';
import { CashboxView, ExpensesView, ReportsView } from './views/FinanceReportsViews';
import {
  MessageLogView,
  MessagingCenterView,
  SmsSettingsView,
  TemplatesView,
} from './views/MessagingOffersViews';
import { PinLockView, SetupWizardView, SplashScreen } from './views/OnboardingViews';
import { DailySalesView, NewSaleView, SaleDetailView } from './views/SalesViews';
import { GoogleDriveBackupView } from './views/GoogleDriveBackupView';
import {
  BackupView,
  MaintenanceView,
  OrgProfileView,
  ProductsView,
  SettingsView,
  SubscriptionView,
  SupportView,
  SyncView,
  UsersView,
} from './views/SettingsSystemViews';

const ScreenRouter: React.FC = () => {
  const { loading, screen, isLocked } = useQatshi();

  if (loading || screen === 'splash') {
    return <SplashScreen />;
  }

  if (isLocked || screen === 'login') {
    return <PinLockView />;
  }

  switch (screen) {
    case 'setup':
      return <SetupWizardView />;
    case 'dashboard':
      return <DashboardView />;
    case 'customers':
      return <CustomersListView />;
    case 'customer_form':
      return <CustomerFormView />;
    case 'customer_profile':
      return <CustomerProfileView />;
    case 'customer_statement':
      return <CustomerStatementView />;
    case 'sales':
      return <DailySalesView />;
    case 'new_sale':
      return <NewSaleView />;
    case 'sale_detail':
      return <SaleDetailView />;
    case 'debts':
      return <DebtsView />;
    case 'collection':
      return <CollectionView />;
    case 'receipt':
      return <ReceiptView />;
    case 'cashbox':
      return <CashboxView />;
    case 'expenses':
      return <ExpensesView />;
    case 'reports':
      return <ReportsView />;
    case 'messaging':
      return <MessagingCenterView />;
    case 'templates':
      return <TemplatesView />;
    case 'message_log':
      return <MessageLogView />;
    case 'sms_settings':
      return <SmsSettingsView />;
    case 'products':
      return <ProductsView />;
    case 'users':
      return <UsersView />;
    case 'org_profile':
      return <OrgProfileView />;
    case 'settings':
      return <SettingsView />;
    case 'backup':
      return <BackupView />;
    case 'google_drive_backup':
      return <GoogleDriveBackupView />;
    case 'maintenance':
      return <MaintenanceView />;
    case 'sync':
      return <SyncView />;
    case 'subscription':
      return <SubscriptionView />;
    case 'support':
      return <SupportView />;
    default:
      return <DashboardView />;
  }
};

export default function App() {
  const [checking, setChecking] = React.useState(true);
  const [authUser, setAuthUser] = React.useState<AuthUser | null>(null);
  const [darkMode, setDarkMode] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    Promise.all([getCurrentAuthUser(), getMeta('themeMode')])
      .then(([user, theme]) => {
        if (!mounted) return;
        if (theme === 'dark' && typeof document !== 'undefined') {
          document.documentElement.classList.add('dark');
          setDarkMode(true);
        }
        setAuthUser(user);
        setChecking(false);
      })
      .catch(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const toggleAuthDarkMode = React.useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', next);
      }
      setMeta('themeMode', next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  }, []);

  const handleCloudLogout = React.useCallback(async () => {
    await logoutAuth().catch(() => {});
    setAuthUser(null);
  }, []);

  if (checking) {
    return (
      <div
        dir="rtl"
        className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#F7F5EE] dark:bg-[#0B1710] text-[#16281E] dark:text-[#EEF2EC] p-6"
      >
        <BrandLogo size="lg" showWordmark />
        <p className="text-xs font-medium text-[#657369] dark:text-[#98A89C]">
          جارٍ التحقق من الجلسة...
        </p>
      </div>
    );
  }

  if (!authUser) {
    return (
      <AccountAuthView
        onAuthenticated={(user) => setAuthUser(user)}
        darkMode={darkMode}
        onToggleDarkMode={toggleAuthDarkMode}
      />
    );
  }

  return (
    <QatshiProvider authUser={authUser} onCloudLogout={handleCloudLogout}>
      <AppShell>
        <ScreenRouter />
      </AppShell>
    </QatshiProvider>
  );
}

import React from 'react';
import { QatshiProvider, useQatshi } from './context/QatshiContext';
import { AppShell } from './components/layout/AppShell';
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
  return (
    <QatshiProvider>
      <AppShell>
        <ScreenRouter />
      </AppShell>
    </QatshiProvider>
  );
}

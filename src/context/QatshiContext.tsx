import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { db } from '../db/qatshiDb';
import type {
  AppScreen,
  AppUser,
  AuditLog,
  BackupRecord,
  Campaign,
  CashboxSession,
  Customer,
  Expense,
  LedgerEntry,
  MessageLog,
  MessageTemplate,
  MessagingConfig,
  Organization,
  Payment,
  Product,
  Sale,
  SyncOperation,
} from '../domain/types';
import { getMeta, requestAndCheckPersistentStorage, setMeta } from '../services/device';
import { subscribeSmsDeliveryUpdates } from '../services/nativeSmsBridge';
import { confirmManualSmsOutcome, getOrCreateMessagingConfig } from '../services/messagingService';
import { resolveInitialOrganizationId } from '../services/seedService';

export interface ScreenParams {
  customerId?: string;
  saleId?: string;
  paymentId?: string;
  receiptType?: 'sale' | 'payment';
  initialMessageCustomerId?: string;
  initialTemplateId?: string;
}

export interface OrgCounts {
  customers: number;
  sales: number;
  payments: number;
  ledgerEntries: number;
}

interface QatshiContextValue {
  loading: boolean;
  screen: AppScreen;
  screenParams: ScreenParams;
  navigate: (next: AppScreen, params?: ScreenParams) => void;
  org: Organization | null;
  allOrgs: Organization[];
  activeUser: AppUser | null;
  users: AppUser[];
  customers: Customer[];
  products: Product[];
  sales: Sale[];
  payments: Payment[];
  ledgerEntries: LedgerEntry[];
  expenses: Expense[];
  cashboxSessions: CashboxSession[];
  templates: MessageTemplate[];
  campaigns: Campaign[];
  messageLogs: MessageLog[];
  messagingConfig: MessagingConfig | null;
  syncOps: SyncOperation[];
  auditLogs: AuditLog[];
  backupRecords: BackupRecord[];
  orgCounts: OrgCounts;
  totalReceivables: number;
  debtorsCount: number;
  isLocked: boolean;
  setLocked: (val: boolean) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  toast: { type: 'success' | 'error' | 'info'; message: string } | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  refreshData: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  switchUser: (user: AppUser) => Promise<void>;
}

const QatshiContext = createContext<QatshiContextValue | null>(null);

const UI_HISTORY_LIMIT = 400;
const UI_CUSTOMER_LIMIT = 1000;

export const QatshiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<AppScreen>('splash');
  const [screenParams, setScreenParams] = useState<ScreenParams>({});
  const [org, setOrg] = useState<Organization | null>(null);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [activeUser, setActiveUser] = useState<AppUser | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cashboxSessions, setCashboxSessions] = useState<CashboxSession[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);
  const [messagingConfig, setMessagingConfig] = useState<MessagingConfig | null>(null);
  const [syncOps, setSyncOps] = useState<SyncOperation[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [backupRecords, setBackupRecords] = useState<BackupRecord[]>([]);
  const [orgCounts, setOrgCounts] = useState<OrgCounts>({
    customers: 0,
    sales: 0,
    payments: 0,
    ledgerEntries: 0,
  });
  const [totalReceivables, setTotalReceivables] = useState(0);
  const [debtorsCount, setDebtorsCount] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3800);
  }, []);

  const navigate = useCallback((next: AppScreen, params: ScreenParams = {}) => {
    setScreen(next);
    setScreenParams(params);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const loadOrgSnapshot = useCallback(async (targetOrgId: string) => {
    const [
      currentOrg,
      orgsList,
      orgUsers,
      orgCustomers,
      custCount,
      debtorsOnly,
      orgProducts,
      orgSales,
      salesCount,
      orgPayments,
      paymentsCount,
      orgLedger,
      ledgerCount,
      orgExpenses,
      orgCashbox,
      orgTemplates,
      orgCampaigns,
      orgMsgLogs,
      orgMsgConfig,
      orgSync,
      orgAudit,
      orgBackups,
      savedUserId,
    ] = await Promise.all([
      db.organizations.get(targetOrgId),
      db.organizations.toArray(),
      db.users.where('orgId').equals(targetOrgId).toArray(),
      db.customers
        .where('[orgId+updatedAt]')
        .between([targetOrgId, ''], [targetOrgId, '\uffff'])
        .reverse()
        .limit(UI_CUSTOMER_LIMIT)
        .toArray(),
      db.customers.where('orgId').equals(targetOrgId).count(),
      db.customers
        .where('[orgId+cachedBalance]')
        .between([targetOrgId, 0.0001], [targetOrgId, Number.MAX_SAFE_INTEGER])
        .toArray(),
      db.products.where('orgId').equals(targetOrgId).toArray(),
      db.sales
        .where('[orgId+createdAt]')
        .between([targetOrgId, ''], [targetOrgId, '\uffff'])
        .reverse()
        .limit(UI_HISTORY_LIMIT)
        .toArray(),
      db.sales.where('orgId').equals(targetOrgId).count(),
      db.payments
        .where('[orgId+createdAt]')
        .between([targetOrgId, ''], [targetOrgId, '\uffff'])
        .reverse()
        .limit(UI_HISTORY_LIMIT)
        .toArray(),
      db.payments.where('orgId').equals(targetOrgId).count(),
      db.ledgerEntries
        .where('[orgId+createdAt]')
        .between([targetOrgId, ''], [targetOrgId, '\uffff'])
        .reverse()
        .limit(UI_HISTORY_LIMIT)
        .toArray(),
      db.ledgerEntries.where('orgId').equals(targetOrgId).count(),
      db.expenses
        .where('[orgId+createdAt]')
        .between([targetOrgId, ''], [targetOrgId, '\uffff'])
        .reverse()
        .limit(UI_HISTORY_LIMIT)
        .toArray(),
      db.cashboxSessions.where('orgId').equals(targetOrgId).toArray(),
      db.messageTemplates.where('orgId').equals(targetOrgId).toArray(),
      db.campaigns.where('orgId').equals(targetOrgId).toArray(),
      db.messageLogs
        .where('[orgId+createdAt]')
        .between([targetOrgId, ''], [targetOrgId, '\uffff'])
        .reverse()
        .limit(UI_HISTORY_LIMIT)
        .toArray(),
      getOrCreateMessagingConfig(targetOrgId),
      db.syncOperations
        .where('[orgId+createdAt]')
        .between([targetOrgId, ''], [targetOrgId, '\uffff'])
        .reverse()
        .limit(UI_HISTORY_LIMIT)
        .toArray(),
      db.auditLogs
        .where('[orgId+createdAt]')
        .between([targetOrgId, ''], [targetOrgId, '\uffff'])
        .reverse()
        .limit(UI_HISTORY_LIMIT)
        .toArray(),
      db.backupRecords.where('orgId').equals(targetOrgId).toArray(),
      getMeta('activeUserId'),
    ]);

    const receivables = debtorsOnly.reduce((sum, c) => sum + Math.max(0, c.cachedBalance), 0);

    setOrg(currentOrg ?? null);
    setAllOrgs(orgsList);
    setUsers(orgUsers);
    setCustomers(orgCustomers);
    setProducts(orgProducts.filter((p) => !p.deletedAt));
    setSales(orgSales);
    setPayments(orgPayments);
    setLedgerEntries(orgLedger);
    setExpenses(orgExpenses);
    setCashboxSessions(orgCashbox.sort((a, b) => b.date.localeCompare(a.date)));
    setTemplates(orgTemplates);
    setCampaigns(orgCampaigns.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setMessageLogs(orgMsgLogs);
    setMessagingConfig(orgMsgConfig);
    setSyncOps(orgSync);
    setAuditLogs(orgAudit);
    setBackupRecords(orgBackups.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setOrgCounts({
      customers: custCount,
      sales: salesCount,
      payments: paymentsCount,
      ledgerEntries: ledgerCount,
    });
    setTotalReceivables(receivables);
    setDebtorsCount(debtorsOnly.length);

    const matchedUser =
      orgUsers.find((u) => u.id === savedUserId && u.active) ||
      orgUsers.find((u) => u.role === 'owner' && u.active) ||
      orgUsers[0] ||
      null;
    setActiveUser(matchedUser);
    if (matchedUser) {
      await setMeta('activeUserId', matchedUser.id);
    }
  }, []);

  const refreshData = useCallback(async () => {
    const activeOrgId = (await getMeta('activeOrgId')) || org?.id;
    if (activeOrgId) {
      await loadOrgSnapshot(activeOrgId);
    }
  }, [loadOrgSnapshot, org?.id]);

  const switchOrganization = useCallback(
    async (orgId: string) => {
      await setMeta('activeOrgId', orgId);
      await loadOrgSnapshot(orgId);
      setIsLocked(false);
      navigate('dashboard');
      showToast('تم التبديل إلى مساحة عمل المؤسسة بنجاح');
    },
    [loadOrgSnapshot, navigate, showToast]
  );

  const switchUser = useCallback(
    async (user: AppUser) => {
      setActiveUser(user);
      await setMeta('activeUserId', user.id);
      setIsLocked(false);
      showToast(`تم تسجيل الدخول بحساب: ${user.name}`);
    },
    [showToast]
  );

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', next);
      }
      setMeta('themeMode', next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const savedTheme = await getMeta('themeMode');
      if (savedTheme === 'dark' && typeof document !== 'undefined') {
        document.documentElement.classList.add('dark');
        if (active) setDarkMode(true);
      }

      const orgId = await resolveInitialOrganizationId();
      await requestAndCheckPersistentStorage();
      if (!active) return;

      if (!orgId) {
        setLoading(false);
        setScreen('setup');
        return;
      }

      await loadOrgSnapshot(orgId);
      setLoading(false);

      setTimeout(() => {
        if (active) {
          setScreen((curr) => (curr === 'splash' ? 'dashboard' : curr));
        }
      }, 350);
    })();
    return () => {
      active = false;
    };
  }, [loadOrgSnapshot]);

  useEffect(() => {
    if (!org || !org.autoLockMinutes || org.autoLockMinutes <= 0 || !activeUser?.hasPin || isLocked) {
      return;
    }
    let timer = setTimeout(() => setIsLocked(true), org.autoLockMinutes * 60 * 1000);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIsLocked(true), org.autoLockMinutes * 60 * 1000);
    };
    window.addEventListener('pointerdown', resetTimer);
    window.addEventListener('keydown', resetTimer);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, [org, activeUser, isLocked]);

  useEffect(() => {
    return subscribeSmsDeliveryUpdates((messageId) => {
      confirmManualSmsOutcome(messageId, 'delivered')
        .then(() => refreshData())
        .catch(() => {});
    });
  }, [refreshData]);

  return (
    <QatshiContext.Provider
      value={{
        loading,
        screen,
        screenParams,
        navigate,
        org,
        allOrgs,
        activeUser,
        users,
        customers,
        products,
        sales,
        payments,
        ledgerEntries,
        expenses,
        cashboxSessions,
        templates,
        campaigns,
        messageLogs,
        messagingConfig,
        syncOps,
        auditLogs,
        backupRecords,
        orgCounts,
        totalReceivables,
        debtorsCount,
        isLocked,
        setLocked: setIsLocked,
        darkMode,
        toggleDarkMode,
        toast,
        showToast,
        refreshData,
        switchOrganization,
        switchUser,
      }}
    >
      {children}
    </QatshiContext.Provider>
  );
};

export function useQatshi(): QatshiContextValue {
  const ctx = useContext(QatshiContext);
  if (!ctx) throw new Error('useQatshi must be used inside QatshiProvider');
  return ctx;
}

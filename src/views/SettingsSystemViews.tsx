import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  CheckCircle2,
  ChevronLeft,
  CloudUpload,
  CreditCard,
  Download,
  FileText,
  HardDriveDownload,
  HelpCircle,
  History,
  Lock,
  MessageSquare,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import { db } from '../db/qatshiDb';
import { useQatshi } from '../context/QatshiContext';
import {
  formatPlanArabic,
  formatRoleArabic,
  formatSubscriptionStatusArabic,
  formatSyncActionArabic,
  formatSyncEntityArabic,
  formatSyncStatusArabic,
  sanitizeCommercialText,
} from '../domain/formatters';
import { formatDateArabic, formatMoney } from '../domain/money';
import type { AppScreen, AppUser, CurrencyCode, Product, UserRole } from '../domain/types';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { verifyAndRepairLedgerIntegrity } from '../services/accountingService';
import {
  createOrganizationBackup,
  parseAndVerifyBackupFile,
  restoreBackupPayload,
} from '../services/backupService';
import {
  auditAndCleanProvenDemoData,
  auditDemoDataInDb,
  type DemoDataAuditReport,
} from '../services/dataCleanupService';
import {
  generateUuid,
  hashPin,
  requestAndCheckPersistentStorage,
  verifyPin,
  type StorageDiagnostics,
} from '../services/device';
import { saveMessagingConfig } from '../services/messagingService';
import { triggerBlobDownload } from '../services/pdfGenerator';
import {
  ensureOrgAuthSecret,
  queueEntitySyncOperation,
  resolveSyncConflict,
  runOrganizationSync,
} from '../services/syncService';
import { EmptyState, KpiMetric, PageHeader, PrimaryButton, SurfaceCard } from '../components/ui/LuxuryUI';
import shopCoverImg from '../assets/images/shop_cover_luxury_1794643393777.jpg';

const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id?: string;
}> = ({ checked, onChange, label, id }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
      checked
        ? 'bg-[#1E4230] border-[#1E4230] dark:bg-[#3A7D56] dark:border-[#3A7D56]'
        : 'bg-[#E5E0D3] border-[#D3CCB9] dark:bg-[#192D22] dark:border-[#2C4636]'
    }`}
  >
    <span
      className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-xs transition-all duration-200 ${
        checked ? 'left-[3px]' : 'right-[3px]'
      }`}
    />
  </button>
);

export const ProductsView: React.FC = () => {
  const { org, products, navigate, refreshData, showToast } = useQatshi();
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('درجة أولى');
  const [unitName, setUnitName] = useState('ربطة');
  const [unitPrice, setUnitPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');

  if (!org) return null;
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const prod: Product = {
      id: generateUuid(),
      orgId: org.id,
      name: name.trim(),
      grade: grade.trim(),
      unitName: unitName.trim() || 'ربطة',
      unitPrice: Number(unitPrice) || 0,
      costPrice: costPrice.trim() ? Number(costPrice) : undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
    };
    await db.products.put(prod);
    await queueEntitySyncOperation({
      orgId: org.id,
      entityType: 'product',
      entityId: prod.id,
      action: 'create',
      payload: prod,
    });
    setName('');
    setUnitPrice('');
    setCostPrice('');
    await refreshData();
    showToast('تم إضافة الصنف بنجاح');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="الأصناف والأسعار"
        subtitle="إضافة وتعديل أصناف القات ودرجاتها"
        icon={<Tag className="h-5 w-5" />}
        backAction={() => navigate('settings')}
      />

      <SurfaceCard>
        <form onSubmit={handleAdd} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label htmlFor="prod-name" className="block text-xs text-[#657369] mb-1.5">
                اسم الصنف *
              </label>
              <input
                id="prod-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: قات ولعة أصلي"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label htmlFor="prod-grade" className="block text-xs text-[#657369] mb-1.5">
                الدرجة
              </label>
              <input
                id="prod-grade"
                type="text"
                required
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label htmlFor="prod-unit" className="block text-xs text-[#657369] mb-1.5">
                وحدة القياس
              </label>
              <input
                id="prod-unit"
                type="text"
                required
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label htmlFor="prod-price" className="block text-xs text-[#657369] mb-1.5">
                سعر البيع *
              </label>
              <input
                id="prod-price"
                type="number"
                min="0"
                required
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm font-bold tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="prod-cost" className="block text-xs text-[#657369] mb-1.5">
                سعر التكلفة (اختياري)
              </label>
              <input
                id="prod-cost"
                type="number"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="لحساب صافي الربح"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
          </div>

          <PrimaryButton type="submit" className="w-full">
            <Plus className="h-4 w-4" />
            إضافة الصنف
          </PrimaryButton>
        </form>
      </SurfaceCard>

      {products.length === 0 ? (
        <EmptyState
          title="لا توجد أصناف مسجلة بعد"
          description="أضف أصناف القات ودرجاتها وأسعارها من النموذج أعلاه لبدء البيع."
        />
      ) : (
        <div className="space-y-2.5">
          {products.map((p) => (
            <SurfaceCard key={p.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">
                  {p.name} — {p.grade}
                </div>
                <div className="text-xs text-[#657369] mt-0.5 tabular-nums">
                  الوحدة: {p.unitName} · السعر: {fmt(p.unitPrice)}
                  {p.costPrice ? ` · التكلفة: ${fmt(p.costPrice)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <PrimaryButton
                  variant="secondary"
                  onClick={async () => {
                    const updated = { ...p, active: !p.active, updatedAt: new Date().toISOString() };
                    await db.products.put(updated);
                    await queueEntitySyncOperation({
                      orgId: org.id,
                      entityType: 'product',
                      entityId: p.id,
                      action: 'update',
                      payload: updated,
                    });
                    await refreshData();
                  }}
                >
                  {p.active ? 'إيقاف' : 'تفعيل'}
                </PrimaryButton>
                <button
                  type="button"
                  aria-label={`حذف ${p.name}`}
                  onClick={async () => {
                    const deleted = {
                      ...p,
                      deletedAt: new Date().toISOString(),
                      active: false,
                      updatedAt: new Date().toISOString(),
                    };
                    await db.products.put(deleted);
                    await queueEntitySyncOperation({
                      orgId: org.id,
                      entityType: 'product',
                      entityId: p.id,
                      action: 'update',
                      payload: deleted,
                    });
                    await refreshData();
                    showToast('تم إخفاء الصنف مع بقاء فواتيره السابقة سليمة');
                  }}
                  className="min-h-[42px] min-w-[42px] inline-flex items-center justify-center rounded-2xl text-[#B93829] hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
};

export const UsersView: React.FC = () => {
  const { org, users, auditLogs, navigate, switchUser, refreshData, showToast } = useQatshi();
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [pin, setPin] = useState('');
  const [pendingSwitchUser, setPendingSwitchUser] = useState<AppUser | null>(null);
  const [switchPinInput, setSwitchPinInput] = useState('');

  if (!org) return null;

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (users.filter((u) => u.active).length >= org.maxUsers) {
      showToast(`وصلت للحد الأقصى للموظفين في باقتك (${org.maxUsers})`, 'error');
      return;
    }
    const id = generateUuid();
    const now = new Date().toISOString();
    const user: AppUser = {
      id,
      orgId: org.id,
      branchId: org.activeBranchId,
      name: name.trim(),
      role,
      hasPin: pin.trim().length >= 4,
      pinHash: pin.trim().length >= 4 ? await hashPin(pin.trim(), id) : undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.users.put(user);
    setName('');
    setPin('');
    await refreshData();
    showToast('تم إضافة الموظف بصلاحياته');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="الموظفون والصلاحيات"
        subtitle="إدارة حسابات الموظفين وسجل العمليات"
        icon={<Users className="h-5 w-5" />}
        backAction={() => navigate('settings')}
      />

      <SurfaceCard>
        <form onSubmit={handleAddUser} className="space-y-3">
          <div>
            <label htmlFor="user-name" className="block text-xs text-[#657369] mb-1.5">
              اسم الموظف *
            </label>
            <input
              id="user-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="user-role" className="block text-xs text-[#657369] mb-1.5">
                الدور الوظيفي
              </label>
              <select
                id="user-role"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full min-h-[48px] px-3 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
              >
                <option value="owner">المالك</option>
                <option value="manager">المدير</option>
                <option value="accountant">المحاسب</option>
                <option value="cashier">أمين الصندوق</option>
              </select>
            </div>
            <div>
              <label htmlFor="user-pin" className="block text-xs text-[#657369] mb-1.5">
                رمز PIN (اختياري)
              </label>
              <input
                id="user-pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4 أرقام+"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
          </div>
          <PrimaryButton type="submit" className="w-full">
            <Plus className="h-4 w-4" />
            إضافة موظف
          </PrimaryButton>
        </form>
      </SurfaceCard>

      <SurfaceCard>
        <h2 className="font-display text-base font-bold mb-3">الحسابات المسجلة</h2>
        <div className="divide-y divide-[#ECE7DA] dark:divide-[#21362A]">
          {users.map((u) => (
            <div key={u.id} className="py-3 flex items-center justify-between gap-2.5">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{u.name}</div>
                <div className="text-xs text-[#657369] truncate">
                  {formatRoleArabic(u.role)} · {u.hasPin ? 'محمي برمز PIN' : 'بدون رمز'}
                </div>
              </div>
              <PrimaryButton
                variant="secondary"
                onClick={async () => {
                  if (u.hasPin && u.pinHash) {
                    setPendingSwitchUser(u);
                    setSwitchPinInput('');
                  } else {
                    await switchUser(u);
                    showToast(`تم التبديل إلى حساب: ${u.name}`);
                  }
                }}
              >
                التبديل للحساب
              </PrimaryButton>
            </div>
          ))}
        </div>

        {pendingSwitchUser && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pendingSwitchUser.pinHash) return;
              const ok = await verifyPin(switchPinInput.trim(), pendingSwitchUser.id, pendingSwitchUser.pinHash);
              if (!ok) {
                showToast('رمز الحماية غير صحيح', 'error');
                return;
              }
              await switchUser(pendingSwitchUser);
              showToast(`تم التبديل إلى حساب: ${pendingSwitchUser.name}`);
              setPendingSwitchUser(null);
              setSwitchPinInput('');
            }}
            className="mt-4 p-4 rounded-2xl bg-[#FAF8F3] dark:bg-[#0B1610] border border-[#D8D3C6] dark:border-[#2C4235] space-y-3"
          >
            <div>
              <label htmlFor="switch-pin" className="block text-xs font-medium mb-1.5">
                أدخل رمز الحماية لحساب ({pendingSwitchUser.name})
              </label>
              <input
                id="switch-pin"
                type="password"
                inputMode="numeric"
                required
                value={switchPinInput}
                onChange={(e) => setSwitchPinInput(e.target.value)}
                placeholder="****"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm tabular-nums"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PrimaryButton type="submit">تأكيد</PrimaryButton>
              <PrimaryButton
                variant="secondary"
                type="button"
                onClick={() => {
                  setPendingSwitchUser(null);
                  setSwitchPinInput('');
                }}
              >
                إلغاء
              </PrimaryButton>
            </div>
          </form>
        )}
      </SurfaceCard>

      <SurfaceCard>
        <h2 className="font-display text-base font-bold mb-3">سجل نشاط الموظفين</h2>
        <div className="divide-y divide-[#ECE7DA] dark:divide-[#21362A] max-h-72 overflow-y-auto">
          {auditLogs.slice(0, 30).map((log) => (
            <div key={log.id} className="py-2.5 flex flex-col gap-0.5 text-xs">
              <span>
                <strong>{log.userName}</strong>: {sanitizeCommercialText(log.summary)}
              </span>
              <span className="text-[11px] text-[#657369] tabular-nums">
                {formatDateArabic(log.createdAt, org.dateFormat, true)}
              </span>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
};

export const OrgProfileView: React.FC = () => {
  const { org, navigate, refreshData, showToast } = useQatshi();
  const [name, setName] = useState(org?.name || '');
  const [ownerName, setOwnerName] = useState(org?.ownerName || '');
  const [phone, setPhone] = useState(org?.phone || '');
  const [address, setAddress] = useState(org?.address || '');
  const [currency, setCurrency] = useState<CurrencyCode>(org?.currency || 'YER');
  const [invoiceFooter, setInvoiceFooter] = useState(org?.invoiceFooter || '');
  const [newBranchName, setNewBranchName] = useState('');

  if (!org) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = {
      ...org,
      name: name.trim(),
      ownerName: ownerName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      currency,
      currencyDecimals: currency === 'YER' ? 0 : 2,
      invoiceFooter: invoiceFooter.trim(),
      updatedAt: new Date().toISOString(),
    };
    await db.organizations.put(updated);
    await queueEntitySyncOperation({
      orgId: org.id,
      entityType: 'organization',
      entityId: org.id,
      action: 'update',
      payload: updated,
    });
    await refreshData();
    showToast('تم حفظ بيانات المحل بنجاح');
  };

  const handleAddBranch = async () => {
    if (!newBranchName.trim()) return;
    const branchId = `branch-${generateUuid().slice(0, 6)}`;
    const updated = {
      ...org,
      branches: [
        ...org.branches,
        { id: branchId, name: newBranchName.trim(), address: org.address, phone: org.phone, isMain: false },
      ],
      updatedAt: new Date().toISOString(),
    };
    await db.organizations.put(updated);
    await queueEntitySyncOperation({
      orgId: org.id,
      entityType: 'organization',
      entityId: org.id,
      action: 'update',
      payload: updated,
    });
    setNewBranchName('');
    await refreshData();
    showToast('تمت إضافة الفرع بنجاح');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="ملف المحل والفروع"
        subtitle="بيانات الترويسة في الفواتير وإدارة الفروع"
        icon={<Building2 className="h-5 w-5" />}
        backAction={() => navigate('settings')}
      />

      <SurfaceCard className="overflow-hidden p-0">
        <div className="aspect-[21/8] bg-[#183526] overflow-hidden">
          <img src={shopCoverImg} alt="واجهة المحل" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
        </div>
        <form onSubmit={handleSave} className="p-4 space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#657369] mb-1.5">اسم المحل / المؤسسة</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#657369] mb-1.5">اسم المالك</label>
              <input
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#657369] mb-1.5">رقم الهاتف</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs text-[#657369] mb-1.5">العملة</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full min-h-[48px] px-3 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
              >
                <option value="YER">ريال يمني (ر.ي)</option>
                <option value="SAR">ريال سعودي (ر.س)</option>
                <option value="USD">دولار أمريكي ($)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#657369] mb-1.5">العنوان</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[#657369] mb-1.5">نص التذييل في الفواتير وكشوفات الحساب</label>
            <input
              type="text"
              value={invoiceFooter}
              onChange={(e) => setInvoiceFooter(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
            />
          </div>
          <PrimaryButton type="submit" className="w-full">
            حفظ التعديلات
          </PrimaryButton>
        </form>
      </SurfaceCard>

      <SurfaceCard className="space-y-4">
        <h2 className="font-display text-base font-bold">الفروع</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="اسم الفرع الجديد..."
            className="flex-1 min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
          />
          <PrimaryButton onClick={handleAddBranch}>إضافة</PrimaryButton>
        </div>
        <div className="divide-y divide-[#ECE7DA] dark:divide-[#21362A]">
          {org.branches.map((b) => (
            <div key={b.id} className="py-3 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">
                {b.name} {b.id === org.activeBranchId ? ' (النشط حالياً)' : ''}
              </div>
              {b.id !== org.activeBranchId && (
                <PrimaryButton
                  variant="secondary"
                  onClick={async () => {
                    const updated = { ...org, activeBranchId: b.id, updatedAt: new Date().toISOString() };
                    await db.organizations.put(updated);
                    await queueEntitySyncOperation({
                      orgId: org.id,
                      entityType: 'organization',
                      entityId: org.id,
                      action: 'update',
                      payload: updated,
                    });
                    await refreshData();
                    showToast(`تم تفعيل فرع: ${b.name}`);
                  }}
                >
                  تحديد كفرع نشط
                </PrimaryButton>
              )}
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
};

interface DirectoryItem {
  id: AppScreen;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  iconBg: string;
  badge?: string;
}

export const SettingsView: React.FC = () => {
  const {
    org,
    activeUser,
    messagingConfig,
    darkMode,
    toggleDarkMode,
    setLocked,
    navigate,
    refreshData,
    showToast,
  } = useQatshi();
  const { isInstalled } = usePWAInstall();
  const [searchQuery, setSearchQuery] = useState('');

  const activeBranch = useMemo(
    () => org?.branches.find((b) => b.id === org.activeBranchId),
    [org]
  );

  const directoryItems = useMemo<DirectoryItem[]>(
    () => [
      {
        id: 'products',
        label: 'الأصناف والأسعار',
        subtitle: 'أصناف القات، الدرجات، وتكلفة الشراء',
        icon: <Tag className="h-4 w-4" />,
        iconBg: 'bg-[#E8F1EB] text-[#1E4230] dark:bg-[#193325] dark:text-[#8FC59B]',
      },
      {
        id: 'users',
        label: 'الموظفون والصلاحيات',
        subtitle: 'حسابات الكاشير، المحاسبين، ورموز الحماية',
        icon: <Users className="h-4 w-4" />,
        iconBg: 'bg-[#EDEFF8] text-[#2F4486] dark:bg-[#1E2642] dark:text-[#9AAEF2]',
      },
      {
        id: 'org_profile',
        label: 'ملف المحل والفروع',
        subtitle: 'بيانات الفاتورة، العملة، وإدارة الفروع',
        icon: <Building2 className="h-4 w-4" />,
        iconBg: 'bg-[#FBF3E2] text-[#8E5D12] dark:bg-[#3A2B11] dark:text-[#ECC068]',
      },
      {
        id: 'cashbox',
        label: 'الصندوق اليومي',
        subtitle: 'الجرد اليومي، فتح وإقفال الصندوق',
        icon: <Wallet className="h-4 w-4" />,
        iconBg: 'bg-[#E8F5ED] text-[#1D6A42] dark:bg-[#173626] dark:text-[#7AD0A1]',
      },
      {
        id: 'expenses',
        label: 'المصروفات',
        subtitle: 'تصنيف وتسجيل مصاريف المحل اليومية',
        icon: <Receipt className="h-4 w-4" />,
        iconBg: 'bg-[#FCECE9] text-[#B93829] dark:bg-[#3B1915] dark:text-[#F0887C]',
      },
      {
        id: 'debts',
        label: 'الديون والتحصيل',
        subtitle: 'أعمار الديون، المتأخرات، وسندات القبض',
        icon: <Banknote className="h-4 w-4" />,
        iconBg: 'bg-[#F8EFE2] text-[#8B5C15] dark:bg-[#362612] dark:text-[#EBB867]',
      },
      {
        id: 'messaging',
        label: 'الرسائل النصية والحملات',
        subtitle: 'إرسال عبر الشريحة للعملاء والمدينين',
        icon: <MessageSquare className="h-4 w-4" />,
        iconBg: 'bg-[#E8F1EB] text-[#1E4230] dark:bg-[#193325] dark:text-[#8FC59B]',
      },
      {
        id: 'templates',
        label: 'قوالب الرسائل',
        subtitle: 'تخصيص نصوص التذكير وإشعارات السداد',
        icon: <FileText className="h-4 w-4" />,
        iconBg: 'bg-[#F2ECE8] text-[#6D4735] dark:bg-[#2F211B] dark:text-[#D5A792]',
      },
      {
        id: 'message_log',
        label: 'سجل الرسائل',
        subtitle: 'متابعة حالة الإرسال ومنع التكرار',
        icon: <History className="h-4 w-4" />,
        iconBg: 'bg-[#EEF1F5] text-[#354E6E] dark:bg-[#1B2635] dark:text-[#96B4DC]',
      },
      {
        id: 'sms_settings',
        label: 'إعدادات الشريحة (SIM)',
        subtitle: 'اختيار شريحة الإرسال وصلاحيات الهاتف',
        icon: <Smartphone className="h-4 w-4" />,
        iconBg: 'bg-[#E9F3EF] text-[#1A5D4A] dark:bg-[#16342B] dark:text-[#84CEB9]',
      },
      {
        id: 'backup',
        label: 'النسخ الاحتياطي المشفر',
        subtitle: 'حفظ نسخة محلية أو سحابية واستعادتها',
        icon: <HardDriveDownload className="h-4 w-4" />,
        iconBg: 'bg-[#EAF0F7] text-[#284C75] dark:bg-[#18293D] dark:text-[#8EB6E6]',
      },
      {
        id: 'sync',
        label: 'المزامنة السحابية',
        subtitle: 'قائمة العمليات المعلقة وحل التعارضات',
        icon: <RefreshCw className="h-4 w-4" />,
        iconBg: 'bg-[#E8F4F1] text-[#1E6050] dark:bg-[#18352E] dark:text-[#7FD1BC]',
      },
      {
        id: 'maintenance',
        label: 'فحص سلامة الحسابات',
        subtitle: 'مطابقة الأرصدة مع دفتر الأستاذ',
        icon: <ShieldCheck className="h-4 w-4" />,
        iconBg: 'bg-[#E8F5ED] text-[#1D6A42] dark:bg-[#173626] dark:text-[#7AD0A1]',
      },
      {
        id: 'subscription',
        label: 'الاشتراك والمؤسسات',
        subtitle: 'التبديل بين المحلات وتفاصيل الباقة',
        icon: <CreditCard className="h-4 w-4" />,
        iconBg: 'bg-[#FBF3E2] text-[#8E5D12] dark:bg-[#3A2B11] dark:text-[#ECC068]',
      },
      {
        id: 'support',
        label: 'المساعدة والدعم',
        subtitle: 'دليل التشغيل السريع والقواعد المحاسبية',
        icon: <HelpCircle className="h-4 w-4" />,
        iconBg: 'bg-[#EFECE4] text-[#4C594F] dark:bg-[#223328] dark:text-[#BAC8BE]',
      },
    ],
    []
  );

  if (!org) return null;

  const q = searchQuery.trim().toLowerCase();

  const preferenceMatches = {
    darkMode: !q || 'المظهر الليلي الوضع الفاتح اضاءة'.includes(q),
    smsEnabled: !q || 'الرسائل النصية تفعيل sms الشريحة'.includes(q),
    manualConfirm: !q || 'تأكيد الإرسال تطبيق الهاتف متصفح'.includes(q),
    autoLock: !q || 'القفل التلقائي خمول امان رمز'.includes(q),
    install: !q || 'تثبيت التطبيق الشاشة الرئيسية'.includes(q),
  };
  const hasAnyPreferenceMatch = Object.values(preferenceMatches).some(Boolean);

  const filteredDirectory = q
    ? directoryItems.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q)
      )
    : directoryItems;

  return (
    <div className="space-y-4">
      <PageHeader
        title="الإعدادات والملف"
        subtitle="إعدادات الحساب، التفضيلات، وأقسام النظام"
        icon={<Settings className="h-5 w-5" />}
        backAction={() => navigate('dashboard')}
      />

      {/* Instant Live Search Bar */}
      <div className="relative">
        <Search className="h-4 w-4 text-[#7A877D] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ابحث في التفضيلات أو أقسام النظام..."
          aria-label="ابحث في الإعدادات"
          className="w-full min-h-[46px] pr-10 pl-3.5 rounded-[16px] bg-white dark:bg-[#12231A] border border-[#E2DDD0] dark:border-[#22382B] text-sm placeholder:text-[#8B978E]"
        />
      </div>

      {/* Organization & Active Account Profile Card */}
      {!q && (
        <SurfaceCard className="p-0 overflow-hidden">
          <div className="p-4 flex items-center gap-3 bg-gradient-to-l from-[#183526] to-[#234A36] text-white">
            <div className="h-12 w-12 rounded-[16px] bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
              <Building2 className="h-6 w-6 text-[#F5D68E]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-extrabold truncate">{org.name}</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#389E6B]/25 text-[#9EE3BA] border border-[#9EE3BA]/30 shrink-0">
                  {formatSubscriptionStatusArabic(org.subscriptionStatus)}
                </span>
              </div>
              <p className="text-xs text-[#C8DACD] truncate mt-0.5">
                {formatPlanArabic(org.subscriptionPlan)} · {activeBranch?.name || 'الفرع الرئيسي'}
              </p>
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="text-[#657369] dark:text-[#98A89C]">
                الحساب النشط الآن
              </div>
              <div className="font-bold text-[#16281E] dark:text-[#EEF2EC]">
                {activeUser ? `${activeUser.name} (${formatRoleArabic(activeUser.role)})` : org.ownerName}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setLocked(true);
                navigate('login');
              }}
              className="w-full min-h-[46px] px-4 rounded-[14px] bg-[#FCECE9] dark:bg-[#3A1915] border border-[#F5CEC7] dark:border-[#5D2922] text-[#B93829] dark:text-[#F49387] text-xs font-bold inline-flex items-center justify-center gap-2 active:scale-[0.985] transition-transform cursor-pointer"
            >
              <Lock className="h-4 w-4" />
              قفل الجلسة وتبديل المستخدم
            </button>
          </div>
        </SurfaceCard>
      )}

      {/* System Preferences Card with Accessible Switches */}
      {hasAnyPreferenceMatch && (
        <SurfaceCard className="p-0 overflow-hidden">
          <div className="px-4 pt-3.5 pb-2 border-b border-[#EFECE3] dark:border-[#21362A]">
            <h2 className="font-display text-sm font-extrabold text-[#16281E] dark:text-[#EEF2EC]">
              تفضيلات النظام
            </h2>
          </div>

          <div className="divide-y divide-[#EFECE3] dark:divide-[#21362A]">
            {preferenceMatches.darkMode && (
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#16281E] dark:text-[#EEF2EC]">
                    المظهر الليلي
                  </div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">
                    مريح للعين في الإضاءة المنخفضة
                  </div>
                </div>
                <ToggleSwitch
                  id="pref-dark-mode"
                  checked={darkMode}
                  onChange={() => toggleDarkMode()}
                  label="تبديل المظهر الليلي"
                />
              </div>
            )}

            {messagingConfig && preferenceMatches.smsEnabled && (
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#16281E] dark:text-[#EEF2EC]">
                    خدمة الرسائل النصية
                  </div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">
                    السماح بإرسال تنبيهات السداد والعروض عبر الشريحة
                  </div>
                </div>
                <ToggleSwitch
                  id="pref-sms-enabled"
                  checked={messagingConfig.smsEnabled}
                  onChange={async (next) => {
                    await saveMessagingConfig({ ...messagingConfig, smsEnabled: next });
                    await refreshData();
                    showToast(next ? 'تم تفعيل خدمة الرسائل النصية' : 'تم إيقاف خدمة الرسائل النصية مؤقتاً');
                  }}
                  label="تفعيل خدمة الرسائل النصية"
                />
              </div>
            )}

            {messagingConfig && preferenceMatches.manualConfirm && (
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#16281E] dark:text-[#EEF2EC]">
                    التأكيد اليدوي من المتصفح
                  </div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">
                    توثيق حالة الرسالة بعد إرسالها بتطبيق الهاتف
                  </div>
                </div>
                <ToggleSwitch
                  id="pref-manual-confirm"
                  checked={messagingConfig.requireManualConfirmInWebFallback}
                  onChange={async (next) => {
                    await saveMessagingConfig({
                      ...messagingConfig,
                      requireManualConfirmInWebFallback: next,
                    });
                    await refreshData();
                    showToast('تم حفظ تفضيل التحقق اليدوي');
                  }}
                  label="تفعيل التأكيد اليدوي للرسائل"
                />
              </div>
            )}

            {preferenceMatches.autoLock && (
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label htmlFor="auto-lock" className="block text-sm font-bold text-[#16281E] dark:text-[#EEF2EC]">
                    القفل التلقائي عند الخمول
                  </label>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">
                    حماية الحسابات عند ترك الهاتف
                  </div>
                </div>
                <select
                  id="auto-lock"
                  value={org.autoLockMinutes}
                  onChange={async (e) => {
                    await db.organizations.put({ ...org, autoLockMinutes: Number(e.target.value) });
                    await refreshData();
                    showToast('تم حفظ مدة القفل التلقائي');
                  }}
                  className="min-h-[40px] px-3 rounded-[12px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-xs font-bold shrink-0"
                >
                  <option value={0}>معطل</option>
                  <option value={5}>5 دقائق</option>
                  <option value={15}>15 دقيقة</option>
                  <option value={30}>30 دقيقة</option>
                </select>
              </div>
            )}

            {preferenceMatches.install && (
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#16281E] dark:text-[#EEF2EC]">
                    تثبيت قاتشي على الهاتف
                  </div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">
                    {isInstalled
                      ? 'مثبّت ويعمل كتطبيق مستقل بدون إنترنت'
                      : 'أضفه للشاشة الرئيسية لفتح فوري كتطبيق أصيل'}
                  </div>
                </div>
                {isInstalled ? (
                  <span className="px-2.5 py-1 rounded-full bg-[#E8F5ED] dark:bg-[#173626] text-[#1D6A42] dark:text-[#7AD0A1] text-[11px] font-bold shrink-0">
                    مثبّت
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('qatshi:open-install-sheet'))}
                    className="min-h-[38px] px-3.5 rounded-[12px] bg-[#1E4230] text-white text-xs font-bold shrink-0 cursor-pointer"
                  >
                    تثبيت
                  </button>
                )}
              </div>
            )}
          </div>
        </SurfaceCard>
      )}

      {/* Sub-Pages Directory */}
      {filteredDirectory.length > 0 && (
        <SurfaceCard className="p-0 overflow-hidden">
          <div className="px-4 pt-3.5 pb-2 border-b border-[#EFECE3] dark:border-[#21362A]">
            <h2 className="font-display text-sm font-extrabold text-[#16281E] dark:text-[#EEF2EC]">
              دليل الإدارة والأدوات ({filteredDirectory.length})
            </h2>
          </div>
          <div className="divide-y divide-[#EFECE3] dark:divide-[#21362A]">
            {filteredDirectory.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-right hover:bg-[#FAF8F3] dark:hover:bg-[#172B20] active:bg-[#F3EFE6] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`h-10 w-10 rounded-[12px] flex items-center justify-center shrink-0 ${item.iconBg}`}>
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-[#16281E] dark:text-[#EEF2EC] truncate">
                      {item.label}
                    </div>
                    <div className="text-[11px] text-[#657369] dark:text-[#98A89C] truncate">
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <ChevronLeft className="h-4 w-4 text-[#8C988F] shrink-0" />
              </button>
            ))}
          </div>
        </SurfaceCard>
      )}

      {!hasAnyPreferenceMatch && filteredDirectory.length === 0 && (
        <EmptyState
          title="لا توجد نتائج مطابقة"
          description="جرّب البحث بكلمة أخرى مثل: المظهر، الموظفون، النسخ، أو الشريحة."
        />
      )}
    </div>
  );
};

export const BackupView: React.FC = () => {
  const { org, backupRecords, navigate, refreshData, showToast } = useQatshi();
  const [activeTab, setActiveTab] = useState<'create' | 'restore' | 'history'>('create');
  const [password, setPassword] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [allowCrossOrg, setAllowCrossOrg] = useState(false);

  if (!org) return null;

  const handleExportLocal = async (uploadCloud = false) => {
    try {
      const { fileContent, fileName } = await createOrganizationBackup({
        orgId: org.id,
        password: password.trim() || undefined,
        storageType: uploadCloud ? 'cloud_optional' : 'local_file',
      });
      if (uploadCloud) {
        const secret = await ensureOrgAuthSecret(org.id);
        const res = await fetch('/api/backup/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-org-secret': secret,
          },
          body: JSON.stringify({ orgId: org.id, content: fileContent }),
        });
        if (!res.ok) throw new Error('تعذر رفع النسخة السحابية');
        showToast('تم حفظ نسخة احتياطية سحابية للمؤسسة بنجاح');
      } else {
        triggerBlobDownload(new Blob([fileContent], { type: 'application/json' }), fileName);
        showToast('تم حفظ النسخة الاحتياطية على جهازك');
      }
      await refreshData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'فشل النسخ الاحتياطي', 'error');
    }
  };

  const handleFileRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { payload } = await parseAndVerifyBackupFile({
        rawText: text,
        password: restorePass.trim() || undefined,
        currentOrgId: org.id,
        allowCrossOrgRestore: allowCrossOrg,
      });
      await restoreBackupPayload(payload);
      await refreshData();
      showToast('تم التحقق من سلامة النسخة واستعادة البيانات بنجاح');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر استعادة النسخة';
      showToast(msg.replace('PASSWORD_REQUIRED:', '').replace('CROSS_ORG_MISMATCH:', ''), 'error');
    } finally {
      e.target.value = '';
    }
  };

  const tabs: Array<{ id: 'create' | 'restore' | 'history'; label: string }> = [
    { id: 'create', label: 'إنشاء نسخة' },
    { id: 'restore', label: 'استعادة نسخة' },
    { id: 'history', label: `السجل (${backupRecords.length})` },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="النسخ الاحتياطي والاستعادة"
        subtitle="حفظ آمن ومشفر لبيانات محلك وإمكانية استعادتها في أي وقت"
        icon={<HardDriveDownload className="h-5 w-5" />}
        backAction={() => navigate('settings')}
      />

      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-[#EFECE3] dark:bg-[#0B1610] border border-[#E2DDD0] dark:border-[#243B2E]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`min-h-[42px] px-2 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
              activeTab === t.id
                ? 'bg-[#1E4230] text-white dark:bg-[#3A7D56] shadow-xs'
                : 'text-[#3D4337] dark:text-[#C7CBB8]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'create' && (
        <SurfaceCard className="space-y-4">
          <div className="p-3.5 rounded-2xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900">
            <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              تذكير مهم: احرص على حفظ نسخة احتياطية على هاتفك أو سحابياً بانتظام لحماية حساباتك عند تغيير الجهاز.
            </p>
          </div>

          <div>
            <label htmlFor="backup-pass" className="block text-xs font-medium text-[#657369] mb-1.5">
              كلمة مرور حماية النسخة (اختياري)
            </label>
            <input
              id="backup-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="اتركه فارغاً للحفظ بدون كلمة مرور"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <PrimaryButton onClick={() => handleExportLocal(false)} className="w-full">
              <Download className="h-4 w-4" />
              حفظ نسخة على الهاتف
            </PrimaryButton>
            <PrimaryButton variant="secondary" onClick={() => handleExportLocal(true)} className="w-full">
              <CloudUpload className="h-4 w-4" />
              حفظ سحابي اختياري
            </PrimaryButton>
          </div>
        </SurfaceCard>
      )}

      {activeTab === 'restore' && (
        <SurfaceCard className="space-y-4">
          <h2 className="font-display text-base font-bold">استعادة نسخة محفوظة</h2>
          <div>
            <label htmlFor="restore-pass" className="block text-xs font-medium text-[#657369] mb-1.5">
              كلمة مرور النسخة (إن وُجدت)
            </label>
            <input
              id="restore-pass"
              type="password"
              value={restorePass}
              onChange={(e) => setRestorePass(e.target.value)}
              placeholder="أدخل كلمة المرور لفك الحماية"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
            />
          </div>

          <label className="flex items-center gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={allowCrossOrg}
              onChange={(e) => setAllowCrossOrg(e.target.checked)}
              className="h-4 w-4 accent-[#1E4230]"
            />
            السماح بالاستعادة حتى لو كانت النسخة لمحل آخر مسجل على التطبيق
          </label>

          <label className="w-full min-h-[48px] px-5 py-3 rounded-2xl bg-[#1E4230] dark:bg-[#3A7D56] text-white text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer">
            <Upload className="h-4 w-4" />
            اختيار ملف النسخة الاحتياطية للاستعادة
            <input type="file" accept=".json" onChange={handleFileRestore} className="hidden" />
          </label>
        </SurfaceCard>
      )}

      {activeTab === 'history' && (
        <SurfaceCard className="space-y-3">
          <h2 className="font-display text-base font-bold">سجل النسخ الاحتياطية</h2>
          {backupRecords.length === 0 ? (
            <p className="text-sm text-[#657369] py-6 text-center">لم يتم إنشاء أي نسخة احتياطية بعد.</p>
          ) : (
            <div className="divide-y divide-[#ECE7DA] dark:divide-[#21362A]">
              {backupRecords.map((b) => (
                <div key={b.id} className="py-3 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-semibold text-sm">
                      {formatDateArabic(b.createdAt, org.dateFormat, true)}
                    </div>
                    <div className="text-[#657369]">
                      {b.recordCount} سجل · {b.encrypted ? 'محمية بكلمة مرور' : 'نسخة قياسية'}
                    </div>
                  </div>
                  <span className="tabular-nums text-[#657369] shrink-0">
                    {Math.max(1, Math.round(b.sizeBytes / 1024))} كيلوبايت
                  </span>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}
    </div>
  );
};

export const MaintenanceView: React.FC = () => {
  const { org, orgCounts, syncOps, backupRecords, navigate, refreshData, showToast } = useQatshi();
  const { isInstalled } = usePWAInstall();
  const [storage, setStorage] = useState<StorageDiagnostics | null>(null);
  const [auditResult, setAuditResult] = useState<string | null>(null);
  const [demoAudit, setDemoAudit] = useState<DemoDataAuditReport | null>(null);
  const [swActive, setSwActive] = useState<boolean>(
    typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller)
  );

  useEffect(() => {
    requestAndCheckPersistentStorage().then(setStorage).catch(() => {});
    auditDemoDataInDb().then((res) => setDemoAudit(res.report)).catch(() => {});
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg?.active) setSwActive(true);
      }).catch(() => {});
    }
  }, []);

  if (!org) return null;

  const handleAudit = async () => {
    const res = await verifyAndRepairLedgerIntegrity(org.id, org.currencyDecimals);
    await refreshData();
    setAuditResult(
      res.repairedCount === 0
        ? `تم فحص ${res.checkedCustomers} عميل: جميع الأرصدة متطابقة 100% مع دفتر الأستاذ.`
        : `تم فحص ${res.checkedCustomers} عميل وإصلاح ${res.repairedCount} رصيد ليطابق دفتر الأستاذ.`
    );
    showToast('اكتمل فحص سلامة البيانات المالية');
  };

  const handleSafeDemoCleanup = async () => {
    const cleaned = await auditAndCleanProvenDemoData({ createSafetyBackup: true });
    if (cleaned.preCleanupBackupCreated) {
      triggerBlobDownload(
        new Blob([cleaned.preCleanupBackupCreated.fileContent], { type: 'application/json' }),
        cleaned.preCleanupBackupCreated.fileName
      );
    }
    setDemoAudit(cleaned);
    await refreshData();
    if (cleaned.cleanedRecordsTotal > 0) {
      showToast(`تم حفظ نسخة احتياطية وتنظيف ${cleaned.cleanedRecordsTotal} سجل تجريبي قديم بأمان`);
    } else {
      showToast('قاعدة البيانات نظيفة تماماً من أي سجلات تجريبية', 'info');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="فحص سلامة الحسابات"
        subtitle="التحقق من مطابقة الأرصدة وحالة التخزين المحفوظ على الهاتف"
        icon={<ShieldCheck className="h-5 w-5" />}
        backAction={() => navigate('settings')}
      />

      <div className="grid grid-cols-2 gap-3">
        <KpiMetric label="العملاء" value={String(orgCounts.customers)} />
        <KpiMetric label="الفواتير والمدفوعات" value={String(orgCounts.sales + orgCounts.payments)} />
        <KpiMetric label="قيود الحسابات" value={String(orgCounts.ledgerEntries)} />
        <KpiMetric
          label="مساحة التخزين المستخدمة"
          value={storage ? `${(storage.usageBytes / (1024 * 1024)).toFixed(2)} م.ب` : '—'}
          meta={storage?.persisted ? 'التخزين الدائم مفعّل' : 'التخزين القياسي'}
        />
      </div>

      <SurfaceCard className="space-y-4">
        <h2 className="font-display text-base font-bold">أدوات الفحص والصيانة الآمنة</h2>
        <p className="text-xs text-[#657369] leading-relaxed">
          تتحقق هذه الأدوات من تطابق أرصدة العملاء مع القيود المسجلة دون حذف أي عملية مالية فعلية.
        </p>
        <div className="grid grid-cols-1 gap-2">
          <PrimaryButton onClick={handleAudit}>
            <ShieldCheck className="h-4 w-4" />
            فحص ومطابقة الأرصدة
          </PrimaryButton>
          <div className="grid grid-cols-2 gap-2">
            <PrimaryButton
              variant="secondary"
              onClick={async () => {
                const res = await requestAndCheckPersistentStorage();
                setStorage(res);
                showToast(res.persisted ? 'تم تأكيد صلاحية الحفظ الدائم على الهاتف' : 'يرجى تثبيت التطبيق لتأكيد الحفظ الدائم');
              }}
            >
              تأكيد الحفظ الدائم
            </PrimaryButton>
            <PrimaryButton variant="secondary" onClick={handleSafeDemoCleanup}>
              فحص نظافة البيانات
            </PrimaryButton>
          </div>
        </div>

        {auditResult && (
          <div className="p-3.5 rounded-2xl bg-[#E8F1EB] dark:bg-[#193325] text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#1E4230] dark:text-[#8FC59B] shrink-0" />
            <span>{auditResult}</span>
          </div>
        )}

        {demoAudit && (
          <div className="p-3.5 rounded-2xl border border-[#E2DDD0] dark:border-[#243B2E] text-xs space-y-1.5">
            <div className="font-semibold">
              حالة البيانات:{' '}
              {demoAudit.hasDemoOrg || Object.values(demoAudit.provenDemoCounts).some((n) => n > 0)
                ? 'تم رصد سجلات تجريبية سابقة'
                : 'سليمة 100% — جميع السجلات حقيقية'}
            </div>
            <div className="text-[#657369]">
              المؤسسات: {demoAudit.realDataCounts.organizations} · العملاء: {demoAudit.realDataCounts.customers}
            </div>
          </div>
        )}

        <div className="text-xs text-[#657369] space-y-1 pt-1">
          <div>
            عمليات بانتظار المزامنة: {syncOps.filter((s) => s.status === 'pending').length} · النسخ الاحتياطية: {backupRecords.length}
          </div>
          <div>
            التخزين للعمل دون إنترنت: {swActive ? 'مفعّل ونشط' : 'قيد التجهيز'} · طريقة التشغيل:{' '}
            {isInstalled ? 'تطبيق مثبّت ومستقل' : 'متصفح الويب'}
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
};

export const SyncView: React.FC = () => {
  const { org, syncOps, navigate, refreshData, showToast } = useQatshi();
  const [syncing, setSyncing] = useState(false);

  if (!org) return null;

  const pending = syncOps.filter((s) => s.status === 'pending');
  const conflicts = syncOps.filter((s) => s.status === 'conflict');
  const synced = syncOps.filter((s) => s.status === 'synced');

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await runOrganizationSync(org.id);
      await refreshData();
      showToast(res.message, res.conflictCount > 0 || !res.serverReachable ? 'info' : 'success');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="المزامنة السحابية"
        subtitle="يعمل النظام على ذاكرة الهاتف أولاً وتتم المزامنة اختيارياً دون تكرار"
        icon={<RefreshCw className="h-5 w-5" />}
        backAction={() => navigate('settings')}
        action={
          <PrimaryButton onClick={handleSyncNow} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'جاري...' : 'مزامنة'}
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-3 gap-2.5">
        <KpiMetric label="بانتظار الإرسال" value={String(pending.length)} tone={pending.length > 0 ? 'warning' : 'default'} />
        <KpiMetric label="تتطلب مراجعة" value={String(conflicts.length)} tone={conflicts.length > 0 ? 'danger' : 'default'} />
        <KpiMetric label="متزامنة" value={String(synced.length)} tone="positive" />
      </div>

      {conflicts.length > 0 && (
        <SurfaceCard className="space-y-3 border-red-300 dark:border-red-900">
          <h2 className="font-display text-base font-bold text-red-700 dark:text-red-400">
            تعارضات تتطلب المراجعة
          </h2>
          {conflicts.map((op) => (
            <div key={op.id} className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/20 flex flex-wrap justify-between items-center gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {formatSyncEntityArabic(op.entityType)} · {formatSyncActionArabic(op.action)}
                </div>
                <div className="text-xs text-red-700 dark:text-red-300">{op.conflictDetails}</div>
              </div>
              <PrimaryButton
                variant="secondary"
                onClick={async () => {
                  await resolveSyncConflict(op, 'mark_reviewed');
                  await refreshData();
                  showToast('تمت المراجعة واعتماد السجل');
                }}
              >
                اعتماد المراجعة
              </PrimaryButton>
            </div>
          ))}
        </SurfaceCard>
      )}

      <SurfaceCard>
        <h2 className="font-display text-base font-bold mb-3">سجل المزامنة</h2>
        {syncOps.length === 0 ? (
          <p className="text-sm text-[#657369] py-4 text-center">لا توجد عمليات مسجلة بعد.</p>
        ) : (
          <div className="divide-y divide-[#ECE7DA] dark:divide-[#21362A] max-h-80 overflow-y-auto">
            {syncOps.slice(0, 40).map((op) => (
              <div key={op.id} className="py-3 flex justify-between items-center gap-2 text-xs">
                <div>
                  <span className="font-semibold">{formatSyncEntityArabic(op.entityType)}</span>
                  <span className="text-[#657369] mr-2">· {formatSyncActionArabic(op.action)}</span>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-lg font-medium ${
                    op.status === 'synced'
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : op.status === 'conflict'
                      ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300'
                      : 'bg-[#FAF8F3] text-[#3D4337] dark:bg-[#1E3A2E] dark:text-[#C7CBB8]'
                  }`}
                >
                  {formatSyncStatusArabic(op.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

export const SubscriptionView: React.FC = () => {
  const { org, allOrgs, users, switchOrganization, navigate, refreshData, showToast } = useQatshi();
  if (!org) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="المؤسسات والاشتراك"
        subtitle="فصل تام لبيانات كل محل مع كامل حرية النسخ والتصدير"
        icon={<Sparkles className="h-5 w-5" />}
        backAction={() => navigate('settings')}
        action={
          <PrimaryButton onClick={() => navigate('setup')}>
            <Plus className="h-4 w-4" />
            تأسيس محل
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <KpiMetric
          label="الباقة الحالية"
          value={formatPlanArabic(org.subscriptionPlan)}
          meta={`الحالة: ${formatSubscriptionStatusArabic(org.subscriptionStatus)}`}
        />
        <KpiMetric
          label="الموظفون المسموحون"
          value={`${users.length} / ${org.maxUsers}`}
          meta={`صلاحية حتى ${formatDateArabic(org.subscriptionExpiry, org.dateFormat)}`}
        />
      </div>

      <SurfaceCard className="space-y-3">
        <h2 className="font-display text-base font-bold">المحلات المسجلة على هذا الجهاز</h2>
        <div className="divide-y divide-[#ECE7DA] dark:divide-[#21362A]">
          {allOrgs.map((o) => (
            <div key={o.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">
                  {o.name} {o.id === org.id ? ' (النشط حالياً)' : ''}
                </div>
                <div className="text-xs text-[#657369]">
                  المالك: {o.ownerName} · {formatPlanArabic(o.subscriptionPlan)}
                </div>
              </div>
              {o.id !== org.id && (
                <PrimaryButton variant="secondary" onClick={() => switchOrganization(o.id)}>
                  التبديل لهذا المحل
                </PrimaryButton>
              )}
            </div>
          ))}
        </div>
      </SurfaceCard>

      <SurfaceCard className="space-y-3">
        <h2 className="font-display text-base font-bold">الباقات المتاحة</h2>
        <div className="space-y-2.5">
          {[
            { id: 'starter', title: 'الباقة الأساسية (محل واحد)', users: 3, devices: 2 },
            { id: 'pro', title: 'الباقة الاحترافية (متعدد الموظفين)', users: 10, devices: 5 },
            { id: 'enterprise', title: 'باقة المؤسسات والفروع', users: 50, devices: 20 },
          ].map((plan) => (
            <div key={plan.id} className="p-4 rounded-2xl border border-[#E2DDD0] dark:border-[#243B2E] flex items-center justify-between gap-3">
              <div>
                <div className="font-display font-bold text-sm">{plan.title}</div>
                <div className="text-xs text-[#657369]">حتى {plan.users} موظفين · {plan.devices} أجهزة</div>
              </div>
              <PrimaryButton
                variant={org.subscriptionPlan === plan.id ? 'secondary' : 'primary'}
                onClick={async () => {
                  await db.organizations.put({
                    ...org,
                    subscriptionPlan: plan.id as typeof org.subscriptionPlan,
                    maxUsers: plan.users,
                    maxDevices: plan.devices,
                  });
                  await refreshData();
                  showToast(`تم تفعيل: ${plan.title}`);
                }}
              >
                {org.subscriptionPlan === plan.id ? 'الحالية' : 'تفعيل'}
              </PrimaryButton>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
};

export const SupportView: React.FC = () => {
  const { navigate } = useQatshi();
  return (
    <div className="space-y-4">
      <PageHeader
        title="المساعدة والدعم"
        subtitle="دليل التشغيل اليومي والقواعد المحاسبية في قاتشي"
        icon={<HelpCircle className="h-5 w-5" />}
        backAction={() => navigate('settings')}
      />

      <SurfaceCard className="space-y-4 text-sm leading-relaxed text-[#3D4337] dark:text-[#C7CBB8]">
        <div>
          <h2 className="font-display font-bold text-base text-[#16281E] dark:text-[#EEF2EC]">
            1. العمل دون إنترنت
          </h2>
          <p className="mt-1">
            تُحفظ كافة الفواتير والعملاء وسندات القبض والمصروفات في ذاكرة الهاتف الآمنة مباشرة، ويمكنك إصدار كشوفات الحساب ومشاركتها في أي وقت.
          </p>
        </div>
        <div>
          <h2 className="font-display font-bold text-base text-[#16281E] dark:text-[#EEF2EC]">
            2. الدقة المحاسبية وحفظ الحقوق
          </h2>
          <p className="mt-1">
            لا يتم حذف الفواتير أو السندات المعتمدة حفاظاً على دقة الحسابات. أي تصحيح يتم عبر قيد عكسي موثق من تفاصيل العملية.
          </p>
        </div>
        <div>
          <h2 className="font-display font-bold text-base text-[#16281E] dark:text-[#EEF2EC]">
            3. حماية بياناتك
          </h2>
          <p className="mt-1">
            نوصي بتنزيل نسخة احتياطية أسبوعياً من شاشة النسخ الاحتياطي والاحتفاظ بها في مكان آمن.
          </p>
        </div>
        <div className="pt-2 grid grid-cols-2 gap-2">
          <PrimaryButton onClick={() => navigate('backup')}>النسخ الاحتياطي</PrimaryButton>
          <PrimaryButton variant="secondary" onClick={() => navigate('maintenance')}>
            فحص سلامة الحسابات
          </PrimaryButton>
        </div>
      </SurfaceCard>
    </div>
  );
};

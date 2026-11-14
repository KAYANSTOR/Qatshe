import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
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
import type { AppUser, CurrencyCode, Product, UserRole } from '../domain/types';
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
import { triggerBlobDownload } from '../services/pdfGenerator';
import {
  ensureOrgAuthSecret,
  queueEntitySyncOperation,
  resolveSyncConflict,
  runOrganizationSync,
} from '../services/syncService';
import { EmptyState, KpiMetric, PageHeader, PrimaryButton, SurfaceCard } from '../components/ui/LuxuryUI';
import shopCoverImg from '../assets/images/shop_cover_luxury_1794643393777.jpg';

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
        backAction={() => navigate('dashboard')}
      />

      <SurfaceCard>
        <form onSubmit={handleAdd} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="prod-name" className="block text-xs text-[#6B7F67] mb-1.5">
                اسم الصنف *
              </label>
              <input
                id="prod-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: قات ولعة أصلي"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label htmlFor="prod-grade" className="block text-xs text-[#6B7F67] mb-1.5">
                الدرجة
              </label>
              <input
                id="prod-grade"
                type="text"
                required
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label htmlFor="prod-price" className="block text-xs text-[#6B7F67] mb-1.5">
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
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm font-bold tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="prod-cost" className="block text-xs text-[#6B7F67] mb-1.5">
                سعر التكلفة (اختياري)
              </label>
              <input
                id="prod-cost"
                type="number"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="لحساب صافي الربح"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
          </div>

          <PrimaryButton type="submit" className="w-full sm:w-auto">
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
                <div className="text-xs text-[#6B7F67] mt-0.5 tabular-nums">
                  الوحدة: {p.unitName} · السعر: {fmt(p.unitPrice)}
                  {p.costPrice ? ` · التكلفة: ${fmt(p.costPrice)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
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
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-2xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
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
        backAction={() => navigate('dashboard')}
      />

      <SurfaceCard>
        <form onSubmit={handleAddUser} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label htmlFor="user-name" className="block text-xs text-[#6B7F67] mb-1.5">
              اسم الموظف *
            </label>
            <input
              id="user-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>
          <div>
            <label htmlFor="user-role" className="block text-xs text-[#6B7F67] mb-1.5">
              الدور الوظيفي
            </label>
            <select
              id="user-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            >
              <option value="owner">المالك (كامل الصلاحيات)</option>
              <option value="manager">المدير</option>
              <option value="accountant">المحاسب</option>
              <option value="cashier">أمين الصندوق (بيع وسداد فقط)</option>
            </select>
          </div>
          <div>
            <label htmlFor="user-pin" className="block text-xs text-[#6B7F67] mb-1.5">
              رمز PIN (اختياري)
            </label>
            <input
              id="user-pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4 أرقام+"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
            />
          </div>
          <PrimaryButton type="submit" className="w-full sm:w-auto">
            إضافة موظف
          </PrimaryButton>
        </form>
      </SurfaceCard>

      <SurfaceCard>
        <h2 className="font-display text-base font-bold mb-3">الحسابات المسجلة</h2>
        <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E]">
          {users.map((u) => (
            <div key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">{u.name}</div>
                <div className="text-xs text-[#6B7F67]">
                  {formatRoleArabic(u.role)} · {u.hasPin ? 'محمي برمز PIN' : 'بدون رمز'} · {u.active ? 'نشط' : 'معطل'}
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
            className="mt-4 p-4 rounded-2xl bg-[#F9FAF7] dark:bg-[#0B1610] border border-[#C7CBB8] dark:border-[#2C4235] flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[200px]">
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
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-sm tabular-nums"
              />
            </div>
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
          </form>
        )}
      </SurfaceCard>

      <SurfaceCard>
        <h2 className="font-display text-base font-bold mb-3">سجل نشاط الموظفين</h2>
        <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E] max-h-72 overflow-y-auto">
          {auditLogs.slice(0, 30).map((log) => (
            <div key={log.id} className="py-2.5 flex flex-wrap justify-between gap-2 text-xs">
              <span>
                <strong>{log.userName}</strong>: {sanitizeCommercialText(log.summary)}
              </span>
              <span className="text-[#6B7F67] tabular-nums">
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
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="ملف المحل والفروع"
        subtitle="بيانات الترويسة في الفواتير وإدارة الفروع"
        backAction={() => navigate('dashboard')}
      />

      <SurfaceCard className="overflow-hidden p-0">
        <div className="aspect-[21/7] bg-[#0F1F17] overflow-hidden">
          <img src={shopCoverImg} alt="واجهة المحل" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
        </div>
        <form onSubmit={handleSave} className="p-5 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs text-[#6B7F67] mb-1.5">اسم المحل / المؤسسة</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6B7F67] mb-1.5">اسم المالك</label>
              <input
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6B7F67] mb-1.5">رقم الهاتف</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6B7F67] mb-1.5">العملة</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              >
                <option value="YER">ريال يمني (ر.ي)</option>
                <option value="SAR">ريال سعودي (ر.س)</option>
                <option value="USD">دولار أمريكي ($)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#6B7F67] mb-1.5">العنوان</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[#6B7F67] mb-1.5">نص التذييل في الفواتير وكشوفات الحساب</label>
            <input
              type="text"
              value={invoiceFooter}
              onChange={(e) => setInvoiceFooter(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>
          <PrimaryButton type="submit" className="w-full sm:w-auto">
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
            className="flex-1 min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
          />
          <PrimaryButton onClick={handleAddBranch}>إضافة</PrimaryButton>
        </div>
        <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E]">
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

export const SettingsView: React.FC = () => {
  const { org, darkMode, toggleDarkMode, setLocked, navigate, refreshData, showToast } = useQatshi();
  const { isInstalled } = usePWAInstall();

  if (!org) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <PageHeader
        title="إعدادات التطبيق"
        subtitle="المظهر، تثبيت التطبيق على الهاتف، وقفل الشاشة"
        backAction={() => navigate('dashboard')}
      />

      <SurfaceCard className="space-y-4">
        <div className="flex items-center justify-between gap-3 py-1">
          <div>
            <div className="font-semibold text-sm">المظهر الليلي</div>
            <div className="text-xs text-[#6B7F67]">مريح للعين في الإضاءة المنخفضة</div>
          </div>
          <PrimaryButton variant="secondary" onClick={toggleDarkMode}>
            {darkMode ? 'الوضع الفاتح' : 'الوضع الليلي'}
          </PrimaryButton>
        </div>

        <div className="flex items-center justify-between gap-3 py-3 border-t border-[#C7CBB8]/40 dark:border-[#243B2E]">
          <div>
            <div className="font-semibold text-sm">تثبيت قاتشي على الهاتف</div>
            <div className="text-xs text-[#6B7F67]">
              {isInstalled
                ? 'التطبيق مثبّت ويعمل كتطبيق مستقل على جهازك'
                : 'تثبيت على الشاشة الرئيسية للعمل السريع دون إنترنت'}
            </div>
          </div>
          {!isInstalled && (
            <PrimaryButton
              onClick={() => window.dispatchEvent(new CustomEvent('qatshi:open-install-sheet'))}
            >
              <Smartphone className="h-4 w-4" />
              تثبيت التطبيق
            </PrimaryButton>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 py-3 border-t border-[#C7CBB8]/40 dark:border-[#243B2E]">
          <div>
            <div className="font-semibold text-sm">قفل الجلسة يدوياً</div>
            <div className="text-xs text-[#6B7F67]">العودة لشاشة الدخول وتبديل الموظفين</div>
          </div>
          <PrimaryButton
            variant="secondary"
            onClick={() => {
              setLocked(true);
              navigate('login');
            }}
          >
            <Lock className="h-4 w-4" />
            قفل الشاشة
          </PrimaryButton>
        </div>

        <div className="pt-3 border-t border-[#C7CBB8]/40 dark:border-[#243B2E]">
          <label htmlFor="auto-lock" className="block text-sm font-semibold mb-1.5">
            القفل التلقائي عند عدم الاستخدام
          </label>
          <select
            id="auto-lock"
            value={org.autoLockMinutes}
            onChange={async (e) => {
              await db.organizations.put({ ...org, autoLockMinutes: Number(e.target.value) });
              await refreshData();
              showToast('تم حفظ مدة القفل التلقائي');
            }}
            className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
          >
            <option value={0}>معطل</option>
            <option value={5}>بعد 5 دقائق</option>
            <option value={15}>بعد 15 دقيقة</option>
            <option value={30}>بعد 30 دقيقة</option>
          </select>
        </div>
      </SurfaceCard>
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
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="النسخ الاحتياطي والاستعادة"
        subtitle="حفظ آمن ومشفر لبيانات محلك وإمكانية استعادتها في أي وقت"
        backAction={() => navigate('dashboard')}
      />

      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-[#EFF1EA] dark:bg-[#0B1610] border border-[#C7CBB8]/50 dark:border-[#243B2E]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`min-h-[44px] px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
              activeTab === t.id
                ? 'bg-[#0F1F17] text-white dark:bg-[#3E5A3F] shadow-xs'
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
            <label htmlFor="backup-pass" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
              كلمة مرور حماية النسخة (اختياري)
            </label>
            <input
              id="backup-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="اتركه فارغاً للحفظ بدون كلمة مرور"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <PrimaryButton onClick={() => handleExportLocal(false)} className="w-full sm:flex-1">
              <Download className="h-4 w-4" />
              حفظ نسخة على الهاتف
            </PrimaryButton>
            <PrimaryButton variant="secondary" onClick={() => handleExportLocal(true)} className="w-full sm:w-auto">
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
            <label htmlFor="restore-pass" className="block text-xs font-medium text-[#6B7F67] mb-1.5">
              كلمة مرور النسخة (إن وُجدت)
            </label>
            <input
              id="restore-pass"
              type="password"
              value={restorePass}
              onChange={(e) => setRestorePass(e.target.value)}
              placeholder="أدخل كلمة المرور لفك الحماية"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>

          <label className="flex items-center gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={allowCrossOrg}
              onChange={(e) => setAllowCrossOrg(e.target.checked)}
              className="h-4 w-4 accent-[#1E3A2E]"
            />
            السماح بالاستعادة حتى لو كانت النسخة لمحل آخر مسجل على التطبيق
          </label>

          <label className="w-full sm:w-auto min-h-[48px] px-5 py-3 rounded-2xl bg-[#0F1F17] dark:bg-[#3E5A3F] text-white text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer">
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
            <p className="text-sm text-[#6B7F67] py-6 text-center">لم يتم إنشاء أي نسخة احتياطية بعد.</p>
          ) : (
            <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E]">
              {backupRecords.map((b) => (
                <div key={b.id} className="py-3 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-semibold text-sm">
                      {formatDateArabic(b.createdAt, org.dateFormat, true)}
                    </div>
                    <div className="text-[#6B7F67]">
                      {b.recordCount} سجل · {b.encrypted ? 'محمية بكلمة مرور' : 'نسخة قياسية'}
                    </div>
                  </div>
                  <span className="tabular-nums text-[#6B7F67] shrink-0">
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
        backAction={() => navigate('dashboard')}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
        <p className="text-xs text-[#6B7F67] leading-relaxed">
          تتحقق هذه الأدوات من تطابق أرصدة العملاء مع القيود المسجلة دون حذف أي عملية مالية فعلية.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <PrimaryButton onClick={handleAudit}>
            <ShieldCheck className="h-4 w-4" />
            فحص ومطابقة الأرصدة
          </PrimaryButton>
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

        {auditResult && (
          <div className="p-3.5 rounded-2xl bg-[#EFF1EA] dark:bg-[#1E3A2E] text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#1E3A2E] dark:text-[#8FB98D] shrink-0" />
            <span>{auditResult}</span>
          </div>
        )}

        {demoAudit && (
          <div className="p-3.5 rounded-2xl border border-[#C7CBB8]/60 dark:border-[#243B2E] text-xs space-y-1.5">
            <div className="font-semibold">
              حالة البيانات:{' '}
              {demoAudit.hasDemoOrg || Object.values(demoAudit.provenDemoCounts).some((n) => n > 0)
                ? 'تم رصد سجلات تجريبية سابقة'
                : 'سليمة 100% — جميع السجلات حقيقية'}
            </div>
            <div className="text-[#6B7F67]">
              المؤسسات: {demoAudit.realDataCounts.organizations} · العملاء: {demoAudit.realDataCounts.customers}
            </div>
          </div>
        )}

        <div className="text-xs text-[#6B7F67] space-y-1 pt-1">
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
        backAction={() => navigate('dashboard')}
        action={
          <PrimaryButton onClick={handleSyncNow} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'جاري المزامنة...' : 'مزامنة الآن'}
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-3 gap-3">
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
          <p className="text-sm text-[#6B7F67] py-4 text-center">لا توجد عمليات مسجلة بعد.</p>
        ) : (
          <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E] max-h-80 overflow-y-auto">
            {syncOps.slice(0, 40).map((op) => (
              <div key={op.id} className="py-3 flex justify-between items-center gap-2 text-xs">
                <div>
                  <span className="font-semibold">{formatSyncEntityArabic(op.entityType)}</span>
                  <span className="text-[#6B7F67] mr-2">· {formatSyncActionArabic(op.action)}</span>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-lg font-medium ${
                    op.status === 'synced'
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : op.status === 'conflict'
                      ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300'
                      : 'bg-[#EFF1EA] text-[#3D4337] dark:bg-[#1E3A2E] dark:text-[#C7CBB8]'
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
        backAction={() => navigate('dashboard')}
        action={
          <PrimaryButton onClick={() => navigate('setup')}>
            <Plus className="h-4 w-4" />
            تأسيس محل جديد
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiMetric
          label="الباقة الحالية"
          value={formatPlanArabic(org.subscriptionPlan)}
          meta={`الحالة: ${formatSubscriptionStatusArabic(org.subscriptionStatus)}`}
        />
        <KpiMetric label="الموظفون المسموحون" value={`${users.length} / ${org.maxUsers}`} />
        <KpiMetric label="صلاحية الباقة حتى" value={formatDateArabic(org.subscriptionExpiry, org.dateFormat)} />
      </div>

      <SurfaceCard className="space-y-3">
        <h2 className="font-display text-base font-bold">المحلات المسجلة على هذا الجهاز</h2>
        <div className="divide-y divide-[#C7CBB8]/40 dark:divide-[#243B2E]">
          {allOrgs.map((o) => (
            <div key={o.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">
                  {o.name} {o.id === org.id ? ' (النشط حالياً)' : ''}
                </div>
                <div className="text-xs text-[#6B7F67]">
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { id: 'starter', title: 'الباقة الأساسية (محل واحد)', users: 3, devices: 2 },
            { id: 'pro', title: 'الباقة الاحترافية (متعدد الموظفين)', users: 10, devices: 5 },
            { id: 'enterprise', title: 'باقة المؤسسات والفروع', users: 50, devices: 20 },
          ].map((plan) => (
            <div key={plan.id} className="p-4 rounded-2xl border border-[#C7CBB8]/70 dark:border-[#243B2E] space-y-2.5">
              <div className="font-display font-bold text-sm">{plan.title}</div>
              <div className="text-xs text-[#6B7F67]">حتى {plan.users} موظفين · {plan.devices} أجهزة</div>
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
                className="w-full"
              >
                {org.subscriptionPlan === plan.id ? 'الباقة الحالية' : 'تفعيل الباقة'}
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
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="المساعدة والدعم"
        subtitle="دليل التشغيل اليومي والقواعد المحاسبية في قاتشي"
        backAction={() => navigate('dashboard')}
      />

      <SurfaceCard className="space-y-4 text-sm leading-relaxed text-[#3D4337] dark:text-[#C7CBB8]">
        <div>
          <h2 className="font-display font-bold text-base text-[#0F1F17] dark:text-[#E8EAE0]">
            1. العمل دون إنترنت
          </h2>
          <p className="mt-1">
            تُحفظ كافة الفواتير والعملاء وسندات القبض والمصروفات في ذاكرة الهاتف الآمنة مباشرة، ويمكنك إصدار كشوفات الحساب ومشاركتها في أي وقت.
          </p>
        </div>
        <div>
          <h2 className="font-display font-bold text-base text-[#0F1F17] dark:text-[#E8EAE0]">
            2. الدقة المحاسبية وحفظ الحقوق
          </h2>
          <p className="mt-1">
            لا يتم حذف الفواتير أو السندات المعتمدة حفاظاً على دقة الحسابات. أي تصحيح يتم عبر قيد عكسي موثق من تفاصيل العملية.
          </p>
        </div>
        <div>
          <h2 className="font-display font-bold text-base text-[#0F1F17] dark:text-[#E8EAE0]">
            3. حماية بياناتك
          </h2>
          <p className="mt-1">
            نوصي بتنزيل نسخة احتياطية أسبوعياً من شاشة النسخ الاحتياطي والاحتفاظ بها في مكان آمن.
          </p>
        </div>
        <div className="pt-2 flex flex-wrap gap-2">
          <PrimaryButton onClick={() => navigate('backup')}>النسخ الاحتياطي</PrimaryButton>
          <PrimaryButton variant="secondary" onClick={() => navigate('maintenance')}>
            فحص سلامة الحسابات
          </PrimaryButton>
        </div>
      </SurfaceCard>
    </div>
  );
};

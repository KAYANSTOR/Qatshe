import React, { useState } from 'react';
import { db } from '../db/qatshiDb';
import { useQatshi } from '../context/QatshiContext';
import type { AppUser, CurrencyCode, Organization } from '../domain/types';
import { generateTenantSecret, generateUuid, hashPin, setMeta, verifyPin } from '../services/device';
import { buildDefaultTemplates } from '../services/seedService';
import { BrandLogo, PrimaryButton, SurfaceCard } from '../components/ui/LuxuryUI';
import emblemImg from '../assets/images/qatshi_brand_emblem_1794643391707.jpg';

export const SplashScreen: React.FC = () => {
  const { navigate } = useQatshi();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0F1F17] text-[#E8EAE0] p-6 text-center">
      <div className="h-24 w-24 rounded-3xl overflow-hidden border border-[#6B7F67]/40 shadow-2xl mb-6">
        <img src={emblemImg} alt="شعار قاتشي" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      </div>
      <h1 className="font-display text-3xl font-bold tracking-tight text-white">قاتشي</h1>
      <p className="mt-2 text-sm text-[#C7CBB8] max-w-sm">
        نظام إدارة محلات القات والحسابات الذكية — يعمل دون إنترنت بدقة محاسبية كاملة
      </p>
      <button
        type="button"
        onClick={() => navigate('dashboard')}
        className="mt-8 min-h-[48px] px-7 py-3 rounded-2xl bg-[#3E5A3F] text-white text-sm font-semibold hover:bg-[#4D6E4E] active:scale-[0.98] transition-all"
      >
        الدخول إلى النظام
      </button>
    </div>
  );
};

export const SetupWizardView: React.FC = () => {
  const { allOrgs, switchOrganization, navigate, showToast } = useQatshi();
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('YER');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopName.trim() || !ownerName.trim() || !phone.trim()) {
      showToast('يرجى إدخال اسم المحل واسم المالك ورقم الهاتف', 'error');
      return;
    }
    setSaving(true);
    try {
      const orgId = `org-${generateUuid().slice(0, 8)}`;
      const branchId = `branch-${generateUuid().slice(0, 8)}`;
      const ownerId = `user-${generateUuid().slice(0, 8)}`;
      const now = new Date().toISOString();

      const newOrg: Organization = {
        id: orgId,
        name: shopName.trim(),
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        whatsapp: '',
        address: address.trim() || 'الفرع الرئيسي',
        description: 'محل قات وخدمات عملاء',
        currency,
        currencyDecimals: currency === 'YER' ? 0 : 2,
        numberLocale: 'en-US',
        dateFormat: 'YYYY-MM-DD',
        invoiceHeader: shopName.trim(),
        invoiceFooter: 'شكراً لتعاملكم معنا',
        autoLockMinutes: 15,
        activeBranchId: branchId,
        branches: [{ id: branchId, name: 'الفرع الرئيسي', address: address.trim(), phone: phone.trim(), isMain: true }],
        subscriptionPlan: 'pro',
        subscriptionStatus: 'active',
        subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        maxUsers: 10,
        maxDevices: 5,
        orgAuthSecret: generateTenantSecret(),
        createdAt: now,
        updatedAt: now,
      };

      const ownerUser: AppUser = {
        id: ownerId,
        orgId,
        branchId,
        name: ownerName.trim(),
        role: 'owner',
        hasPin: pin.trim().length >= 4,
        pinHash: pin.trim().length >= 4 ? await hashPin(pin.trim(), ownerId) : undefined,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      await db.transaction('rw', [db.organizations, db.users, db.messageTemplates], async () => {
        await db.organizations.put(newOrg);
        await db.users.put(ownerUser);
        await db.messageTemplates.bulkPut(buildDefaultTemplates(orgId));
      });

      await setMeta('activeUserId', ownerId);
      await switchOrganization(orgId);
      showToast('تم تأسيس المحل بنجاح وفتح سجل حسابات نظيف');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر إنشاء المؤسسة', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-2 sm:py-4 space-y-4">
      <SurfaceCard>
        <div className="flex items-center justify-between gap-4 mb-5">
          <BrandLogo size="md" />
          {allOrgs.length > 0 && (
            <PrimaryButton variant="ghost" onClick={() => navigate('dashboard')}>
              إلغاء والعودة
            </PrimaryButton>
          )}
        </div>

        <h1 className="font-display text-2xl font-bold text-[#0F1F17] dark:text-[#E8EAE0]">
          تأسيس محل جديد
        </h1>
        <p className="mt-1 text-sm text-[#3D4337] dark:text-[#9AA896]">
          سجل حسابات خاص ومستقل بالكامل لإدارة مبيعاتك وعملائك وديونك.
        </p>

        <form onSubmit={handleCreate} className="mt-5 space-y-4">
          <div>
            <label htmlFor="setup-shop-name" className="block text-sm font-medium mb-1.5">
              اسم المحل أو المؤسسة *
            </label>
            <input
              id="setup-shop-name"
              type="text"
              required
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="مثال: محل النخبة للقات"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="setup-owner-name" className="block text-sm font-medium mb-1.5">
                اسم المالك *
              </label>
              <input
                id="setup-owner-name"
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="الاسم الكامل"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              />
            </div>

            <div>
              <label htmlFor="setup-phone" className="block text-sm font-medium mb-1.5">
                رقم الهاتف *
              </label>
              <input
                id="setup-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="777000000"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="setup-currency" className="block text-sm font-medium mb-1.5">
                العملة المعتمدة
              </label>
              <select
                id="setup-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
              >
                <option value="YER">ريال يمني (ر.ي)</option>
                <option value="SAR">ريال سعودي (ر.س)</option>
                <option value="USD">دولار أمريكي ($)</option>
              </select>
            </div>

            <div>
              <label htmlFor="setup-pin" className="block text-sm font-medium mb-1.5">
                رمز حماية (اختياري)
              </label>
              <input
                id="setup-pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4 أرقام لقفل الشاشة"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <label htmlFor="setup-address" className="block text-sm font-medium mb-1.5">
              العنوان (اختياري)
            </label>
            <input
              id="setup-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="المدينة — الشارع"
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            />
          </div>

          <PrimaryButton type="submit" disabled={saving} className="w-full">
            {saving ? 'جاري التأسيس...' : 'إنشاء المحل والبدء'}
          </PrimaryButton>
        </form>
      </SurfaceCard>

      <SurfaceCard className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-extrabold text-[#16281E] dark:text-[#EEF2EC]">
            هل تغيّر هاتفك أو لديك نسخة سابقة؟
          </div>
          <p className="text-[11px] text-[#657369] dark:text-[#98A89C] mt-0.5">
            اربط حساب Google نفسه لاستعادة جميع العملاء والمبيعات والديون فوراً.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('google_drive_backup')}
          className="min-h-[42px] px-3.5 rounded-[14px] bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#86C89B] text-xs font-bold shrink-0"
        >
          استعادة من Drive
        </button>
      </SurfaceCard>
    </div>
  );
};

export const PinLockView: React.FC = () => {
  const { users, activeUser, switchUser, org, navigate, setLocked, showToast } = useQatshi();
  const [selectedUserId, setSelectedUserId] = useState(activeUser?.id || users[0]?.id || '');
  const [pinInput, setPinInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const targetUser = users.find((u) => u.id === selectedUserId) || activeUser;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUser) return;
    setErrorMsg('');

    if (targetUser.hasPin && targetUser.pinHash) {
      const ok = await verifyPin(pinInput.trim(), targetUser.id, targetUser.pinHash);
      if (!ok) {
        setErrorMsg('رمز الحماية غير صحيح — يرجى التحقق والمحاولة مجدداً');
        return;
      }
    }
    await switchUser(targetUser);
    setLocked(false);
    setPinInput('');
    navigate('dashboard');
    showToast(`أهلاً بك ${targetUser.name}`);
  };

  const roleName = (r: string) =>
    r === 'owner' ? 'المالك' : r === 'manager' ? 'المدير' : r === 'accountant' ? 'المحاسب' : 'أمين الصندوق';

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <SurfaceCard className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center gap-3">
          <BrandLogo size="lg" showWordmark={false} />
          <div>
            <h1 className="font-display text-xl font-bold text-[#0F1F17] dark:text-[#E8EAE0]">
              {org?.name || 'قاتشي'}
            </h1>
            <p className="text-xs text-[#6B7F67]">تسجيل الدخول وتبديل الموظفين</p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="login-user-select" className="block text-sm font-medium mb-1.5">
              اختر الحساب
            </label>
            <select
              id="login-user-select"
              value={selectedUserId}
              onChange={(e) => {
                setSelectedUserId(e.target.value);
                setPinInput('');
                setErrorMsg('');
              }}
              className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm"
            >
              {users
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {roleName(u.role)}
                  </option>
                ))}
            </select>
          </div>

          {targetUser?.hasPin && (
            <div>
              <label htmlFor="login-pin" className="block text-sm font-medium mb-1.5">
                رمز الحماية
              </label>
              <input
                id="login-pin"
                type="password"
                inputMode="numeric"
                required
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="أدخل رمز الحماية"
                className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-sm tabular-nums tracking-widest"
              />
            </div>
          )}

          {errorMsg && <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>}

          <PrimaryButton type="submit" className="w-full">
            دخول وفتح الجلسة
          </PrimaryButton>
        </form>
      </SurfaceCard>
    </div>
  );
};

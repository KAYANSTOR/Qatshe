import React, { useState } from 'react';
import { BrandLogo, PrimaryButton, SurfaceCard } from '../components/ui/LuxuryUI';
import { loginWithPhone, normalizeNumericCode, normalizePhone, registerWithPhone } from '../services/authService';

export const AccountAuthView: React.FC<{ onAuthenticated: () => void }> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (mode === 'login') await loginWithPhone(phone, code);
      else await registerWithPhone({ phone, code, ownerName, projectName });
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إكمال العملية');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F1F17] px-4 py-8 text-[#E8EAE0]" dir="rtl">
      <div className="w-full max-w-md">
        <div className="text-center mb-5"><BrandLogo size="lg" /></div>
        <SurfaceCard>
          <div className="flex gap-2 p-1 rounded-2xl bg-[#EEF1E9] dark:bg-[#13251B] mb-6">
            {(['login', 'register'] as const).map((item) => (
              <button key={item} type="button" onClick={() => { setMode(item); setError(''); }} className={`flex-1 min-h-[44px] rounded-xl text-sm font-bold transition ${mode === item ? 'bg-[#3E5A3F] text-white shadow' : 'text-[#3D4337] dark:text-[#B8C4B3]'}`}>
                {item === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}
              </button>
            ))}
          </div>
          <h1 className="font-display text-2xl font-bold text-[#0F1F17] dark:text-[#E8EAE0]">{mode === 'login' ? 'مرحباً بعودتك' : 'أنشئ حساب قاتشي'}</h1>
          <p className="mt-1 text-sm text-[#687365] dark:text-[#9AA896]">استخدم رقم الهاتف ورمزًا رقميًا فقط لحماية حسابك.</p>
          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === 'register' && <>
              <div><label className="block text-sm font-medium mb-1.5">اسم المالك</label><input required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-[#0F1F17] dark:text-white" placeholder="الاسم الكامل" /></div>
              <div><label className="block text-sm font-medium mb-1.5">اسم المشروع</label><input required value={projectName} onChange={(e) => setProjectName(e.target.value)} className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-[#0F1F17] dark:text-white" placeholder="مثال: محل النخبة" /></div>
            </>}
            <div><label className="block text-sm font-medium mb-1.5">رقم الهاتف</label><input required type="tel" inputMode="numeric" dir="ltr" value={phone} onChange={(e) => setPhone(normalizePhone(e.target.value))} className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-[#0F1F17] dark:text-white tabular-nums" placeholder="777000000" /></div>
            <div><label className="block text-sm font-medium mb-1.5">الرمز الرقمي</label><input required type="password" inputMode="numeric" pattern="[0-9٠-٩]{4,8}" maxLength={8} dir="ltr" value={code} onChange={(e) => setCode(normalizeNumericCode(e.target.value))} className="w-full min-h-[48px] px-3.5 rounded-2xl border border-[#C7CBB8] dark:border-[#2C4235] bg-[#F9FAF7] dark:bg-[#0B1610] text-[#0F1F17] dark:text-white tracking-[0.35em] tabular-nums" placeholder="••••" /></div>
            {error && <div role="alert" className="rounded-2xl bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 px-4 py-3 text-sm">{error}</div>}
            <PrimaryButton type="submit" className="w-full justify-center" disabled={saving}>{saving ? 'جارٍ التحقق...' : mode === 'login' ? 'دخول آمن' : 'إنشاء الحساب'}</PrimaryButton>
          </form>
        </SurfaceCard>
        <p className="text-center text-xs text-[#A8B3A4] mt-4">بياناتك معزولة عن بقية المؤسسات ومشفرة أثناء النقل.</p>
      </div>
    </div>
  );
};

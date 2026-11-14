import React, { useState } from 'react';
import {
  Database,
  Eye,
  EyeOff,
  Lock,
  Moon,
  Phone,
  ShieldCheck,
  Store,
  Sun,
  User,
} from 'lucide-react';
import { BrandLogo, HeaderCircleButton, PrimaryButton, SurfaceCard } from '../components/ui/LuxuryUI';
import {
  loginWithPhone,
  normalizeNumericCode,
  normalizePhone,
  registerWithPhone,
  type AuthUser,
} from '../services/authService';

export const AccountAuthView: React.FC<{
  onAuthenticated: (user: AuthUser) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}> = ({ onAuthenticated, darkMode, onToggleDarkMode }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const cleanPhone = normalizePhone(phone);
    const cleanCode = normalizeNumericCode(code);
    if (!/^\d{7,15}$/.test(cleanPhone)) {
      setError('رقم الهاتف يجب أن يتكون من 7 إلى 15 رقمًا');
      return;
    }
    if (!/^\d{4,8}$/.test(cleanCode)) {
      setError('الرمز السري يجب أن يكون من 4 إلى 8 أرقام فقط');
      return;
    }

    setSaving(true);
    try {
      const user =
        mode === 'login'
          ? await loginWithPhone(cleanPhone, cleanCode)
          : await registerWithPhone({
              phone: cleanPhone,
              code: cleanCode,
              ownerName,
              projectName,
            });
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إكمال العملية');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-[#F7F5EE] dark:bg-[#0B1710] text-[#16281E] dark:text-[#EEF2EC] transition-colors flex flex-col justify-center py-6 px-4"
    >
      <div className="w-full max-w-[480px] mx-auto space-y-4">
        {/* Top Brand Row matching AppShell Header */}
        <div className="flex items-center justify-between gap-3 px-1">
          <BrandLogo size="md" showWordmark />
          <HeaderCircleButton
            label={darkMode ? 'تفعيل المظهر الفاتح' : 'تفعيل المظهر الليلي'}
            onClick={onToggleDarkMode}
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </HeaderCircleButton>
        </div>

        {/* Hero Forest Emerald Banner matching QATSHI Identity */}
        <SurfaceCard className="!p-0 overflow-hidden">
          <div className="p-5 bg-gradient-to-l from-[#183526] to-[#234A36] text-white space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#F5D68E]">
                <Database className="h-3.5 w-3.5 shrink-0" />
                حساب سحابي مستقل للمشروع والعملاء
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/15 border border-white/20 text-[#EEF6F0] whitespace-nowrap shrink-0">
                أرقام فقط
              </span>
            </div>
            <h1 className="font-display text-xl font-extrabold leading-snug">
              {mode === 'login' ? 'تسجيل الدخول إلى مشروعك' : 'إنشاء حساب ومشروع جديد'}
            </h1>
            <p className="text-xs text-[#C8DACD] leading-relaxed">
              {mode === 'login'
                ? 'أدخل رقم الهاتف والرمز الرقمي للوصول الفوري إلى حساب محلك وقاعدة بيانات العملاء.'
                : 'سجّل برقم الهاتف ورمز أرقام فقط لتأسيس مشروعك وربط قاعدة بيانات العملاء تلقائياً.'}
            </p>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* Segmented Mode Switch */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-[16px] bg-[#EFECE3] dark:bg-[#0D1A13] border border-[#E2DDD0] dark:border-[#21362A]">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className={`min-h-[44px] rounded-[12px] text-xs font-extrabold transition-all text-center cursor-pointer ${
                  mode === 'login'
                    ? 'bg-[#1E4230] text-white shadow-xs dark:bg-[#2F6A4A]'
                    : 'text-[#5A6A5F] dark:text-[#98A89C] hover:text-[#16281E]'
                }`}
              >
                تسجيل الدخول
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
                className={`min-h-[44px] rounded-[12px] text-xs font-extrabold transition-all text-center cursor-pointer ${
                  mode === 'register'
                    ? 'bg-[#1E4230] text-white shadow-xs dark:bg-[#2F6A4A]'
                    : 'text-[#5A6A5F] dark:text-[#98A89C] hover:text-[#16281E]'
                }`}
              >
                إنشاء حساب جديد
              </button>
            </div>

            <form onSubmit={submit} className="space-y-3.5" noValidate>
              {mode === 'register' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="auth-owner-name"
                      className="block text-xs font-bold text-[#46564B] dark:text-[#B4C4B8] mb-1.5"
                    >
                      اسم المالك *
                    </label>
                    <div className="relative">
                      <User className="h-4 w-4 text-[#7A877D] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="auth-owner-name"
                        type="text"
                        required
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        placeholder="الاسم الكامل"
                        className="w-full min-h-[48px] pr-10 pl-3.5 rounded-[14px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm text-[#16281E] dark:text-white placeholder:text-[#8B978E]"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="auth-project-name"
                      className="block text-xs font-bold text-[#46564B] dark:text-[#B4C4B8] mb-1.5"
                    >
                      اسم المشروع / المحل *
                    </label>
                    <div className="relative">
                      <Store className="h-4 w-4 text-[#7A877D] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="auth-project-name"
                        type="text"
                        required
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="مثال: محل النخبة"
                        className="w-full min-h-[48px] pr-10 pl-3.5 rounded-[14px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm text-[#16281E] dark:text-white placeholder:text-[#8B978E]"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-phone"
                  className="block text-xs font-bold text-[#46564B] dark:text-[#B4C4B8] mb-1.5"
                >
                  رقم الهاتف *
                </label>
                <div className="relative">
                  <Phone className="h-4 w-4 text-[#7A877D] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    dir="ltr"
                    required
                    value={phone}
                    onChange={(e) => setPhone(normalizePhone(e.target.value))}
                    placeholder="777000000"
                    className="w-full min-h-[48px] pr-10 pl-3.5 rounded-[14px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm text-[#16281E] dark:text-white tabular-nums text-left placeholder:text-[#8B978E]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="auth-code"
                    className="block text-xs font-bold text-[#46564B] dark:text-[#B4C4B8]"
                  >
                    الرمز الرقمي (4 إلى 8 أرقام) *
                  </label>
                  <span className="text-[11px] text-[#7A877D] dark:text-[#8CA092]">أرقام فقط</span>
                </div>
                <div className="relative">
                  <Lock className="h-4 w-4 text-[#7A877D] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-code"
                    type={showCode ? 'text' : 'password'}
                    inputMode="numeric"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    maxLength={8}
                    dir="ltr"
                    required
                    value={code}
                    onChange={(e) => setCode(normalizeNumericCode(e.target.value))}
                    placeholder="••••"
                    className="w-full min-h-[48px] pr-10 pl-11 rounded-[14px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm text-[#16281E] dark:text-white tracking-[0.35em] tabular-nums text-left placeholder:text-[#8B978E]"
                  />
                  <button
                    type="button"
                    aria-label={showCode ? 'إخفاء الرمز' : 'إظهار الرمز'}
                    onClick={() => setShowCode((v) => !v)}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 h-8 w-8 inline-flex items-center justify-center rounded-xl text-[#657369] dark:text-[#98A89C] hover:bg-[#EFECE3] dark:hover:bg-[#193325] cursor-pointer"
                  >
                    {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-[14px] bg-[#FCECE9] dark:bg-[#3A1915] border border-[#F5CEC7] dark:border-[#5D2922] text-[#B93829] dark:text-[#F49387] px-3.5 py-2.5 text-xs font-bold leading-relaxed"
                >
                  {error}
                </div>
              )}

              <PrimaryButton type="submit" className="w-full" disabled={saving}>
                {saving
                  ? 'جارٍ التحقق...'
                  : mode === 'login'
                  ? 'دخول آمن إلى المشروع'
                  : 'إنشاء الحساب وقاعدة العملاء'}
              </PrimaryButton>
            </form>
          </div>
        </SurfaceCard>

        {/* Security Assurance Footer */}
        <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-[14px] bg-[#EFECE3]/80 dark:bg-[#12231A] border border-[#E2DDD0] dark:border-[#21362A] text-[11px] text-[#5C6B60] dark:text-[#98A89C]">
          <ShieldCheck className="h-4 w-4 text-[#1E4230] dark:text-[#86C89B] shrink-0" />
          <span>بيانات كل مشروع وعملائه معزولة بالكامل ومحمية بجلسات مشفرة</span>
        </div>
      </div>
    </div>
  );
};

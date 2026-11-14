import React, { useEffect } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { CurrencyCode } from '../../domain/types';
import { formatMoney } from '../../domain/money';
import emblemImg from '../../assets/images/qatshi_brand_emblem_1794643391707.jpg';

export const BrandLogo: React.FC<{ size?: 'sm' | 'md' | 'lg'; showWordmark?: boolean }> = ({
  size = 'md',
  showWordmark = true,
}) => {
  const dim = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-16 w-16' : 'h-10 w-10';
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className={`${dim} rounded-2xl overflow-hidden bg-[#0F1F17] border border-[#3E5A3F]/40 shrink-0 shadow-xs`}>
        <img
          src={emblemImg}
          alt="شعار قاتشي"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      </div>
      {showWordmark && (
        <div className="leading-tight whitespace-nowrap">
          <div className="font-display text-base font-bold tracking-tight text-[#0F1F17] dark:text-[#E8EAE0]">
            قاتشي
          </div>
          <div className="text-[11px] font-medium text-[#6B7F67] dark:text-[#9AA896]">
            إدارة المحل والحسابات
          </div>
        </div>
      )}
    </div>
  );
};

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  backAction?: () => void;
}> = ({ title, subtitle, action, backAction }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#C7CBB8]/55 dark:border-[#243B2E]">
    <div className="flex items-center gap-3 min-w-0 flex-1">
      {backAction && (
        <button
          type="button"
          onClick={backAction}
          aria-label="رجوع"
          className="min-h-[48px] min-w-[48px] inline-flex items-center justify-center rounded-2xl border border-[#C7CBB8]/80 dark:border-[#2C4235] bg-white dark:bg-[#12241B] text-[#0F1F17] dark:text-[#E8EAE0] hover:bg-[#F4F5F0] dark:hover:bg-[#1E3A2E] active:scale-[0.97] transition-transform shrink-0"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-[#0F1F17] dark:text-[#E8EAE0] truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-xs sm:text-sm text-[#3D4337] dark:text-[#9AA896] line-clamp-2">
            {subtitle}
          </p>
        )}
      </div>
    </div>
    {action && <div className="flex flex-wrap items-center gap-2 shrink-0">{action}</div>}
  </div>
);

export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <section
    className={`rounded-3xl bg-white dark:bg-[#12241B] border border-[#C7CBB8]/60 dark:border-[#243B2E] p-4 sm:p-6 shadow-[0_1px_2px_rgba(15,31,23,0.04)] ${className}`}
  >
    {children}
  </section>
);

export const KpiMetric: React.FC<{
  label: string;
  value: string;
  meta?: string;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
  onClick?: () => void;
}> = ({ label, value, meta, tone = 'default', onClick }) => {
  const valueColor =
    tone === 'danger'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'warning'
      ? 'text-amber-700 dark:text-amber-400'
      : tone === 'positive'
      ? 'text-[#1E3A2E] dark:text-[#8FB98D]'
      : 'text-[#0F1F17] dark:text-[#E8EAE0]';

  const content = (
    <div className="flex flex-col justify-between gap-1.5 text-right h-full">
      <span className="text-xs font-medium text-[#3D4337] dark:text-[#9AA896]">{label}</span>
      <span className={`font-display text-lg sm:text-2xl font-bold tabular-nums leading-snug ${valueColor}`}>
        {value}
      </span>
      {meta && (
        <span className="text-[11px] sm:text-xs text-[#6B7F67] dark:text-[#8FA38A] tabular-nums line-clamp-1">
          {meta}
        </span>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full min-h-[88px] text-right rounded-2xl sm:rounded-3xl bg-white dark:bg-[#12241B] border border-[#C7CBB8]/65 dark:border-[#243B2E] p-4 hover:border-[#3E5A3F] dark:hover:border-[#6B7F67] active:scale-[0.985] transition-all focus-visible:outline-2 focus-visible:outline-[#3E5A3F]"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-2xl sm:rounded-3xl bg-white dark:bg-[#12241B] border border-[#C7CBB8]/65 dark:border-[#243B2E] p-4">
      {content}
    </div>
  );
};

export const EmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="rounded-3xl border border-dashed border-[#C7CBB8] dark:border-[#2C4235] bg-white/60 dark:bg-[#12241B]/50 p-7 sm:p-9 text-center">
    <h3 className="font-display text-base font-semibold text-[#0F1F17] dark:text-[#E8EAE0]">
      {title}
    </h3>
    <p className="mt-1.5 text-sm text-[#3D4337] dark:text-[#9AA896] max-w-md mx-auto leading-relaxed">
      {description}
    </p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-5 min-h-[48px] px-6 py-2.5 rounded-2xl bg-[#0F1F17] dark:bg-[#3E5A3F] text-white text-sm font-medium hover:bg-[#1E3A2E] active:scale-[0.98] transition-all whitespace-nowrap"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export const PrimaryButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }
> = ({ variant = 'primary', className = '', children, ...rest }) => {
  const styles =
    variant === 'primary'
      ? 'bg-[#0F1F17] hover:bg-[#1E3A2E] text-white dark:bg-[#3E5A3F] dark:hover:bg-[#4D6E4E] shadow-xs'
      : variant === 'secondary'
      ? 'bg-[#E9ECE2] hover:bg-[#DCE0D2] text-[#0F1F17] dark:bg-[#1E3A2E] dark:hover:bg-[#274B3C] dark:text-[#E8EAE0]'
      : variant === 'danger'
      ? 'bg-red-700 hover:bg-red-800 text-white'
      : 'bg-transparent hover:bg-[#E9ECE2]/70 dark:hover:bg-[#1E3A2E]/60 text-[#0F1F17] dark:text-[#E8EAE0]';

  return (
    <button
      {...rest}
      className={`min-h-[46px] px-4 py-2.5 rounded-2xl text-sm font-medium inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#3E5A3F] ${styles} ${className}`}
    >
      {children}
    </button>
  );
};

export const MoneyText: React.FC<{
  amount: number;
  currency?: CurrencyCode;
  decimals?: number;
  locale?: 'ar-YE' | 'en-US';
  className?: string;
}> = ({ amount, currency = 'YER', decimals = 0, locale = 'en-US', className = '' }) => (
  <span className={`tabular-nums font-medium ${className}`}>
    {formatMoney(amount, currency, decimals, locale)}
  </span>
);

export const StepProgress: React.FC<{
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
}> = ({ currentStep, totalSteps, stepTitle }) => (
  <div className="rounded-2xl bg-white dark:bg-[#12241B] border border-[#C7CBB8]/60 dark:border-[#243B2E] p-3.5 sm:p-4 space-y-2.5">
    <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
      <span className="font-display font-bold text-[#0F1F17] dark:text-[#E8EAE0]">
        {stepTitle}
      </span>
      <span className="text-xs font-medium text-[#6B7F67] dark:text-[#9AA896] tabular-nums shrink-0">
        الخطوة {currentStep} من {totalSteps}
      </span>
    </div>
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))` }}>
      {Array.from({ length: totalSteps }).map((_, idx) => {
        const active = idx + 1 <= currentStep;
        return (
          <div
            key={idx}
            className={`h-1.5 rounded-full transition-colors ${
              active ? 'bg-[#1E3A2E] dark:bg-[#8FB98D]' : 'bg-[#E5E8DD] dark:bg-[#1E3A2E]/40'
            }`}
          />
        );
      })}
    </div>
  </div>
);

export const BottomSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ open, onClose, title, subtitle, children, footer }) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center no-print"
    >
      <div
        className="fixed inset-0 bg-black/55 backdrop-blur-xs"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-[#12241B] border-t sm:border border-[#C7CBB8]/70 dark:border-[#243B2E] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88vh] flex flex-col animate-sheet-up">
        {/* Android Grab Handle */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-[#C7CBB8] dark:bg-[#2C4235]" />
        </div>

        <div className="px-5 py-3.5 border-b border-[#C7CBB8]/45 dark:border-[#243B2E] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-display text-base sm:text-lg font-bold text-[#0F1F17] dark:text-[#E8EAE0] truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-[#6B7F67] dark:text-[#9AA896] truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-2xl hover:bg-[#EFF1EA] dark:hover:bg-[#1E3A2E] text-[#3D4337] dark:text-[#C7CBB8] shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-[#C7CBB8]/45 dark:border-[#243B2E] bg-[#F9FAF7] dark:bg-[#0F1F17] pb-safe rounded-b-none sm:rounded-b-3xl shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

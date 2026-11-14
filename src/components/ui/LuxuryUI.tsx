import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X } from 'lucide-react';
import type { CurrencyCode } from '../../domain/types';
import { formatMoney } from '../../domain/money';
import emblemImg from '../../assets/images/qatshi_brand_emblem_1794643391707.jpg';

export const BrandLogo: React.FC<{ size?: 'sm' | 'md' | 'lg'; showWordmark?: boolean }> = ({
  size = 'md',
  showWordmark = true,
}) => {
  const dim = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-14 w-14' : 'h-11 w-11';
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div
        className={`${dim} rounded-2xl overflow-hidden bg-[#183526] border border-[#C69E57]/35 shrink-0 shadow-xs`}
      >
        <img
          src={emblemImg}
          alt="شعار قاتشي"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      </div>
      {showWordmark && (
        <div className="leading-tight whitespace-nowrap">
          <div className="font-display text-base font-extrabold tracking-tight text-[#16281E] dark:text-[#EEF2EC]">
            قاتشي
          </div>
          <div className="text-[11px] font-medium text-[#617065] dark:text-[#98A89C]">
            نظام الحسابات الذكي
          </div>
        </div>
      )}
    </div>
  );
};

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  backAction?: () => void;
}> = ({ title, subtitle, icon, action, backAction }) => (
  <header className="flex items-center justify-between gap-2.5 pb-3 pt-1 border-b border-[#E5E0D4] dark:border-[#21362A]">
    {/* RTL Start (Right): Section icon inside tinted square + title + 1-line subtitle */}
    <div className="flex items-center gap-3 min-w-0 flex-1">
      {icon && (
        <div className="h-11 w-11 rounded-[14px] bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#8FC59B] border border-[#D4E0D6] dark:border-[#284C38] flex items-center justify-center shrink-0">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-base sm:text-lg font-extrabold text-[#16281E] dark:text-[#EEF2EC] line-clamp-2 leading-snug">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-[#657369] dark:text-[#9AA99E] truncate mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
    </div>

    {/* RTL End (Left): Circular action buttons & optional back button */}
    <div className="flex items-center gap-1.5 shrink-0">
      {action}
      {backAction && (
        <button
          type="button"
          onClick={backAction}
          aria-label="رجوع"
          className="h-10 w-10 inline-flex items-center justify-center rounded-full border border-[#E2DDD0] dark:border-[#274032] bg-white dark:bg-[#12231A] text-[#16281E] dark:text-[#EEF2EC] hover:bg-[#EFECE4] dark:hover:bg-[#1B3326] active:scale-[0.95] transition-transform shrink-0 shadow-2xs"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  </header>
);

export const HeaderCircleButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
> = ({ label, className = '', children, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...rest}
    className={`h-10 w-10 inline-flex items-center justify-center rounded-full border border-[#E2DDD0] dark:border-[#274032] bg-white dark:bg-[#12231A] text-[#1E4230] dark:text-[#C5D8CA] hover:bg-[#EFECE4] dark:hover:bg-[#1B3326] active:scale-[0.95] transition-transform shrink-0 shadow-2xs ${className}`}
  >
    {children}
  </button>
);

export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <section
    className={`rounded-[20px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] p-4 shadow-[0_2px_10px_rgba(22,40,30,0.04)] ${className}`}
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
      ? 'text-[#B93829] dark:text-[#F07D70]'
      : tone === 'warning'
      ? 'text-[#9E6A14] dark:text-[#EBB354]'
      : tone === 'positive'
      ? 'text-[#1E5638] dark:text-[#86C89B]'
      : 'text-[#16281E] dark:text-[#EEF2EC]';

  const content = (
    <div className="flex flex-col justify-between gap-1 text-right h-full min-w-0">
      <span className="text-[11px] font-medium text-[#657369] dark:text-[#98A89C] truncate">
        {label}
      </span>
      <span
        className={`font-display text-base sm:text-lg font-extrabold tabular-nums leading-snug truncate ${valueColor}`}
      >
        {value}
      </span>
      {meta && (
        <span className="text-[11px] text-[#7A877D] dark:text-[#88988C] tabular-nums truncate">
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
        className="w-full min-h-[82px] text-right rounded-[18px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] p-3.5 hover:border-[#2E6046] dark:hover:border-[#5D9B76] active:scale-[0.985] transition-all focus-visible:outline-2 focus-visible:outline-[#2E6046]"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-[18px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] p-3.5">
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
  <div className="rounded-[20px] border border-dashed border-[#D6CFC0] dark:border-[#294234] bg-white/70 dark:bg-[#12231A]/60 p-6 text-center">
    <h3 className="font-display text-base font-bold text-[#16281E] dark:text-[#EEF2EC]">
      {title}
    </h3>
    <p className="mt-1.5 text-xs sm:text-sm text-[#617065] dark:text-[#9AA99E] max-w-sm mx-auto leading-relaxed">
      {description}
    </p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-4 min-h-[46px] px-5 py-2.5 rounded-2xl bg-[#1E4230] dark:bg-[#2E6046] text-white text-sm font-bold hover:bg-[#163022] active:scale-[0.98] transition-all whitespace-nowrap"
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
      ? 'bg-[#1E4230] hover:bg-[#163022] text-white dark:bg-[#2E6046] dark:hover:bg-[#3A7557] shadow-xs'
      : variant === 'secondary'
      ? 'bg-[#EFECE4] hover:bg-[#E4DFD4] text-[#16281E] dark:bg-[#1B3326] dark:hover:bg-[#244333] dark:text-[#EEF2EC]'
      : variant === 'danger'
      ? 'bg-[#B93829] hover:bg-[#9D2D20] text-white'
      : 'bg-transparent hover:bg-[#EFECE4]/80 dark:hover:bg-[#1B3326]/60 text-[#16281E] dark:text-[#EEF2EC]';

  return (
    <button
      {...rest}
      className={`min-h-[46px] px-4 py-2.5 rounded-[16px] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#2E6046] ${styles} ${className}`}
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
  <span className={`tabular-nums font-bold ${className}`}>
    {formatMoney(amount, currency, decimals, locale)}
  </span>
);

export const StepProgress: React.FC<{
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
}> = ({ currentStep, totalSteps, stepTitle }) => (
  <div className="rounded-[18px] bg-white dark:bg-[#12231A] border border-[#E6E1D5] dark:border-[#22382B] p-3.5 space-y-2.5">
    <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
      <span className="font-display font-bold text-[#16281E] dark:text-[#EEF2EC]">
        {stepTitle}
      </span>
      <span className="text-xs font-medium text-[#657369] dark:text-[#98A89C] tabular-nums shrink-0">
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
              active ? 'bg-[#1E4230] dark:bg-[#86C89B]' : 'bg-[#EAE6DC] dark:bg-[#1B3326]'
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
  headerIcon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ open, onClose, title, subtitle, headerIcon, children, footer }) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-end justify-center no-print"
    >
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[480px] bg-white dark:bg-[#12231A] border-t border-x border-[#E2DDD0] dark:border-[#22382B] rounded-t-[26px] shadow-2xl max-h-[90vh] flex flex-col animate-sheet-up">
        {/* Drag Handle */}
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-11 h-1.5 rounded-full bg-[#D7D1C4] dark:bg-[#2B4637]" />
        </div>

        <div className="px-4 py-3 border-b border-[#EFEBE2] dark:border-[#203529] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {headerIcon && (
              <div className="h-10 w-10 rounded-[13px] bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#86C89B] flex items-center justify-center shrink-0">
                {headerIcon}
              </div>
            )}
            <div className="min-w-0 flex-1 text-right">
              <h3 className="font-display text-base font-extrabold text-[#16281E] dark:text-[#EEF2EC] truncate">
                {title}
              </h3>
              {subtitle && (
                <p className="text-xs text-[#657369] dark:text-[#98A89C] truncate">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-[#F5F2EA] dark:bg-[#193325] text-[#4C5850] dark:text-[#C5D8CA] hover:bg-[#EAE5D9] shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {children}
        </div>

        {footer && (
          <div className="px-4 py-3 border-t border-[#EFEBE2] dark:border-[#203529] bg-[#FAF8F4] dark:bg-[#0D1A13] pb-safe shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

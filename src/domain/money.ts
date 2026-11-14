import type { CurrencyCode } from './types';

export function toMinorUnits(amount: number, decimals: number): number {
  if (!Number.isFinite(amount)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(amount * factor);
}

export function fromMinorUnits(minor: number, decimals: number): number {
  if (!Number.isFinite(minor)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(minor) / factor;
}

export function roundMoney(amount: number, decimals = 0): number {
  return fromMinorUnits(toMinorUnits(amount, decimals), decimals);
}

export function addMoney(a: number, b: number, decimals = 0): number {
  return fromMinorUnits(toMinorUnits(a, decimals) + toMinorUnits(b, decimals), decimals);
}

export function subMoney(a: number, b: number, decimals = 0): number {
  return fromMinorUnits(toMinorUnits(a, decimals) - toMinorUnits(b, decimals), decimals);
}

export function mulMoney(unitPrice: number, quantity: number, decimals = 0): number {
  if (!Number.isFinite(unitPrice) || !Number.isFinite(quantity)) return 0;
  const minorUnit = toMinorUnits(unitPrice, decimals);
  const scaled = Math.round(minorUnit * quantity);
  return fromMinorUnits(scaled, decimals);
}

export function currencyLabel(currency: CurrencyCode): string {
  switch (currency) {
    case 'YER':
      return 'ر.ي';
    case 'SAR':
      return 'ر.س';
    case 'USD':
      return '$';
    default:
      return currency;
  }
}

export function formatMoney(
  amount: number,
  currency: CurrencyCode = 'YER',
  decimals = 0,
  locale: 'ar-YE' | 'en-US' = 'en-US'
): string {
  const safe = roundMoney(amount, decimals);
  const formatted = new Intl.NumberFormat(locale === 'ar-YE' ? 'ar-YE-u-nu-latn' : 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
  return `${formatted} ${currencyLabel(currency)}`;
}

export function toLocalDateKey(input?: string | Date): string {
  const d = input ? (input instanceof Date ? input : new Date(input)) : new Date();
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    const y = fallback.getFullYear();
    const m = String(fallback.getMonth() + 1).padStart(2, '0');
    const day = String(fallback.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateArabic(
  isoString: string | undefined,
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' = 'YYYY-MM-DD',
  includeTime = false
): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const datePart = dateFormat === 'DD/MM/YYYY' ? `${dd}/${mm}/${yyyy}` : `${yyyy}-${mm}-${dd}`;
  if (!includeTime) return datePart;
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${datePart} ${hh}:${min}`;
}

import type { AppUser, Organization, PaymentMethod, SyncOperation } from './types';

/**
 * تنسيق أرقام المستندات التجارية بالعربية بشكل متسلسل ومقروء وخالٍ من الرموز التقنية.
 */
export function formatSequentialDocumentNumber(
  prefix: 'INV' | 'REC' | 'ADJ' | 'OPEN' | 'EXP',
  seqNumber: number,
  branchIndex = 1
): string {
  const padded = String(Math.max(1, Math.floor(seqNumber))).padStart(4, '0');
  const branchTag = branchIndex > 1 ? ` - فرع ${branchIndex}` : '';
  switch (prefix) {
    case 'INV':
      return `فاتورة بيع رقم ${padded}${branchTag}`;
    case 'REC':
      return `سند قبض رقم ${padded}${branchTag}`;
    case 'ADJ':
      return `قيد تسوية رقم ${padded}${branchTag}`;
    case 'OPEN':
      return `رصيد افتتاحي رقم ${padded}${branchTag}`;
    case 'EXP':
      return `سند مصروف رقم ${padded}${branchTag}`;
  }
}

/**
 * تحويل أي مرجع قديم أو حالي إلى صيغة عربية تجارية مفهومة للمستخدم
 * (يخفي أي أكواد تقنية مثل INV-00001-5E5 أو OPEN-144E0A أو REV-).
 */
export function formatCommercialRef(rawRef?: string, refType?: string): string {
  const val = (rawRef || '').trim();
  if (!val) {
    if (refType === 'sale') return 'فاتورة بيع';
    if (refType === 'payment') return 'سند قبض';
    if (refType === 'opening_balance') return 'رصيد افتتاحي';
    if (refType === 'adjustment') return 'قيد تسوية';
    if (refType === 'reversal') return 'قيد عكسي';
    return 'عملية مالية';
  }

  // Already clean Arabic commercial label
  if (/^(فاتورة بيع رقم|سند قبض رقم|قيد تسوية رقم|رصيد افتتاحي رقم|سند مصروف رقم|قيد عكسي)/.test(val)) {
    return val;
  }

  // Reversal prefix legacy handling
  if (val.startsWith('REV-')) {
    const inner = formatCommercialRef(val.slice(4));
    return `قيد عكسي - ${inner}`;
  }

  // Legacy INV-00001-XYZ / REC-00001-XYZ / ADJ-00001-XYZ
  const legacyMatch = /^(INV|REC|ADJ)-(\d+)(?:-[A-Z0-9]+)?$/i.exec(val);
  if (legacyMatch) {
    const kind = legacyMatch[1].toUpperCase() as 'INV' | 'REC' | 'ADJ';
    const num = Number(legacyMatch[2]) || 1;
    return formatSequentialDocumentNumber(kind, num);
  }

  // Legacy OPEN-XXXXXX
  if (/^OPEN-/i.test(val) || refType === 'opening_balance') {
    return 'رصيد افتتاحي';
  }

  return val;
}

/**
 * إزالة الرموز التقنية من وصف القيود أو ملخصات السجل عند العرض.
 */
export function sanitizeCommercialText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\bREV-(INV|REC|ADJ)-(\d+)(?:-[A-Z0-9]+)?\b/gi, (_, k: string, n: string) =>
      `قيد عكسي - ${formatSequentialDocumentNumber(k.toUpperCase() as 'INV' | 'REC' | 'ADJ', Number(n) || 1)}`
    )
    .replace(/\b(INV|REC|ADJ)-(\d+)(?:-[A-Z0-9]+)?\b/gi, (_, k: string, n: string) =>
      formatSequentialDocumentNumber(k.toUpperCase() as 'INV' | 'REC' | 'ADJ', Number(n) || 1)
    )
    .replace(/\bOPEN-[A-Z0-9]+\b/gi, 'رصيد افتتاحي')
    .replace(/\bDEV-[A-Z0-9]+\b/gi, 'هذا الجهاز');
}

/**
 * استخراج الرقم التسلسلي الصافي من رقم المستند لتسمية ملفات PDF بوضوح.
 */
export function extractSequenceDigits(docNumber?: string): string {
  const match = /(\d{3,})/.exec(docNumber || '');
  return match ? match[1] : '0001';
}

/**
 * تنظيف اسم ملف عربي آمن للمشاركة والتنزيل دون أي معرفات تقنية.
 */
export function buildCleanExportFileName(baseParts: string[], ext: string): string {
  const cleaned = baseParts
    .map((p) =>
      p
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '')
        .replace(/\s+/g, '-')
    )
    .filter(Boolean)
    .join('-');
  const cleanExt = ext.replace(/^\./, '').toLowerCase();
  return `${cleaned || 'مستند'}.${cleanExt}`;
}

export function formatRoleArabic(role: AppUser['role']): string {
  switch (role) {
    case 'owner':
      return 'المالك';
    case 'manager':
      return 'المدير';
    case 'accountant':
      return 'المحاسب';
    case 'cashier':
      return 'أمين الصندوق (كاشير)';
  }
}

export function formatPaymentMethodArabic(method: PaymentMethod): string {
  switch (method) {
    case 'cash':
      return 'نقداً (الصندوق)';
    case 'transfer':
      return 'حوالة بنكية / صرافة';
    case 'wallet':
      return 'محفظة إلكترونية';
  }
}

export function formatPlanArabic(plan: Organization['subscriptionPlan']): string {
  switch (plan) {
    case 'starter':
      return 'الباقة الأساسية';
    case 'pro':
      return 'الباقة الاحترافية';
    case 'enterprise':
      return 'باقة المؤسسات والفروع';
  }
}

export function formatSubscriptionStatusArabic(status: Organization['subscriptionStatus']): string {
  switch (status) {
    case 'active':
      return 'نشط';
    case 'trial':
      return 'فترة تجريبية';
    case 'expired':
      return 'منتهي';
    case 'suspended':
      return 'موقوف';
  }
}

export function formatSyncEntityArabic(entityType: SyncOperation['entityType']): string {
  switch (entityType) {
    case 'organization':
      return 'ملف المؤسسة';
    case 'customer':
      return 'ملف العميل';
    case 'product':
      return 'بيانات الصنف';
    case 'sale':
      return 'فاتورة بيع';
    case 'payment':
      return 'سند قبض';
    case 'ledger':
      return 'قيد محاسبي';
    case 'expense':
      return 'سند مصروف';
    case 'cashbox':
      return 'حركة الصندوق';
  }
}

export function formatSyncActionArabic(action: SyncOperation['action']): string {
  switch (action) {
    case 'create':
      return 'إضافة جديدة';
    case 'update':
      return 'تحديث بيانات';
    case 'reverse':
      return 'قيد عكسي';
  }
}

export function formatSyncStatusArabic(status: SyncOperation['status']): string {
  switch (status) {
    case 'pending':
      return 'بانتظار الإرسال';
    case 'synced':
      return 'متزامنة';
    case 'conflict':
      return 'يتطلب مراجعة';
    case 'failed':
      return 'تعذر الإرسال';
  }
}

import type { Customer, MessageStatus } from './types';

// GSM 03.38 7-bit basic and extended character tables
const GSM_BASIC_CHARS = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
);
const GSM_EXTENDED_CHARS = new Set('^{}\\[~]|€');

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsSegmentSummary {
  encoding: SmsEncoding;
  charCount: number;
  unitCount: number;
  partsCount: number;
  singlePartLimit: number;
  multiPartLimit: number;
  charsRemainingInCurrentPart: number;
}

export function detectSmsEncoding(body: string): SmsEncoding {
  for (const ch of body) {
    if (!GSM_BASIC_CHARS.has(ch) && !GSM_EXTENDED_CHARS.has(ch)) {
      return 'UCS-2';
    }
  }
  return 'GSM-7';
}

export function calculateSmsSegments(body: string): SmsSegmentSummary {
  const encoding = detectSmsEncoding(body);
  const charCount = body.length;

  if (encoding === 'UCS-2') {
    const singlePartLimit = 70;
    const multiPartLimit = 67;
    if (charCount === 0) {
      return {
        encoding,
        charCount: 0,
        unitCount: 0,
        partsCount: 0,
        singlePartLimit,
        multiPartLimit,
        charsRemainingInCurrentPart: singlePartLimit,
      };
    }
    const partsCount = charCount <= singlePartLimit ? 1 : Math.ceil(charCount / multiPartLimit);
    const limitUsed = partsCount === 1 ? singlePartLimit : partsCount * multiPartLimit;
    return {
      encoding,
      charCount,
      unitCount: charCount,
      partsCount,
      singlePartLimit,
      multiPartLimit,
      charsRemainingInCurrentPart: Math.max(0, limitUsed - charCount),
    };
  }

  let septets = 0;
  for (const ch of body) {
    septets += GSM_EXTENDED_CHARS.has(ch) ? 2 : 1;
  }

  const singlePartLimit = 160;
  const multiPartLimit = 153;
  if (septets === 0) {
    return {
      encoding,
      charCount: 0,
      unitCount: 0,
      partsCount: 0,
      singlePartLimit,
      multiPartLimit,
      charsRemainingInCurrentPart: singlePartLimit,
    };
  }
  const partsCount = septets <= singlePartLimit ? 1 : Math.ceil(septets / multiPartLimit);
  const limitUsed = partsCount === 1 ? singlePartLimit : partsCount * multiPartLimit;
  return {
    encoding,
    charCount,
    unitCount: septets,
    partsCount,
    singlePartLimit,
    multiPartLimit,
    charsRemainingInCurrentPart: Math.max(0, limitUsed - septets),
  };
}

export function normalizeSmsPhoneNumber(rawPhone: string): string {
  const cleaned = rawPhone.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('00')) {
    return `+${cleaned.slice(2)}`;
  }
  return cleaned;
}

export function isValidSmsPhone(rawPhone: string): boolean {
  const normalized = normalizeSmsPhoneNumber(rawPhone).replace(/^\+/, '');
  return /^\d{6,15}$/.test(normalized);
}

export interface RecipientSelectionResult {
  validRecipients: Array<{
    id: string;
    name: string;
    phone: string;
    customer?: Customer;
  }>;
  excludedOptOutCount: number;
  excludedInvalidPhoneCount: number;
  excludedDuplicateCount: number;
}

export function resolveConfirmedSmsRecipients(params: {
  customers: Customer[];
  selectedCustomerIds: string[];
  extraAdhocContacts?: Array<{ id: string; name: string; phone: string }>;
  isMarketingMessage: boolean;
}): RecipientSelectionResult {
  const customerMap = new Map(params.customers.map((c) => [c.id, c]));
  const seenPhones = new Set<string>();
  const validRecipients: RecipientSelectionResult['validRecipients'] = [];
  let excludedOptOutCount = 0;
  let excludedInvalidPhoneCount = 0;
  let excludedDuplicateCount = 0;

  for (const custId of params.selectedCustomerIds) {
    const cust = customerMap.get(custId);
    if (!cust) continue;

    if (params.isMarketingMessage && cust.marketingOptOut) {
      excludedOptOutCount += 1;
      continue;
    }

    const phone = normalizeSmsPhoneNumber(cust.phone);
    if (!isValidSmsPhone(phone)) {
      excludedInvalidPhoneCount += 1;
      continue;
    }

    if (seenPhones.has(phone)) {
      excludedDuplicateCount += 1;
      continue;
    }

    seenPhones.add(phone);
    validRecipients.push({
      id: cust.id,
      name: cust.fullName,
      phone,
      customer: cust,
    });
  }

  for (const extra of params.extraAdhocContacts || []) {
    const phone = normalizeSmsPhoneNumber(extra.phone);
    if (!isValidSmsPhone(phone)) {
      excludedInvalidPhoneCount += 1;
      continue;
    }
    if (seenPhones.has(phone)) {
      excludedDuplicateCount += 1;
      continue;
    }
    seenPhones.add(phone);
    validRecipients.push({
      id: extra.id,
      name: extra.name.trim() || phone,
      phone,
    });
  }

  return {
    validRecipients,
    excludedOptOutCount,
    excludedInvalidPhoneCount,
    excludedDuplicateCount,
  };
}

export function getSmsStatusLabel(status: MessageStatus): string {
  switch (status) {
    case 'pending':
      return 'بانتظار الإرسال';
    case 'sending':
      return 'قيد الإرسال';
    case 'sent_to_network':
      return 'أُرسلت إلى شبكة الاتصالات';
    case 'delivered':
      return 'تم تأكيد التسليم';
    case 'failed':
      return 'فشل الإرسال';
    case 'unknown':
      return 'تعذر التحقق من النتيجة';
  }
}

export function canDispatchMessage(
  status: MessageStatus,
  explicitResendUnknownApproved = false
): boolean {
  if (status === 'pending' || status === 'failed') {
    return true;
  }
  if (status === 'unknown') {
    return explicitResendUnknownApproved;
  }
  return false;
}

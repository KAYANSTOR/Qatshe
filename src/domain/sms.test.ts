import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateSmsSegments,
  canDispatchMessage,
  detectSmsEncoding,
  getSmsStatusLabel,
  isValidSmsPhone,
  normalizeSmsPhoneNumber,
  resolveConfirmedSmsRecipients,
} from './sms';
import type { Customer, MessageStatus } from './types';

function makeCustomer(overrides: Partial<Customer> & { id: string; fullName: string; phone: string }): Customer {
  const now = new Date().toISOString();
  return {
    orgId: 'org-1',
    branchId: 'branch-1',
    address: '',
    category: 'regular',
    creditLimit: 50000,
    status: 'active',
    marketingOptOut: false,
    notes: '',
    cachedBalance: 0,
    cachedTotalPurchases: 0,
    cachedTotalPaid: 0,
    purchaseCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: 'owner',
    deviceId: 'dev-1',
    syncStatus: 'pending',
    ...overrides,
  };
}

test('SMS encoding and segmentation counts GSM-7 vs Arabic UCS-2 accurately', () => {
  assert.equal(detectSmsEncoding('Hello QATSHI 123'), 'GSM-7');
  assert.equal(detectSmsEncoding('مرحباً بك في قاتشي'), 'UCS-2');

  // Empty body
  const empty = calculateSmsSegments('');
  assert.equal(empty.partsCount, 0);

  // GSM-7 single vs multi-part (160 / 153)
  const gsm160 = calculateSmsSegments('A'.repeat(160));
  assert.equal(gsm160.encoding, 'GSM-7');
  assert.equal(gsm160.partsCount, 1);
  assert.equal(gsm160.charsRemainingInCurrentPart, 0);

  const gsm161 = calculateSmsSegments('A'.repeat(161));
  assert.equal(gsm161.partsCount, 2);
  assert.equal(gsm161.multiPartLimit, 153);

  // Extended GSM-7 character takes 2 septets
  const gsmExt = calculateSmsSegments(`${'A'.repeat(159)}€`);
  assert.equal(gsmExt.unitCount, 161);
  assert.equal(gsmExt.partsCount, 2);

  // Arabic UCS-2 single vs multi-part (70 / 67)
  const ar70 = calculateSmsSegments('أ'.repeat(70));
  assert.equal(ar70.encoding, 'UCS-2');
  assert.equal(ar70.partsCount, 1);

  const ar71 = calculateSmsSegments('أ'.repeat(71));
  assert.equal(ar71.partsCount, 2);
  assert.equal(ar71.multiPartLimit, 67);
});

test('Phone normalization and validation handles formatting and international prefixes', () => {
  assert.equal(normalizeSmsPhoneNumber('00967 777-123-456'), '+967777123456');
  assert.equal(isValidSmsPhone('+967777123456'), true);
  assert.equal(isValidSmsPhone('777123456'), true);
  assert.equal(isValidSmsPhone('123'), false);
  assert.equal(isValidSmsPhone('abc'), false);
});

test('Recipient resolver sends strictly to confirmed selections, enforces opt-out & deduplicates', () => {
  const c1 = makeCustomer({ id: 'c1', fullName: 'أحمد', phone: '777111222' });
  const c2 = makeCustomer({ id: 'c2', fullName: 'خالد (رافض تسويق)', phone: '777333444', marketingOptOut: true });
  const c3 = makeCustomer({ id: 'c3', fullName: 'سعيد (رقم غير صالح)', phone: '12' });
  const c4 = makeCustomer({ id: 'c4', fullName: 'غير محدد', phone: '777999888' });
  const c5 = makeCustomer({ id: 'c5', fullName: 'مكرر الرقم', phone: '777 111 222' });

  // Marketing message excludes c2; unconfirmed c4 is never included
  const marketingRes = resolveConfirmedSmsRecipients({
    customers: [c1, c2, c3, c4, c5],
    selectedCustomerIds: ['c1', 'c2', 'c3', 'c5'],
    extraAdhocContacts: [{ id: 'adhoc-1', name: 'مكرر مع c1', phone: '777111222' }],
    isMarketingMessage: true,
  });

  assert.equal(marketingRes.validRecipients.length, 1);
  assert.equal(marketingRes.validRecipients[0].id, 'c1');
  assert.equal(marketingRes.excludedOptOutCount, 1);
  assert.equal(marketingRes.excludedInvalidPhoneCount, 1);
  assert.equal(marketingRes.excludedDuplicateCount, 2);

  // Debt / transactional message still reaches c2 when confirmed
  const transactionalRes = resolveConfirmedSmsRecipients({
    customers: [c1, c2],
    selectedCustomerIds: ['c1', 'c2'],
    isMarketingMessage: false,
  });
  assert.equal(transactionalRes.validRecipients.length, 2);
});

test('SMS statuses map to exact Arabic labels and unknown status prevents automatic retry', () => {
  const expected: Record<MessageStatus, string> = {
    pending: 'بانتظار الإرسال',
    sending: 'قيد الإرسال',
    sent_to_network: 'أُرسلت إلى شبكة الاتصالات',
    delivered: 'تم تأكيد التسليم',
    failed: 'فشل الإرسال',
    unknown: 'تعذر التحقق من النتيجة',
  };

  for (const [status, label] of Object.entries(expected)) {
    assert.equal(getSmsStatusLabel(status as MessageStatus), label);
  }

  assert.equal(canDispatchMessage('pending'), true);
  assert.equal(canDispatchMessage('failed'), true);
  assert.equal(canDispatchMessage('sent_to_network'), false);
  assert.equal(canDispatchMessage('delivered'), false);
  assert.equal(canDispatchMessage('unknown', false), false);
  assert.equal(canDispatchMessage('unknown', true), true);
});

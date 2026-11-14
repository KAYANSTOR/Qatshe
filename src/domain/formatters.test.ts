import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCleanExportFileName,
  extractSequenceDigits,
  formatCommercialRef,
  formatRoleArabic,
  formatSequentialDocumentNumber,
  formatSyncEntityArabic,
  sanitizeCommercialText,
} from './formatters.ts';

test('Sequential document numbers are clean Arabic commercial strings with zero technical codes', () => {
  assert.equal(formatSequentialDocumentNumber('INV', 1), 'فاتورة بيع رقم 0001');
  assert.equal(formatSequentialDocumentNumber('REC', 12), 'سند قبض رقم 0012');
  assert.equal(formatSequentialDocumentNumber('ADJ', 3, 2), 'قيد تسوية رقم 0003 - فرع 2');
  assert.equal(formatSequentialDocumentNumber('OPEN', 5), 'رصيد افتتاحي رقم 0005');
  assert.equal(formatSequentialDocumentNumber('EXP', 9), 'سند مصروف رقم 0009');
});

test('Legacy technical references are cleanly converted for display', () => {
  assert.equal(formatCommercialRef('INV-00001-5E5'), 'فاتورة بيع رقم 0001');
  assert.equal(formatCommercialRef('REC-00014-ABC'), 'سند قبض رقم 0014');
  assert.equal(formatCommercialRef('REV-INV-00002-5E5'), 'قيد عكسي - فاتورة بيع رقم 0002');
  assert.equal(formatCommercialRef('OPEN-144E0A', 'opening_balance'), 'رصيد افتتاحي');
  assert.equal(
    sanitizeCommercialText('سداد فوري مع فاتورة INV-00003-9A1 على DEV-8812'),
    'سداد فوري مع فاتورة فاتورة بيع رقم 0003 على هذا الجهاز'
  );
});

test('Clean Arabic filenames contain zero random IDs or unsafe characters', () => {
  assert.equal(
    buildCleanExportFileName(['فاتورة-بيع', 'علي الحرازي', extractSequenceDigits('فاتورة بيع رقم 0007')], 'pdf'),
    'فاتورة-بيع-علي-الحرازي-0007.pdf'
  );
  assert.equal(
    buildCleanExportFileName(['كشف-حساب', 'محمد/صالح?'], 'pdf'),
    'كشف-حساب-محمدصالح.pdf'
  );
  assert.equal(formatRoleArabic('cashier'), 'أمين الصندوق (كاشير)');
  assert.equal(formatSyncEntityArabic('sale'), 'فاتورة بيع');
});

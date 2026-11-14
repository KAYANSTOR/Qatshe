import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { db } from '../db/qatshiDb';
import {
  ensureLocalProjectInitialized,
  normalizeNumericCode,
  normalizePhone,
} from './authService';

test('normalizePhone and normalizeNumericCode enforce numeric digits and convert Arabic-Indic numerals', () => {
  assert.equal(normalizePhone('٧٧١-٢٢٣-٣٤٤abc'), '771223344');
  assert.equal(normalizePhone('1234567890123456789'), '123456789012345');
  assert.equal(normalizeNumericCode('١٢٣٤أب٥٦'), '123456');
  assert.equal(normalizeNumericCode('1234567890'), '12345678');
});

test('Railway Auth & Project Customers API: phone + numeric code registration, login, isolation, upsert, and logout', async () => {
  process.env.QATSHI_TEST_NO_LISTEN = '1';
  const { createQatshiApp } = await import('../../server');
  const app = createQatshiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Reject non-numeric or short code / short phone
    const badCodeRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerName: 'أحمد السياغي',
        projectName: 'محل النخبة',
        phone: '777111222',
        code: 'abc12',
      }),
    });
    assert.equal(badCodeRes.status, 400);

    // 2. Register Project A using Arabic-Indic numerals
    const regARes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerName: 'أحمد السياغي',
        projectName: 'محل النخبة للقات',
        phone: '٧٧٧١١١٢٢٢',
        code: '٢٥٨٠',
      }),
    });
    assert.equal(regARes.status, 201);
    const regAJson = (await regARes.json()) as {
      ok: boolean;
      user: { id: string; phone: string; ownerName: string; projectId: string; projectName: string };
    };
    assert.equal(regAJson.ok, true);
    assert.equal(regAJson.user.phone, '777111222');
    assert.equal(regAJson.user.projectName, 'محل النخبة للقات');
    assert.ok(regAJson.user.projectId);

    const setCookieA = regARes.headers.get('set-cookie') || '';
    const cookieA = setCookieA.split(';')[0];
    assert.ok(cookieA.startsWith('qatshi_session='));

    // 3. Duplicate phone returns 409
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerName: 'مستخدم مكرر',
        projectName: 'محل آخر',
        phone: '777111222',
        code: '1234',
      }),
    });
    assert.equal(dupRes.status, 409);

    // 4. Verify /api/auth/me with session cookie A
    const meARes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookieA },
    });
    const meAJson = (await meARes.json()) as { authenticated: boolean; user?: { projectId: string } };
    assert.equal(meAJson.authenticated, true);
    assert.equal(meAJson.user?.projectId, regAJson.user.projectId);

    // 5. Create & upsert customer inside Project A
    const custCreateRes = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        fullName: 'صالح الجرادي',
        phone: '771999888',
        address: 'التحرير',
        balance: 5000,
      }),
    });
    assert.equal(custCreateRes.status, 201);

    const listARes = await fetch(`${baseUrl}/api/customers`, {
      headers: { Cookie: cookieA },
    });
    const listAJson = (await listARes.json()) as {
      ok: boolean;
      customers: Array<{ fullName: string; phone: string; balance: number }>;
    };
    assert.equal(listAJson.customers.length, 1);
    assert.equal(listAJson.customers[0].fullName, 'صالح الجرادي');
    assert.equal(listAJson.customers[0].balance, 5000);

    // 6. Register Project B and verify strict project isolation
    const regBRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerName: 'خالد المعمري',
        projectName: 'محل الريان',
        phone: '770444555',
        code: '9988',
      }),
    });
    assert.equal(regBRes.status, 201);
    const cookieB = (regBRes.headers.get('set-cookie') || '').split(';')[0];

    const listBRes = await fetch(`${baseUrl}/api/customers`, {
      headers: { Cookie: cookieB },
    });
    const listBJson = (await listBRes.json()) as { ok: boolean; customers: unknown[] };
    assert.equal(listBJson.customers.length, 0);

    // 7. Wrong numeric code fails login (401), valid numeric code succeeds
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '777111222', code: '0000' }),
    });
    assert.equal(badLoginRes.status, 401);

    const goodLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '777111222', code: '2580' }),
    });
    assert.equal(goodLoginRes.status, 200);
    const loginCookieA = (goodLoginRes.headers.get('set-cookie') || '').split(';')[0];

    // 8. Logout destroys session
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: loginCookieA },
    });
    assert.equal(logoutRes.status, 200);

    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: loginCookieA },
    });
    const meAfterJson = (await meAfterLogout.json()) as { authenticated: boolean };
    assert.equal(meAfterJson.authenticated, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('ensureLocalProjectInitialized bootstraps local Dexie organization and owner user from AuthUser', async () => {
  await db.delete();
  await db.open();

  const orgId = await ensureLocalProjectInitialized({
    id: 'acct_test_1',
    phone: '777111222',
    ownerName: 'أحمد السياغي',
    projectId: 'proj_test_1',
    projectName: 'محل النخبة للقات',
  });

  assert.equal(orgId, 'proj_test_1');
  const org = await db.organizations.get('proj_test_1');
  assert.equal(org?.name, 'محل النخبة للقات');
  assert.equal(org?.ownerName, 'أحمد السياغي');
  assert.equal(org?.phone, '777111222');

  const users = await db.users.where('orgId').equals('proj_test_1').toArray();
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'owner');
});

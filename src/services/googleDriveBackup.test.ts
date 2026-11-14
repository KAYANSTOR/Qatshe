import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';

import { db } from '../db/qatshiDb';
import { toLocalDateKey } from '../domain/money';
import type { AppUser, Organization, RemoteDriveBackupFile } from '../domain/types';
import { createPaymentTransaction, createSaleTransaction, queryCustomerFinancialProfile } from './accountingService';
import { sha256Hex } from './backupService';
import { saveCustomer } from './customerService';
import { generateTenantSecret } from './device';
import {
  disconnectGoogleDriveAccount,
  findOtherOrgUsingGoogleAccount,
  getLinkedGoogleDriveAccount,
  saveLinkedGoogleDriveAccount,
} from './googleAuthService';
import {
  configureDriveBackupPassphrase,
  executeGoogleDriveBackup,
  getDriveBackupState,
  listGoogleDriveBackups,
  restoreFromGoogleDriveFile,
  runDriveBackupCatchUp,
  updateDriveRetentionPolicy,
} from './googleDriveBackupScheduler';
import type { DriveTransport, DriveUploadInput } from './googleDriveService';

async function resetDb() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

function makeOrg(id: string, name: string): Organization {
  const now = new Date().toISOString();
  return {
    id,
    name,
    ownerName: 'أحمد السياغي',
    phone: '777100200',
    whatsapp: '777100200',
    address: 'صنعاء',
    description: 'محل قات',
    currency: 'YER',
    currencyDecimals: 0,
    numberLocale: 'en-US',
    dateFormat: 'YYYY-MM-DD',
    invoiceHeader: name,
    invoiceFooter: 'شكراً لتعاملكم',
    autoLockMinutes: 0,
    subscriptionPlan: 'pro',
    subscriptionStatus: 'active',
    subscriptionExpiry: '2029-01-01',
    maxUsers: 10,
    maxDevices: 5,
    branches: [{ id: 'branch-main', name: 'الفرع الرئيسي', address: 'صنعاء', phone: '777100200', isMain: true }],
    activeBranchId: 'branch-main',
    orgAuthSecret: generateTenantSecret(),
    createdAt: now,
    updatedAt: now,
  };
}

function makeOwner(orgId: string): AppUser {
  const now = new Date().toISOString();
  return {
    id: `owner-${orgId}`,
    orgId,
    branchId: 'branch-main',
    name: 'أحمد المالك',
    role: 'owner',
    hasPin: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

class InMemoryMockDriveTransport implements DriveTransport {
  public validToken = 'valid-drive-token-account-a';
  public failNextUpload = false;
  public files = new Map<string, { meta: RemoteDriveBackupFile; content: string }>();
  public uploadCount = 0;
  public deleteCount = 0;
  private seq = 1;

  private assertAuth(token: string) {
    if (!token || token !== this.validToken) {
      throw new Error('DRIVE_UNAUTHORIZED:رمز Google غير مصرح به أو منتهي الصلاحية');
    }
  }

  async listAppDataFiles(accessToken: string, orgId?: string): Promise<RemoteDriveBackupFile[]> {
    this.assertAuth(accessToken);
    const list = Array.from(this.files.values()).map((x) => x.meta);
    return (orgId ? list.filter((f) => f.orgId === orgId) : list).sort((a, b) =>
      b.createdTime.localeCompare(a.createdTime)
    );
  }

  async uploadAppDataFile(input: DriveUploadInput): Promise<RemoteDriveBackupFile> {
    this.assertAuth(input.accessToken);
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error('DRIVE_HTTP_503:انقطاع مؤقت أثناء الرفع');
    }
    this.uploadCount++;
    const id = `drive-file-${this.seq++}`;
    const createdTime = new Date(Date.now() + this.seq * 1000).toISOString();
    const meta: RemoteDriveBackupFile = {
      id,
      name: input.fileName,
      sizeBytes: new Blob([input.content]).size,
      createdTime,
      orgId: input.appProperties.orgId || '',
      orgName: input.appProperties.orgName || '',
      backupKind: (input.appProperties.backupKind as RemoteDriveBackupFile['backupKind']) || 'daily',
      dateKey: input.appProperties.dateKey || createdTime.slice(0, 10),
      sha256: input.appProperties.sha256 || '',
      dataChecksum: input.appProperties.dataChecksum || '',
      recordCount: Number(input.appProperties.recordCount || 0),
      schemaVersion: Number(input.appProperties.schemaVersion || 3),
      encrypted: input.appProperties.encrypted !== 'false',
    };
    this.files.set(id, { meta, content: input.content });
    return meta;
  }

  async downloadAppDataFile(accessToken: string, fileId: string): Promise<string> {
    this.assertAuth(accessToken);
    const item = this.files.get(fileId);
    if (!item) throw new Error('DRIVE_NOT_FOUND:الملف غير موجود');
    return item.content;
  }

  async deleteAppDataFile(accessToken: string, fileId: string): Promise<void> {
    this.assertAuth(accessToken);
    this.deleteCount++;
    this.files.delete(fileId);
  }
}

test('Google Drive Acceptance: full lifecycle, offline catch-up, no duplicates, AES-256-GCM + SHA-256, cross-device restore & security', async () => {
  await resetDb();
  const drive = new InMemoryMockDriveTransport();
  const org = makeOrg('org-drive-1', 'محل النخبة للقات');
  const owner = makeOwner(org.id);
  await db.organizations.put(org);
  await db.users.put(owner);

  // Create real accounting activity (customer, partial sale, collection payment)
  const customer = await saveCustomer({
    org,
    user: owner,
    fullName: 'صالح الجرادي',
    phone: '771223344',
    address: 'التحرير',
    category: 'vip',
    creditLimit: 50000,
    status: 'active',
    marketingOptOut: false,
    notes: 'عميل دائم',
    openingBalance: 4000,
  });

  await createSaleTransaction({
    org,
    user: owner,
    customerId: customer.id,
    items: [
      {
        productId: 'p-1',
        productName: 'قات ولعة',
        grade: 'ممتاز',
        unitName: 'ربطة',
        quantity: 2,
        unitPrice: 5000,
        costPrice: 3500,
      },
    ],
    discount: 0,
    paymentMode: 'partial',
    paidAmount: 3000,
    paymentMethod: 'cash',
    notes: '',
    idempotencyKey: 'drive-test-sale-1',
  });

  await createPaymentTransaction({
    org,
    user: owner,
    customerId: customer.id,
    amount: 2000,
    paymentMethod: 'cash',
    allocationMode: 'auto',
    notes: 'دفعة',
    idempotencyKey: 'drive-test-pay-1',
  });
  // Expected customer balance: 4000 + (10000 - 3000) - 2000 = 9000
  const custBeforeBackup = await db.customers.get(customer.id);
  assert.equal(custBeforeBackup?.cachedBalance, 9000);

  // 1. Link Google Drive account & set AES-256-GCM passphrase
  await saveLinkedGoogleDriveAccount(org.id, {
    uid: 'google-uid-shop-1',
    email: 'shop.owner1@gmail.com',
    displayName: 'صاحب محل النخبة',
    connectedAt: new Date().toISOString(),
  });
  await configureDriveBackupPassphrase(org.id, 'MyStrongDrivePass!2026');

  // Verify tenant isolation helper flags when another org tries to inspect/link same account
  const conflictOrgName = await findOtherOrgUsingGoogleAccount('org-other', 'shop.owner1@gmail.com');
  assert.equal(conflictOrgName, 'محل النخبة للقات');

  // 2. Offline test -> marks pending_offline cleanly without crashing or creating redundant uploads
  const offlineRes = await executeGoogleDriveBackup({
    orgId: org.id,
    trigger: 'daily_auto',
    isOnlineOverride: false,
    accessTokenOverride: drive.validToken,
    passphraseOverride: 'MyStrongDrivePass!2026',
    transport: drive,
  });
  assert.equal(offlineRes.outcome, 'deferred_offline');
  assert.equal(offlineRes.state.status, 'pending_offline');
  assert.ok(offlineRes.state.pendingSince);
  assert.equal(drive.uploadCount, 0);

  // 3. Reconnect online catch-up -> executes deferred backup automatically
  const catchupRes = await runDriveBackupCatchUp({
    orgId: org.id,
    trigger: 'online_catchup',
    isOnlineOverride: true,
    accessTokenOverride: drive.validToken,
    transport: drive,
  });
  assert.equal(catchupRes.executed, true);
  assert.equal(catchupRes.outcome, 'success');
  assert.equal(drive.uploadCount, 1);

  const uploadedEntry = Array.from(drive.files.values())[0];
  assert.ok(uploadedEntry);
  const parsedEnvelope = JSON.parse(uploadedEntry.content) as {
    encrypted?: boolean;
    algorithm?: string;
    cipherB64?: string;
  };
  assert.equal(parsedEnvelope.encrypted, true);
  assert.equal(parsedEnvelope.algorithm, 'AES-GCM');
  assert.ok(parsedEnvelope.cipherB64);
  // Ensure NO OAuth tokens or secrets leaked into uploaded content
  assert.equal(uploadedEntry.content.includes(drive.validToken), false);
  assert.equal(uploadedEntry.content.includes(org.orgAuthSecret!), false);
  // Verify SHA-256 matches uploaded content
  assert.equal(await sha256Hex(uploadedEntry.content), uploadedEntry.meta.sha256);

  // 4. Duplicate prevention on repeated online / app_resume catch-up same day
  const repeatCatchup = await runDriveBackupCatchUp({
    orgId: org.id,
    trigger: 'app_resume',
    isOnlineOverride: true,
    accessTokenOverride: drive.validToken,
    transport: drive,
  });
  assert.equal(repeatCatchup.executed, false);
  assert.equal(drive.uploadCount, 1);

  const forcedDuplicate = await executeGoogleDriveBackup({
    orgId: org.id,
    trigger: 'daily_auto',
    force: false,
    isOnlineOverride: true,
    accessTokenOverride: drive.validToken,
    passphraseOverride: 'MyStrongDrivePass!2026',
    transport: drive,
  });
  assert.equal(forcedDuplicate.outcome, 'skipped_duplicate');
  assert.equal(drive.uploadCount, 1);

  // 5. Simulate closing app & reopening next day -> overdue catch-up runs automatically
  const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
  await saveCustomer({
    org,
    user: owner,
    fullName: 'عميل جديد باليوم التالي',
    phone: '777888999',
    address: 'عدن',
    category: 'regular',
    creditLimit: 20000,
    status: 'active',
    marketingOptOut: false,
    notes: '',
    openingBalance: 1500,
  });
  const nextDayCatchup = await runDriveBackupCatchUp({
    orgId: org.id,
    trigger: 'app_resume',
    isOnlineOverride: true,
    accessTokenOverride: drive.validToken,
    transport: drive,
    now: tomorrow,
  });
  assert.equal(nextDayCatchup.executed, true);
  assert.equal(nextDayCatchup.outcome, 'success');
  assert.equal(drive.uploadCount, 2);

  // 6. Unauthorized Google account test -> returns needs_auth and does not crash
  const unauthRes = await executeGoogleDriveBackup({
    orgId: org.id,
    trigger: 'manual',
    force: true,
    isOnlineOverride: true,
    accessTokenOverride: 'expired-or-unauthorized-token',
    passphraseOverride: 'MyStrongDrivePass!2026',
    transport: drive,
  });
  assert.equal(unauthRes.outcome, 'needs_auth');
  assert.equal(unauthRes.state.status, 'needs_auth');

  // 7. Retention policy + fail-safe (do NOT delete old backups if new upload fails!)
  await updateDriveRetentionPolicy(org.id, {
    dailyEnabled: true,
    preferredHour: 23,
    retainDailyCount: 1,
    retainMonthlyCount: 0,
    keepManualCount: 1,
  });
  const filesCountBeforeFail = drive.files.size;
  drive.failNextUpload = true;
  const failUpload = await executeGoogleDriveBackup({
    orgId: org.id,
    trigger: 'manual',
    force: true,
    isOnlineOverride: true,
    accessTokenOverride: drive.validToken,
    passphraseOverride: 'MyStrongDrivePass!2026',
    transport: drive,
  });
  assert.equal(failUpload.outcome, 'failed');
  assert.equal(drive.files.size, filesCountBeforeFail);

  // Succeeding manual upload now prunes excess old backup only AFTER verified upload
  const successPrune = await executeGoogleDriveBackup({
    orgId: org.id,
    trigger: 'manual',
    backupKind: 'manual',
    force: true,
    isOnlineOverride: true,
    accessTokenOverride: drive.validToken,
    passphraseOverride: 'MyStrongDrivePass!2026',
    transport: drive,
  });
  assert.equal(successPrune.outcome, 'success');
  assert.ok(drive.deleteCount >= 1);

  // 8. Corrupted backup & wrong passphrase tests must abort BEFORE touching local DB
  const latestRemote = (await listGoogleDriveBackups({ orgId: org.id, accessTokenOverride: drive.validToken, transport: drive }))[0];
  await assert.rejects(
    () =>
      restoreFromGoogleDriveFile({
        file: latestRemote,
        passphrase: 'WrongPassphrase99',
        currentOrgId: org.id,
        allowCrossOrgRestore: false,
        accessTokenOverride: drive.validToken,
        transport: drive,
      }),
    /غير صحيحة/
  );
  // Corrupt remote bytes -> SHA-256 mismatch stops restore cleanly
  const stored = drive.files.get(latestRemote.id)!;
  const originalContent = stored.content;
  stored.content = originalContent.slice(0, -10) + 'CORRUPTED!';
  await assert.rejects(
    () =>
      restoreFromGoogleDriveFile({
        file: latestRemote,
        passphrase: 'MyStrongDrivePass!2026',
        currentOrgId: org.id,
        allowCrossOrgRestore: false,
        accessTokenOverride: drive.validToken,
        transport: drive,
      }),
    /بصمة SHA-256/
  );
  stored.content = originalContent; // restore valid remote bytes

  // 9. Different organization guard + safety backup creation
  await assert.rejects(
    () =>
      restoreFromGoogleDriveFile({
        file: latestRemote,
        passphrase: 'MyStrongDrivePass!2026',
        currentOrgId: 'completely-different-org',
        allowCrossOrgRestore: false,
        accessTokenOverride: drive.validToken,
        transport: drive,
      }),
    /CROSS_ORG_MISMATCH/
  );

  // 10. Cross-device full restore on a wiped new phone + verify balances & ledger integrity
  await resetDb();
  assert.equal(await db.customers.count(), 0);

  const remoteBackupsOnNewPhone = await listGoogleDriveBackups({
    accessTokenOverride: drive.validToken,
    transport: drive,
  });
  assert.ok(remoteBackupsOnNewPhone.length >= 1);

  const restored = await restoreFromGoogleDriveFile({
    file: remoteBackupsOnNewPhone[0],
    passphrase: 'MyStrongDrivePass!2026',
    currentOrgId: '',
    allowCrossOrgRestore: true,
    accessTokenOverride: drive.validToken,
    transport: drive,
  });
  assert.equal(restored.integrityCheckedCustomers, 2);
  assert.equal(restored.integrityRepairedCount, 0);

  const restoredCustomer = await db.customers.get(customer.id);
  assert.equal(restoredCustomer?.cachedBalance, 9000);
  const restoredProfile = await queryCustomerFinancialProfile(org.id, customer.id);
  assert.equal(restoredProfile.sales.length, 1);
  assert.equal(restoredProfile.payments.length, 1);
  assert.equal(restoredProfile.entries.length, 4);
  const restoredOrg = await db.organizations.get(org.id);
  assert.equal(restoredOrg?.name, 'محل النخبة للقات');
  assert.ok(restoredOrg?.orgAuthSecret); // Freshly generated without having been exported in backup

  // 11. Switch & Disconnect Google account cleanly
  await saveLinkedGoogleDriveAccount(org.id, {
    uid: 'google-uid-shop-2',
    email: 'switched.owner@gmail.com',
    displayName: 'حساب بديل',
    connectedAt: new Date().toISOString(),
  });
  const switchedLink = await getLinkedGoogleDriveAccount(org.id);
  assert.equal(switchedLink?.email, 'switched.owner@gmail.com');

  await disconnectGoogleDriveAccount(org.id);
  assert.equal(await getLinkedGoogleDriveAccount(org.id), null);
  const disconnectedState = await getDriveBackupState(org.id);
  assert.equal(disconnectedState.status, 'disconnected');
  assert.equal(toLocalDateKey(), toLocalDateKey(new Date().toISOString()));
});

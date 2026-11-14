import { db } from '../db/qatshiDb';
import { toLocalDateKey } from '../domain/money';
import type {
  DriveBackupAttemptLog,
  DriveBackupState,
  DriveRetentionPolicy,
  RemoteDriveBackupFile,
} from '../domain/types';
import {
  createOrganizationBackup,
  restoreBackupWithSafetyNet,
} from './backupService';
import { generateUuid, getMeta, setMeta } from './device';
import {
  getInMemoryDriveAccessToken,
  getLinkedGoogleDriveAccount,
} from './googleAuthService';
import {
  downloadAndVerifyDriveBackupContent,
  fetchGoogleDriveTransport,
  pruneRemoteDriveBackupsAfterSuccess,
  verifyUploadedDriveBackup,
  type DriveTransport,
} from './googleDriveService';
import {
  acknowledgeNativeBackupTrigger,
  getNativeDailyBackupWorkStatus,
  scheduleNativeDailyBackupWork,
} from './nativeBackupBridge';

export const DEFAULT_DRIVE_RETENTION: DriveRetentionPolicy = {
  dailyEnabled: true,
  preferredHour: 23,
  retainDailyCount: 30,
  retainMonthlyCount: 12,
  keepManualCount: 10,
};

const MAX_HISTORY_ENTRIES = 25;
const inFlightOrgBackups = new Set<string>();
const sessionPassphraseCache = new Map<string, string>();

function stateMetaKey(orgId: string): string {
  return `driveBackupState:${orgId}`;
}

function wrappedPassKey(orgId: string): string {
  return `driveWrappedPass:${orgId}`;
}

function localWrappingCryptoKeyMeta(orgId: string): string {
  return `driveWrappingKey:${orgId}`;
}

export function computeNextScheduledIso(
  retention: DriveRetentionPolicy,
  lastSuccessDateKey?: string,
  now = new Date()
): string | undefined {
  if (!retention.dailyEnabled) return undefined;
  const target = new Date(now);
  const todayKey = toLocalDateKey(now.toISOString());
  if (lastSuccessDateKey === todayKey || now.getHours() >= retention.preferredHour) {
    target.setDate(target.getDate() + 1);
  }
  target.setHours(retention.preferredHour, 0, 0, 0);
  return target.toISOString();
}

export async function getDriveBackupState(orgId: string): Promise<DriveBackupState> {
  const [rawState, linkedAccount, wrappedExists] = await Promise.all([
    getMeta(stateMetaKey(orgId)),
    getLinkedGoogleDriveAccount(orgId),
    getMeta(wrappedPassKey(orgId)),
  ]);

  let parsed: Partial<DriveBackupState> = {};
  if (rawState) {
    try {
      parsed = JSON.parse(rawState) as Partial<DriveBackupState>;
    } catch {
      parsed = {};
    }
  }

  const retention: DriveRetentionPolicy = {
    ...DEFAULT_DRIVE_RETENTION,
    ...(parsed.retention || {}),
  };

  const passphraseConfigured =
    Boolean(sessionPassphraseCache.get(orgId)) || Boolean(wrappedExists) || Boolean(parsed.passphraseConfigured);

  let status = parsed.status || (linkedAccount ? 'idle' : 'disconnected');
  if (!linkedAccount) {
    status = 'disconnected';
  }

  return {
    orgId,
    linkedAccount,
    retention,
    passphraseConfigured,
    status,
    pendingReason: parsed.pendingReason,
    pendingSince: parsed.pendingSince,
    lastSuccessfulBackupAt: parsed.lastSuccessfulBackupAt,
    lastSuccessfulDateKey: parsed.lastSuccessfulDateKey,
    lastSuccessfulSizeBytes: parsed.lastSuccessfulSizeBytes,
    lastSuccessfulSha256: parsed.lastSuccessfulSha256,
    lastUploadedDataChecksum: parsed.lastUploadedDataChecksum,
    lastAttemptAt: parsed.lastAttemptAt,
    lastAttemptOutcome: parsed.lastAttemptOutcome,
    lastErrorMessage: parsed.lastErrorMessage,
    nextScheduledAt: computeNextScheduledIso(retention, parsed.lastSuccessfulDateKey),
    remoteBackupCount: parsed.remoteBackupCount,
    prunedCount: parsed.prunedCount,
    lastNativeTriggerAt: parsed.lastNativeTriggerAt,
    history: Array.isArray(parsed.history) ? parsed.history : [],
  };
}

export async function saveDriveBackupState(state: DriveBackupState): Promise<void> {
  const trimmed: DriveBackupState = {
    ...state,
    history: state.history.slice(0, MAX_HISTORY_ENTRIES),
    nextScheduledAt: computeNextScheduledIso(state.retention, state.lastSuccessfulDateKey),
  };
  await setMeta(stateMetaKey(state.orgId), JSON.stringify(trimmed));
}

function appendAttemptHistory(
  prev: DriveBackupAttemptLog[],
  entry: Omit<DriveBackupAttemptLog, 'id'>
): DriveBackupAttemptLog[] {
  return [{ id: generateUuid(), ...entry }, ...prev].slice(0, MAX_HISTORY_ENTRIES);
}

/**
 * Encrypts the backup passphrase locally using a non-extractable AES-GCM CryptoKey
 * stored in IndexedDB so unattended same-device catch-up backups can use the exact
 * same PBKDF2 passphrase without ever storing plaintext passwords or uploading keys.
 */
export async function configureDriveBackupPassphrase(orgId: string, passphrase: string): Promise<void> {
  const clean = passphrase.trim();
  if (clean.length < 6) {
    throw new Error('كلمة مرور تشفير النسخ الاحتياطي يجب أن تكون 6 أحرف على الأقل');
  }
  sessionPassphraseCache.set(orgId, clean);

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const wrappingKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable from JS
        ['encrypt', 'decrypt']
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        wrappingKey,
        new TextEncoder().encode(clean)
      );

      // IndexedDB supports structured cloning of non-extractable CryptoKey in browsers
      await db.kvMeta.put({
        key: localWrappingCryptoKeyMeta(orgId),
        value: wrappingKey as unknown as string,
      });
      await setMeta(
        wrappedPassKey(orgId),
        JSON.stringify({
          iv: Array.from(iv),
          cipher: Array.from(new Uint8Array(cipher)),
        })
      );
    }
  } catch {
    // Fallback cleanly to in-memory session cache if environment forbids structured-cloned CryptoKey
  }

  const state = await getDriveBackupState(orgId);
  await saveDriveBackupState({ ...state, passphraseConfigured: true });
}

export async function clearDriveBackupPassphrase(orgId: string): Promise<void> {
  sessionPassphraseCache.delete(orgId);
  await db.kvMeta.delete(wrappedPassKey(orgId));
  await db.kvMeta.delete(localWrappingCryptoKeyMeta(orgId));
}

export async function resolveDriveEncryptionPassphrase(
  orgId: string,
  override?: string
): Promise<string | null> {
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  const inMemory = sessionPassphraseCache.get(orgId);
  if (inMemory) return inMemory;

  try {
    const keyRow = await db.kvMeta.get(localWrappingCryptoKeyMeta(orgId));
    const wrappedRaw = await getMeta(wrappedPassKey(orgId));
    if (!keyRow?.value || !wrappedRaw) return null;
    const wrappingKey = keyRow.value as unknown as CryptoKey;
    const parsed = JSON.parse(wrappedRaw) as { iv: number[]; cipher: number[] };
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(parsed.iv) },
      wrappingKey,
      new Uint8Array(parsed.cipher)
    );
    const decoded = new TextDecoder().decode(plainBuf);
    sessionPassphraseCache.set(orgId, decoded);
    return decoded;
  } catch {
    return null;
  }
}

export async function updateDriveRetentionPolicy(
  orgId: string,
  retention: DriveRetentionPolicy
): Promise<DriveBackupState> {
  const state = await getDriveBackupState(orgId);
  const updated: DriveBackupState = {
    ...state,
    retention: {
      dailyEnabled: Boolean(retention.dailyEnabled),
      preferredHour: Math.max(0, Math.min(23, Math.floor(retention.preferredHour))),
      retainDailyCount: Math.max(1, Math.min(365, Math.floor(retention.retainDailyCount))),
      retainMonthlyCount: Math.max(0, Math.min(60, Math.floor(retention.retainMonthlyCount))),
      keepManualCount: Math.max(1, Math.min(50, Math.floor(retention.keepManualCount))),
    },
  };
  await saveDriveBackupState(updated);
  await scheduleNativeDailyBackupWork({
    orgId,
    enabled: updated.retention.dailyEnabled && Boolean(updated.linkedAccount),
    preferredHour: updated.retention.preferredHour,
  });
  return updated;
}

export function isDailyBackupDue(state: DriveBackupState, now = new Date()): boolean {
  if (!state.linkedAccount || !state.retention.dailyEnabled) return false;
  const todayKey = toLocalDateKey(now.toISOString());
  if (state.lastSuccessfulDateKey === todayKey) return false;
  if (!state.lastSuccessfulBackupAt) return true;
  if (state.pendingSince) return true;
  return now.getHours() >= state.retention.preferredHour || state.lastSuccessfulDateKey !== todayKey;
}

export async function executeGoogleDriveBackup(params: {
  orgId: string;
  trigger: DriveBackupAttemptLog['trigger'];
  backupKind?: 'daily' | 'monthly' | 'manual' | 'pre_maintenance';
  force?: boolean;
  isOnlineOverride?: boolean;
  passphraseOverride?: string;
  accessTokenOverride?: string;
  transport?: DriveTransport;
  now?: Date;
}): Promise<{
  outcome: DriveBackupAttemptLog['outcome'];
  state: DriveBackupState;
  uploadedFile?: RemoteDriveBackupFile;
  message: string;
}> {
  const transport = params.transport || fetchGoogleDriveTransport;
  const nowDate = params.now || new Date();
  const nowIso = nowDate.toISOString();
  const todayKey = toLocalDateKey(nowIso);

  if (inFlightOrgBackups.has(params.orgId)) {
    const curr = await getDriveBackupState(params.orgId);
    return {
      outcome: 'skipped_duplicate',
      state: curr,
      message: 'عملية نسخ احتياطي جارية حالياً — تم منع التكرار',
    };
  }

  inFlightOrgBackups.add(params.orgId);
  try {
    const state = await getDriveBackupState(params.orgId);
    if (!state.linkedAccount) {
      return {
        outcome: 'failed',
        state,
        message: 'لم يتم ربط حساب Google Drive لهذه المؤسسة بعد',
      };
    }

    // Deduplicate automatic daily triggers when already backed up today
    if (!params.force && state.lastSuccessfulDateKey === todayKey) {
      return {
        outcome: 'skipped_duplicate',
        state,
        message: 'تم إنشاء نسخة اليوم السحابية مسبقاً بنجاح',
      };
    }

    const online =
      params.isOnlineOverride !== undefined
        ? params.isOnlineOverride
        : typeof navigator === 'undefined'
        ? true
        : navigator.onLine;

    if (!online) {
      const pendingState: DriveBackupState = {
        ...state,
        status: 'pending_offline',
        pendingSince: state.pendingSince || nowIso,
        pendingReason: 'الإنترنت غير متصل — سيتم الرفع تلقائياً فور عودة الاتصال',
        lastAttemptAt: nowIso,
        lastAttemptOutcome: 'deferred_offline',
        history: appendAttemptHistory(state.history, {
          at: nowIso,
          trigger: params.trigger,
          outcome: 'deferred_offline',
          message: 'تأجيل النسخ الاحتياطي لعدم توفر اتصال بالإنترنت — محفوظ للمتابعة تلقائياً',
        }),
      };
      await saveDriveBackupState(pendingState);
      return {
        outcome: 'deferred_offline',
        state: pendingState,
        message: pendingState.pendingReason!,
      };
    }

    const accessToken =
      params.accessTokenOverride !== undefined
        ? params.accessTokenOverride
        : await getInMemoryDriveAccessToken();

    if (!accessToken) {
      const authState: DriveBackupState = {
        ...state,
        status: 'needs_auth',
        pendingSince: state.pendingSince || nowIso,
        pendingReason: 'جلسة Google Drive تحتاج تجديد الدخول لإتمام الرفع',
        lastAttemptAt: nowIso,
        lastAttemptOutcome: 'needs_auth',
        history: appendAttemptHistory(state.history, {
          at: nowIso,
          trigger: params.trigger,
          outcome: 'needs_auth',
          message: 'تعذر الرفع — يتطلب إعادة المصادقة مع حساب Google المرتبط',
        }),
      };
      await saveDriveBackupState(authState);
      return {
        outcome: 'needs_auth',
        state: authState,
        message: authState.pendingReason!,
      };
    }

    const passphrase = await resolveDriveEncryptionPassphrase(params.orgId, params.passphraseOverride);
    if (!passphrase) {
      const errMsg = 'يجب تعيين كلمة مرور تشفير النسخ السحابية قبل الرفع إلى Google Drive';
      const errState: DriveBackupState = {
        ...state,
        status: 'error',
        lastAttemptAt: nowIso,
        lastAttemptOutcome: 'failed',
        lastErrorMessage: errMsg,
        history: appendAttemptHistory(state.history, {
          at: nowIso,
          trigger: params.trigger,
          outcome: 'failed',
          message: errMsg,
        }),
      };
      await saveDriveBackupState(errState);
      return { outcome: 'failed', state: errState, message: errMsg };
    }

    // Mark running state
    await saveDriveBackupState({ ...state, status: 'running' });

    // Determine kind: automatic first backup of a month becomes 'monthly' snapshot for longer retention
    const monthPrefix = todayKey.slice(0, 7);
    const shouldTagMonthly =
      !params.backupKind &&
      state.retention.retainMonthlyCount > 0 &&
      (!state.lastSuccessfulDateKey || !state.lastSuccessfulDateKey.startsWith(monthPrefix));

    const backupKind: RemoteDriveBackupFile['backupKind'] =
      params.backupKind || (shouldTagMonthly ? 'monthly' : 'daily');

    // Create transactionally consistent AES-256-GCM encrypted backup
    const backup = await createOrganizationBackup({
      orgId: params.orgId,
      password: passphrase,
      storageType: 'google_drive',
      backupKind,
      remoteAccountEmail: state.linkedAccount.email,
    });

    // Skip redundant upload if database content hasn't changed at all (unless manual/forced)
    if (!params.force && state.lastUploadedDataChecksum === backup.dataChecksum) {
      const skippedState: DriveBackupState = {
        ...state,
        status: 'idle',
        pendingReason: undefined,
        pendingSince: undefined,
        lastSuccessfulDateKey: todayKey,
        lastAttemptAt: nowIso,
        lastAttemptOutcome: 'skipped_duplicate',
        lastErrorMessage: undefined,
        history: appendAttemptHistory(state.history, {
          at: nowIso,
          trigger: params.trigger,
          outcome: 'skipped_duplicate',
          message: 'لم تتغير بيانات المحل منذ آخر نسخة مرفوعة — تم تفادي التكرار',
        }),
      };
      await saveDriveBackupState(skippedState);
      await acknowledgeNativeBackupTrigger(params.orgId);
      return {
        outcome: 'skipped_duplicate',
        state: skippedState,
        message: 'لا توجد تغييرات جديدة منذ آخر نسخة محفوظة في Google Drive',
      };
    }

    const org = await db.organizations.get(params.orgId);
    const safeOrgName = (org?.name || 'محل قاتشي').slice(0, 64);

    const uploaded = await transport.uploadAppDataFile({
      accessToken,
      fileName: backup.fileName,
      content: backup.fileContent,
      appProperties: {
        app: 'QATSHI',
        orgId: params.orgId,
        orgName: safeOrgName,
        backupKind,
        dateKey: todayKey,
        sha256: backup.fileSha256,
        dataChecksum: backup.dataChecksum,
        recordCount: String(backup.record.recordCount),
        schemaVersion: '3',
        encrypted: 'true',
      },
    });

    // Verify upload completion & SHA-256
    await verifyUploadedDriveBackup({
      uploaded,
      expectedSha256: backup.fileSha256,
      expectedMinBytes: backup.record.sizeBytes,
    });

    // Record local backup history entry with remote file ID
    await db.backupRecords.put({
      ...backup.record,
      remoteFileId: uploaded.id,
      remoteAccountEmail: state.linkedAccount.email,
      sha256: backup.fileSha256,
      storageType: 'google_drive',
    });

    // ONLY AFTER verified success: enforce retention policy pruning
    const prunedCount = await pruneRemoteDriveBackupsAfterSuccess({
      transport,
      accessToken,
      orgId: params.orgId,
      retention: state.retention,
      newlyUploadedFileId: uploaded.id,
    });

    const remoteFilesAfter = await transport
      .listAppDataFiles(accessToken, params.orgId)
      .catch(() => []);

    const successState: DriveBackupState = {
      ...state,
      status: 'idle',
      pendingReason: undefined,
      pendingSince: undefined,
      lastSuccessfulBackupAt: nowIso,
      lastSuccessfulDateKey: todayKey,
      lastSuccessfulSizeBytes: backup.record.sizeBytes,
      lastSuccessfulSha256: backup.fileSha256,
      lastUploadedDataChecksum: backup.dataChecksum,
      lastAttemptAt: nowIso,
      lastAttemptOutcome: 'success',
      lastErrorMessage: undefined,
      remoteBackupCount: remoteFilesAfter.length || (state.remoteBackupCount ?? 0) + 1,
      prunedCount,
      history: appendAttemptHistory(state.history, {
        at: nowIso,
        trigger: params.trigger,
        outcome: 'success',
        backupKind,
        fileName: uploaded.name,
        remoteFileId: uploaded.id,
        sizeBytes: backup.record.sizeBytes,
        sha256: backup.fileSha256,
        message: 'تم تشفير النسخة والتحقق من SHA-256 ورفعها إلى Google Drive بنجاح',
      }),
    };
    await saveDriveBackupState(successState);
    await acknowledgeNativeBackupTrigger(params.orgId);

    return {
      outcome: 'success',
      state: successState,
      uploadedFile: uploaded,
      message: 'تم إنشاء النسخة الاحتياطية المشفرة ورفعها والتحقق منها بنجاح',
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isUnauthorized = rawMsg.startsWith('DRIVE_UNAUTHORIZED:') || rawMsg.startsWith('DRIVE_FORBIDDEN:');
    const cleanMsg = rawMsg
      .replace(/^DRIVE_[A-Z0-9_]+:/, '')
      .trim();

    const prevState = await getDriveBackupState(params.orgId);
    const failedState: DriveBackupState = {
      ...prevState,
      status: isUnauthorized ? 'needs_auth' : 'error',
      lastAttemptAt: nowIso,
      lastAttemptOutcome: isUnauthorized ? 'needs_auth' : 'failed',
      lastErrorMessage: cleanMsg,
      history: appendAttemptHistory(prevState.history, {
        at: nowIso,
        trigger: params.trigger,
        outcome: isUnauthorized ? 'needs_auth' : 'failed',
        message: cleanMsg,
      }),
    };
    await saveDriveBackupState(failedState);
    return {
      outcome: failedState.lastAttemptOutcome!,
      state: failedState,
      message: cleanMsg,
    };
  } finally {
    inFlightOrgBackups.delete(params.orgId);
  }
}

export async function runDriveBackupCatchUp(params: {
  orgId: string;
  trigger: 'app_resume' | 'online_catchup' | 'daily_auto';
  isOnlineOverride?: boolean;
  accessTokenOverride?: string;
  transport?: DriveTransport;
  now?: Date;
}): Promise<{
  executed: boolean;
  outcome?: DriveBackupAttemptLog['outcome'];
  state: DriveBackupState;
}> {
  const state = await getDriveBackupState(params.orgId);
  const nativeStatus = await getNativeDailyBackupWorkStatus(params.orgId);

  const due =
    isDailyBackupDue(state, params.now) ||
    Boolean(state.pendingSince) ||
    nativeStatus.pendingDueFromNative;

  if (!due) {
    return { executed: false, state };
  }

  const effectiveTrigger = nativeStatus.pendingDueFromNative ? 'native_workmanager' : params.trigger;
  const res = await executeGoogleDriveBackup({
    orgId: params.orgId,
    trigger: effectiveTrigger,
    isOnlineOverride: params.isOnlineOverride,
    accessTokenOverride: params.accessTokenOverride,
    transport: params.transport,
    now: params.now,
  });

  if (nativeStatus.lastNativeTriggerAt) {
    await saveDriveBackupState({
      ...res.state,
      lastNativeTriggerAt: nativeStatus.lastNativeTriggerAt,
    });
  }

  return { executed: true, outcome: res.outcome, state: res.state };
}

export async function listGoogleDriveBackups(params: {
  orgId?: string;
  accessTokenOverride?: string;
  transport?: DriveTransport;
}): Promise<RemoteDriveBackupFile[]> {
  const token =
    params.accessTokenOverride !== undefined
      ? params.accessTokenOverride
      : await getInMemoryDriveAccessToken();
  if (!token) {
    throw new Error('DRIVE_UNAUTHORIZED:يرجى تسجيل الدخول بحساب Google أولاً لعرض النسخ الاحتياطية');
  }
  const transport = params.transport || fetchGoogleDriveTransport;
  return transport.listAppDataFiles(token, params.orgId);
}

export async function restoreFromGoogleDriveFile(params: {
  file: RemoteDriveBackupFile;
  passphrase: string;
  currentOrgId: string;
  allowCrossOrgRestore: boolean;
  accessTokenOverride?: string;
  transport?: DriveTransport;
}) {
  const token =
    params.accessTokenOverride !== undefined
      ? params.accessTokenOverride
      : await getInMemoryDriveAccessToken();
  if (!token) {
    throw new Error('DRIVE_UNAUTHORIZED:يرجى تسجيل الدخول بحساب Google أولاً لاستعادة النسخة');
  }
  const transport = params.transport || fetchGoogleDriveTransport;

  const rawText = await downloadAndVerifyDriveBackupContent({
    transport,
    accessToken: token,
    file: params.file,
  });

  return restoreBackupWithSafetyNet({
    rawText,
    password: params.passphrase,
    currentOrgId: params.currentOrgId,
    allowCrossOrgRestore: params.allowCrossOrgRestore,
    expectedFileSha256: params.file.sha256 || undefined,
  });
}

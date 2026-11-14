import type { DriveRetentionPolicy, RemoteDriveBackupFile } from '../domain/types';
import { sha256Hex } from './backupService';

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime,appProperties';

export interface DriveUploadInput {
  accessToken: string;
  fileName: string;
  content: string;
  appProperties: Record<string, string>;
}

export interface DriveTransport {
  listAppDataFiles(accessToken: string, orgId?: string): Promise<RemoteDriveBackupFile[]>;
  uploadAppDataFile(input: DriveUploadInput): Promise<RemoteDriveBackupFile>;
  downloadAppDataFile(accessToken: string, fileId: string): Promise<string>;
  deleteAppDataFile(accessToken: string, fileId: string): Promise<void>;
}

interface RawDriveFile {
  id?: string;
  name?: string;
  size?: string | number;
  createdTime?: string;
  appProperties?: Record<string, string>;
}

function mapRawDriveFile(raw: RawDriveFile): RemoteDriveBackupFile | null {
  if (!raw.id || !raw.name) return null;
  const props = raw.appProperties || {};
  if (props.app && props.app !== 'QATSHI') return null;

  const kindRaw = props.backupKind;
  const backupKind: RemoteDriveBackupFile['backupKind'] =
    kindRaw === 'monthly' || kindRaw === 'manual' || kindRaw === 'pre_maintenance' ? kindRaw : 'daily';

  return {
    id: raw.id,
    name: raw.name,
    sizeBytes: Number(raw.size || 0) || 0,
    createdTime: raw.createdTime || new Date().toISOString(),
    orgId: props.orgId || '',
    orgName: props.orgName || 'محل قاتشي',
    backupKind,
    dateKey: props.dateKey || (raw.createdTime || '').slice(0, 10),
    sha256: props.sha256 || '',
    dataChecksum: props.dataChecksum || '',
    recordCount: Number(props.recordCount || 0) || 0,
    schemaVersion: Number(props.schemaVersion || 1) || 1,
    encrypted: props.encrypted !== 'false',
  };
}

function classifyDriveHttpError(status: number, bodyText: string): Error {
  if (status === 401) {
    return new Error('DRIVE_UNAUTHORIZED:انتهت صلاحية جلسة Google Drive — يرجى إعادة تسجيل الدخول');
  }
  if (status === 403) {
    return new Error('DRIVE_FORBIDDEN:حساب Google غير مصرح له بالوصول إلى مجلد النسخ الاحتياطي للتطبيق');
  }
  if (status === 404) {
    return new Error('DRIVE_NOT_FOUND:ملف النسخة الاحتياطية غير موجود في Google Drive');
  }
  return new Error(`DRIVE_HTTP_${status}:تعذر الاتصال بخدمة Google Drive (${status}) ${bodyText.slice(0, 120)}`);
}

export const fetchGoogleDriveTransport: DriveTransport = {
  async listAppDataFiles(accessToken: string, orgId?: string): Promise<RemoteDriveBackupFile[]> {
    const queryParts = ["trashed = false", "appProperties has { key='app' and value='QATSHI' }"];
    if (orgId) {
      const safeOrgId = orgId.replace(/'/g, "\\'");
      queryParts.push(`appProperties has { key='orgId' and value='${safeOrgId}' }`);
    }
    const url =
      `${DRIVE_FILES_API}?spaces=appDataFolder` +
      `&q=${encodeURIComponent(queryParts.join(' and '))}` +
      `&orderBy=createdTime%20desc` +
      `&pageSize=100` +
      `&fields=${encodeURIComponent('files(id,name,size,createdTime,appProperties)')}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw classifyDriveHttpError(res.status, await res.text().catch(() => ''));
    }
    const data = (await res.json()) as { files?: RawDriveFile[] };
    return (data.files || [])
      .map(mapRawDriveFile)
      .filter((f): f is RemoteDriveBackupFile => f !== null);
  },

  async uploadAppDataFile(input: DriveUploadInput): Promise<RemoteDriveBackupFile> {
    const boundary = `qatshi_drive_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const metadata = {
      name: input.fileName,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
      appProperties: input.appProperties,
    };

    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${input.content}\r\n` +
      `--${boundary}--`;

    const res = await fetch(DRIVE_UPLOAD_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      throw classifyDriveHttpError(res.status, await res.text().catch(() => ''));
    }

    const raw = (await res.json()) as RawDriveFile;
    const mapped = mapRawDriveFile(raw);
    if (!mapped || !mapped.id) {
      throw new Error('لم يُرجع Google Drive معرّفاً صالحاً للنسخة المرفوعة');
    }
    return mapped;
  },

  async downloadAppDataFile(accessToken: string, fileId: string): Promise<string> {
    const url = `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw classifyDriveHttpError(res.status, await res.text().catch(() => ''));
    }
    return res.text();
  },

  async deleteAppDataFile(accessToken: string, fileId: string): Promise<void> {
    const url = `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404) {
      throw classifyDriveHttpError(res.status, await res.text().catch(() => ''));
    }
  },
};

export async function verifyUploadedDriveBackup(params: {
  uploaded: RemoteDriveBackupFile;
  expectedSha256: string;
  expectedMinBytes: number;
}): Promise<void> {
  if (!params.uploaded.id) {
    throw new Error('فشل التحقق من اكتمال الرفع — معرف الملف غير متوفر');
  }
  if (params.uploaded.sizeBytes > 0 && params.uploaded.sizeBytes < Math.min(20, params.expectedMinBytes)) {
    throw new Error('فشل التحقق من اكتمال الرفع — حجم الملف المرفوع غير مكتمل');
  }
  if (params.uploaded.sha256 && params.uploaded.sha256 !== params.expectedSha256) {
    throw new Error('فشل التحقق من تطابق بصمة SHA-256 بعد الرفع إلى Google Drive');
  }
}

export async function downloadAndVerifyDriveBackupContent(params: {
  transport: DriveTransport;
  accessToken: string;
  file: RemoteDriveBackupFile;
}): Promise<string> {
  const rawContent = await params.transport.downloadAppDataFile(params.accessToken, params.file.id);
  if (!rawContent || rawContent.trim().length === 0) {
    throw new Error('الملف الذي تم تنزيله من Google Drive فارغ أو تالف');
  }
  if (params.file.sha256) {
    const actualSha = await sha256Hex(rawContent);
    if (actualSha !== params.file.sha256) {
      throw new Error('فشل التحقق من بصمة SHA-256 للملف المنزّل من Google Drive — الملف تالف أو معدل');
    }
  }
  return rawContent;
}

export function selectFilesToPruneByRetention(params: {
  files: RemoteDriveBackupFile[];
  retention: DriveRetentionPolicy;
  protectedFileId?: string;
}): RemoteDriveBackupFile[] {
  const sorted = [...params.files].sort((a, b) => b.createdTime.localeCompare(a.createdTime));

  const dailyKeep: RemoteDriveBackupFile[] = [];
  const monthlyKeep: RemoteDriveBackupFile[] = [];
  const manualKeep: RemoteDriveBackupFile[] = [];
  const seenMonths = new Set<string>();
  const toDelete: RemoteDriveBackupFile[] = [];

  for (const file of sorted) {
    if (file.id === params.protectedFileId) {
      dailyKeep.push(file);
      continue;
    }

    if (file.backupKind === 'monthly') {
      const monthKey = (file.dateKey || file.createdTime).slice(0, 7);
      if (monthlyKeep.length < Math.max(0, params.retention.retainMonthlyCount) && !seenMonths.has(monthKey)) {
        seenMonths.add(monthKey);
        monthlyKeep.push(file);
      } else {
        toDelete.push(file);
      }
      continue;
    }

    if (file.backupKind === 'manual' || file.backupKind === 'pre_maintenance') {
      if (manualKeep.length < Math.max(1, params.retention.keepManualCount)) {
        manualKeep.push(file);
      } else {
        toDelete.push(file);
      }
      continue;
    }

    if (dailyKeep.length < Math.max(1, params.retention.retainDailyCount)) {
      dailyKeep.push(file);
    } else {
      toDelete.push(file);
    }
  }

  return toDelete;
}

export async function pruneRemoteDriveBackupsAfterSuccess(params: {
  transport: DriveTransport;
  accessToken: string;
  orgId: string;
  retention: DriveRetentionPolicy;
  newlyUploadedFileId: string;
}): Promise<number> {
  if (!params.newlyUploadedFileId) return 0;

  const files = await params.transport.listAppDataFiles(params.accessToken, params.orgId);
  const deletable = selectFilesToPruneByRetention({
    files,
    retention: params.retention,
    protectedFileId: params.newlyUploadedFileId,
  });

  let deletedCount = 0;
  for (const oldFile of deletable) {
    try {
      await params.transport.deleteAppDataFile(params.accessToken, oldFile.id);
      deletedCount++;
    } catch {
      // Never abort or fail the already-succeeded backup if pruning one stale file fails
    }
  }
  return deletedCount;
}

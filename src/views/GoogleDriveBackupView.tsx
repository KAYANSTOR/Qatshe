import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  Cloud,
  CloudOff,
  CloudUpload,
  DatabaseBackup,
  HardDriveDownload,
  History,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useQatshi } from '../context/QatshiContext';
import { formatDateArabic } from '../domain/money';
import type { DriveBackupOutcome, DriveBackupState, RemoteDriveBackupFile } from '../domain/types';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  connectGoogleDriveAccount,
  disconnectGoogleDriveAccount,
  getInMemoryDriveAccessToken,
  initGoogleDriveAuth,
} from '../services/googleAuthService';
import {
  configureDriveBackupPassphrase,
  executeGoogleDriveBackup,
  getDriveBackupState,
  listGoogleDriveBackups,
  restoreFromGoogleDriveFile,
  updateDriveRetentionPolicy,
} from '../services/googleDriveBackupScheduler';
import {
  getNativeDailyBackupWorkStatus,
  scheduleNativeDailyBackupWork,
  type NativeBackupWorkStatus,
} from '../services/nativeBackupBridge';
import {
  BottomSheet,
  PageHeader,
  PrimaryButton,
  SurfaceCard,
} from '../components/ui/LuxuryUI';

const GoogleBrandMark: React.FC = () => (
  <svg
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 48 48"
    className="h-full w-full block"
    aria-hidden="true"
  >
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
    <path fill="none" d="M0 0h48v48H0z" />
  </svg>
);

const GoogleSignInButton: React.FC<{
  label: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, disabled, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="gsi-material-button"
  >
    <div className="gsi-material-button-state" />
    <div className="gsi-material-button-content-wrapper">
      <div className="gsi-material-button-icon">
        <GoogleBrandMark />
      </div>
      <span className="gsi-material-button-contents">{label}</span>
    </div>
  </button>
);

function formatBytesArabic(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} ميجابايت`;
}

function outcomeLabelArabic(outcome?: DriveBackupOutcome): string {
  switch (outcome) {
    case 'success':
      return 'نجحت العملية';
    case 'skipped_duplicate':
      return 'تم التخطي (لا توجد تغييرات)';
    case 'deferred_offline':
      return 'مؤجلة لعدم توفر الإنترنت';
    case 'needs_auth':
      return 'بانتظار إعادة تسجيل الدخول';
    case 'failed':
      return 'فشلت المحاولة';
    default:
      return 'لا توجد محاولات بعد';
  }
}

export const GoogleDriveBackupView: React.FC = () => {
  const { org, navigate, refreshData, switchOrganization, showToast } = useQatshi();
  const isOnline = useOnlineStatus();

  const [driveState, setDriveState] = useState<DriveBackupState | null>(null);
  const [hasMemoryToken, setHasMemoryToken] = useState(false);
  const [nativeStatus, setNativeStatus] = useState<NativeBackupWorkStatus | null>(null);

  const [busyAuth, setBusyAuth] = useState(false);
  const [busyBackup, setBusyBackup] = useState(false);
  const [busyList, setBusyList] = useState(false);
  const [busyRestore, setBusyRestore] = useState(false);

  const [passInput, setPassInput] = useState('');
  const [passModalOpen, setPassModalOpen] = useState(false);

  const [remoteSheetOpen, setRemoteSheetOpen] = useState(false);
  const [remoteFiles, setRemoteFiles] = useState<RemoteDriveBackupFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<RemoteDriveBackupFile | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [allowCrossOrg, setAllowCrossOrg] = useState(false);

  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmSwitchOpen, setConfirmSwitchOpen] = useState(false);

  const orgId = org?.id || '';

  const loadState = useCallback(async () => {
    const token = await getInMemoryDriveAccessToken();
    setHasMemoryToken(Boolean(token));
    if (!orgId) {
      setDriveState(null);
      setNativeStatus(await getNativeDailyBackupWorkStatus('recovery'));
      return;
    }
    const [st, nat] = await Promise.all([
      getDriveBackupState(orgId),
      getNativeDailyBackupWorkStatus(orgId),
    ]);
    setDriveState(st);
    setNativeStatus(nat);
  }, [orgId]);

  useEffect(() => {
    loadState().catch(() => {});
    const unsub = initGoogleDriveAuth(async ({ authenticated }) => {
      setHasMemoryToken(authenticated);
    });
    return () => unsub();
  }, [loadState]);

  const handleConnectGoogle = async (mode: 'connect' | 'switch' | 'reauth') => {
    setBusyAuth(true);
    try {
      const targetOrgId = orgId || 'fresh-device-recovery';
      const res = await connectGoogleDriveAccount({
        orgId: targetOrgId,
        mode,
        expectedEmail: mode === 'reauth' ? driveState?.linkedAccount?.email : undefined,
      });

      setHasMemoryToken(true);
      if (orgId) {
        const current = await getDriveBackupState(orgId);
        await scheduleNativeDailyBackupWork({
          orgId,
          enabled: current.retention.dailyEnabled,
          preferredHour: current.retention.preferredHour,
        });
      }

      await loadState();

      if (res.otherOrgWarning) {
        showToast(
          `تنبيه: هذا الحساب مرتبط أيضاً بمؤسسة أخرى (${res.otherOrgWarning}). تبقى بيانات كل مؤسسة معزولة.`,
          'info'
        );
      } else {
        showToast(`تم ربط حساب Google (${res.link.email}) بنجاح`);
      }

      if (!orgId) {
        // Fresh device recovery flow: open Drive backups directly after connecting
        await handleOpenRemoteList(res.accessToken);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر ربط حساب Google Drive';
      showToast(msg.replace('ACCOUNT_MISMATCH:', ''), 'error');
    } finally {
      setBusyAuth(false);
      setConfirmSwitchOpen(false);
    }
  };

  const handleDisconnect = async () => {
    if (!orgId) return;
    await disconnectGoogleDriveAccount(orgId);
    await scheduleNativeDailyBackupWork({ orgId, enabled: false, preferredHour: 23 });
    setHasMemoryToken(false);
    setConfirmDisconnectOpen(false);
    await loadState();
    showToast('تم فصل حساب Google Drive عن هذه المؤسسة', 'info');
  };

  const handleSavePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    try {
      await configureDriveBackupPassphrase(orgId, passInput);
      setPassInput('');
      setPassModalOpen(false);
      await loadState();
      showToast('تم حفظ كلمة مرور التشفير (AES-256-GCM) بنجاح');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ كلمة المرور', 'error');
    }
  };

  const handleBackupNow = async () => {
    if (!orgId) return;
    if (!driveState?.linkedAccount) {
      showToast('يرجى ربط حساب Google Drive أولاً', 'error');
      return;
    }
    if (!driveState.passphraseConfigured) {
      setPassModalOpen(true);
      showToast('عيّن كلمة مرور لتشفير النسخ السحابية قبل الرفع', 'info');
      return;
    }

    setBusyBackup(true);
    try {
      const res = await executeGoogleDriveBackup({
        orgId,
        trigger: 'manual',
        backupKind: 'manual',
        force: true,
      });
      await loadState();
      await refreshData();
      if (res.outcome === 'success') {
        showToast(res.message);
      } else if (res.outcome === 'deferred_offline' || res.outcome === 'needs_auth') {
        showToast(res.message, 'info');
      } else {
        showToast(res.message, 'error');
      }
    } finally {
      setBusyBackup(false);
    }
  };

  const handleOpenRemoteList = async (tokenOverride?: string) => {
    setBusyList(true);
    setSelectedFile(null);
    setRestorePass('');
    setAllowCrossOrg(false);
    try {
      const token = tokenOverride || (await getInMemoryDriveAccessToken());
      if (!token) {
        showToast('يرجى تسجيل الدخول بحساب Google أولاً لعرض النسخ المحفوظة', 'info');
        return;
      }
      const files = await listGoogleDriveBackups({
        orgId: undefined, // Show all QATSHI backups in this Google Drive appDataFolder so cross-device / org selection works cleanly
        accessTokenOverride: token,
      });
      setRemoteFiles(files);
      if (orgId && driveState) {
        const orgFilesCount = files.filter((f) => f.orgId === orgId).length;
        await loadState();
        setDriveState((prev) => (prev ? { ...prev, remoteBackupCount: orgFilesCount } : prev));
      }
      setRemoteSheetOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر جلب قائمة النسخ من Google Drive';
      showToast(msg.replace(/^DRIVE_[A-Z_]+:/, ''), 'error');
    } finally {
      setBusyList(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedFile) return;
    if (!restorePass.trim()) {
      showToast('أدخل كلمة مرور فك التشفير لاستعادة النسخة', 'error');
      return;
    }

    setBusyRestore(true);
    try {
      const res = await restoreFromGoogleDriveFile({
        file: selectedFile,
        passphrase: restorePass,
        currentOrgId: orgId,
        allowCrossOrgRestore: allowCrossOrg || !orgId,
      });
      setSelectedFile(null);
      setRemoteSheetOpen(false);
      await switchOrganization(res.payload.orgId);
      await refreshData();
      await loadState();
      showToast(
        `تمت استعادة بيانات "${res.payload.orgName}" والتحقق من ${res.integrityCheckedCustomers} حساب عميل بنجاح`
      );
      if (!orgId) {
        navigate('dashboard');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر استعادة النسخة';
      showToast(
        msg
          .replace(/^DRIVE_[A-Z_]+:/, '')
          .replace('PASSWORD_REQUIRED:', '')
          .replace('CROSS_ORG_MISMATCH:', ''),
        'error'
      );
    } finally {
      setBusyRestore(false);
    }
  };

  const statusMeta = (() => {
    if (!driveState?.linkedAccount) {
      return {
        label: 'غير مرتبط',
        tone: 'bg-[#F0ECE2] text-[#5C665E] dark:bg-[#1E2E24] dark:text-[#A9B8AC]',
      };
    }
    if (!isOnline || driveState.status === 'pending_offline') {
      return {
        label: 'نسخ معلق · بانتظار الإنترنت',
        tone: 'bg-[#F8EFE2] text-[#8B5C15] dark:bg-[#362612] dark:text-[#EBB867]',
      };
    }
    if (!hasMemoryToken || driveState.status === 'needs_auth') {
      return {
        label: 'يتطلب تأكيد جلسة Google',
        tone: 'bg-[#FCECE9] text-[#B93829] dark:bg-[#3B1915] dark:text-[#F0887C]',
      };
    }
    if (driveState.status === 'running') {
      return {
        label: 'جاري التشفير والرفع...',
        tone: 'bg-[#EAF0F7] text-[#284C75] dark:bg-[#18293D] dark:text-[#8EB6E6]',
      };
    }
    if (driveState.status === 'error') {
      return {
        label: 'يتطلب مراجعة آخر محاولة',
        tone: 'bg-[#FCECE9] text-[#B93829] dark:bg-[#3B1915] dark:text-[#F0887C]',
      };
    }
    return {
      label: 'مرتبط ونشط',
      tone: 'bg-[#E8F5ED] text-[#1D6A42] dark:bg-[#173626] dark:text-[#7AD0A1]',
    };
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title="النسخ الاحتياطي إلى Google Drive"
        subtitle={
          org
            ? 'حماية مشفرة ومزامنة يومية لبيانات المحل في حسابك الخاص'
            : 'استعادة بيانات محلك من حساب Google على هذا الهاتف'
        }
        icon={<Cloud className="h-5 w-5" />}
        backAction={() => navigate(org ? 'settings' : 'setup')}
      />

      {/* Fresh Device Recovery Banner when no org exists */}
      {!org && (
        <SurfaceCard className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-[14px] bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#86C89B] flex items-center justify-center shrink-0">
              <DatabaseBackup className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-extrabold">استعادة سريعة على هاتف جديد</h2>
              <p className="text-xs text-[#657369] dark:text-[#98A89C] mt-1 leading-relaxed">
                سجّل الدخول بحساب Google الذي كنت تحفظ عليه نسخ قاتشي لعرض النسخ الاحتياطية المشفرة وفك تشفيرها واستعادة جميع عملائك ومبيعاتك.
              </p>
            </div>
          </div>

          <GoogleSignInButton
            label={busyAuth ? 'جاري التحقق من الحساب...' : 'ربط حساب Google وعرض النسخ'}
            disabled={busyAuth || !isOnline}
            onClick={() => handleConnectGoogle('connect')}
          />
          {!isOnline && (
            <p className="text-xs text-[#9E6A14] dark:text-[#EBB354]">
              الاتصال بالإنترنت مطلوب للوصول إلى نسخ Google Drive.
            </p>
          )}
        </SurfaceCard>
      )}

      {/* Main Shop Mode Cards */}
      {org && driveState && (
        <>
          {/* 1. Connection & Status Summary Card */}
          <SurfaceCard className="p-0 overflow-hidden">
            <div className="p-4 bg-gradient-to-l from-[#183526] to-[#234A36] text-white space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-11 w-11 rounded-[14px] bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
                    {driveState.linkedAccount ? (
                      <Cloud className="h-5 w-5 text-[#F5D68E]" />
                    ) : (
                      <CloudOff className="h-5 w-5 text-white/75" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-white/75">حساب Google المرتبط</div>
                    <div className="font-display text-sm font-extrabold truncate">
                      {driveState.linkedAccount ? driveState.linkedAccount.email : 'غير مرتبط بعد'}
                    </div>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${statusMeta.tone}`}>
                  {statusMeta.label}
                </span>
              </div>

              <div className="text-[11px] text-[#C8DACD] leading-relaxed">
                يُحفظ النسخ في <span className="font-bold text-white">مجلد التطبيق الخاص (App Data)</span> فقط دون الوصول لبقية ملفاتك في Google Drive.
              </div>
            </div>

            <div className="p-4 grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-[14px] bg-[#FAF8F3] dark:bg-[#0D1A13] border border-[#EAE5D9] dark:border-[#203529]">
                <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">آخر نسخة ناجحة</div>
                <div className="font-display font-extrabold text-sm mt-1 tabular-nums">
                  {driveState.lastSuccessfulBackupAt
                    ? formatDateArabic(driveState.lastSuccessfulBackupAt, org.dateFormat, true)
                    : 'لا توجد بعد'}
                </div>
              </div>

              <div className="p-3 rounded-[14px] bg-[#FAF8F3] dark:bg-[#0D1A13] border border-[#EAE5D9] dark:border-[#203529]">
                <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">موعد النسخة القادمة</div>
                <div className="font-display font-extrabold text-sm mt-1 tabular-nums">
                  {driveState.linkedAccount && driveState.nextScheduledAt
                    ? formatDateArabic(driveState.nextScheduledAt, org.dateFormat, true)
                    : 'غير مجدولة'}
                </div>
              </div>

              <div className="p-3 rounded-[14px] bg-[#FAF8F3] dark:bg-[#0D1A13] border border-[#EAE5D9] dark:border-[#203529]">
                <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">حجم آخر نسخة</div>
                <div className="font-display font-extrabold text-sm mt-1 tabular-nums">
                  {formatBytesArabic(driveState.lastSuccessfulSizeBytes)}
                </div>
              </div>

              <div className="p-3 rounded-[14px] bg-[#FAF8F3] dark:bg-[#0D1A13] border border-[#EAE5D9] dark:border-[#203529]">
                <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">عدد النسخ الموجودة</div>
                <div className="font-display font-extrabold text-sm mt-1 tabular-nums">
                  {driveState.remoteBackupCount !== undefined ? `${driveState.remoteBackupCount} نسخة` : '—'}
                </div>
              </div>
            </div>

            <div className="px-4 pb-4 space-y-2">
              <div className="p-3 rounded-[14px] bg-[#F5F2EA] dark:bg-[#172B20] flex items-center justify-between gap-2 text-xs">
                <span className="text-[#657369] dark:text-[#98A89C]">نتيجة آخر محاولة</span>
                <span className="font-bold text-[#16281E] dark:text-[#EEF2EC]">
                  {outcomeLabelArabic(driveState.lastAttemptOutcome)}
                </span>
              </div>
              {driveState.lastSuccessfulSha256 && (
                <div className="flex items-center gap-1.5 text-[11px] text-[#1D6A42] dark:text-[#7AD0A1]">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>التشفير: AES-256-GCM · بصمة التحقق SHA-256 موثّقة</span>
                </div>
              )}
              {driveState.pendingReason && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-900 dark:text-amber-200">
                  {driveState.pendingReason}
                </div>
              )}
              {driveState.lastErrorMessage && driveState.status === 'error' && (
                <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-[11px] text-[#B93829] dark:text-red-300">
                  {driveState.lastErrorMessage}
                </div>
              )}
            </div>
          </SurfaceCard>

          {/* 2. Primary Actions Card (All 5 Requested Buttons) */}
          <SurfaceCard className="space-y-3">
            <h2 className="font-display text-sm font-extrabold">إجراءات النسخ والاستعادة</h2>

            {!driveState.linkedAccount ? (
              <GoogleSignInButton
                label={busyAuth ? 'جاري الربط...' : 'ربط حساب Google'}
                disabled={busyAuth || !isOnline}
                onClick={() => handleConnectGoogle('connect')}
              />
            ) : !hasMemoryToken ? (
              <GoogleSignInButton
                label={busyAuth ? 'جاري تسجيل الدخول...' : `تأكيد الدخول (${driveState.linkedAccount.email})`}
                disabled={busyAuth || !isOnline}
                onClick={() => handleConnectGoogle('reauth')}
              />
            ) : null}

            <div className="grid grid-cols-2 gap-2.5">
              <PrimaryButton
                onClick={handleBackupNow}
                disabled={busyBackup || !driveState.linkedAccount}
                className="w-full text-xs"
              >
                <CloudUpload className="h-4 w-4" />
                {busyBackup ? 'جاري الرفع...' : 'نسخ احتياطي الآن'}
              </PrimaryButton>

              <PrimaryButton
                variant="secondary"
                onClick={() => handleOpenRemoteList()}
                disabled={busyList || !driveState.linkedAccount}
                className="w-full text-xs"
              >
                <HardDriveDownload className="h-4 w-4" />
                {busyList ? 'جاري التحميل...' : 'استعادة نسخة احتياطية'}
              </PrimaryButton>
            </div>

            {driveState.linkedAccount && (
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={busyAuth || !isOnline}
                  onClick={() => setConfirmSwitchOpen(true)}
                  className="min-h-[44px] px-3 rounded-[14px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0D1A13] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:border-[#1E4230] disabled:opacity-50"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  تغيير الحساب
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmDisconnectOpen(true)}
                  className="min-h-[44px] px-3 rounded-[14px] border border-[#F5CEC7] dark:border-[#5D2922] bg-[#FCECE9] dark:bg-[#3A1915] text-[#B93829] dark:text-[#F49387] text-xs font-bold inline-flex items-center justify-center gap-1.5"
                >
                  <LogOut className="h-4 w-4" />
                  فصل الحساب
                </button>
              </div>
            )}
          </SurfaceCard>

          {/* 3. Encryption Passphrase Setup Card */}
          <SurfaceCard className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="h-10 w-10 rounded-[13px] bg-[#F5EFE3] dark:bg-[#2F2513] text-[#9E6A14] dark:text-[#EBB354] flex items-center justify-center shrink-0">
                <KeyRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-sm font-bold">تشفير النسخ السحابية (AES-256-GCM)</div>
                <div className="text-[11px] text-[#657369] dark:text-[#98A89C] mt-0.5">
                  {driveState.passphraseConfigured
                    ? 'تم تعيين كلمة مرور التشفير — جميع النسخ تُشفر محلياً قبل الرفع'
                    : 'مطلوبة لحماية بياناتك قبل الرفع وفك تشفيرها على أي هاتف جديد'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPassModalOpen(true)}
              className="min-h-[40px] px-3.5 rounded-[12px] bg-[#1E4230] text-white text-xs font-bold shrink-0"
            >
              {driveState.passphraseConfigured ? 'تحديث' : 'تعيين'}
            </button>
          </SurfaceCard>

          {/* 4. Retention Policy & Schedule Settings */}
          <SurfaceCard className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EFECE3] dark:border-[#21362A] flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[#1E4230] dark:text-[#86C89B]" />
              <h2 className="font-display text-sm font-extrabold">النسخ اليومي التلقائي وسياسة الاحتفاظ</h2>
            </div>

            <div className="divide-y divide-[#EFECE3] dark:divide-[#21362A]">
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold">تفعيل النسخ اليومي التلقائي</div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">
                    ينشئ نسخة يومية واحدة ويستدرك النسخ المتأخرة عند عودة الإنترنت
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={driveState.retention.dailyEnabled}
                  aria-label="تفعيل النسخ اليومي التلقائي"
                  onClick={async () => {
                    const updated = await updateDriveRetentionPolicy(orgId, {
                      ...driveState.retention,
                      dailyEnabled: !driveState.retention.dailyEnabled,
                    });
                    setDriveState(updated);
                    showToast(
                      updated.retention.dailyEnabled
                        ? 'تم تفعيل النسخ اليومي التلقائي'
                        : 'تم إيقاف النسخ التلقائي مؤقتاً'
                    );
                  }}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                    driveState.retention.dailyEnabled
                      ? 'bg-[#1E4230] border-[#1E4230] dark:bg-[#3A7D56] dark:border-[#3A7D56]'
                      : 'bg-[#E5E0D3] border-[#D3CCB9] dark:bg-[#192D22] dark:border-[#2C4636]'
                  }`}
                >
                  <span
                    className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-xs transition-all duration-200 ${
                      driveState.retention.dailyEnabled ? 'left-[3px]' : 'right-[3px]'
                    }`}
                  />
                </button>
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-bold text-sm">الساعة المفضلة للنسخ</div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">توقيت تشغيل النسخ اليومي</div>
                </div>
                <select
                  aria-label="الساعة المفضلة للنسخ"
                  value={driveState.retention.preferredHour}
                  onChange={async (e) => {
                    const updated = await updateDriveRetentionPolicy(orgId, {
                      ...driveState.retention,
                      preferredHour: Number(e.target.value),
                    });
                    setDriveState(updated);
                    showToast('تم تحديث موعد النسخ اليومي');
                  }}
                  className="min-h-[40px] px-3 rounded-[12px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] font-bold"
                >
                  <option value={21}>9:00 مساءً</option>
                  <option value={22}>10:00 مساءً</option>
                  <option value={23}>11:00 مساءً</option>
                  <option value={1}>1:00 صباحاً</option>
                  <option value={6}>6:00 صباحاً</option>
                </select>
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-bold text-sm">الاحتفاظ بالنسخ اليومية</div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">عدد النسخ اليومية المحفوظة في Drive</div>
                </div>
                <select
                  aria-label="الاحتفاظ بالنسخ اليومية"
                  value={driveState.retention.retainDailyCount}
                  onChange={async (e) => {
                    const updated = await updateDriveRetentionPolicy(orgId, {
                      ...driveState.retention,
                      retainDailyCount: Number(e.target.value),
                    });
                    setDriveState(updated);
                    showToast('تم حفظ سياسة الاحتفاظ بالنسخ اليومية');
                  }}
                  className="min-h-[40px] px-3 rounded-[12px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] font-bold"
                >
                  <option value={7}>آخر 7 أيام</option>
                  <option value={14}>آخر 14 يوماً</option>
                  <option value={30}>آخر 30 يوماً (الافتراضي)</option>
                  <option value={60}>آخر 60 يوماً</option>
                  <option value={90}>آخر 90 يوماً</option>
                </select>
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-bold text-sm">الاحتفاظ بالنسخ الشهرية</div>
                  <div className="text-[11px] text-[#657369] dark:text-[#98A89C]">حفظ نسخة بداية كل شهر لفترة أطول</div>
                </div>
                <select
                  aria-label="الاحتفاظ بالنسخ الشهرية"
                  value={driveState.retention.retainMonthlyCount}
                  onChange={async (e) => {
                    const updated = await updateDriveRetentionPolicy(orgId, {
                      ...driveState.retention,
                      retainMonthlyCount: Number(e.target.value),
                    });
                    setDriveState(updated);
                    showToast('تم حفظ سياسة الاحتفاظ الشهري');
                  }}
                  className="min-h-[40px] px-3 rounded-[12px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] font-bold"
                >
                  <option value={0}>بدون نسخ شهرية</option>
                  <option value={3}>آخر 3 أشهر</option>
                  <option value={6}>آخر 6 أشهر</option>
                  <option value={12}>آخر 12 شهراً (الافتراضي)</option>
                  <option value={24}>آخر 24 شهراً</option>
                </select>
              </div>
            </div>
          </SurfaceCard>

          {/* 5. Honest Background Execution & Android WorkManager Capabilities Card */}
          {nativeStatus && (
            <SurfaceCard className="space-y-2 bg-[#FAF8F3] dark:bg-[#0F1F17]">
              <div className="flex items-center gap-2 text-xs font-extrabold text-[#1E4230] dark:text-[#86C89B]">
                <Smartphone className="h-4 w-4" />
                <span>
                  {nativeStatus.isNativeAndroid
                    ? `بيئة Android Native · WorkManager (${nativeStatus.scheduled ? 'مجدول' : 'غير مجدول'})`
                    : 'بيئة المتصفح / PWA · استدراك تلقائي عند الفتح وعودة الإنترنت'}
                </span>
              </div>
              <p className="text-[11px] text-[#657369] dark:text-[#98A89C] leading-relaxed">
                {nativeStatus.platformNote} لا تُحذف أي نسخة قديمة قبل التحقق من نجاح رفع النسخة الجديدة.
              </p>
            </SurfaceCard>
          )}

          {/* 6. Recent Operations History Card */}
          <SurfaceCard className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EFECE3] dark:border-[#21362A] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-[#657369]" />
                <h2 className="font-display text-sm font-extrabold">سجل عمليات Google Drive</h2>
              </div>
              <button
                type="button"
                onClick={() => loadState()}
                className="text-xs font-bold text-[#1E4230] dark:text-[#86C89B] inline-flex items-center gap-1"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                تحديث
              </button>
            </div>

            {driveState.history.length === 0 ? (
              <p className="p-6 text-center text-xs text-[#657369]">لم تُنفذ أي عمليات نسخ إلى Google Drive بعد.</p>
            ) : (
              <div className="divide-y divide-[#EFECE3] dark:divide-[#21362A]">
                {driveState.history.slice(0, 10).map((item) => (
                  <div key={item.id} className="px-4 py-3 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#16281E] dark:text-[#EEF2EC]">
                        {outcomeLabelArabic(item.outcome)}
                      </span>
                      <span className="text-[11px] text-[#657369] tabular-nums">
                        {formatDateArabic(item.at, org.dateFormat, true)}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#657369] dark:text-[#98A89C]">{item.message}</p>
                    {item.sizeBytes && (
                      <div className="text-[10px] text-[#7A877D] tabular-nums">
                        الحجم: {formatBytesArabic(item.sizeBytes)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </>
      )}

      {/* Passphrase Modal */}
      <BottomSheet
        open={passModalOpen}
        onClose={() => setPassModalOpen(false)}
        title="كلمة مرور تشفير النسخ السحابية"
        subtitle="تشفير AES-256-GCM محلياً قبل الرفع إلى Google Drive"
        headerIcon={<KeyRound className="h-5 w-5" />}
      >
        <form onSubmit={handleSavePassphrase} className="space-y-4">
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            تنبيه هام: احتفظ بكلمة المرور هذه في مكان آمن. ستحتاجها لفك تشفير النسخة واستعادتها عند تغيير الهاتف أو فقدانه.
          </div>

          <div>
            <label htmlFor="drive-pass-input" className="block text-xs font-bold mb-1.5">
              كلمة مرور التشفير (6 أحرف على الأقل)
            </label>
            <input
              id="drive-pass-input"
              type="password"
              required
              minLength={6}
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              placeholder="أدخل كلمة مرور قوية لحماية نسخ المحل"
              className="w-full min-h-[48px] px-3.5 rounded-[14px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
            />
          </div>

          <PrimaryButton type="submit" className="w-full">
            <ShieldCheck className="h-4 w-4" />
            حفظ وتفعيل التشفير
          </PrimaryButton>
        </form>
      </BottomSheet>

      {/* Remote Drive Backups & Restore Confirmation BottomSheet */}
      <BottomSheet
        open={remoteSheetOpen}
        onClose={() => {
          setRemoteSheetOpen(false);
          setSelectedFile(null);
        }}
        title={selectedFile ? 'تأكيد استعادة النسخة السحابية' : 'النسخ المحفوظة في Google Drive'}
        subtitle={
          selectedFile
            ? selectedFile.orgName
            : `${remoteFiles.length} نسخة متاحة في مجلد التطبيق الخاص`
        }
        headerIcon={<HardDriveDownload className="h-5 w-5" />}
      >
        {!selectedFile ? (
          remoteFiles.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <CloudOff className="h-8 w-8 mx-auto text-[#8D9990]" />
              <div className="font-display font-bold text-sm">لا توجد نسخ احتياطية في هذا الحساب</div>
              <p className="text-xs text-[#657369]">
                تأكد من تسجيل الدخول بنفس حساب Google الذي حُفظت عليه نسخ قاتشي.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {remoteFiles.map((f) => {
                const isOtherOrg = Boolean(orgId && f.orgId && f.orgId !== orgId);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setSelectedFile(f);
                      setAllowCrossOrg(false);
                    }}
                    className="w-full p-3.5 rounded-[16px] bg-[#FAF8F3] dark:bg-[#0D1A13] border border-[#E4DFD4] dark:border-[#22382B] hover:border-[#1E4230] text-right space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display font-bold text-sm text-[#16281E] dark:text-[#EEF2EC] truncate">
                        {f.orgName}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8EFE9] dark:bg-[#193325] text-[#1E4230] dark:text-[#86C89B] shrink-0">
                        {f.backupKind === 'monthly'
                          ? 'شهرية'
                          : f.backupKind === 'manual'
                          ? 'يدوية'
                          : 'يومية'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#657369] dark:text-[#98A89C] tabular-nums">
                      <span>{formatDateArabic(f.createdTime, org?.dateFormat || 'YYYY-MM-DD', true)}</span>
                      <span>{formatBytesArabic(f.sizeBytes)}</span>
                    </div>
                    {isOtherOrg && (
                      <div className="text-[11px] font-bold text-[#9E6A14] dark:text-[#EBB354]">
                        تخص مؤسسة أخرى — يتطلب تأكيداً صريحاً للاستعادة
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="p-3.5 rounded-[16px] bg-[#FAF8F3] dark:bg-[#0D1A13] border border-[#E4DFD4] dark:border-[#22382B] space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#657369]">المؤسسة</span>
                <span className="font-bold">{selectedFile.orgName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#657369]">تاريخ النسخة</span>
                <span className="font-bold tabular-nums">
                  {formatDateArabic(selectedFile.createdTime, org?.dateFormat || 'YYYY-MM-DD', true)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#657369]">الحجم</span>
                <span className="font-bold tabular-nums">{formatBytesArabic(selectedFile.sizeBytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#657369]">عدد السجلات</span>
                <span className="font-bold tabular-nums">{selectedFile.recordCount} سجل</span>
              </div>
            </div>

            {orgId && selectedFile.orgId !== orgId && (
              <label className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowCrossOrg}
                  onChange={(e) => setAllowCrossOrg(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#1E4230]"
                />
                <span>
                  تحذير: هذه النسخة تخص مؤسسة مختلفة ({selectedFile.orgName}). أؤكد رغبتي في استعادتها.
                </span>
              </label>
            )}

            <div>
              <label htmlFor="drive-restore-pass" className="block text-xs font-bold mb-1.5">
                كلمة مرور فك التشفير *
              </label>
              <input
                id="drive-restore-pass"
                type="password"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
                placeholder="أدخل كلمة المرور لفك تشفير النسخة"
                className="w-full min-h-[48px] px-3.5 rounded-[14px] border border-[#D8D3C6] dark:border-[#2C4235] bg-[#FAF8F3] dark:bg-[#0B1610] text-sm"
              />
            </div>

            <div className="p-3 rounded-xl bg-[#E8F5ED] dark:bg-[#173626] text-[11px] text-[#1D6A42] dark:text-[#7AD0A1] flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                أمان إضافي: سيقوم قاتشي بإنشاء نسخة أمان محلية من بياناتك الحالية والتحقق من SHA-256 قبل استبدال أي بيانات، ثم مطابقة جميع الأرصدة مع دفتر الأستاذ.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <PrimaryButton
                variant="secondary"
                onClick={() => setSelectedFile(null)}
                disabled={busyRestore}
              >
                رجوع للقائمة
              </PrimaryButton>
              <PrimaryButton
                onClick={handleConfirmRestore}
                disabled={busyRestore || (Boolean(orgId && selectedFile.orgId !== orgId) && !allowCrossOrg)}
              >
                {busyRestore ? 'جاري الاستعادة...' : 'تأكيد الاستعادة الآن'}
              </PrimaryButton>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Switch Account Explicit Confirmation Sheet */}
      <BottomSheet
        open={confirmSwitchOpen}
        onClose={() => setConfirmSwitchOpen(false)}
        title="تغيير حساب Google المرتبط"
        headerIcon={<ArrowLeftRight className="h-5 w-5" />}
      >
        <div className="space-y-4">
          <p className="text-xs text-[#657369] dark:text-[#98A89C] leading-relaxed">
            سيتم ربط مؤسسة <strong>{org?.name}</strong> بحساب Google جديد تختاره من نافذة تسجيل الدخول، وتبدأ النسخ اليومية القادمة بالحفظ فيه.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <PrimaryButton variant="secondary" onClick={() => setConfirmSwitchOpen(false)}>
              إلغاء
            </PrimaryButton>
            <PrimaryButton onClick={() => handleConnectGoogle('switch')} disabled={busyAuth}>
              متابعة لاختيار الحساب
            </PrimaryButton>
          </div>
        </div>
      </BottomSheet>

      {/* Disconnect Account Explicit Confirmation Sheet */}
      <BottomSheet
        open={confirmDisconnectOpen}
        onClose={() => setConfirmDisconnectOpen(false)}
        title="تأكيد فصل حساب Google Drive"
        headerIcon={<AlertTriangle className="h-5 w-5 text-[#B93829]" />}
      >
        <div className="space-y-4">
          <p className="text-xs text-[#657369] dark:text-[#98A89C] leading-relaxed">
            هل تريد فصل الحساب <strong>{driveState?.linkedAccount?.email}</strong>؟ سيتوقف النسخ التلقائي اليومي إلى Google Drive لهذه المؤسسة، مع بقاء النسخ المرفوعة مسبقاً محفوظة في حسابك.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <PrimaryButton variant="secondary" onClick={() => setConfirmDisconnectOpen(false)}>
              إلغاء
            </PrimaryButton>
            <PrimaryButton variant="danger" onClick={handleDisconnect}>
              تأكيد فصل الحساب
            </PrimaryButton>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};

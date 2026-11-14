import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeBackupWorkStatus {
  isNativeAndroid: boolean;
  scheduled: boolean;
  workState?: 'ENQUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED' | 'NONE';
  lastNativeTriggerAt?: string;
  pendingDueFromNative: boolean;
  platformNote: string;
}

interface QatshiBackupPluginContract {
  scheduleDailyBackup(options: { orgId: string; intervalHours: number; preferredHour: number }): Promise<{
    scheduled: boolean;
    workState: string;
  }>;
  cancelDailyBackup(options: { orgId: string }): Promise<{ cancelled: boolean }>;
  getWorkStatus(options: { orgId: string }): Promise<{
    scheduled: boolean;
    workState: string;
    lastNativeTriggerAt?: string;
    pendingDueFromNative: boolean;
  }>;
  acknowledgeNativeTrigger(options: { orgId: string }): Promise<{ acknowledged: boolean }>;
}

const NativeQatshiBackup = registerPlugin<QatshiBackupPluginContract>('QatshiBackup');

const ANDROID_NATIVE_NOTE =
  'على Android يعمل المجدول الأصلي (WorkManager) مع احترام قيود البطارية وتوفر الإنترنت، ويسجّل استحقاق النسخة اليومية ليتم تنفيذ الرفع المشفر فور نشاط التطبيق.';

const WEB_PWA_NOTE =
  'في وضع المتصفح / PWA لا تسمح أنظمة التشغيل بتنفيذ مهام مجدولة عندما يكون التطبيق مغلقاً تماماً؛ لذلك يعتمد قاتشي على فحص الاستدراك التلقائي فور فتح التطبيق أو عودة اتصال الإنترنت.';

export async function scheduleNativeDailyBackupWork(params: {
  orgId: string;
  enabled: boolean;
  preferredHour: number;
}): Promise<NativeBackupWorkStatus> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return {
      isNativeAndroid: false,
      scheduled: false,
      pendingDueFromNative: false,
      platformNote: WEB_PWA_NOTE,
    };
  }

  try {
    if (!params.enabled) {
      await NativeQatshiBackup.cancelDailyBackup({ orgId: params.orgId });
      return {
        isNativeAndroid: true,
        scheduled: false,
        workState: 'CANCELLED',
        pendingDueFromNative: false,
        platformNote: ANDROID_NATIVE_NOTE,
      };
    }

    const res = await NativeQatshiBackup.scheduleDailyBackup({
      orgId: params.orgId,
      intervalHours: 24,
      preferredHour: params.preferredHour,
    });
    return {
      isNativeAndroid: true,
      scheduled: res.scheduled,
      workState: (res.workState as NativeBackupWorkStatus['workState']) || 'ENQUEUED',
      pendingDueFromNative: false,
      platformNote: ANDROID_NATIVE_NOTE,
    };
  } catch {
    return {
      isNativeAndroid: true,
      scheduled: false,
      pendingDueFromNative: false,
      platformNote: ANDROID_NATIVE_NOTE,
    };
  }
}

export async function getNativeDailyBackupWorkStatus(orgId: string): Promise<NativeBackupWorkStatus> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return {
      isNativeAndroid: false,
      scheduled: false,
      pendingDueFromNative: false,
      platformNote: WEB_PWA_NOTE,
    };
  }

  try {
    const res = await NativeQatshiBackup.getWorkStatus({ orgId });
    return {
      isNativeAndroid: true,
      scheduled: res.scheduled,
      workState: (res.workState as NativeBackupWorkStatus['workState']) || 'NONE',
      lastNativeTriggerAt: res.lastNativeTriggerAt || undefined,
      pendingDueFromNative: Boolean(res.pendingDueFromNative),
      platformNote: ANDROID_NATIVE_NOTE,
    };
  } catch {
    return {
      isNativeAndroid: true,
      scheduled: false,
      pendingDueFromNative: false,
      platformNote: ANDROID_NATIVE_NOTE,
    };
  }
}

export async function acknowledgeNativeBackupTrigger(orgId: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  try {
    await NativeQatshiBackup.acknowledgeNativeTrigger({ orgId });
  } catch {
    // Ignore native ack failure when plugin unavailable
  }
}

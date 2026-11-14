import { Capacitor, registerPlugin } from '@capacitor/core';
import { calculateSmsSegments, normalizeSmsPhoneNumber } from '../domain/sms';

export interface SimSlotInfo {
  subscriptionId: number;
  slotIndex: number;
  displayName: string;
  carrierName: string;
  number?: string;
}

export interface NativeSmsEnvironmentStatus {
  isNativeAndroid: boolean;
  platform: 'android' | 'web';
  sendSmsGranted: boolean;
  readPhoneStateGranted: boolean;
  hasTelephonyHardware: boolean;
  airplaneModeOn: boolean;
  hasCellularSignal: boolean;
  sims: SimSlotInfo[];
  unsupportedReason?: string;
  playStorePolicyNote: string;
}

export interface NativeContactPickResult {
  name: string;
  phone: string;
}

export interface DirectSmsDispatchResult {
  status: 'sent_to_network' | 'delivered' | 'failed' | 'unknown' | 'fallback_required';
  simSlot?: number;
  subscriptionId?: number;
  carrierName?: string;
  partsCount: number;
  encoding: 'GSM-7' | 'UCS-2';
  errorReason?: string;
  sentAt?: string;
  deliveredAt?: string;
}

export interface QatshiSmsPluginContract {
  checkEnvironment(): Promise<{
    sendSmsGranted: boolean;
    readPhoneStateGranted: boolean;
    hasTelephonyHardware: boolean;
    airplaneModeOn: boolean;
    hasCellularSignal: boolean;
    sims: SimSlotInfo[];
  }>;
  requestSmsPermissions(): Promise<{
    sendSmsGranted: boolean;
    readPhoneStateGranted: boolean;
  }>;
  pickContact(): Promise<{ cancelled: boolean; name?: string; phone?: string }>;
  sendDirectSms(options: {
    messageId: string;
    phone: string;
    body: string;
    subscriptionId?: number;
  }): Promise<{
    status: 'sent_to_network' | 'delivered' | 'failed' | 'unknown';
    simSlot?: number;
    subscriptionId?: number;
    carrierName?: string;
    partsCount?: number;
    errorReason?: string;
  }>;
  addListener?: (
    eventName: 'smsDeliveryStatus',
    listenerFunc: (event: { messageId: string; status: 'delivered' }) => void
  ) => Promise<{ remove: () => Promise<void> }>;
}

const NativeQatshiSms = registerPlugin<QatshiSmsPluginContract>('QatshiSms');

export interface SmsBridgeAdapter {
  getEnvironmentStatus(): Promise<NativeSmsEnvironmentStatus>;
  requestPermissions(): Promise<{ sendSmsGranted: boolean; readPhoneStateGranted: boolean }>;
  pickDeviceContact(): Promise<NativeContactPickResult | null>;
  sendSmsViaSim(params: {
    messageId: string;
    phone: string;
    body: string;
    subscriptionId?: number;
  }): Promise<DirectSmsDispatchResult>;
}

const PLAY_STORE_POLICY_NOTE =
  'سياسة Google Play تُقيّد إذن SEND_SMS على التطبيقات إلا في حالات محددة وتطلب نموذج تصريح (Permission Declaration Form). في النسخة المباشرة (APK) يعمل الإرسال عبر شريحة SIM مباشرة بعد منح الإذن، بينما يمكن لنسخة المتجر استخدام فتح تطبيق الرسائل الافتراضي دون أذونات مقيدة.';

export const capacitorSmsBridge: SmsBridgeAdapter = {
  async getEnvironmentStatus(): Promise<NativeSmsEnvironmentStatus> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return {
        isNativeAndroid: false,
        platform: 'web',
        sendSmsGranted: false,
        readPhoneStateGranted: false,
        hasTelephonyHardware: false,
        airplaneModeOn: false,
        hasCellularSignal: false,
        sims: [],
        unsupportedReason:
          'وضع المتصفح (Web / PWA) لا يسمح برمجياً بالوصول إلى شريحة الاتصال SIM أو Android SmsManager. يمكنك استخدام تطبيق الرسائل الافتراضي على الهاتف وتأكيد النتيجة يدوياً، أو تشغيل نسخة Android Native (Capacitor).',
        playStorePolicyNote: PLAY_STORE_POLICY_NOTE,
      };
    }

    try {
      const env = await NativeQatshiSms.checkEnvironment();
      return {
        isNativeAndroid: true,
        platform: 'android',
        sendSmsGranted: env.sendSmsGranted,
        readPhoneStateGranted: env.readPhoneStateGranted,
        hasTelephonyHardware: env.hasTelephonyHardware,
        airplaneModeOn: env.airplaneModeOn,
        hasCellularSignal: env.hasCellularSignal,
        sims: env.sims || [],
        playStorePolicyNote: PLAY_STORE_POLICY_NOTE,
      };
    } catch (err) {
      return {
        isNativeAndroid: true,
        platform: 'android',
        sendSmsGranted: false,
        readPhoneStateGranted: false,
        hasTelephonyHardware: false,
        airplaneModeOn: false,
        hasCellularSignal: false,
        sims: [],
        unsupportedReason:
          err instanceof Error ? err.message : 'تعذر قراءة حالة شريحة SIM والصلاحيات من النظام',
        playStorePolicyNote: PLAY_STORE_POLICY_NOTE,
      };
    }
  },

  async requestPermissions() {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return { sendSmsGranted: false, readPhoneStateGranted: false };
    }
    return NativeQatshiSms.requestSmsPermissions();
  },

  async pickDeviceContact(): Promise<NativeContactPickResult | null> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return null;
    }
    const res = await NativeQatshiSms.pickContact();
    if (res.cancelled || !res.phone) return null;
    return {
      name: res.name?.trim() || res.phone.trim(),
      phone: normalizeSmsPhoneNumber(res.phone),
    };
  },

  async sendSmsViaSim(params): Promise<DirectSmsDispatchResult> {
    const seg = calculateSmsSegments(params.body);
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return {
        status: 'fallback_required',
        partsCount: seg.partsCount,
        encoding: seg.encoding,
        errorReason: 'وضع المتصفح يتطلب فتح تطبيق الرسائل الافتراضي على الهاتف وتأكيد الإرسال يدوياً.',
      };
    }

    const res = await NativeQatshiSms.sendDirectSms({
      messageId: params.messageId,
      phone: normalizeSmsPhoneNumber(params.phone),
      body: params.body,
      subscriptionId: params.subscriptionId,
    });

    const now = new Date().toISOString();
    return {
      status: res.status,
      simSlot: res.simSlot,
      subscriptionId: res.subscriptionId,
      carrierName: res.carrierName,
      partsCount: res.partsCount || seg.partsCount,
      encoding: seg.encoding,
      errorReason: res.errorReason,
      sentAt: res.status === 'sent_to_network' || res.status === 'delivered' ? now : undefined,
      deliveredAt: res.status === 'delivered' ? now : undefined,
    };
  },
};

export function buildSmsDeviceIntentUri(phone: string, body: string): string {
  const normalized = normalizeSmsPhoneNumber(phone);
  return `sms:${normalized}?body=${encodeURIComponent(body)}`;
}

export function subscribeSmsDeliveryUpdates(
  onDelivered: (messageId: string) => void
): () => void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return () => {};
  }
  let handle: { remove: () => Promise<void> } | null = null;
  let cancelled = false;
  NativeQatshiSms.addListener?.('smsDeliveryStatus', (ev) => {
    if (ev?.status === 'delivered' && ev?.messageId) {
      onDelivered(ev.messageId);
    }
  }).then((res) => {
    if (cancelled) {
      res.remove().catch(() => {});
    } else {
      handle = res;
    }
  }).catch(() => {});

  return () => {
    cancelled = true;
    handle?.remove().catch(() => {});
  };
}

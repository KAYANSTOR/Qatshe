import { db } from '../db/qatshiDb';
import {
  calculateSmsSegments,
  canDispatchMessage,
  resolveConfirmedSmsRecipients,
} from '../domain/sms';
import { renderTemplateVariables } from '../domain/templates';
import {
  hasPermission,
  type AppUser,
  type Campaign,
  type MessageLog,
  type MessageStatus,
  type MessageTemplate,
  type MessagingConfig,
  type Organization,
} from '../domain/types';
import { generateUuid } from './device';
import {
  capacitorSmsBridge,
  type SmsBridgeAdapter,
} from './nativeSmsBridge';

export async function getOrCreateMessagingConfig(orgId: string): Promise<MessagingConfig> {
  const existing = await db.messagingConfigs.get(orgId);
  if (existing) {
    return {
      orgId: existing.orgId,
      smsEnabled: existing.smsEnabled ?? true,
      preferredSimSubscriptionId: existing.preferredSimSubscriptionId,
      preferredSimSlotIndex: existing.preferredSimSlotIndex,
      requireManualConfirmInWebFallback: existing.requireManualConfirmInWebFallback ?? true,
      updatedAt: existing.updatedAt,
    };
  }
  const fresh: MessagingConfig = {
    orgId,
    smsEnabled: true,
    requireManualConfirmInWebFallback: true,
    updatedAt: new Date().toISOString(),
  };
  await db.messagingConfigs.put(fresh);
  return fresh;
}

export async function saveMessagingConfig(config: MessagingConfig): Promise<void> {
  await db.messagingConfigs.put({
    orgId: config.orgId,
    smsEnabled: config.smsEnabled,
    preferredSimSubscriptionId: config.preferredSimSubscriptionId,
    preferredSimSlotIndex: config.preferredSimSlotIndex,
    requireManualConfirmInWebFallback: config.requireManualConfirmInWebFallback,
    updatedAt: new Date().toISOString(),
  });
}

export async function prepareConfirmedSmsBatch(params: {
  org: Organization;
  user: AppUser;
  title: string;
  bodyTemplate: string;
  confirmedCustomerIds: string[];
  extraAdhocContacts?: Array<{ id: string; name: string; phone: string }>;
  isMarketingMessage: boolean;
  templateId?: string;
  simSlot?: number;
  subscriptionId?: number;
}): Promise<{
  campaign: Campaign;
  logs: MessageLog[];
  excludedOptOutCount: number;
  excludedInvalidPhoneCount: number;
  excludedDuplicateCount: number;
}> {
  if (!hasPermission(params.user.role, 'manage_messaging')) {
    throw new Error('صلاحيتك لا تسمح بإرسال رسائل العملاء');
  }
  if (!params.bodyTemplate.trim()) {
    throw new Error('يرجى إدخال نص الرسالة النصية أولاً');
  }

  const customers = await db.customers.where('orgId').equals(params.org.id).toArray();
  const resolution = resolveConfirmedSmsRecipients({
    customers,
    selectedCustomerIds: params.confirmedCustomerIds,
    extraAdhocContacts: params.extraAdhocContacts,
    isMarketingMessage: params.isMarketingMessage,
  });

  if (!resolution.validRecipients.length) {
    throw new Error('لم يتم اختيار أي مستلم صالح للإرسال (تحقق من الأرقام المحددة)');
  }

  const now = new Date().toISOString();
  const campaignId = generateUuid();

  const logs: MessageLog[] = resolution.validRecipients.map((r) => {
    const cust = r.customer;
    const rendered = renderTemplateVariables(params.bodyTemplate, {
      customerName: r.name,
      shopName: params.org.name,
      customerBalance: cust?.cachedBalance ?? 0,
      remainingBalance: cust?.cachedBalance ?? 0,
      lastPurchaseDate: cust?.lastPurchaseAt,
      lastPaymentDate: cust?.lastPaymentAt,
      shopPhone: params.org.phone,
      org: params.org,
    });
    const seg = calculateSmsSegments(rendered);
    return {
      id: generateUuid(),
      orgId: params.org.id,
      campaignId,
      customerId: r.id,
      customerName: r.name,
      phone: r.phone,
      channel: 'sms',
      body: rendered,
      status: 'pending',
      simSlot: params.simSlot,
      subscriptionId: params.subscriptionId,
      partsCount: seg.partsCount,
      encoding: seg.encoding,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  });

  const campaign: Campaign = {
    id: campaignId,
    orgId: params.org.id,
    title: params.title.trim() || 'دفعة رسائل SMS',
    templateId: params.templateId,
    channel: 'sms',
    targetFilter: 'manual',
    recipientCount: logs.length,
    sentCount: 0,
    queuedCount: logs.length,
    failedCount: 0,
    status: 'queued',
    createdAt: now,
    createdBy: params.user.id,
  };

  await db.transaction('rw', [db.campaigns, db.messageLogs], async () => {
    await db.campaigns.put(campaign);
    await db.messageLogs.bulkPut(logs);
  });

  return {
    campaign,
    logs,
    excludedOptOutCount: resolution.excludedOptOutCount,
    excludedInvalidPhoneCount: resolution.excludedInvalidPhoneCount,
    excludedDuplicateCount: resolution.excludedDuplicateCount,
  };
}

export async function dispatchSmsViaDeviceSim(params: {
  logId: string;
  subscriptionId?: number;
  simSlot?: number;
  explicitResendUnknown?: boolean;
  bridge?: SmsBridgeAdapter;
}): Promise<MessageLog> {
  const bridge = params.bridge || capacitorSmsBridge;
  const existing = await db.messageLogs.get(params.logId);
  if (!existing) {
    throw new Error('سجل الرسالة غير موجود');
  }

  if (!canDispatchMessage(existing.status, Boolean(params.explicitResendUnknown))) {
    if (existing.status === 'unknown') {
      throw new Error('نتيجة هذه الرسالة غير محققة — راجعها أولاً واختر تأكيد الإرسال اليدوي إذا لزم الأمر لمنع التكرار');
    }
    return existing;
  }

  const nextAttempt = (existing.attemptCount ?? 0) + 1;
  const sendingRecord: MessageLog = {
    ...existing,
    status: 'sending',
    attemptCount: nextAttempt,
    simSlot: params.simSlot ?? existing.simSlot,
    subscriptionId: params.subscriptionId ?? existing.subscriptionId,
    updatedAt: new Date().toISOString(),
  };
  await db.messageLogs.put(sendingRecord);

  const env = await bridge.getEnvironmentStatus();
  if (!env.isNativeAndroid) {
    const fallbackLog: MessageLog = {
      ...sendingRecord,
      status: 'pending',
      dispatchMethod: 'device_intent_fallback',
      errorReason:
        env.unsupportedReason ||
        'وضع المتصفح لا يصل مباشرة لشريحة SIM — استخدم زر "فتح في تطبيق الرسائل" ثم أكّد النتيجة يدوياً.',
      updatedAt: new Date().toISOString(),
    };
    await db.messageLogs.put(fallbackLog);
    await recomputeCampaignCounts(fallbackLog.campaignId);
    return fallbackLog;
  }

  if (!env.sendSmsGranted) {
    const permDenied: MessageLog = {
      ...sendingRecord,
      status: 'failed',
      errorReason: 'لم يُمنح إذن إرسال الرسائل (SEND_SMS) على الجهاز.',
      updatedAt: new Date().toISOString(),
    };
    await db.messageLogs.put(permDenied);
    await recomputeCampaignCounts(permDenied.campaignId);
    return permDenied;
  }

  if (env.airplaneModeOn || env.sims.length === 0 || !env.hasCellularSignal) {
    const noSignal: MessageLog = {
      ...sendingRecord,
      status: 'failed',
      errorReason: env.airplaneModeOn
        ? 'وضع الطيران مفعّل — تعذر الإرسال عبر شريحة SIM.'
        : env.sims.length === 0
        ? 'لا توجد شريحة SIM فعالة في الجهاز.'
        : 'لا توجد تغطية شبكة اتصال خلوية حالياً.',
      updatedAt: new Date().toISOString(),
    };
    await db.messageLogs.put(noSignal);
    await recomputeCampaignCounts(noSignal.campaignId);
    return noSignal;
  }

  try {
    const result = await bridge.sendSmsViaSim({
      messageId: sendingRecord.id,
      phone: sendingRecord.phone,
      body: sendingRecord.body,
      subscriptionId: sendingRecord.subscriptionId,
    });

    const finalStatus: MessageStatus =
      result.status === 'fallback_required' ? 'pending' : result.status;

    const finalRecord: MessageLog = {
      ...sendingRecord,
      status: finalStatus,
      simSlot: result.simSlot ?? sendingRecord.simSlot,
      subscriptionId: result.subscriptionId ?? sendingRecord.subscriptionId,
      carrierName: result.carrierName,
      partsCount: result.partsCount,
      encoding: result.encoding,
      dispatchMethod: result.status === 'fallback_required' ? 'device_intent_fallback' : 'native_sim',
      sentAt: result.sentAt,
      deliveredAt: result.deliveredAt,
      errorReason: result.errorReason,
      updatedAt: new Date().toISOString(),
    };
    await db.messageLogs.put(finalRecord);
    await recomputeCampaignCounts(finalRecord.campaignId);
    return finalRecord;
  } catch (err) {
    const unknownRecord: MessageLog = {
      ...sendingRecord,
      status: 'unknown',
      errorReason:
        err instanceof Error
          ? `تعذر التحقق من نتيجة الإرسال: ${err.message}`
          : 'تعذر التحقق من نتيجة الإرسال من شريحة SIM — لا تعيد الإرسال قبل التحقق لتجنب التكرار.',
      updatedAt: new Date().toISOString(),
    };
    await db.messageLogs.put(unknownRecord);
    await recomputeCampaignCounts(unknownRecord.campaignId);
    return unknownRecord;
  }
}

export async function confirmManualSmsOutcome(
  logId: string,
  outcome: 'sent_to_network' | 'delivered' | 'failed' | 'unknown',
  errorReason?: string
): Promise<MessageLog | undefined> {
  const existing = await db.messageLogs.get(logId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: MessageLog = {
    ...existing,
    status: outcome,
    dispatchMethod: existing.dispatchMethod || 'device_intent_fallback',
    attemptCount: (existing.attemptCount ?? 0) + 1,
    sentAt: outcome === 'sent_to_network' || outcome === 'delivered' ? existing.sentAt || now : existing.sentAt,
    deliveredAt: outcome === 'delivered' ? now : existing.deliveredAt,
    errorReason:
      outcome === 'failed' || outcome === 'unknown'
        ? errorReason || (outcome === 'unknown' ? 'تعذر التحقق من الإرسال' : 'لم يكتمل الإرسال')
        : undefined,
    updatedAt: now,
  };
  await db.messageLogs.put(updated);
  await recomputeCampaignCounts(existing.campaignId);
  return updated;
}

async function recomputeCampaignCounts(campaignId?: string): Promise<void> {
  if (!campaignId) return;
  const campaign = await db.campaigns.get(campaignId);
  if (!campaign) return;
  const logs = await db.messageLogs.where('campaignId').equals(campaignId).toArray();
  const sentCount = logs.filter((l) => l.status === 'sent_to_network' || l.status === 'delivered').length;
  const failedCount = logs.filter((l) => l.status === 'failed' || l.status === 'unknown').length;
  const queuedCount = logs.filter((l) => l.status === 'pending' || l.status === 'sending').length;

  let status: Campaign['status'] = 'queued';
  if (queuedCount === 0 && sentCount === logs.length) status = 'dispatched';
  else if (sentCount > 0 || failedCount > 0) status = 'partial';

  await db.campaigns.put({
    ...campaign,
    sentCount,
    failedCount,
    queuedCount,
    status,
  });
}

export async function saveMessageTemplate(
  orgId: string,
  template: Omit<MessageTemplate, 'id' | 'orgId' | 'channel' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<MessageTemplate> {
  const now = new Date().toISOString();
  const existing = template.id ? await db.messageTemplates.get(template.id) : undefined;
  const record: MessageTemplate = {
    id: existing?.id ?? generateUuid(),
    orgId,
    name: template.name.trim(),
    category: template.category,
    channel: 'sms',
    body: template.body,
    isDefault: template.isDefault ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.messageTemplates.put(record);
  return record;
}

export async function deleteMessageTemplate(templateId: string): Promise<void> {
  await db.messageTemplates.delete(templateId);
}

import { db } from '../db/qatshiDb';
import type { MessageTemplate } from '../domain/types';
import { generateUuid, getMeta, setMeta } from './device';

/**
 * القوالب المحلية الأساسية للرسائل النصية SMS عند إنشاء مؤسسة جديدة.
 * خالية تماماً من أي أسعار أو تواريخ أو بيانات تجريبية وهمية.
 */
export function buildDefaultTemplates(orgId: string): MessageTemplate[] {
  const now = new Date().toISOString();
  return [
    {
      id: generateUuid(),
      orgId,
      name: 'تذكير بالمديونية',
      category: 'debt',
      channel: 'sms',
      body: 'مرحباً {customer_name}، نذكركم بلطف أن رصيدكم المستحق لدى {shop_name} هو {customer_balance}. للاستفسار: {shop_phone}',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuid(),
      orgId,
      name: 'تأكيد سداد',
      category: 'debt',
      channel: 'sms',
      body: 'الأخ {customer_name}، تم استلام مبلغ {amount_paid} بتاريخ {today_date} في {shop_name}. الرصيد المتبقي: {remaining_balance}.',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuid(),
      orgId,
      name: 'عرض يومي',
      category: 'offer',
      channel: 'sms',
      body: 'مرحباً {customer_name}، تتوفر لدينا اليوم طلبات طازجة مختارة في {shop_name}. للحجز أو الاستفسار يرجى التواصل على: {shop_phone}',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuid(),
      orgId,
      name: 'إشعار كشف الحساب',
      category: 'debt',
      channel: 'sms',
      body: 'السلام عليكم {customer_name}، الرصيد النهائي في كشف حسابكم لدى {shop_name} حتى {today_date} هو {customer_balance}.',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuid(),
      orgId,
      name: 'ترحيب بعميل جديد',
      category: 'welcome',
      channel: 'sms',
      body: 'أهلاً بك يا {customer_name} في {shop_name}. نسعد بخدمتكم دائماً، للتواصل: {shop_phone}',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * يرجع المؤسسة النشطة إن وُجدت فقط، ولا ينشئ أي مؤسسات أو بيانات تجريبية تلقائياً.
 */
export async function resolveInitialOrganizationId(): Promise<string | null> {
  const existingOrgId = await getMeta('activeOrgId');
  if (existingOrgId) {
    const org = await db.organizations.get(existingOrgId);
    if (org) return org.id;
  }

  const orgCount = await db.organizations.count();
  if (orgCount > 0) {
    const first = await db.organizations.toCollection().first();
    if (first) {
      await setMeta('activeOrgId', first.id);
      return first.id;
    }
  }

  return null;
}

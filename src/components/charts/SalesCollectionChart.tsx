import React, { useMemo, useState } from 'react';
import { formatMoney, toLocalDateKey } from '../../domain/money';
import type { Organization, Payment, Sale } from '../../domain/types';

export const SalesCollectionChart: React.FC<{
  sales: Sale[];
  payments: Payment[];
  org: Organization;
}> = ({ sales, payments, org }) => {
  const [range, setRange] = useState<'week' | 'month'>('week');

  const series = useMemo(() => {
    const days = range === 'week' ? 7 : 14;
    const now = new Date();
    const buckets: Array<{ dateKey: string; label: string; salesTotal: number; cashCollected: number }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = toLocalDateKey(d);
      const label = `${d.getDate()}/${d.getMonth() + 1}`;
      buckets.push({ dateKey: key, label, salesTotal: 0, cashCollected: 0 });
    }

    const map = new Map(buckets.map((b) => [b.dateKey, b]));
    for (const s of sales) {
      if (s.status !== 'active') continue;
      const b = map.get(toLocalDateKey(s.createdAt));
      if (b) {
        b.salesTotal += s.total;
        b.cashCollected += s.paidAmount;
      }
    }
    for (const p of payments) {
      if (p.status !== 'active') continue;
      const b = map.get(toLocalDateKey(p.createdAt));
      if (b) {
        b.cashCollected += p.amount;
      }
    }
    return buckets;
  }, [sales, payments, range]);

  const maxVal = Math.max(1000, ...series.map((s) => Math.max(s.salesTotal, s.cashCollected)));
  const hasActivity = series.some((s) => s.salesTotal > 0 || s.cashCollected > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-[#0F1F17] dark:text-[#E8EAE0]">
            المبيعات والتحصيل
          </h2>
          <p className="text-xs text-[#6B7F67]">مقارنة إجمالي المبيعات بالنقد المحصل فعلياً</p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFF1EA] dark:bg-[#0B1610]">
          <button
            type="button"
            onClick={() => setRange('week')}
            className={`min-h-[36px] px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              range === 'week'
                ? 'bg-white dark:bg-[#1E3A2E] text-[#0F1F17] dark:text-white shadow-xs'
                : 'text-[#3D4337] dark:text-[#9AA896]'
            }`}
          >
            آخر 7 أيام
          </button>
          <button
            type="button"
            onClick={() => setRange('month')}
            className={`min-h-[36px] px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              range === 'month'
                ? 'bg-white dark:bg-[#1E3A2E] text-[#0F1F17] dark:text-white shadow-xs'
                : 'text-[#3D4337] dark:text-[#9AA896]'
            }`}
          >
            آخر 14 يوماً
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 text-xs text-[#3D4337] dark:text-[#C7CBB8]">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#1E3A2E] dark:bg-[#8FB98D]" />
          إجمالي المبيعات
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#6B7F67] dark:bg-[#C7CBB8]" />
          التحصيل النقدي
        </span>
      </div>

      {!hasActivity ? (
        <div className="h-52 flex items-center justify-center rounded-xl border border-dashed border-[#C7CBB8]/80 dark:border-[#243B2E] text-sm text-[#6B7F67]">
          لا توجد مبيعات أو تحصيلات مسجلة خلال هذه الفترة بعد
        </div>
      ) : (
        <div className="h-52 flex items-end gap-2 sm:gap-3 pt-4 border-b border-[#C7CBB8]/60 dark:border-[#243B2E]">
          {series.map((bar) => {
            const saleH = Math.max(4, Math.round((bar.salesTotal / maxVal) * 164));
            const cashH = Math.max(4, Math.round((bar.cashCollected / maxVal) * 164));
            return (
              <div key={bar.dateKey} className="flex-1 flex flex-col items-center gap-2 group min-w-0">
                <div className="w-full flex items-end justify-center gap-1 h-44">
                  <div
                    title={`مبيعات ${bar.label}: ${formatMoney(bar.salesTotal, org.currency, org.currencyDecimals, org.numberLocale)}`}
                    style={{ height: `${saleH}px` }}
                    className="w-2.5 sm:w-3.5 rounded-t-md bg-[#1E3A2E] dark:bg-[#6B7F67] transition-all"
                  />
                  <div
                    title={`تحصيل ${bar.label}: ${formatMoney(bar.cashCollected, org.currency, org.currencyDecimals, org.numberLocale)}`}
                    style={{ height: `${cashH}px` }}
                    className="w-2.5 sm:w-3.5 rounded-t-md bg-[#8EA387] dark:bg-[#C7CBB8] transition-all"
                  />
                </div>
                <span className="text-[11px] font-mono tabular-nums text-[#6B7F67] truncate">
                  {bar.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

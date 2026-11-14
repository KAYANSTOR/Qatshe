import { jsPDF } from 'jspdf';
import type { CustomerStatementResult } from '../domain/accounting';
import {
  buildCleanExportFileName,
  extractSequenceDigits,
  formatCommercialRef,
  sanitizeCommercialText,
} from '../domain/formatters';
import { addMoney, formatDateArabic, formatMoney, toLocalDateKey } from '../domain/money';
import type { Customer, Organization, Payment, Sale } from '../domain/types';

// A4 at 150 DPI for crisp, fast, offline RTL Arabic text via Chromium's native HarfBuzz shaping
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 72;

async function ensureFontsLoaded(): Promise<void> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font wait failure
    }
  }
}

function createPageCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذر تهيئة محرك PDF المحلي');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.direction = 'rtl';
  return { canvas, ctx };
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(1, lines[maxLines - 1].length - 1))}…`;
  }
  return lines.length ? lines : ['—'];
}

function drawHeaderAndFooter(
  ctx: CanvasRenderingContext2D,
  org: Organization,
  title: string,
  pageNum: number,
  totalPages: number
) {
  ctx.fillStyle = '#0F1F17';
  ctx.fillRect(0, 0, PAGE_W, 18);

  ctx.fillStyle = '#0F1F17';
  ctx.font = '700 30px "Readex Pro", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(org.name, PAGE_W - MARGIN, 86);

  ctx.fillStyle = '#3E5A3F';
  ctx.font = '500 18px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(`${org.address}  ·  هاتف: ${org.phone}`, PAGE_W - MARGIN, 120);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#1E3A2E';
  ctx.font = '700 28px "Readex Pro", "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(title, MARGIN, 86);

  ctx.fillStyle = '#6B7F67';
  ctx.font = '600 16px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('نظام قاتشي لإدارة المحلات', MARGIN, 118);

  ctx.strokeStyle = '#C7CBB8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, 146);
  ctx.lineTo(PAGE_W - MARGIN, 146);
  ctx.stroke();

  const footerY = PAGE_H - 58;
  ctx.strokeStyle = '#C7CBB8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MARGIN, footerY - 26);
  ctx.lineTo(PAGE_W - MARGIN, footerY - 26);
  ctx.stroke();

  ctx.fillStyle = '#3D4337';
  ctx.font = '500 16px "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(org.invoiceFooter || 'وثيقة محاسبية صادرة من نظام قاتشي', PAGE_W - MARGIN, footerY);

  ctx.textAlign = 'left';
  ctx.font = '500 16px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(`صفحة ${pageNum} من ${totalPages}`, MARGIN, footerY);
}

function drawRoundedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export async function generateCustomerStatementPdf(params: {
  org: Organization;
  customer: Customer;
  statement: CustomerStatementResult;
  fromDate?: string;
  toDate?: string;
}): Promise<{ blob: Blob; fileName: string }> {
  await ensureFontsLoaded();
  const { org, customer, statement, fromDate, toDate } = params;
  const rows = statement.rows;
  const rowsPerFirstPage = 13;
  const rowsPerNextPage = 18;

  const pagesRows: typeof rows[] = [];
  if (rows.length === 0) {
    pagesRows.push([]);
  } else {
    pagesRows.push(rows.slice(0, rowsPerFirstPage));
    let idx = rowsPerFirstPage;
    while (idx < rows.length) {
      pagesRows.push(rows.slice(idx, idx + rowsPerNextPage));
      idx += rowsPerNextPage;
    }
  }

  const totalPages = pagesRows.length;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  for (let p = 0; p < totalPages; p++) {
    if (p > 0) pdf.addPage();
    const { canvas, ctx } = createPageCanvas();
    drawHeaderAndFooter(ctx, org, 'كشف حساب عميل', p + 1, totalPages);

    let y = 176;

    if (p === 0) {
      drawRoundedBox(ctx, MARGIN, y, PAGE_W - MARGIN * 2, 132, 14, '#F6F7F3', '#C7CBB8');
      ctx.textAlign = 'right';
      ctx.fillStyle = '#0F1F17';
      ctx.font = '700 22px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(`العميل: ${customer.fullName}`, PAGE_W - MARGIN - 24, y + 38);

      ctx.fillStyle = '#3D4337';
      ctx.font = '500 18px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(`الهاتف: ${customer.phone}   ·   العنوان: ${customer.address || 'غير محدد'}`, PAGE_W - MARGIN - 24, y + 74);
      ctx.fillText(
        `الفترة: ${fromDate ? formatDateArabic(fromDate, org.dateFormat) : 'من البداية'} إلى ${
          toDate ? formatDateArabic(toDate, org.dateFormat) : formatDateArabic(new Date().toISOString(), org.dateFormat)
        }`,
        PAGE_W - MARGIN - 24,
        y + 108
      );

      ctx.textAlign = 'left';
      ctx.fillStyle = '#3D4337';
      ctx.font = '500 17px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(`تاريخ الإصدار: ${formatDateArabic(new Date().toISOString(), org.dateFormat)}`, MARGIN + 24, y + 38);
      ctx.fillText(`الرصيد الافتتاحي: ${fmt(statement.openingBalance)}`, MARGIN + 24, y + 74);
      ctx.fillStyle = statement.closingBalance > 0 ? '#991B1B' : '#1E3A2E';
      ctx.font = '700 20px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(`الرصيد النهائي: ${fmt(statement.closingBalance)}`, MARGIN + 24, y + 108);

      y += 156;
    }

    const colWidths = [140, 125, 370, 145, 145, 171];
    const headers = ['التاريخ', 'المرجع', 'البيان', 'مدين (عليه)', 'دائن (له)', 'الرصيد المتبقي'];

    ctx.fillStyle = '#1E3A2E';
    ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 46);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 17px "IBM Plex Sans Arabic", sans-serif';

    let cursorRight = PAGE_W - MARGIN;
    for (let c = 0; c < headers.length; c++) {
      const w = colWidths[c];
      ctx.textAlign = c >= 3 ? 'left' : 'right';
      const textX = c >= 3 ? cursorRight - w + 14 : cursorRight - 14;
      ctx.fillText(headers[c], textX, y + 30);
      cursorRight -= w;
    }
    y += 46;

    const pageSlice = pagesRows[p];
    let pageDebit = 0;
    let pageCredit = 0;

    if (pageSlice.length === 0) {
      ctx.fillStyle = '#6B7F67';
      ctx.font = '500 20px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('لا توجد حركات مالية مسجلة خلال هذه الفترة', PAGE_W / 2, y + 72);
      y += 120;
    } else {
      pageSlice.forEach((row, idx) => {
        pageDebit = addMoney(pageDebit, row.entry.debit, org.currencyDecimals);
        pageCredit = addMoney(pageCredit, row.entry.credit, org.currencyDecimals);

        ctx.font = '500 16px "IBM Plex Sans Arabic", sans-serif';
        const descLines = wrapTextLines(ctx, sanitizeCommercialText(row.entry.description), colWidths[2] - 28, 2);
        const rowH = descLines.length > 1 ? 66 : 52;

        if (idx % 2 === 1) {
          ctx.fillStyle = '#F9FAF7';
          ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, rowH);
        }
        ctx.strokeStyle = '#E5E7DF';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(MARGIN, y + rowH);
        ctx.lineTo(PAGE_W - MARGIN, y + rowH);
        ctx.stroke();

        const cells = [
          formatDateArabic(row.entry.createdAt, org.dateFormat),
          formatCommercialRef(row.entry.refNumber, row.entry.refType),
          descLines,
          row.entry.debit > 0 ? fmt(row.entry.debit) : '—',
          row.entry.credit > 0 ? fmt(row.entry.credit) : '—',
          fmt(row.runningBalance),
        ];

        let colX = PAGE_W - MARGIN;
        cells.forEach((cellVal, c) => {
          const w = colWidths[c];
          ctx.fillStyle =
            c === 5
              ? '#0F1F17'
              : c === 3 && row.entry.debit > 0
              ? '#991B1B'
              : c === 4 && row.entry.credit > 0
              ? '#1E3A2E'
              : '#2A332B';
          ctx.font = c >= 3 ? '600 16px "IBM Plex Sans Arabic", sans-serif' : '500 16px "IBM Plex Sans Arabic", sans-serif';
          ctx.textAlign = c >= 3 ? 'left' : 'right';
          const textX = c >= 3 ? colX - w + 14 : colX - 14;
          if (Array.isArray(cellVal)) {
            cellVal.forEach((ln, li) => {
              ctx.fillText(ln, textX, y + 26 + li * 22);
            });
          } else {
            ctx.fillText(cellVal, textX, y + 32);
          }
          colX -= w;
        });
        y += rowH;
      });

      // Per-page subtotal strip
      ctx.fillStyle = '#EFF1EA';
      ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 42);
      ctx.fillStyle = '#0F1F17';
      ctx.font = '700 15px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`مجموع الصفحة (${p + 1})`, PAGE_W - MARGIN - 14, y + 27);
      ctx.textAlign = 'left';
      const debitColLeft = PAGE_W - MARGIN - colWidths[0] - colWidths[1] - colWidths[2] - colWidths[3] + 14;
      const creditColLeft = debitColLeft - colWidths[4];
      const balColLeft = MARGIN + 14;
      ctx.fillStyle = '#991B1B';
      ctx.fillText(fmt(pageDebit), debitColLeft, y + 27);
      ctx.fillStyle = '#1E3A2E';
      ctx.fillText(fmt(pageCredit), creditColLeft, y + 27);
      ctx.fillStyle = '#0F1F17';
      ctx.fillText(fmt(pageSlice[pageSlice.length - 1].runningBalance), balColLeft, y + 27);
      y += 42;
    }

    if (p === totalPages - 1) {
      y += 24;
      drawRoundedBox(ctx, MARGIN, y, PAGE_W - MARGIN * 2, 118, 14, '#0F1F17');
      ctx.fillStyle = '#C7CBB8';
      ctx.font = '500 17px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('إجمالي المشتريات (مدين)', PAGE_W - MARGIN - 30, y + 38);
      ctx.fillText('إجمالي السداد (دائن)', PAGE_W - MARGIN - 380, y + 38);
      ctx.fillText('الخصومات والتسويات', PAGE_W - MARGIN - 700, y + 38);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 22px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(fmt(statement.totalPurchasesDebit), PAGE_W - MARGIN - 30, y + 82);
      ctx.fillText(fmt(statement.totalPaymentsCredit), PAGE_W - MARGIN - 380, y + 82);
      ctx.fillText(fmt(statement.totalDiscountsAndAdjustments), PAGE_W - MARGIN - 700, y + 82);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#C7CBB8';
      ctx.font = '500 17px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText('الرصيد المستحق النهائي', MARGIN + 30, y + 38);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 24px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(fmt(statement.closingBalance), MARGIN + 30, y + 82);
    }

    const imgData = canvas.toDataURL('image/png', 0.95);
    pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
  }

  const blob = pdf.output('blob');
  const fileName = buildCleanExportFileName(['كشف-حساب', customer.fullName, toLocalDateKey()], 'pdf');
  return { blob, fileName };
}

export async function generateReceiptPdf(params: {
  org: Organization;
  type: 'sale' | 'payment';
  sale?: Sale;
  payment?: Payment;
  customerRemainingBalance?: number;
}): Promise<{ blob: Blob; fileName: string }> {
  await ensureFontsLoaded();
  const { org, type, sale, payment, customerRemainingBalance } = params;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const fmt = (n: number) => formatMoney(n, org.currency, org.currencyDecimals, org.numberLocale);

  if (type === 'sale' && sale) {
    const itemsFirst = 14;
    const itemsNext = 20;
    const itemChunks: Sale['items'][] = [];
    if (sale.items.length <= itemsFirst) {
      itemChunks.push(sale.items);
    } else {
      itemChunks.push(sale.items.slice(0, itemsFirst));
      let idx = itemsFirst;
      while (idx < sale.items.length) {
        itemChunks.push(sale.items.slice(idx, idx + itemsNext));
        idx += itemsNext;
      }
    }

    const totalPages = itemChunks.length;
    for (let p = 0; p < totalPages; p++) {
      if (p > 0) pdf.addPage();
      const { canvas, ctx } = createPageCanvas();
      drawHeaderAndFooter(ctx, org, 'فاتورة بيع', p + 1, totalPages);

      let y = 186;
      if (p === 0) {
        drawRoundedBox(ctx, MARGIN, y, PAGE_W - MARGIN * 2, 120, 14, '#F6F7F3', '#C7CBB8');
        ctx.textAlign = 'right';
        ctx.fillStyle = '#0F1F17';
        ctx.font = '700 22px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(formatCommercialRef(sale.invoiceNumber, 'sale'), PAGE_W - MARGIN - 24, y + 40);
        ctx.font = '500 18px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(`العميل: ${sale.customerName}`, PAGE_W - MARGIN - 24, y + 78);

        ctx.textAlign = 'left';
        ctx.fillText(`التاريخ: ${formatDateArabic(sale.createdAt, org.dateFormat, true)}`, MARGIN + 24, y + 40);
        ctx.fillText(`الموظف: ${sale.createdByName}`, MARGIN + 24, y + 78);
        y += 148;
      }

      ctx.fillStyle = '#1E3A2E';
      ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 46);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 18px "IBM Plex Sans Arabic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('الصنف والدرجة', PAGE_W - MARGIN - 20, y + 30);
      ctx.fillText('الكمية', PAGE_W - MARGIN - 540, y + 30);
      ctx.fillText('سعر الوحدة', PAGE_W - MARGIN - 720, y + 30);
      ctx.textAlign = 'left';
      ctx.fillText('الإجمالي', MARGIN + 20, y + 30);
      y += 46;

      itemChunks[p].forEach((item, idx) => {
        if (idx % 2 === 1) {
          ctx.fillStyle = '#F9FAF7';
          ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 52);
        }
        ctx.fillStyle = '#0F1F17';
        ctx.font = '500 18px "IBM Plex Sans Arabic", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${item.productName} (${item.grade})`, PAGE_W - MARGIN - 20, y + 34);
        ctx.fillText(`${item.quantity} ${item.unitName}`, PAGE_W - MARGIN - 540, y + 34);
        ctx.fillText(fmt(item.unitPrice), PAGE_W - MARGIN - 720, y + 34);
        ctx.textAlign = 'left';
        ctx.fillText(fmt(item.lineTotal), MARGIN + 20, y + 34);
        y += 52;
      });

      if (p === totalPages - 1) {
        y += 30;
        drawRoundedBox(ctx, MARGIN, y, PAGE_W - MARGIN * 2, 150, 14, '#0F1F17');
        ctx.fillStyle = '#C7CBB8';
        ctx.font = '500 18px "IBM Plex Sans Arabic", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`المجموع الفرعي: ${fmt(sale.subtotal)}   ·   الخصم: ${fmt(sale.discount)}`, PAGE_W - MARGIN - 28, y + 44);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 24px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(`الإجمالي: ${fmt(sale.total)}`, PAGE_W - MARGIN - 28, y + 92);
        ctx.textAlign = 'left';
        ctx.fillText(`المدفوع: ${fmt(sale.paidAmount)}`, MARGIN + 28, y + 52);
        ctx.fillText(`المتبقي آجل: ${fmt(sale.remainingAmount)}`, MARGIN + 28, y + 98);
      }

      pdf.addImage(canvas.toDataURL('image/png', 0.95), 'PNG', 0, 0, pdfW, pdfH);
    }
  } else if (type === 'payment' && payment) {
    const { canvas, ctx } = createPageCanvas();
    drawHeaderAndFooter(ctx, org, 'سند قبض وسداد', 1, 1);

    const y = 190;
    drawRoundedBox(ctx, MARGIN, y, PAGE_W - MARGIN * 2, 260, 16, '#F6F7F3', '#C7CBB8');
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0F1F17';
    ctx.font = '700 24px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(formatCommercialRef(payment.receiptNumber, 'payment'), PAGE_W - MARGIN - 28, y + 48);
    ctx.font = '500 20px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(`استلمنا من العميل: ${payment.customerName}`, PAGE_W - MARGIN - 28, y + 96);
    ctx.fillText(`التاريخ: ${formatDateArabic(payment.createdAt, org.dateFormat, true)}`, PAGE_W - MARGIN - 28, y + 140);
    ctx.fillText(`ملاحظات: ${payment.notes || 'سداد مستحق'}`, PAGE_W - MARGIN - 28, y + 184);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1E3A2E';
    ctx.font = '700 28px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(`المبلغ المسدد: ${fmt(payment.amount)}`, MARGIN + 28, y + 96);
    if (customerRemainingBalance !== undefined) {
      ctx.fillStyle = '#3D4337';
      ctx.font = '600 20px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(`الرصيد المتبقي: ${fmt(customerRemainingBalance)}`, MARGIN + 28, y + 148);
    }

    pdf.addImage(canvas.toDataURL('image/png', 0.95), 'PNG', 0, 0, pdfW, pdfH);
  }

  const blob = pdf.output('blob');
  const fileName =
    type === 'sale' && sale
      ? buildCleanExportFileName(
          ['فاتورة-بيع', sale.customerName, extractSequenceDigits(sale.invoiceNumber)],
          'pdf'
        )
      : type === 'payment' && payment
      ? buildCleanExportFileName(
          ['سند-قبض', payment.customerName, extractSequenceDigits(payment.receiptNumber)],
          'pdf'
        )
      : buildCleanExportFileName(['مستند-محاسبي', toLocalDateKey()], 'pdf');
  return { blob, fileName };
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

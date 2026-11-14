import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { triggerBlobDownload } from './pdfGenerator';

export interface SharePdfResult {
  method: 'capacitor_share' | 'web_share' | 'download_fallback';
  message: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('تعذر قراءة ملف PDF للمشاركة'));
    reader.readAsDataURL(blob);
  });
}

export async function sharePdfDocument(params: {
  blob: Blob;
  fileName: string;
  title: string;
  text?: string;
}): Promise<SharePdfResult> {
  const safeFileName = params.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '-');

  if (Capacitor.isNativePlatform()) {
    const base64Data = await blobToBase64(params.blob);
    const writeRes = await Filesystem.writeFile({
      path: `qatshi-share/${safeFileName}`,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title: params.title,
      text: params.text || params.title,
      url: writeRes.uri,
      dialogTitle: 'مشاركة المستند PDF عبر واتساب أو تطبيق آخر',
    });
    return {
      method: 'capacitor_share',
      message: 'تم فتح نافذة مشاركة النظام لملف PDF',
    };
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([params.blob], safeFileName, { type: 'application/pdf' });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: params.title,
          text: params.text || params.title,
          files: [file],
        });
        return {
          method: 'web_share',
          message: 'تمت مشاركة ملف PDF عبر قائمة المشاركة في النظام',
        };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('تم إلغاء المشاركة من قبل المستخدم');
        }
      }
    }
  }

  triggerBlobDownload(params.blob, safeFileName);
  return {
    method: 'download_fallback',
    message: 'تم تنزيل ملف PDF محلياً — يمكنك مشاركته يدوياً عبر واتساب أو أي تطبيق آخر',
  };
}

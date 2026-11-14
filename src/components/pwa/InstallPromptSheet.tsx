import React, { useState } from 'react';
import { Download, MoreVertical, Share, Smartphone } from 'lucide-react';
import { BrandLogo, BottomSheet, PrimaryButton } from '../ui/LuxuryUI';

interface InstallPromptSheetProps {
  open: boolean;
  isInstallable: boolean;
  isIOS: boolean;
  onInstall: () => Promise<boolean>;
  onDismissForever: () => void;
  onCloseTemporary: () => void;
}

export const InstallPromptSheet: React.FC<InstallPromptSheetProps> = ({
  open,
  isInstallable,
  isIOS,
  onInstall,
  onDismissForever,
  onCloseTemporary,
}) => {
  const [showBrowserSteps, setShowBrowserSteps] = useState(false);
  const [installing, setInstalling] = useState(false);

  const handleInstallClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        const accepted = await onInstall();
        if (!accepted) {
          setShowBrowserSteps(true);
        }
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowBrowserSteps(true);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onCloseTemporary}
      title="ثبّت قاتشي على هاتفك"
      subtitle="تجربة تطبيق كاملة وسريعة على الشاشة الرئيسية"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-4 p-4 rounded-2xl bg-[#F4F5F0] dark:bg-[#0B1610]">
          <BrandLogo size="md" showWordmark={false} />
          <div className="space-y-1.5">
            <div className="font-display font-bold text-base text-[#0F1F17] dark:text-[#E8EAE0]">
              قاتشي — إدارة المحل والحسابات
            </div>
            <p className="text-xs sm:text-sm text-[#3D4337] dark:text-[#C7CBB8] leading-relaxed">
              استخدم نظامك المحاسبي بسهولة من الشاشة الرئيسية، واصل إدارة العملاء والمبيعات والحسابات حتى دون إنترنت.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="p-2.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0F1F17] border border-[#C7CBB8]/40 dark:border-[#243B2E]">
            <div className="font-semibold text-[#0F1F17] dark:text-[#E8EAE0]">فتح فوري</div>
            <div className="text-[11px] text-[#6B7F67] mt-0.5">أيقونة مستقلة</div>
          </div>
          <div className="p-2.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0F1F17] border border-[#C7CBB8]/40 dark:border-[#243B2E]">
            <div className="font-semibold text-[#0F1F17] dark:text-[#E8EAE0]">دون إنترنت</div>
            <div className="text-[11px] text-[#6B7F67] mt-0.5">حفظ آمن بالهاتف</div>
          </div>
          <div className="p-2.5 rounded-2xl bg-[#F9FAF7] dark:bg-[#0F1F17] border border-[#C7CBB8]/40 dark:border-[#243B2E]">
            <div className="font-semibold text-[#0F1F17] dark:text-[#E8EAE0]">شاشة كاملة</div>
            <div className="text-[11px] text-[#6B7F67] mt-0.5">تجربة Android</div>
          </div>
        </div>

        {showBrowserSteps && (
          <div className="p-4 rounded-2xl border border-[#3E5A3F]/40 bg-[#EFF1EA]/60 dark:bg-[#1E3A2E]/40 space-y-2.5 text-xs sm:text-sm text-[#0F1F17] dark:text-[#E8EAE0]">
            <div className="font-display font-bold flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-[#3E5A3F] dark:text-[#8FB98D]" />
              {isIOS ? 'خطوات التثبيت على iPhone / Safari:' : 'خطوات التثبيت المباشر من متصفح الهاتف:'}
            </div>
            {isIOS ? (
              <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                <li>
                  اضغط على زر المشاركة <Share className="inline h-3.5 w-3.5 mx-0.5" /> أسفل شاشة Safari.
                </li>
                <li>اختر «إضافة إلى الشاشة الرئيسية» ثم اضغط «إضافة».</li>
              </ol>
            ) : (
              <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                <li>
                  اضغط على قائمة المتصفح <MoreVertical className="inline h-3.5 w-3.5 mx-0.5" /> أعلى الشاشة (أو أيقونة التثبيت في شريط العنوان).
                </li>
                <li>اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li>
              </ol>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          <PrimaryButton
            type="button"
            disabled={installing}
            onClick={handleInstallClick}
            className="flex-1 min-h-[48px]"
          >
            <Download className="h-4 w-4" />
            {installing ? 'جاري التثبيت...' : 'تثبيت التطبيق'}
          </PrimaryButton>
          <PrimaryButton
            type="button"
            variant="secondary"
            onClick={onDismissForever}
            className="sm:min-w-[130px] min-h-[46px]"
          >
            ليس الآن
          </PrimaryButton>
        </div>
      </div>
    </BottomSheet>
  );
};

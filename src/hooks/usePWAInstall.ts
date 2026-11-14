import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'qatshi_pwa_install_dismissed';

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(DISMISS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setIsAndroid(/android/.test(ua));

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setManualOpen(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setManualOpen(false);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  const dismissFirstVisitPrompt = useCallback(() => {
    setDismissed(true);
    setManualOpen(false);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, '1');
    } catch {
      // Ignore storage failures
    }
  }, []);

  const openInstallSheet = useCallback(() => {
    setManualOpen(true);
  }, []);

  const closeInstallSheet = useCallback(() => {
    setManualOpen(false);
  }, []);

  const shouldShowSheet = !isInstalled && (manualOpen || !dismissed);

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    isAndroid,
    dismissed,
    shouldShowSheet,
    manualOpen,
    install,
    dismissFirstVisitPrompt,
    openInstallSheet,
    closeInstallSheet,
  };
}

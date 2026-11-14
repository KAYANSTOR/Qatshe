import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
import '@fontsource/tajawal/700.css';
import '@fontsource/tajawal/800.css';
import { registerSW } from 'virtual:pwa-register';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onOfflineReady() {
      (window as unknown as { __QATSHI_SW_STATUS__?: string }).__QATSHI_SW_STATUS__ = 'offline_ready';
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        (window as unknown as { __QATSHI_SW_STATUS__?: string }).__QATSHI_SW_STATUS__ = 'registered';
      }
    },
    onRegisterError(err) {
      (window as unknown as { __QATSHI_SW_STATUS__?: string }).__QATSHI_SW_STATUS__ =
        err instanceof Error ? `error:${err.message}` : 'error';
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);

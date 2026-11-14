import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { db } from '../db/qatshiDb';
import type { GoogleDriveAccountLink } from '../domain/types';
import { getMeta, setMeta } from './device';

export const SCOPES = ['https://www.googleapis.com/auth/drive.appdata'] as const;

let firebaseAuthInstance: Auth | null = null;
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;
let cachedFirebaseUser: User | null = null;
let isSigningIn = false;

function getFirebaseAuth(): Auth {
  if (firebaseAuthInstance) return firebaseAuthInstance;
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  firebaseAuthInstance = getAuth(app);
  return firebaseAuthInstance;
}

function buildDriveProvider(options?: {
  promptSelectAccount?: boolean;
  loginHint?: string;
}): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  const customParams: Record<string, string> = {};
  if (options?.promptSelectAccount) {
    customParams.prompt = 'select_account consent';
  }
  if (options?.loginHint) {
    customParams.login_hint = options.loginHint;
  }
  if (Object.keys(customParams).length > 0) {
    provider.setCustomParameters(customParams);
  }
  return provider;
}

export function initGoogleDriveAuth(
  onAuthUpdate?: (state: { authenticated: boolean; user: User | null }) => void
): () => void {
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, (user) => {
    cachedFirebaseUser = user;
    if (user && cachedAccessToken && Date.now() < cachedTokenExpiresAt) {
      onAuthUpdate?.({ authenticated: true, user });
    } else if (!isSigningIn) {
      if (!user) {
        cachedAccessToken = null;
        cachedTokenExpiresAt = 0;
      }
      onAuthUpdate?.({ authenticated: Boolean(user && cachedAccessToken), user });
    }
  });
}

export async function getInMemoryDriveAccessToken(): Promise<string | null> {
  if (!cachedAccessToken) return null;
  if (Date.now() >= cachedTokenExpiresAt) {
    cachedAccessToken = null;
    cachedTokenExpiresAt = 0;
    return null;
  }
  return cachedAccessToken;
}

export function getCachedSignedInGoogleEmail(): string | null {
  return cachedFirebaseUser?.email || null;
}

export async function getLinkedGoogleDriveAccount(
  orgId: string
): Promise<GoogleDriveAccountLink | null> {
  const raw = await getMeta(`googleDriveLink:${orgId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GoogleDriveAccountLink;
  } catch {
    return null;
  }
}

export async function saveLinkedGoogleDriveAccount(
  orgId: string,
  link: GoogleDriveAccountLink | null
): Promise<void> {
  if (!link) {
    await db.kvMeta.delete(`googleDriveLink:${orgId}`);
    return;
  }
  await setMeta(`googleDriveLink:${orgId}`, JSON.stringify(link));
}

export async function findOtherOrgUsingGoogleAccount(
  currentOrgId: string,
  email: string
): Promise<string | null> {
  const rows = await db.kvMeta.where('key').startsWith('googleDriveLink:').toArray();
  const normalized = email.trim().toLowerCase();
  for (const row of rows) {
    const orgId = row.key.replace('googleDriveLink:', '');
    if (orgId === currentOrgId) continue;
    try {
      const parsed = JSON.parse(row.value) as GoogleDriveAccountLink;
      if (parsed.email?.trim().toLowerCase() === normalized) {
        const org = await db.organizations.get(orgId);
        return org?.name || orgId;
      }
    } catch {
      // ignore malformed entry
    }
  }
  return null;
}

export async function connectGoogleDriveAccount(params: {
  orgId: string;
  mode: 'connect' | 'switch' | 'reauth';
  expectedEmail?: string;
}): Promise<{
  link: GoogleDriveAccountLink;
  accessToken: string;
  otherOrgWarning?: string;
}> {
  const auth = getFirebaseAuth();
  const provider = buildDriveProvider({
    promptSelectAccount: params.mode === 'connect' || params.mode === 'switch',
    loginHint: params.mode === 'reauth' ? params.expectedEmail : undefined,
  });

  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('لم يمنح حساب Google رمز وصول صالحاً لصلاحية مجلد التطبيق.');
    }

    const email = result.user.email?.trim();
    if (!email) {
      throw new Error('تعذر قراءة البريد الإلكتروني لحساب Google المختار.');
    }

    if (
      params.mode === 'reauth' &&
      params.expectedEmail &&
      email.toLowerCase() !== params.expectedEmail.trim().toLowerCase()
    ) {
      cachedAccessToken = null;
      cachedTokenExpiresAt = 0;
      throw new Error(
        `ACCOUNT_MISMATCH:الحساب المختار (${email}) يختلف عن الحساب المرتبط بالمؤسسة (${params.expectedEmail}). استخدم خيار "تغيير الحساب" إذا كنت تقصد التبديل.`
      );
    }

    // Store token strictly in memory (50 min safe TTL window; Google tokens last ~60m)
    cachedAccessToken = credential.accessToken;
    cachedTokenExpiresAt = Date.now() + 50 * 60 * 1000;
    cachedFirebaseUser = result.user;

    const otherOrgName = await findOtherOrgUsingGoogleAccount(params.orgId, email);
    const link: GoogleDriveAccountLink = {
      uid: result.user.uid,
      email,
      displayName: result.user.displayName?.trim() || email,
      photoURL: result.user.photoURL || undefined,
      connectedAt: new Date().toISOString(),
    };

    await saveLinkedGoogleDriveAccount(params.orgId, link);

    return {
      link,
      accessToken: credential.accessToken,
      otherOrgWarning: otherOrgName || undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/popup-closed-by-user|cancelled-popup-request/i.test(msg)) {
      throw new Error('تم إلغاء نافذة تسجيل الدخول إلى Google قبل منح الصلاحية.');
    }
    if (/popup-blocked/i.test(msg)) {
      throw new Error('تم حظر نافذة تسجيل الدخول من المتصفح — اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
}

export async function disconnectGoogleDriveAccount(orgId: string): Promise<void> {
  await saveLinkedGoogleDriveAccount(orgId, null);
  cachedAccessToken = null;
  cachedTokenExpiresAt = 0;
  cachedFirebaseUser = null;
  try {
    const auth = getFirebaseAuth();
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch {
    // Offline or auth not initialized: local linkage & memory token are already cleared
  }
}

/**
 * Test/automation hook for injecting an in-memory access token without touching localStorage.
 */
export function setInMemoryDriveAccessTokenForTest(token: string | null, ttlMs = 3600_000): void {
  cachedAccessToken = token;
  cachedTokenExpiresAt = token ? Date.now() + ttlMs : 0;
}

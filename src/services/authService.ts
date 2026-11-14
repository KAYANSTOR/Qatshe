export interface AuthUser {
  id: string;
  phone: string;
  ownerName: string;
  projectId: string | null;
  projectName: string | null;
}

interface AuthResponse {
  ok: true;
  user: AuthUser;
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\D/g, '');
}

export function normalizePhone(value: string): string {
  return normalizeDigits(value).slice(0, 15);
}

export function normalizeNumericCode(value: string): string {
  return normalizeDigits(value).slice(0, 8);
}

async function request<T>(path: string, body?: unknown, method = 'GET'): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || 'تعذر الاتصال بخدمة الحساب');
  return payload;
}

export async function getCurrentAuthUser(): Promise<AuthUser | null> {
  try {
    const payload = await request<{ authenticated: boolean; user?: AuthUser }>('/api/auth/me');
    return payload.authenticated ? payload.user || null : null;
  } catch {
    return null;
  }
}

export async function loginWithPhone(phone: string, code: string): Promise<AuthUser> {
  const payload = await request<AuthResponse>('/api/auth/login', {
    phone: normalizePhone(phone),
    code: normalizeNumericCode(code),
  }, 'POST');
  return payload.user;
}

export async function registerWithPhone(input: {
  phone: string;
  code: string;
  ownerName: string;
  projectName: string;
}): Promise<AuthUser> {
  const payload = await request<AuthResponse>('/api/auth/register', {
    phone: normalizePhone(input.phone),
    code: normalizeNumericCode(input.code),
    ownerName: input.ownerName.trim(),
    projectName: input.projectName.trim(),
  }, 'POST');
  return payload.user;
}

export async function logoutAuth(): Promise<void> {
  await request('/api/auth/logout', undefined, 'POST');
}

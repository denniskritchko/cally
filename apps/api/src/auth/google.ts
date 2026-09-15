import { env } from '../env.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const SCOPES = {
  login: ['openid', 'email', 'profile'],
  /** Only lets us create secondary calendars and edit events on those. Cannot see or touch the user's own calendars. */
  calendar: ['https://www.googleapis.com/auth/calendar.app.created'],
};

export const redirectUri = () => `${env.APP_URL}/api/auth/google/callback`;

export function authorizationUrl(state: string, scopes: string[], loginHint?: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('include_granted_scopes', 'true');
  // Google only returns a refresh_token on consent. Force it when we need calendar access.
  if (scopes.some((s) => s.includes('calendar'))) u.searchParams.set('prompt', 'consent');
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  token_type: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new GoogleAuthError(res.status, await res.text());
  return (await res.json()) as { access_token: string; expires_in: number };
}

export class GoogleAuthError extends Error {
  constructor(public status: number, body: string) {
    super(`Google auth ${status}: ${body.slice(0, 200)}`);
  }
  /** invalid_grant = user revoked access or token expired; the connection is dead. */
  get revoked(): boolean {
    return this.status === 400 && this.message.includes('invalid_grant');
  }
}

/**
 * The id_token came straight from Google's token endpoint over TLS in a
 * confidential-client flow, so we can trust its payload without verifying
 * the signature (per Google's own guidance).
 */
export function decodeIdToken(idToken: string): { sub: string; email: string; name?: string; email_verified?: boolean } {
  const payload = idToken.split('.')[1]!;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

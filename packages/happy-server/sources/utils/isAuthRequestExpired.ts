/**
 * Checks whether an auth request (terminal or account) has expired.
 *
 * Auth requests are considered expired when their `createdAt` timestamp
 * is older than the configured TTL. This prevents captured QR codes
 * from being used indefinitely.
 *
 * @param createdAt - The timestamp when the auth request was created
 * @param ttlMs - Time-to-live in milliseconds (default: 5 minutes)
 * @returns true if the request has expired
 */
export function isAuthRequestExpired(createdAt: Date, ttlMs: number = AUTH_REQUEST_TTL_MS): boolean {
    return Date.now() - createdAt.getTime() > ttlMs;
}

/** Default TTL for auth requests: 5 minutes */
export const AUTH_REQUEST_TTL_MS = 5 * 60 * 1000;

import { describe, it, expect, vi, afterEach } from "vitest";
import { isAuthRequestExpired, AUTH_REQUEST_TTL_MS } from "./isAuthRequestExpired";

describe("isAuthRequestExpired", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns false for a request created just now", () => {
        const now = new Date();
        expect(isAuthRequestExpired(now)).toBe(false);
    });

    it("returns false for a request created 1 minute ago", () => {
        vi.useFakeTimers();
        const createdAt = new Date();
        vi.advanceTimersByTime(60_000); // 1 minute
        expect(isAuthRequestExpired(createdAt)).toBe(false);
    });

    it("returns false for a request created exactly at the TTL boundary", () => {
        vi.useFakeTimers();
        const createdAt = new Date();
        vi.advanceTimersByTime(AUTH_REQUEST_TTL_MS); // exactly 5 minutes
        expect(isAuthRequestExpired(createdAt)).toBe(false);
    });

    it("returns true for a request created 1ms past the TTL", () => {
        vi.useFakeTimers();
        const createdAt = new Date();
        vi.advanceTimersByTime(AUTH_REQUEST_TTL_MS + 1);
        expect(isAuthRequestExpired(createdAt)).toBe(true);
    });

    it("returns true for a request created 10 minutes ago", () => {
        vi.useFakeTimers();
        const createdAt = new Date();
        vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
        expect(isAuthRequestExpired(createdAt)).toBe(true);
    });

    it("returns true for a request created days ago", () => {
        const createdAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
        expect(isAuthRequestExpired(createdAt)).toBe(true);
    });

    it("supports custom TTL", () => {
        vi.useFakeTimers();
        const createdAt = new Date();
        const customTtl = 60_000; // 1 minute

        vi.advanceTimersByTime(30_000); // 30 seconds
        expect(isAuthRequestExpired(createdAt, customTtl)).toBe(false);

        vi.advanceTimersByTime(31_000); // 61 seconds total
        expect(isAuthRequestExpired(createdAt, customTtl)).toBe(true);
    });

    it("has a default TTL of 5 minutes", () => {
        expect(AUTH_REQUEST_TTL_MS).toBe(5 * 60 * 1000);
    });
});

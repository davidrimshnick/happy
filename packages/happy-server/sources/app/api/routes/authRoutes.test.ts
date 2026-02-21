import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";
import { AUTH_REQUEST_TTL_MS } from "@/utils/isAuthRequestExpired";

/**
 * A valid 32-byte Curve25519 public key encoded as base64.
 * tweetnacl.box.publicKeyLength === 32, so any 32 bytes will pass validation.
 */
const VALID_PUBLIC_KEY_BYTES = new Uint8Array(32).fill(1);

/** A createdAt timestamp that is well within the TTL (1 minute ago) */
function freshCreatedAt(): Date {
    return new Date(Date.now() - 60_000);
}

/** A createdAt timestamp that is well past the TTL (10 minutes ago) */
function expiredCreatedAt(): Date {
    return new Date(Date.now() - AUTH_REQUEST_TTL_MS - 60_000);
}

/** A createdAt timestamp that is just within the TTL (4 minutes ago) */
function nearlyExpiredCreatedAt(): Date {
    return new Date(Date.now() - 4 * 60 * 1000);
}

const {
    state,
    dbMock,
    authMock,
    resetState
} = vi.hoisted(() => {

    interface AuthRequestRecord {
        id: string;
        publicKey: string;
        supportsV2: boolean;
        response: string | null;
        responseAccountId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }

    const state = {
        terminalAuthRequests: [] as AuthRequestRecord[],
        accountAuthRequests: [] as AuthRequestRecord[],
        nextId: 1,
    };

    const resetState = () => {
        state.terminalAuthRequests = [];
        state.accountAuthRequests = [];
        state.nextId = 1;
    };

    const makeDbModel = (store: () => AuthRequestRecord[]) => ({
        findUnique: vi.fn(async (args: any) => {
            return store().find(r => r.publicKey === args?.where?.publicKey) ?? null;
        }),
        findMany: vi.fn(async () => store()),
        upsert: vi.fn(async (args: any) => {
            const existing = store().find(r => r.publicKey === args?.where?.publicKey);
            if (existing) {
                return existing;
            }
            const now = new Date();
            const record: AuthRequestRecord = {
                id: `req-${state.nextId++}`,
                publicKey: args?.create?.publicKey,
                supportsV2: args?.create?.supportsV2 ?? false,
                response: null,
                responseAccountId: null,
                createdAt: now,
                updatedAt: now,
            };
            store().push(record);
            return record;
        }),
        update: vi.fn(async (args: any) => {
            const record = store().find(r => r.id === args?.where?.id);
            if (!record) {
                throw new Error("Record not found");
            }
            if (args?.data?.createdAt !== undefined) {
                record.createdAt = args.data.createdAt;
            }
            if (args?.data?.response !== undefined) {
                record.response = args.data.response;
            }
            if (args?.data?.responseAccountId !== undefined) {
                record.responseAccountId = args.data.responseAccountId;
            }
            if (args?.data?.supportsV2 !== undefined) {
                record.supportsV2 = args.data.supportsV2;
            }
            record.updatedAt = new Date();
            return record;
        }),
    });

    const dbMock = {
        terminalAuthRequest: makeDbModel(() => state.terminalAuthRequests),
        accountAuthRequest: makeDbModel(() => state.accountAuthRequests),
    };

    const authMock = {
        createToken: vi.fn(async () => "mock-token"),
    };

    return { state, dbMock, authMock, resetState };
});

vi.mock("@/storage/db", () => ({
    db: dbMock,
}));

vi.mock("@/app/auth/auth", () => ({
    auth: authMock,
}));

vi.mock("@/utils/log", () => ({
    log: vi.fn(),
}));

import { authRoutes } from "./authRoutes";
import * as privacyKit from "privacy-kit";

const VALID_PUBLIC_KEY_BASE64 = privacyKit.encodeBase64(VALID_PUBLIC_KEY_BYTES);
const VALID_PUBLIC_KEY_HEX = privacyKit.encodeHex(VALID_PUBLIC_KEY_BYTES);

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    typed.decorate("authenticate", async (request: any, reply: any) => {
        const userId = request.headers["x-user-id"];
        if (typeof userId !== "string") {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        request.userId = userId;
    });

    authRoutes(typed);
    await typed.ready();
    return typed;
}

function seedTerminalAuthRequest(overrides: Partial<{
    id: string;
    publicKey: string;
    supportsV2: boolean;
    response: string | null;
    responseAccountId: string | null;
    createdAt: Date;
}> = {}) {
    const now = new Date();
    const record = {
        id: overrides.id ?? `req-${state.nextId++}`,
        publicKey: overrides.publicKey ?? VALID_PUBLIC_KEY_HEX,
        supportsV2: overrides.supportsV2 ?? false,
        response: overrides.response ?? null,
        responseAccountId: overrides.responseAccountId ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: now,
    };
    state.terminalAuthRequests.push(record);
    return record;
}

function seedAccountAuthRequest(overrides: Partial<{
    id: string;
    publicKey: string;
    response: string | null;
    responseAccountId: string | null;
    createdAt: Date;
}> = {}) {
    const now = new Date();
    const record = {
        id: overrides.id ?? `req-${state.nextId++}`,
        publicKey: overrides.publicKey ?? VALID_PUBLIC_KEY_HEX,
        supportsV2: false,
        response: overrides.response ?? null,
        responseAccountId: overrides.responseAccountId ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: now,
    };
    state.accountAuthRequests.push(record);
    return record;
}

describe("authRoutes - challenge expiry", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        authMock.createToken.mockClear();
        dbMock.terminalAuthRequest.update.mockClear();
        dbMock.accountAuthRequest.update.mockClear();
    });

    afterEach(async () => {
        if (app) {
            await app.close();
        }
    });

    // ─── POST /v1/auth/request (terminal) ─────────────────────────────

    describe("POST /v1/auth/request", () => {
        it("creates a new terminal auth request", async () => {
            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/request",
                payload: { publicKey: VALID_PUBLIC_KEY_BASE64 }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ state: "requested" });
            expect(state.terminalAuthRequests).toHaveLength(1);
        });

        it("returns authorized for a non-expired approved request", async () => {
            seedTerminalAuthRequest({
                response: "encrypted-response",
                responseAccountId: "user-1",
                createdAt: freshCreatedAt(),
            });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/request",
                payload: { publicKey: VALID_PUBLIC_KEY_BASE64 }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.state).toBe("authorized");
            expect(body.token).toBe("mock-token");
            expect(body.response).toBe("encrypted-response");
        });

        it("resets an expired terminal auth request and returns 'requested'", async () => {
            const record = seedTerminalAuthRequest({
                response: "old-response",
                responseAccountId: "user-1",
                createdAt: expiredCreatedAt(),
            });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/request",
                payload: { publicKey: VALID_PUBLIC_KEY_BASE64 }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ state: "requested" });

            // The expired record should have been updated (response cleared)
            expect(dbMock.terminalAuthRequest.update).toHaveBeenCalledWith({
                where: { id: record.id },
                data: expect.objectContaining({
                    response: null,
                    responseAccountId: null,
                })
            });
        });
    });

    // ─── GET /v1/auth/request/status ───────────────────────────────────

    describe("GET /v1/auth/request/status", () => {
        it("returns not_found for expired requests", async () => {
            seedTerminalAuthRequest({ createdAt: expiredCreatedAt() });

            app = await createApp();
            const response = await app.inject({
                method: "GET",
                url: `/v1/auth/request/status?publicKey=${encodeURIComponent(VALID_PUBLIC_KEY_BASE64)}`
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ status: "not_found", supportsV2: false });
        });

        it("returns pending for non-expired requests", async () => {
            seedTerminalAuthRequest({ createdAt: freshCreatedAt(), supportsV2: true });

            app = await createApp();
            const response = await app.inject({
                method: "GET",
                url: `/v1/auth/request/status?publicKey=${encodeURIComponent(VALID_PUBLIC_KEY_BASE64)}`
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ status: "pending", supportsV2: true });
        });

        it("returns authorized for approved non-expired requests", async () => {
            seedTerminalAuthRequest({
                createdAt: freshCreatedAt(),
                response: "encrypted",
                responseAccountId: "user-1",
            });

            app = await createApp();
            const response = await app.inject({
                method: "GET",
                url: `/v1/auth/request/status?publicKey=${encodeURIComponent(VALID_PUBLIC_KEY_BASE64)}`
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ status: "authorized", supportsV2: false });
        });
    });

    // ─── POST /v1/auth/response (terminal) ─────────────────────────────

    describe("POST /v1/auth/response", () => {
        it("rejects expired terminal auth requests with 410", async () => {
            seedTerminalAuthRequest({ createdAt: expiredCreatedAt() });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/response",
                headers: { "x-user-id": "user-1" },
                payload: {
                    response: "encrypted-response",
                    publicKey: VALID_PUBLIC_KEY_BASE64
                }
            });

            expect(response.statusCode).toBe(410);
            expect(response.json()).toEqual({ error: "Request expired" });
        });

        it("approves non-expired terminal auth requests", async () => {
            seedTerminalAuthRequest({ createdAt: freshCreatedAt() });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/response",
                headers: { "x-user-id": "user-1" },
                payload: {
                    response: "encrypted-response",
                    publicKey: VALID_PUBLIC_KEY_BASE64
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ success: true });
        });

        it("approves a request created 4 minutes ago (within TTL)", async () => {
            seedTerminalAuthRequest({ createdAt: nearlyExpiredCreatedAt() });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/response",
                headers: { "x-user-id": "user-1" },
                payload: {
                    response: "encrypted-response",
                    publicKey: VALID_PUBLIC_KEY_BASE64
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ success: true });
        });
    });

    // ─── POST /v1/auth/account/request ─────────────────────────────────

    describe("POST /v1/auth/account/request", () => {
        it("creates a new account auth request", async () => {
            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/account/request",
                payload: { publicKey: VALID_PUBLIC_KEY_BASE64 }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ state: "requested" });
        });

        it("resets an expired account auth request", async () => {
            const record = seedAccountAuthRequest({
                response: "old-response",
                responseAccountId: "user-1",
                createdAt: expiredCreatedAt(),
            });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/account/request",
                payload: { publicKey: VALID_PUBLIC_KEY_BASE64 }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ state: "requested" });
            expect(dbMock.accountAuthRequest.update).toHaveBeenCalledWith({
                where: { id: record.id },
                data: expect.objectContaining({
                    response: null,
                    responseAccountId: null,
                })
            });
        });

        it("returns authorized for a non-expired approved account request", async () => {
            seedAccountAuthRequest({
                response: "encrypted-response",
                responseAccountId: "user-1",
                createdAt: freshCreatedAt(),
            });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/account/request",
                payload: { publicKey: VALID_PUBLIC_KEY_BASE64 }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.state).toBe("authorized");
            expect(body.token).toBe("mock-token");
        });
    });

    // ─── POST /v1/auth/account/response ────────────────────────────────

    describe("POST /v1/auth/account/response", () => {
        it("rejects expired account auth requests with 410", async () => {
            seedAccountAuthRequest({ createdAt: expiredCreatedAt() });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/account/response",
                headers: { "x-user-id": "user-1" },
                payload: {
                    response: "encrypted-response",
                    publicKey: VALID_PUBLIC_KEY_BASE64
                }
            });

            expect(response.statusCode).toBe(410);
            expect(response.json()).toEqual({ error: "Request expired" });
        });

        it("approves non-expired account auth requests", async () => {
            seedAccountAuthRequest({ createdAt: freshCreatedAt() });

            app = await createApp();
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth/account/response",
                headers: { "x-user-id": "user-1" },
                payload: {
                    response: "encrypted-response",
                    publicKey: VALID_PUBLIC_KEY_BASE64
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ success: true });
        });
    });
});

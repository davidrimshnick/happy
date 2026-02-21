import { describe, it, expect, beforeEach } from 'vitest';
import { BasePermissionHandler, PermissionResponse, PermissionResult } from './BasePermissionHandler';
import { AgentState } from '@/api/types';

/**
 * Minimal stub for ApiSessionClient that captures agentState updates
 * and allows triggering RPC handlers.
 */
function createStubSession() {
    let agentState: AgentState = {};
    let rpcHandler: ((response: PermissionResponse) => Promise<void>) | null = null;

    return {
        agentState,
        getAgentState: () => agentState,
        triggerRpc: async (response: PermissionResponse) => {
            if (!rpcHandler) throw new Error('No RPC handler registered');
            await rpcHandler(response);
        },
        updateAgentState: (handler: (state: AgentState) => AgentState) => {
            agentState = handler(agentState);
        },
        rpcHandlerManager: {
            registerHandler: (_method: string, handler: (response: PermissionResponse) => Promise<void>) => {
                rpcHandler = handler;
            }
        }
    };
}

/**
 * Concrete implementation of BasePermissionHandler for testing.
 */
class TestPermissionHandler extends BasePermissionHandler {
    protected getLogPrefix(): string {
        return '[Test]';
    }

    /** Expose for testing */
    addRequest(toolCallId: string, toolName: string, input: unknown): Promise<PermissionResult> {
        return new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input });
            this.addPendingRequestToState(toolCallId, toolName, input);
        });
    }

    getPendingCount(): number {
        return this.pendingRequests.size;
    }
}

describe('BasePermissionHandler', () => {
    let stub: ReturnType<typeof createStubSession>;
    let handler: TestPermissionHandler;

    beforeEach(() => {
        stub = createStubSession();
        handler = new TestPermissionHandler(stub as any);
    });

    it('should resolve a pending permission request on RPC response', async () => {
        const resultPromise = handler.addRequest('tool-1', 'Bash', { command: 'ls' });

        // Simulate mobile app approving
        await stub.triggerRpc({ id: 'tool-1', approved: true, decision: 'approved' });

        const result = await resultPromise;
        expect(result.decision).toBe('approved');
        expect(handler.getPendingCount()).toBe(0);
    });

    it('should move request to completedRequests in agentState on approval', async () => {
        const resultPromise = handler.addRequest('tool-1', 'Bash', { command: 'ls' });
        await stub.triggerRpc({ id: 'tool-1', approved: true, decision: 'approved' });
        await resultPromise;

        const state = stub.getAgentState();
        expect(state.requests).toEqual({});
        expect(state.completedRequests?.['tool-1']).toBeDefined();
        expect(state.completedRequests?.['tool-1']?.status).toBe('approved');
    });

    it('should move request to completedRequests in agentState on denial', async () => {
        const resultPromise = handler.addRequest('tool-1', 'Bash', { command: 'rm -rf /' });
        await stub.triggerRpc({ id: 'tool-1', approved: false, decision: 'denied' });

        const result = await resultPromise;
        expect(result.decision).toBe('denied');

        const state = stub.getAgentState();
        expect(state.completedRequests?.['tool-1']?.status).toBe('denied');
    });

    it('should handle approved_for_session decision', async () => {
        const resultPromise = handler.addRequest('tool-1', 'Bash', { command: 'ls' });
        await stub.triggerRpc({ id: 'tool-1', approved: true, decision: 'approved_for_session' });

        const result = await resultPromise;
        expect(result.decision).toBe('approved_for_session');
    });

    describe('race condition: response arrives after reset()', () => {
        it('should update agentState when pending request was cleared by reset', async () => {
            // Add a request - but don't await it (will be rejected by reset)
            const resultPromise = handler.addRequest('tool-1', 'Bash', { command: 'ls' });

            // Simulate turn ending: reset clears pendingRequests
            handler.reset();

            // The promise should reject with Session reset
            await expect(resultPromise).rejects.toThrow('Session reset');

            // Verify request was moved to completedRequests as canceled
            let state = stub.getAgentState();
            expect(state.requests).toEqual({});
            expect(state.completedRequests?.['tool-1']?.status).toBe('canceled');

            // Now simulate mobile app sending approval AFTER reset
            await stub.triggerRpc({ id: 'tool-1', approved: true, decision: 'approved' });

            // The agentState should be updated to 'approved' (overriding 'canceled')
            state = stub.getAgentState();
            expect(state.completedRequests?.['tool-1']?.status).toBe('approved');
            expect(state.completedRequests?.['tool-1']?.decision).toBe('approved');
        });

        it('should update agentState from pending requests when response arrives after reset', async () => {
            // Manually put the request in agentState.requests but NOT in pendingRequests
            // (simulating the case where reset() hasn't yet propagated the state update)
            stub.updateAgentState((state) => ({
                ...state,
                requests: {
                    'tool-2': { tool: 'Edit', arguments: { file: 'test.ts' }, createdAt: 1000 }
                }
            }));

            // Trigger RPC response for a request not in pendingRequests
            await stub.triggerRpc({ id: 'tool-2', approved: false, decision: 'abort' });

            // The agentState should be updated
            const state = stub.getAgentState();
            expect(state.requests).toEqual({});
            expect(state.completedRequests?.['tool-2']?.status).toBe('denied');
            expect(state.completedRequests?.['tool-2']?.decision).toBe('abort');
        });

        it('should not modify agentState when response ID is completely unknown', async () => {
            // Trigger RPC response for a completely unknown ID
            await stub.triggerRpc({ id: 'unknown-id', approved: true, decision: 'approved' });

            // AgentState should not be modified
            const state = stub.getAgentState();
            expect(state.requests).toBeUndefined();
            expect(state.completedRequests).toBeUndefined();
        });
    });

    describe('reset()', () => {
        it('should reject all pending requests and move them to completedRequests', async () => {
            const p1 = handler.addRequest('tool-1', 'Bash', { command: 'ls' });
            const p2 = handler.addRequest('tool-2', 'Edit', { file: 'test.ts' });

            handler.reset();

            await expect(p1).rejects.toThrow('Session reset');
            await expect(p2).rejects.toThrow('Session reset');

            const state = stub.getAgentState();
            expect(state.requests).toEqual({});
            expect(state.completedRequests?.['tool-1']?.status).toBe('canceled');
            expect(state.completedRequests?.['tool-2']?.status).toBe('canceled');
            expect(handler.getPendingCount()).toBe(0);
        });

        it('should be idempotent when called multiple times', () => {
            handler.reset();
            handler.reset();
            handler.reset();

            // Should not throw
            const state = stub.getAgentState();
            expect(state.requests).toEqual({});
        });
    });
});

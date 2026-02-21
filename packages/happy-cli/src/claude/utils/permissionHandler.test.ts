import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionHandler } from './permissionHandler';

/**
 * Inline type to avoid transitive zod dependency from @/api/types.
 */
type AgentState = {
    requests?: Record<string, any>;
    completedRequests?: Record<string, any>;
};

/**
 * Minimal stub that satisfies PermissionHandler's Session dependency.
 * Captures agentState updates and allows triggering the RPC handler.
 */
function createStubSession() {
    let agentState: AgentState = {};
    let rpcHandler: ((response: any) => Promise<void>) | null = null;

    const client = {
        sessionId: 'test-session',
        updateAgentState: (handler: (state: AgentState) => AgentState) => {
            agentState = handler(agentState);
        },
        rpcHandlerManager: {
            registerHandler: (_method: string, handler: (response: any) => Promise<void>) => {
                rpcHandler = handler;
            }
        }
    };

    return {
        session: {
            client,
            queue: {
                unshift: () => {}
            },
            api: {
                push: () => ({
                    sendToAllDevices: () => {}
                })
            }
        },
        getAgentState: () => agentState,
        setAgentState: (state: AgentState) => { agentState = state; },
        triggerRpc: async (response: any) => {
            if (!rpcHandler) throw new Error('No RPC handler registered');
            await rpcHandler(response);
        }
    };
}

describe('PermissionHandler (Claude)', () => {
    let stub: ReturnType<typeof createStubSession>;
    let handler: PermissionHandler;

    beforeEach(() => {
        stub = createStubSession();
        handler = new PermissionHandler(stub.session as any);
    });

    describe('race condition: response arrives after reset()', () => {
        it('should update agentState when pending request was cleared by reset', async () => {
            // Simulate tracking a tool call
            handler.onMessage({
                type: 'assistant',
                message: {
                    content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }]
                }
            } as any);

            const abortController = new AbortController();

            // Start permission request
            const resultPromise = handler.handleToolCall(
                'Bash',
                { command: 'ls' },
                { permissionMode: 'default' } as any,
                { signal: abortController.signal }
            );

            // Reset clears pending requests (simulates turn ending)
            handler.reset();

            // The promise should reject
            await expect(resultPromise).rejects.toThrow('Session reset');

            // Verify reset moved request to completedRequests as canceled
            let state = stub.getAgentState();
            expect(state.requests).toEqual({});
            expect(state.completedRequests?.['tool-1']?.status).toBe('canceled');

            // Now simulate mobile app sending approval AFTER reset
            await stub.triggerRpc({ id: 'tool-1', approved: true });

            // The agentState should be updated to 'approved' (overriding 'canceled')
            state = stub.getAgentState();
            expect(state.completedRequests?.['tool-1']?.status).toBe('approved');
        });

        it('should update agentState from pending requests when response arrives for unknown pending', async () => {
            // Manually put the request in agentState.requests but NOT in pendingRequests
            stub.setAgentState({
                requests: {
                    'tool-2': { tool: 'Edit', arguments: { file: 'test.ts' }, createdAt: 1000 }
                }
            });

            // Trigger RPC response for a request not in pendingRequests
            await stub.triggerRpc({ id: 'tool-2', approved: false });

            // The agentState should be updated
            const state = stub.getAgentState();
            expect(state.requests).toEqual({});
            expect(state.completedRequests?.['tool-2']?.status).toBe('denied');
        });

        it('should not modify agentState when response ID is completely unknown', async () => {
            // Trigger RPC response for a completely unknown ID
            await stub.triggerRpc({ id: 'unknown-id', approved: true });

            // AgentState should not be modified
            const state = stub.getAgentState();
            expect(state.requests).toBeUndefined();
            expect(state.completedRequests).toBeUndefined();
        });
    });

    describe('normal flow', () => {
        it('should resolve a pending permission request on RPC response', async () => {
            // Simulate tracking a tool call
            handler.onMessage({
                type: 'assistant',
                message: {
                    content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }]
                }
            } as any);

            const abortController = new AbortController();

            const resultPromise = handler.handleToolCall(
                'Bash',
                { command: 'ls' },
                { permissionMode: 'default' } as any,
                { signal: abortController.signal }
            );

            // Simulate mobile app approving
            await stub.triggerRpc({ id: 'tool-1', approved: true });

            const result = await resultPromise;
            expect(result.behavior).toBe('allow');

            const state = stub.getAgentState();
            expect(state.completedRequests?.['tool-1']?.status).toBe('approved');
        });

        it('should deny a permission request', async () => {
            handler.onMessage({
                type: 'assistant',
                message: {
                    content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'rm -rf /' } }]
                }
            } as any);

            const abortController = new AbortController();

            const resultPromise = handler.handleToolCall(
                'Bash',
                { command: 'rm -rf /' },
                { permissionMode: 'default' } as any,
                { signal: abortController.signal }
            );

            await stub.triggerRpc({ id: 'tool-1', approved: false, reason: 'Too dangerous' });

            const result = await resultPromise;
            expect(result.behavior).toBe('deny');

            const state = stub.getAgentState();
            expect(state.completedRequests?.['tool-1']?.status).toBe('denied');
        });

        it('should store mode and allowTools from response', async () => {
            handler.onMessage({
                type: 'assistant',
                message: {
                    content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }]
                }
            } as any);

            const abortController = new AbortController();

            const resultPromise = handler.handleToolCall(
                'Bash',
                { command: 'ls' },
                { permissionMode: 'default' } as any,
                { signal: abortController.signal }
            );

            await stub.triggerRpc({
                id: 'tool-1',
                approved: true,
                mode: 'acceptEdits',
                allowTools: ['Bash']
            });

            await resultPromise;

            const state = stub.getAgentState();
            expect(state.completedRequests?.['tool-1']?.mode).toBe('acceptEdits');
            expect(state.completedRequests?.['tool-1']?.allowTools).toEqual(['Bash']);
        });
    });

    describe('abort handling', () => {
        it('should reject when abort signal fires', async () => {
            handler.onMessage({
                type: 'assistant',
                message: {
                    content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }]
                }
            } as any);

            const abortController = new AbortController();

            const resultPromise = handler.handleToolCall(
                'Bash',
                { command: 'ls' },
                { permissionMode: 'default' } as any,
                { signal: abortController.signal }
            );

            abortController.abort();

            await expect(resultPromise).rejects.toThrow('Permission request aborted');
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for claudeRemote's --resume session resolution logic.
 *
 * The key behavior being tested: when --resume is passed without a session ID
 * in remote mode, claudeRemote should resolve it to the last session
 * for the directory using claudeFindLastSession, rather than silently ignoring it.
 */

// Mock dependencies
const mockClaudeFindLastSession = vi.fn();
const mockClaudeCheckSession = vi.fn();
const mockQuery = vi.fn();

vi.mock('./utils/claudeFindLastSession', () => ({
    claudeFindLastSession: (...args: any[]) => mockClaudeFindLastSession(...args)
}));

vi.mock('./utils/claudeCheckSession', () => ({
    claudeCheckSession: (...args: any[]) => mockClaudeCheckSession(...args)
}));

vi.mock('@/claude/sdk', () => ({
    query: (...args: any[]) => mockQuery(...args),
    AbortError: class AbortError extends Error {}
}));

vi.mock('./utils/permissionMode', () => ({
    mapToClaudeMode: vi.fn(() => 'default')
}));

vi.mock('@/projectPath', () => ({
    projectPath: () => '/fake/project'
}));

vi.mock('@/parsers/specialCommands', () => ({
    parseSpecialCommand: vi.fn(() => ({ type: null }))
}));

vi.mock('@/lib', () => ({
    logger: { debug: vi.fn(), debugLargeJson: vi.fn() }
}));

vi.mock('@/utils/PushableAsyncIterable', () => ({
    PushableAsyncIterable: vi.fn().mockImplementation(() => ({
        push: vi.fn(),
        end: vi.fn(),
        [Symbol.asyncIterator]: async function* () {}
    }))
}));

vi.mock('./utils/path', () => ({
    getProjectPath: vi.fn(() => '/fake/.claude/projects/test')
}));

vi.mock('@/modules/watcher/awaitFileExist', () => ({
    awaitFileExist: vi.fn(async () => true)
}));

vi.mock('./utils/systemPrompt', () => ({
    systemPrompt: 'test-system-prompt'
}));

// Import after mocks
import { claudeRemote } from './claudeRemote';

describe('claudeRemote --resume session resolution', () => {
    let baseOpts: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Default: query returns an empty async iterator that ends immediately
        mockQuery.mockReturnValue({
            [Symbol.asyncIterator]: async function* () {
                yield { type: 'result', subtype: 'success' };
            }
        });

        baseOpts = {
            sessionId: null,
            path: '/test/project',
            mcpServers: {},
            claudeEnvVars: {},
            claudeArgs: [],
            allowedTools: [],
            signal: new AbortController().signal,
            canCallTool: vi.fn(async () => ({ approved: true })),
            hookSettingsPath: '/tmp/hook-settings',
            nextMessage: vi.fn(async () => null), // No message = exit
            onReady: vi.fn(),
            isAborted: vi.fn(() => false),
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            onMessage: vi.fn(),
            onCompletionEvent: vi.fn(),
            onSessionReset: vi.fn()
        };
    });

    it('should resolve --resume without session ID to last session', async () => {
        mockClaudeFindLastSession.mockReturnValue('abcd1234-5678-9012-3456-789012345678');
        mockClaudeCheckSession.mockReturnValue(true);

        baseOpts.claudeArgs = ['--resume'];
        baseOpts.nextMessage = vi.fn(async () => ({
            message: 'Hello',
            mode: { permissionMode: 'default' }
        }));

        // Since query returns result immediately, the function will request next message
        // and get null (from the second call), then exit
        let callCount = 0;
        baseOpts.nextMessage = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return { message: 'Hello', mode: { permissionMode: 'default' } };
            }
            return null;
        });

        await claudeRemote(baseOpts);

        // Verify claudeFindLastSession was called with the correct path
        expect(mockClaudeFindLastSession).toHaveBeenCalledWith('/test/project');

        // Verify query was called with resume set to the found session
        expect(mockQuery).toHaveBeenCalled();
        const queryOptions = mockQuery.mock.calls[0][0].options;
        expect(queryOptions.resume).toBe('abcd1234-5678-9012-3456-789012345678');
    });

    it('should resolve --resume at end of args to last session', async () => {
        mockClaudeFindLastSession.mockReturnValue('11111111-2222-3333-4444-555555555555');

        baseOpts.claudeArgs = ['--some-flag', '--resume'];
        let callCount = 0;
        baseOpts.nextMessage = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return { message: 'Hello', mode: { permissionMode: 'default' } };
            }
            return null;
        });

        await claudeRemote(baseOpts);

        expect(mockClaudeFindLastSession).toHaveBeenCalledWith('/test/project');
        expect(mockQuery).toHaveBeenCalled();
        const queryOptions = mockQuery.mock.calls[0][0].options;
        expect(queryOptions.resume).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('should not call claudeFindLastSession when --resume has a session ID', async () => {
        baseOpts.claudeArgs = ['--resume', 'explicit-session-id-with-dashes'];
        let callCount = 0;
        baseOpts.nextMessage = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return { message: 'Hello', mode: { permissionMode: 'default' } };
            }
            return null;
        });

        await claudeRemote(baseOpts);

        // Should not search for sessions - explicit ID was provided
        expect(mockClaudeFindLastSession).not.toHaveBeenCalled();
        expect(mockQuery).toHaveBeenCalled();
        const queryOptions = mockQuery.mock.calls[0][0].options;
        expect(queryOptions.resume).toBe('explicit-session-id-with-dashes');
    });

    it('should pass undefined resume when --resume without session and no sessions found', async () => {
        mockClaudeFindLastSession.mockReturnValue(null);

        baseOpts.claudeArgs = ['--resume'];
        let callCount = 0;
        baseOpts.nextMessage = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return { message: 'Hello', mode: { permissionMode: 'default' } };
            }
            return null;
        });

        await claudeRemote(baseOpts);

        expect(mockClaudeFindLastSession).toHaveBeenCalledWith('/test/project');
        expect(mockQuery).toHaveBeenCalled();
        const queryOptions = mockQuery.mock.calls[0][0].options;
        expect(queryOptions.resume).toBeUndefined();
    });

    it('should use sessionId from opts when provided and valid', async () => {
        mockClaudeCheckSession.mockReturnValue(true);

        baseOpts.sessionId = 'existing-session-id-from-opts';
        let callCount = 0;
        baseOpts.nextMessage = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return { message: 'Hello', mode: { permissionMode: 'default' } };
            }
            return null;
        });

        await claudeRemote(baseOpts);

        // Should not search for sessions
        expect(mockClaudeFindLastSession).not.toHaveBeenCalled();
        expect(mockQuery).toHaveBeenCalled();
        const queryOptions = mockQuery.mock.calls[0][0].options;
        expect(queryOptions.resume).toBe('existing-session-id-from-opts');
    });
});

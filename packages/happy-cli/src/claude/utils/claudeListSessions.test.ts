import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { claudeListSessions, ClaudeSessionInfo } from './claudeListSessions';
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock getProjectPath to use test directory directly
vi.mock('./path', () => ({
    getProjectPath: (path: string) => path
}));

describe('claudeListSessions', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `test-list-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('Basic listing', () => {
        it('should return empty array when no sessions exist', () => {
            const sessions = claudeListSessions(testDir);
            expect(sessions).toEqual([]);
        });

        it('should return empty array when directory does not exist', () => {
            const nonExistentDir = join(tmpdir(), 'does-not-exist-' + Date.now());
            const sessions = claudeListSessions(nonExistentDir);
            expect(sessions).toEqual([]);
        });

        it('should list a single valid session', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            writeFileSync(
                join(testDir, `${sessionId}.jsonl`),
                JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: 'Hello world', role: 'user' } }) + '\n' +
                JSON.stringify({ uuid: 'msg-2', type: 'assistant', message: { content: [{ type: 'text', text: 'Hi there' }], role: 'assistant' } }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].sessionId).toBe(sessionId);
            expect(sessions[0].firstMessage).toBe('Hello world');
            expect(sessions[0].messageCount).toBe(2);
            expect(sessions[0].summary).toBeNull();
            expect(sessions[0].lastModified).toBeGreaterThan(0);
        });

        it('should extract first message from content array format', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            writeFileSync(
                join(testDir, `${sessionId}.jsonl`),
                JSON.stringify({
                    uuid: 'msg-1',
                    type: 'user',
                    message: {
                        content: [{ type: 'text', text: 'Hello from array' }],
                        role: 'user'
                    }
                }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].firstMessage).toBe('Hello from array');
        });

        it('should extract summary from resumed session files', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            writeFileSync(
                join(testDir, `${sessionId}.jsonl`),
                JSON.stringify({ type: 'summary', summary: 'Discussed file system operations', leafUuid: 'leaf-1' }) + '\n' +
                JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: 'List files', role: 'user' } }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].summary).toBe('Discussed file system operations');
            expect(sessions[0].firstMessage).toBe('List files');
        });
    });

    describe('Sorting and limiting', () => {
        it('should return sessions sorted by most recently modified first', () => {
            const oldId = '11111111-1111-1111-1111-111111111111';
            const newId = '22222222-2222-2222-2222-222222222222';

            const oldFile = join(testDir, `${oldId}.jsonl`);
            writeFileSync(oldFile, JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: 'Old session', role: 'user' } }) + '\n');
            utimesSync(oldFile, new Date('2025-01-01'), new Date('2025-01-01'));

            const newFile = join(testDir, `${newId}.jsonl`);
            writeFileSync(newFile, JSON.stringify({ uuid: 'msg-2', type: 'user', message: { content: 'New session', role: 'user' } }) + '\n');
            utimesSync(newFile, new Date('2025-12-31'), new Date('2025-12-31'));

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(2);
            expect(sessions[0].sessionId).toBe(newId);
            expect(sessions[0].firstMessage).toBe('New session');
            expect(sessions[1].sessionId).toBe(oldId);
            expect(sessions[1].firstMessage).toBe('Old session');
        });

        it('should respect the limit parameter', () => {
            // Create 5 sessions
            for (let i = 0; i < 5; i++) {
                const sessionId = `${i.toString().padStart(8, '0')}-1111-1111-1111-111111111111`;
                const sessionFile = join(testDir, `${sessionId}.jsonl`);
                writeFileSync(sessionFile, JSON.stringify({ uuid: `msg-${i}`, type: 'user', message: { content: `Session ${i}`, role: 'user' } }) + '\n');
                utimesSync(sessionFile, new Date(2025, 0, 1 + i), new Date(2025, 0, 1 + i));
            }

            const sessions = claudeListSessions(testDir, 3);
            expect(sessions).toHaveLength(3);
            // Most recent first
            expect(sessions[0].sessionId).toBe('00000004-1111-1111-1111-111111111111');
        });
    });

    describe('Filtering', () => {
        it('should skip non-UUID session files (agent sessions)', () => {
            writeFileSync(
                join(testDir, 'agent-abc123.jsonl'),
                JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: 'Agent session', role: 'user' } }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toEqual([]);
        });

        it('should skip sessions without valid ID fields', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            writeFileSync(
                join(testDir, `${sessionId}.jsonl`),
                JSON.stringify({ type: 'user', content: 'test' }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toEqual([]);
        });

        it('should skip empty session files', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            writeFileSync(join(testDir, `${sessionId}.jsonl`), '');

            const sessions = claudeListSessions(testDir);
            expect(sessions).toEqual([]);
        });

        it('should skip non-jsonl files', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            writeFileSync(
                join(testDir, `${sessionId}.txt`),
                JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: 'test', role: 'user' } }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toEqual([]);
        });
    });

    describe('Message counting', () => {
        it('should count all parseable JSONL lines', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            writeFileSync(
                join(testDir, `${sessionId}.jsonl`),
                JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: 'Hello', role: 'user' } }) + '\n' +
                JSON.stringify({ uuid: 'msg-2', type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }], role: 'assistant' } }) + '\n' +
                JSON.stringify({ uuid: 'msg-3', type: 'user', message: { content: 'Thanks', role: 'user' } }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].messageCount).toBe(3);
        });

        it('should skip empty lines and malformed JSON in count', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            writeFileSync(
                join(testDir, `${sessionId}.jsonl`),
                JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: 'Hello', role: 'user' } }) + '\n' +
                '\n' +  // empty line
                'not valid json\n' +  // malformed
                JSON.stringify({ uuid: 'msg-2', type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }], role: 'assistant' } }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(1);
            // Only 2 valid JSON lines counted
            expect(sessions[0].messageCount).toBe(2);
        });
    });

    describe('First message truncation', () => {
        it('should truncate first message to 200 characters', () => {
            const sessionId = '12345678-1234-1234-1234-123456789abc';
            const longMessage = 'A'.repeat(300);
            writeFileSync(
                join(testDir, `${sessionId}.jsonl`),
                JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: longMessage, role: 'user' } }) + '\n'
            );

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].firstMessage).toHaveLength(200);
        });
    });

    describe('Mixed valid and invalid sessions', () => {
        it('should only return valid sessions', () => {
            // Valid UUID session
            const validId = '12345678-1234-1234-1234-123456789abc';
            const validFile = join(testDir, `${validId}.jsonl`);
            writeFileSync(validFile,
                JSON.stringify({ uuid: 'msg-1', type: 'user', message: { content: 'Valid session', role: 'user' } }) + '\n'
            );
            utimesSync(validFile, new Date('2025-06-01'), new Date('2025-06-01'));

            // Agent session (invalid)
            writeFileSync(
                join(testDir, 'agent-xyz.jsonl'),
                JSON.stringify({ uuid: 'msg-2', type: 'user', message: { content: 'Agent', role: 'user' } }) + '\n'
            );

            // Empty session (invalid)
            const emptyId = '99999999-9999-9999-9999-999999999999';
            writeFileSync(join(testDir, `${emptyId}.jsonl`), '');

            // Valid session 2
            const validId2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
            const validFile2 = join(testDir, `${validId2}.jsonl`);
            writeFileSync(validFile2,
                JSON.stringify({ uuid: 'msg-3', type: 'user', message: { content: 'Another valid', role: 'user' } }) + '\n'
            );
            utimesSync(validFile2, new Date('2025-07-01'), new Date('2025-07-01'));

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(2);
            // More recent first
            expect(sessions[0].sessionId).toBe(validId2);
            expect(sessions[1].sessionId).toBe(validId);
        });
    });

    describe('Default limit', () => {
        it('should default to 20 sessions', () => {
            // Create 25 sessions
            for (let i = 0; i < 25; i++) {
                const sessionId = `${i.toString().padStart(8, '0')}-1111-1111-1111-111111111111`;
                const sessionFile = join(testDir, `${sessionId}.jsonl`);
                writeFileSync(sessionFile, JSON.stringify({
                    uuid: `msg-${i}`,
                    type: 'user',
                    message: { content: `Session ${i}`, role: 'user' }
                }) + '\n');
            }

            const sessions = claudeListSessions(testDir);
            expect(sessions).toHaveLength(20);
        });
    });
});

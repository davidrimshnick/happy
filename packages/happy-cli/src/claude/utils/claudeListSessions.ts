import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectPath } from './path';
import { claudeCheckSession } from './claudeCheckSession';
import { logger } from '@/ui/logger';

/**
 * Information about a Claude Code session available for resuming.
 * Extracted from session JSONL files in the project directory.
 */
export interface ClaudeSessionInfo {
    /** UUID session ID (filename without .jsonl) */
    sessionId: string;
    /** Last modification time as Unix timestamp (ms) */
    lastModified: number;
    /** First user message text, truncated to 200 chars */
    firstMessage: string | null;
    /** Summary line from session file (present in resumed sessions) */
    summary: string | null;
    /** Total number of parseable JSONL lines in the session file */
    messageCount: number;
}

/**
 * Lists all valid Claude Code sessions for a given working directory,
 * sorted by most recently modified first. Each session includes metadata
 * useful for displaying in a session picker UI.
 *
 * Valid sessions must:
 * 1. Have a UUID-format filename (agent-* sessions excluded)
 * 2. Contain at least one message with a uuid, messageId, or leafUuid field
 *
 * @param workingDirectory - The project working directory to scan sessions for
 * @param limit - Maximum number of sessions to return (default: 20)
 */
export function claudeListSessions(workingDirectory: string, limit: number = 20): ClaudeSessionInfo[] {
    try {
        const projectDir = getProjectPath(workingDirectory);

        // UUID format pattern (8-4-4-4-12 hex digits)
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        const sessions = readdirSync(projectDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => {
                const sessionId = f.replace('.jsonl', '');

                // Filter out non-UUID session IDs (e.g., agent-* sessions)
                if (!uuidPattern.test(sessionId)) {
                    return null;
                }

                // Check if this is a valid session
                if (!claudeCheckSession(sessionId, workingDirectory)) {
                    return null;
                }

                const filePath = join(projectDir, f);
                const mtime = statSync(filePath).mtime.getTime();
                const { firstMessage, summary, messageCount } = extractSessionMetadata(filePath);

                return {
                    sessionId,
                    lastModified: mtime,
                    firstMessage,
                    summary,
                    messageCount,
                } satisfies ClaudeSessionInfo;
            })
            .filter((f): f is ClaudeSessionInfo => f !== null)
            .sort((a, b) => b.lastModified - a.lastModified);

        return sessions.slice(0, limit);
    } catch (e) {
        logger.debug('[claudeListSessions] Error listing sessions:', e);
        return [];
    }
}

/**
 * Extract metadata from a session JSONL file for display in the session picker.
 * Reads the file and parses lines to find the first user message and summary.
 */
function extractSessionMetadata(filePath: string): {
    firstMessage: string | null;
    summary: string | null;
    messageCount: number;
} {
    let firstMessage: string | null = null;
    let summary: string | null = null;
    let messageCount = 0;

    try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const parsed = JSON.parse(line);
                messageCount++;

                // Extract summary (appears at the top of resumed session files)
                if (!summary && parsed.type === 'summary' && typeof parsed.summary === 'string') {
                    summary = parsed.summary;
                }

                // Extract first user message text
                if (!firstMessage && parsed.type === 'user') {
                    const content = parsed.message?.content;
                    if (typeof content === 'string') {
                        firstMessage = content.slice(0, 200);
                    } else if (Array.isArray(content)) {
                        // Find first text block in content array
                        for (const block of content) {
                            if (block.type === 'text' && typeof block.text === 'string') {
                                firstMessage = block.text.slice(0, 200);
                                break;
                            }
                        }
                    }
                }

                // Once we have both summary and firstMessage, we can stop
                // scanning for those fields (but we still count messages)
            } catch {
                // Skip unparseable lines
            }
        }
    } catch (e) {
        logger.debug(`[claudeListSessions] Error reading session file ${filePath}:`, e);
    }

    return { firstMessage, summary, messageCount };
}

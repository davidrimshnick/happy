import { describe, it, expect } from 'vitest';
import { groupSessionListViewData, OLDER_SESSION_THRESHOLD_MS, SessionListViewItemLike } from './sessionListGrouping';

// Helper to create a minimal mock session item
function createSessionItem(overrides: {
    id?: string;
    active?: boolean;
    updatedAt?: number;
} = {}): SessionListViewItemLike {
    return {
        type: 'session',
        session: {
            id: overrides.id ?? 'test-' + Math.random().toString(36).slice(2),
            active: overrides.active ?? false,
            updatedAt: overrides.updatedAt ?? Date.now(),
        },
    };
}

function createHeader(title: string): SessionListViewItemLike {
    return { type: 'header', title };
}

function createActiveSessions(sessions: { id: string; active: boolean; updatedAt: number }[]): SessionListViewItemLike {
    return { type: 'active-sessions', sessions };
}

describe('groupSessionListViewData', () => {
    const NOW = 1700000000000; // Fixed reference timestamp
    const ONE_HOUR = 60 * 60 * 1000;

    describe('when hideInactiveSessions is true', () => {
        it('should filter out all inactive sessions', () => {
            const data: SessionListViewItemLike[] = [
                createActiveSessions([{ id: 'active-1', active: true, updatedAt: NOW }]),
                createHeader('Today'),
                createSessionItem({ id: 'inactive-1', active: false, updatedAt: NOW }),
            ];

            const result = groupSessionListViewData(data, true, false, NOW);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('active-sessions');
        });

        it('should keep active sessions in session items', () => {
            const data: SessionListViewItemLike[] = [
                createSessionItem({ id: 'active-1', active: true, updatedAt: NOW }),
            ];

            const result = groupSessionListViewData(data, true, false, NOW);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('session');
        });

        it('should return empty array when all sessions are inactive', () => {
            const data: SessionListViewItemLike[] = [
                createHeader('Today'),
                createSessionItem({ id: 'inactive-1', active: false, updatedAt: NOW }),
            ];

            const result = groupSessionListViewData(data, true, false, NOW);

            expect(result).toHaveLength(0);
        });
    });

    describe('when hideInactiveSessions is false', () => {
        it('should return data as-is when no older sessions exist', () => {
            const data: SessionListViewItemLike[] = [
                createHeader('Today'),
                createSessionItem({
                    id: 'recent-1',
                    active: false,
                    updatedAt: NOW - ONE_HOUR, // 1 hour ago (within 24h)
                }),
            ];

            const result = groupSessionListViewData(data, false, false, NOW);

            // No older sessions, so returns original data unchanged
            expect(result).toEqual(data);
        });

        it('should split sessions into recent and older groups', () => {
            const data: SessionListViewItemLike[] = [
                createHeader('Today'),
                createSessionItem({
                    id: 'recent-1',
                    active: false,
                    updatedAt: NOW - ONE_HOUR, // 1 hour ago
                }),
                createHeader('Yesterday'),
                createSessionItem({
                    id: 'older-1',
                    active: false,
                    updatedAt: NOW - (OLDER_SESSION_THRESHOLD_MS + ONE_HOUR), // 25 hours ago
                }),
            ];

            const result = groupSessionListViewData(data, false, false, NOW);

            // Should have: header + recent session + toggle (collapsed, no older items shown)
            expect(result).toHaveLength(3);
            expect(result[0].type).toBe('header');
            expect(result[1].type).toBe('session');
            expect(result[1].session?.id).toBe('recent-1');
            expect(result[2].type).toBe('older-sessions-toggle');
            expect(result[2].count).toBe(1);
            expect(result[2].expanded).toBe(false);
        });

        it('should show older sessions when expanded', () => {
            const data: SessionListViewItemLike[] = [
                createHeader('Today'),
                createSessionItem({
                    id: 'recent-1',
                    active: false,
                    updatedAt: NOW - ONE_HOUR,
                }),
                createHeader('2 days ago'),
                createSessionItem({
                    id: 'older-1',
                    active: false,
                    updatedAt: NOW - (OLDER_SESSION_THRESHOLD_MS + ONE_HOUR),
                }),
            ];

            const result = groupSessionListViewData(data, false, true, NOW);

            // Should have: header + recent + toggle + header + older
            expect(result).toHaveLength(5);
            expect(result[0].type).toBe('header');
            expect(result[1].type).toBe('session');
            expect(result[2].type).toBe('older-sessions-toggle');
            expect(result[2].expanded).toBe(true);
            expect(result[3].type).toBe('header');
            expect(result[4].type).toBe('session');
            expect(result[4].session?.id).toBe('older-1');
        });

        it('should keep active sessions in recent group regardless of updatedAt', () => {
            const data: SessionListViewItemLike[] = [
                createActiveSessions([{
                    id: 'active-old',
                    active: true,
                    updatedAt: NOW - (OLDER_SESSION_THRESHOLD_MS + ONE_HOUR),
                }]),
            ];

            const result = groupSessionListViewData(data, false, false, NOW);

            // Active sessions type is always in recent, no toggle needed
            expect(result).toEqual(data);
        });

        it('should count only session items in older group (not headers)', () => {
            const data: SessionListViewItemLike[] = [
                createHeader('Yesterday'),
                createSessionItem({
                    id: 'older-1',
                    active: false,
                    updatedAt: NOW - (OLDER_SESSION_THRESHOLD_MS + ONE_HOUR),
                }),
                createSessionItem({
                    id: 'older-2',
                    active: false,
                    updatedAt: NOW - (OLDER_SESSION_THRESHOLD_MS + 2 * ONE_HOUR),
                }),
                createHeader('3 days ago'),
                createSessionItem({
                    id: 'older-3',
                    active: false,
                    updatedAt: NOW - (OLDER_SESSION_THRESHOLD_MS + 48 * ONE_HOUR),
                }),
            ];

            const result = groupSessionListViewData(data, false, false, NOW);

            // Toggle should show count of 3 (sessions only, not headers)
            const toggle = result.find(item => item.type === 'older-sessions-toggle');
            expect(toggle).toBeDefined();
            expect(toggle?.count).toBe(3);
        });

        it('should handle all sessions being older (no recent inactive)', () => {
            const data: SessionListViewItemLike[] = [
                createActiveSessions([{ id: 'active-1', active: true, updatedAt: NOW }]),
                createHeader('2 days ago'),
                createSessionItem({
                    id: 'older-1',
                    active: false,
                    updatedAt: NOW - (OLDER_SESSION_THRESHOLD_MS + ONE_HOUR),
                }),
            ];

            const result = groupSessionListViewData(data, false, false, NOW);

            // Should have: active-sessions + toggle
            expect(result).toHaveLength(2);
            expect(result[0].type).toBe('active-sessions');
            expect(result[1].type).toBe('older-sessions-toggle');
        });

        it('should handle empty data', () => {
            const result = groupSessionListViewData([], false, false, NOW);
            expect(result).toEqual([]);
        });

        it('should handle data with only active sessions (no inactive at all)', () => {
            const data: SessionListViewItemLike[] = [
                createActiveSessions([{ id: 'active-1', active: true, updatedAt: NOW }]),
            ];

            const result = groupSessionListViewData(data, false, false, NOW);
            expect(result).toEqual(data);
        });

        it('should correctly use the 24-hour threshold', () => {
            // Session exactly at the threshold boundary (should be recent - at threshold means not yet older)
            const data: SessionListViewItemLike[] = [
                createHeader('Yesterday'),
                createSessionItem({
                    id: 'at-threshold',
                    active: false,
                    updatedAt: NOW - OLDER_SESSION_THRESHOLD_MS, // Exactly 24h ago
                }),
                createSessionItem({
                    id: 'past-threshold',
                    active: false,
                    updatedAt: NOW - OLDER_SESSION_THRESHOLD_MS - 1, // 24h + 1ms ago
                }),
            ];

            const result = groupSessionListViewData(data, false, false, NOW);

            // atThreshold is NOT older (updatedAt == threshold, not < threshold)
            // pastThreshold IS older (updatedAt < threshold)
            const toggle = result.find(item => item.type === 'older-sessions-toggle');
            expect(toggle).toBeDefined();
            expect(toggle?.count).toBe(1); // Only pastThreshold

            // The recent items should include the header and atThreshold session
            expect(result[0].type).toBe('header');
            expect(result[1].type).toBe('session');
            expect(result[1].session?.id).toBe('at-threshold');
        });

        it('should handle mixed date groups with both recent and older sessions', () => {
            // A "Today" group with both recent and older sessions
            const data: SessionListViewItemLike[] = [
                createHeader('Today'),
                createSessionItem({
                    id: 'recent-today',
                    active: false,
                    updatedAt: NOW - ONE_HOUR,
                }),
                createHeader('3 days ago'),
                createSessionItem({
                    id: 'older-3days',
                    active: false,
                    updatedAt: NOW - (3 * 24 * ONE_HOUR),
                }),
                createHeader('7 days ago'),
                createSessionItem({
                    id: 'older-7days',
                    active: false,
                    updatedAt: NOW - (7 * 24 * ONE_HOUR),
                }),
            ];

            const result = groupSessionListViewData(data, false, false, NOW);

            // Recent: header(Today) + recent-today + toggle
            expect(result).toHaveLength(3);
            expect(result[0].type).toBe('header');
            expect(result[1].type).toBe('session');
            expect(result[1].session?.id).toBe('recent-today');
            expect(result[2].type).toBe('older-sessions-toggle');
            expect(result[2].count).toBe(2);
        });
    });

    describe('OLDER_SESSION_THRESHOLD_MS', () => {
        it('should be 24 hours in milliseconds', () => {
            expect(OLDER_SESSION_THRESHOLD_MS).toBe(24 * 60 * 60 * 1000);
        });
    });
});

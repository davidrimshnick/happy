/**
 * Pure utility functions for grouping session list view data.
 * Extracted to avoid React dependency in tests.
 */

/**
 * Threshold in milliseconds for considering an inactive session as "older".
 * Sessions inactive for longer than this are collapsed under a toggle.
 */
export const OLDER_SESSION_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Represents a session list view item. Matches SessionListViewItem from storage.ts.
 * Redefined here to avoid importing the full storage module and its React dependencies.
 */
export interface SessionListViewItemLike {
    type: string;
    session?: { id: string; active: boolean; updatedAt: number };
    count?: number;
    expanded?: boolean;
    [key: string]: unknown;
}

/**
 * Splits session list view data into recent and older inactive sessions.
 *
 * - Active sessions and recent inactive sessions (< 24h) are always shown.
 * - Older inactive sessions (>= 24h) are placed behind a collapsible toggle.
 * - When hideInactiveSessions is true, ALL inactive sessions are hidden entirely.
 */
export function groupSessionListViewData<T extends SessionListViewItemLike>(
    data: T[],
    hideInactiveSessions: boolean,
    olderSessionsExpanded: boolean,
    now: number = Date.now(),
): (T | { type: 'older-sessions-toggle'; count: number; expanded: boolean })[] {
    // When hideInactiveSessions is on, filter out all inactive sessions entirely
    if (hideInactiveSessions) {
        const filtered: T[] = [];
        let pendingProjectGroup: T | null = null;

        for (const item of data) {
            if (item.type === 'project-group') {
                pendingProjectGroup = item;
                continue;
            }

            if (item.type === 'session') {
                if (item.session?.active) {
                    if (pendingProjectGroup) {
                        filtered.push(pendingProjectGroup);
                        pendingProjectGroup = null;
                    }
                    filtered.push(item);
                }
                continue;
            }

            pendingProjectGroup = null;

            if (item.type === 'active-sessions') {
                filtered.push(item);
            }
        }

        return filtered;
    }

    // Split inactive sessions into "recent" (<24h) and "older" (>=24h)
    const threshold = now - OLDER_SESSION_THRESHOLD_MS;

    // Collect recent items and older items
    const recentItems: T[] = [];
    const olderItems: T[] = [];

    // Track headers - we need to associate them with the right group
    let currentHeader: T | null = null;
    let addedHeaderToRecent = false;
    let addedHeaderToOlder = false;

    for (const item of data) {
        if (item.type === 'active-sessions') {
            recentItems.push(item);
            continue;
        }

        if (item.type === 'header') {
            // Buffer the header - we'll add it once we see the sessions that follow
            currentHeader = item;
            addedHeaderToRecent = false;
            addedHeaderToOlder = false;
            continue;
        }

        if (item.type === 'project-group') {
            // Project groups follow their parent context
            continue;
        }

        if (item.type === 'session') {
            const isOlder = !item.session?.active && (item.session?.updatedAt ?? 0) < threshold;

            if (isOlder) {
                if (currentHeader && !addedHeaderToOlder) {
                    olderItems.push(currentHeader);
                    addedHeaderToOlder = true;
                }
                olderItems.push(item);
            } else {
                if (currentHeader && !addedHeaderToRecent) {
                    recentItems.push(currentHeader);
                    addedHeaderToRecent = true;
                }
                recentItems.push(item);
            }
        }
    }

    // If no older items, return data as-is (no toggle needed)
    if (olderItems.length === 0) {
        return data;
    }

    // Count only actual session items in older (not headers)
    const olderSessionCount = olderItems.filter(item => item.type === 'session').length;

    // Build result: recent items, then toggle, then (conditionally) older items
    const result: (T | { type: 'older-sessions-toggle'; count: number; expanded: boolean })[] = [...recentItems];

    result.push({
        type: 'older-sessions-toggle',
        count: olderSessionCount,
        expanded: olderSessionsExpanded,
    });

    if (olderSessionsExpanded) {
        result.push(...olderItems);
    }

    return result;
}

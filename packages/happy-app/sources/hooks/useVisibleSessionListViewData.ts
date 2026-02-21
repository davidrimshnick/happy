import * as React from 'react';
import { SessionListViewItem, useSessionListViewData, useSetting } from '@/sync/storage';
import { groupSessionListViewData, OLDER_SESSION_THRESHOLD_MS } from '@/utils/sessionListGrouping';

export { groupSessionListViewData, OLDER_SESSION_THRESHOLD_MS };

/**
 * Module-level state for the older sessions expanded toggle.
 * Shared across all consumers of useVisibleSessionListViewData.
 */
let _olderSessionsExpanded = false;
const _listeners = new Set<() => void>();

function setOlderSessionsExpanded(value: boolean) {
    _olderSessionsExpanded = value;
    _listeners.forEach(listener => listener());
}

/**
 * Hook to subscribe to the older sessions expanded state.
 */
function useOlderSessionsExpanded(): boolean {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        _listeners.add(forceUpdate);
        return () => { _listeners.delete(forceUpdate); };
    }, []);

    return _olderSessionsExpanded;
}

/**
 * Toggle the older sessions expanded state.
 * Can be called from any component.
 */
export function toggleOlderSessions() {
    setOlderSessionsExpanded(!_olderSessionsExpanded);
}

export function useVisibleSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();
    const hideInactiveSessions = useSetting('hideInactiveSessions');
    const olderSessionsExpanded = useOlderSessionsExpanded();

    return React.useMemo(() => {
        if (!data) {
            return data;
        }

        return groupSessionListViewData(data, hideInactiveSessions, olderSessionsExpanded) as SessionListViewItem[];
    }, [data, hideInactiveSessions, olderSessionsExpanded]);
}

import { describe, it, expect } from 'vitest';

/**
 * Tests to ensure ToolView styles don't regress to the configuration that
 * caused permission buttons to be invisible in Chromium browsers (Chrome, Arc).
 *
 * Root cause: The inverted FlatList applies CSS `transform: scaleY(-1)` to
 * each cell. When the ToolView container had `overflow: 'hidden'`, Chromium
 * miscalculated the clipping region under this transform, causing the
 * PermissionFooter (rendered at the bottom of ToolView) to be clipped.
 *
 * The fix:
 *  - Remove `overflow: 'hidden'` from the container
 *  - Apply borderRadius directly to the header's top corners so its
 *    background doesn't bleed outside the container's rounded corners
 *
 * See: https://github.com/slopus/happy/issues/684
 */

// Extract the style factory from the StyleSheet.create call.
// Since the styles use react-native-unistyles StyleSheet.create with a
// theme function, we test the structural invariants by reading the file
// source and checking for the critical patterns.

// NOTE: We cannot directly import the styles from ToolView.tsx in a
// pure node vitest environment because it depends on react-native and
// react-native-unistyles. Instead we validate the source text to ensure
// the critical styling invariants are maintained.

import { readFileSync } from 'fs';
import { resolve } from 'path';

function readToolViewSource(): string {
    const filePath = resolve(__dirname, 'ToolView.tsx');
    return readFileSync(filePath, 'utf-8');
}

describe('ToolView styles - Chromium permission button fix (issue #684)', () => {
    const source = readToolViewSource();

    it('container style should NOT have overflow hidden', () => {
        // Extract the container style block from the StyleSheet.create call
        const containerMatch = source.match(
            /container:\s*\{([^}]*)\}/
        );
        expect(containerMatch).toBeTruthy();
        const containerStyles = containerMatch![1];

        // The container must NOT have overflow: 'hidden' as this causes
        // Chromium to clip the PermissionFooter when inside an inverted
        // FlatList (which applies transform: scaleY(-1) to cells).
        expect(containerStyles).not.toMatch(/overflow\s*:\s*['"]hidden['"]/);
    });

    it('container style should have borderRadius', () => {
        const containerMatch = source.match(
            /container:\s*\{([^}]*)\}/
        );
        expect(containerMatch).toBeTruthy();
        const containerStyles = containerMatch![1];

        // Container must retain its borderRadius for visual appearance
        expect(containerStyles).toMatch(/borderRadius\s*:\s*\d+/);
    });

    it('header style should have top border radius to prevent background bleed', () => {
        // Since we removed overflow: hidden from the container, the header
        // needs its own top border-radius to prevent its background from
        // bleeding outside the container's rounded corners.
        const headerMatch = source.match(
            /header:\s*\{([^}]*)\}/
        );
        expect(headerMatch).toBeTruthy();
        const headerStyles = headerMatch![1];

        expect(headerStyles).toMatch(/borderTopLeftRadius\s*:\s*\d+/);
        expect(headerStyles).toMatch(/borderTopRightRadius\s*:\s*\d+/);
    });

    it('PermissionFooter is rendered when tool.permission exists and sessionId is present', () => {
        // Verify the PermissionFooter render condition exists in the JSX
        expect(source).toContain('tool.permission && sessionId');
        expect(source).toContain('<PermissionFooter');
    });

    it('PermissionFooter is not rendered for AskUserQuestion tools', () => {
        // AskUserQuestion has its own submit UI, so PermissionFooter should
        // be excluded for it
        expect(source).toContain("tool.name !== 'AskUserQuestion'");
    });
});

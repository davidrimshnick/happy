/**
 * Unit tests for trimIdent utility
 *
 * Tests cover:
 * - Basic indentation removal
 * - Multi-line content with various indentation patterns
 * - Tab normalization (the root cause of #664)
 * - Edge cases (empty input, all-blank lines, single lines)
 *
 * See: https://github.com/slopus/happy/issues/664
 */
import { describe, expect, it } from 'vitest';
import { trimIdent } from './trimIdent';

describe('trimIdent', () => {

    it('should remove common leading spaces from indented text', () => {
        const result = trimIdent(`
            Hello
            World
        `);
        expect(result).toBe('Hello\nWorld');
    });

    it('should handle single-line text', () => {
        const result = trimIdent(`
            Hello World
        `);
        expect(result).toBe('Hello World');
    });

    it('should preserve relative indentation', () => {
        const result = trimIdent(`
            if (true) {
                console.log('hi');
            }
        `);
        expect(result).toBe('if (true) {\n    console.log(\'hi\');\n}');
    });

    it('should handle text with no indentation', () => {
        const result = trimIdent(`
Hello
World
        `);
        expect(result).toBe('Hello\nWorld');
    });

    it('should preserve blank lines between content', () => {
        const result = trimIdent(`
            First paragraph.

            Second paragraph.
        `);
        expect(result).toBe('First paragraph.\n\nSecond paragraph.');
    });

    it('should return empty string for empty template literal', () => {
        const result = trimIdent(``);
        expect(result).toBe('');
    });

    it('should return empty string for whitespace-only template literal', () => {
        const result = trimIdent(`

        `);
        expect(result).toBe('');
    });

    it('should return empty string for only newlines', () => {
        const result = trimIdent('\n\n\n');
        expect(result).toBe('');
    });

    it('should handle mixed indentation levels (dist file editing scenario)', () => {
        // Simulates a user editing a dist file and adding content
        // at a different indentation level than the original
        const result = trimIdent(`
            Original line with 12-space indent.
        Added line with 8-space indent.
            Back to 12-space indent.
        `);
        expect(result).toBe('    Original line with 12-space indent.\nAdded line with 8-space indent.\n    Back to 12-space indent.');
    });

    describe('tab normalization (issue #664)', () => {

        it('should normalize tabs to 4 spaces for indentation calculation', () => {
            // When editing dist files, users often use tabs while the original uses spaces.
            // A tab is 1 character but should count as 4 spaces of indentation.
            const result = trimIdent(`
\tTabbed line
\tAnother tabbed line
            `);
            expect(result).toBe('Tabbed line\nAnother tabbed line');
        });

        it('should handle mixed tabs and spaces', () => {
            // This is the core scenario from #664: original content uses spaces,
            // user adds content with tabs in the dist file
            const result = trimIdent(`
    Original with 4 spaces.
\tAdded with tab.
    Back to 4 spaces.
            `);
            // Tab normalizes to 4 spaces, so minSpaces is 4 for all lines
            expect(result).toBe('Original with 4 spaces.\nAdded with tab.\nBack to 4 spaces.');
        });

        it('should handle tabs within content (not just leading)', () => {
            const result = trimIdent(`
                Before\tafter tab
                Normal line
            `);
            // Tab in middle of content should be normalized to spaces too
            expect(result).toBe('Before    after tab\nNormal line');
        });

        it('should handle tab-indented content added to space-indented template', () => {
            // Simulates user editing BASE_SYSTEM_PROMPT in dist file with tab indentation
            const result = trimIdent(`
    ALWAYS when you start a new chat - you must call a tool.
\tHere is my custom instruction that I added.
\tAnd another line of instructions.
            `);
            // Tab (normalized to 4 spaces) = same indent as original (4 spaces)
            // So minSpaces = 4, all lines get 4 chars stripped
            expect(result).toBe(
                'ALWAYS when you start a new chat - you must call a tool.\n' +
                'Here is my custom instruction that I added.\n' +
                'And another line of instructions.'
            );
        });
    });

    describe('multi-line content in BASE_SYSTEM_PROMPT pattern', () => {

        it('should handle the exact IIFE pattern from systemPrompt.ts', () => {
            const BASE_SYSTEM_PROMPT = trimIdent(`
    ALWAYS when you start a new chat - you must call a tool "mcp__happy__change_title" to set a chat title.
`);
            expect(BASE_SYSTEM_PROMPT).toBe('ALWAYS when you start a new chat - you must call a tool "mcp__happy__change_title" to set a chat title.');
        });

        it('should handle multi-line additions to the prompt', () => {
            const BASE_SYSTEM_PROMPT = trimIdent(`
    ALWAYS when you start a new chat - you must call a tool.

    Also, here is some extra instruction that a user added.
    And another line of instruction.
    And a third line for good measure.
`);
            expect(BASE_SYSTEM_PROMPT).toBe(
                'ALWAYS when you start a new chat - you must call a tool.\n' +
                '\n' +
                'Also, here is some extra instruction that a user added.\n' +
                'And another line of instruction.\n' +
                'And a third line for good measure.'
            );
        });

        it('should produce a valid string when content is modified in dist pattern', () => {
            // This test verifies the full flow: trimIdent produces a clean string
            // that can be safely combined with another system prompt
            const cliPrompt = trimIdent(`
    ALWAYS when you start a new chat - you must call a tool.
    Also here is extra content.
`);

            const appPrompt = trimIdent(`
    # Options
    You have a way to give a user a easy way to answer your questions.
`);

            const combined = appPrompt + '\n\n' + cliPrompt;

            // Combined prompt should be a clean multi-line string
            expect(combined).not.toContain('\0');
            expect(combined).not.toContain('\r');
            expect(combined).toContain('# Options');
            expect(combined).toContain('ALWAYS when you start');
        });
    });

    describe('edge cases that could cause silent CLI failures', () => {

        it('should not produce null bytes', () => {
            const result = trimIdent(`
    Line with content
    Another line
`);
            expect(result).not.toContain('\0');
        });

        it('should handle very long single-line content', () => {
            const longLine = 'A'.repeat(10000);
            const result = trimIdent(`
    ${longLine}
`);
            expect(result).toBe(longLine);
        });

        it('should handle content with special characters', () => {
            const result = trimIdent(`
    Content with "quotes" and 'apostrophes'
    Content with <xml> tags and &entities
    Content with $dollar and \`backticks\`
`);
            expect(result).toContain('"quotes"');
            expect(result).toContain('<xml>');
            expect(result).toContain('$dollar');
        });
    });
});

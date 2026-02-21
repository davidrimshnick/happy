/**
 * Unit tests for sanitizeSystemPrompt utility
 *
 * Ensures system prompt strings are safe for passing through CLI arguments
 * without causing silent failures in message delivery.
 *
 * See: https://github.com/slopus/happy/issues/664
 */
import { describe, expect, it } from 'vitest';
import { sanitizeSystemPrompt } from './sanitizeSystemPrompt';

describe('sanitizeSystemPrompt', () => {

    it('should pass through normal text unchanged', () => {
        const input = 'Hello, this is a normal system prompt.';
        expect(sanitizeSystemPrompt(input)).toBe(input);
    });

    it('should preserve newlines', () => {
        const input = 'Line 1\nLine 2\nLine 3';
        expect(sanitizeSystemPrompt(input)).toBe(input);
    });

    it('should preserve tabs', () => {
        // Tabs are valid in system prompts (trimIdent handles normalization separately)
        const input = 'Before\tafter';
        expect(sanitizeSystemPrompt(input)).toBe(input);
    });

    it('should preserve spaces', () => {
        const input = '    indented text    ';
        expect(sanitizeSystemPrompt(input)).toBe(input);
    });

    it('should remove null bytes', () => {
        const input = 'Before\0After';
        expect(sanitizeSystemPrompt(input)).toBe('BeforeAfter');
    });

    it('should remove carriage returns (\\r)', () => {
        const input = 'Line 1\r\nLine 2\r\nLine 3';
        expect(sanitizeSystemPrompt(input)).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should remove form feed characters', () => {
        const input = 'Before\fAfter';
        expect(sanitizeSystemPrompt(input)).toBe('BeforeAfter');
    });

    it('should remove vertical tab characters', () => {
        const input = 'Before\vAfter';
        expect(sanitizeSystemPrompt(input)).toBe('BeforeAfter');
    });

    it('should remove backspace characters', () => {
        const input = 'Before\bAfter';
        expect(sanitizeSystemPrompt(input)).toBe('BeforeAfter');
    });

    it('should remove DEL character (0x7F)', () => {
        const input = 'Before\x7FAfter';
        expect(sanitizeSystemPrompt(input)).toBe('BeforeAfter');
    });

    it('should remove all ASCII control characters except tab and newline', () => {
        // Build a string with all control characters 0x00-0x1F plus 0x7F
        let input = '';
        for (let i = 0; i <= 0x1F; i++) {
            input += String.fromCharCode(i);
        }
        input += String.fromCharCode(0x7F);

        const result = sanitizeSystemPrompt(input);

        // Only tab (0x09) and newline (0x0A) should remain
        expect(result).toBe('\t\n');
    });

    it('should handle empty string', () => {
        expect(sanitizeSystemPrompt('')).toBe('');
    });

    it('should preserve Unicode characters', () => {
        const input = 'Hello \u{1F600} World \u00E9\u00E8\u00EA';
        expect(sanitizeSystemPrompt(input)).toBe(input);
    });

    it('should preserve multi-line prompts with XML-like content', () => {
        const input = '# Options\n\n<options>\n    <option>Option 1</option>\n</options>';
        expect(sanitizeSystemPrompt(input)).toBe(input);
    });

    it('should handle a realistic combined system prompt', () => {
        const appPrompt = '# Options\n\nYou have a way to give users options.\n\n<options>\n    <option>Option 1</option>\n</options>';
        const cliPrompt = 'ALWAYS when you start a new chat - you must call a tool.';
        const combined = appPrompt + '\n\n' + cliPrompt;

        const result = sanitizeSystemPrompt(combined);

        // Should pass through unchanged since there are no control characters
        expect(result).toBe(combined);
    });

    it('should sanitize a prompt that was corrupted during dist file editing', () => {
        // Simulates a scenario where editing a dist file introduces
        // control characters (e.g., from copy-paste or editor encoding issues)
        const corrupted = 'Normal text\x00\x01\x02hidden\x0Dreturn\x1Bescape';
        const result = sanitizeSystemPrompt(corrupted);

        expect(result).toBe('Normal texthiddenreturnescape');
        expect(result).not.toContain('\0');
        expect(result).not.toContain('\r');
        expect(result).not.toContain('\x1B');
    });
});

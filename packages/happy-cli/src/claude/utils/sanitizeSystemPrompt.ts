/**
 * Sanitize a system prompt string for safe passage through CLI arguments.
 *
 * When system prompts are passed via --append-system-prompt or --system-prompt
 * to the Claude Code CLI, certain characters can cause silent failures:
 * - Null bytes (\0) cause argument truncation
 * - Other control characters may interfere with argument parsing
 * - Carriage returns (\r) can cause display/parsing issues
 *
 * This function strips problematic characters while preserving meaningful
 * whitespace (newlines, spaces) and all printable content.
 *
 * See: https://github.com/slopus/happy/issues/664
 */
export function sanitizeSystemPrompt(prompt: string): string {
    // Remove null bytes - these silently truncate CLI arguments
    // Remove carriage returns - normalize to Unix line endings
    // Remove other ASCII control characters (0x00-0x1F) except:
    //   - \n (0x0A) - newlines are meaningful in prompts
    //   - \t (0x09) - tabs are converted to spaces by trimIdent but may appear in user edits
    // Also remove DEL (0x7F)
    return prompt.replace(/[\x00-\x08\x0B\x0C\x0D-\x1F\x7F]/g, '');
}

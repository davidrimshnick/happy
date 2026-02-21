import { trimIdent } from "@/utils/trimIdent";
import { sanitizeSystemPrompt } from "./sanitizeSystemPrompt";
import { shouldIncludeCoAuthoredBy } from "./claudeSettings";

/**
 * Base system prompt shared across all configurations.
 *
 * WARNING: If you modify this content (e.g., in dist files), ensure that:
 * 1. The text uses spaces for indentation (not tabs) to match the trimIdent template
 * 2. Added lines maintain consistent indentation with existing content
 * 3. No control characters (null bytes, etc.) are introduced
 * See: https://github.com/slopus/happy/issues/664
 */
const BASE_SYSTEM_PROMPT = trimIdent(`
    ALWAYS when you start a new chat - you must call a tool "mcp__happy__change_title" to set a chat title. When you think chat title is not relevant anymore - call the tool again to change it. When chat name is too generic and you have a change to make it more specific - call the tool again to change it. This title is needed to easily find the chat in the future. Help human.
`);

/**
 * Co-authored-by credits to append when enabled
 */
const CO_AUTHORED_CREDITS = trimIdent(`
    When making commit messages, instead of just giving co-credit to Claude, also give credit to Happy like so:

    <main commit message>

    Generated with [Claude Code](https://claude.ai/code)
    via [Happy](https://happy.engineering)

    Co-Authored-By: Claude <noreply@anthropic.com>
    Co-Authored-By: Happy <yesreply@happy.engineering>
`);

/**
 * Build the full system prompt, sanitized and ready for use.
 *
 * Combines BASE_SYSTEM_PROMPT with optional CO_AUTHORED_CREDITS based on Claude's
 * settings.json configuration. The result is sanitized to remove control characters
 * that could break CLI argument passing.
 *
 * Settings are read once on startup for performance.
 */
export const systemPrompt = (() => {
  try {
    const includeCoAuthored = shouldIncludeCoAuthoredBy();
    const rawPrompt = includeCoAuthored
      ? BASE_SYSTEM_PROMPT + '\n\n' + CO_AUTHORED_CREDITS
      : BASE_SYSTEM_PROMPT;

    return sanitizeSystemPrompt(rawPrompt);
  } catch {
    // Fallback: return the base prompt without co-authored credits
    // This prevents a module load failure from breaking message delivery entirely
    return sanitizeSystemPrompt(BASE_SYSTEM_PROMPT);
  }
})();
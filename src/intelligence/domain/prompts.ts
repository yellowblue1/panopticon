const MAX_SUMMARY_LENGTH = 100;
const CONVERSATION_TAIL_CHARS = 4000;
const ACTION_TAIL_CHARS = 1000;

export { MAX_SUMMARY_LENGTH };

/**
 * Get the tail of conversation text, limited by character count
 */
export function getConversationTail(conversation: string): string {
  if (conversation.length <= CONVERSATION_TAIL_CHARS) return conversation;
  return conversation.slice(-CONVERSATION_TAIL_CHARS);
}

/**
 * Build the prompt for Gemini to summarize a coding agent session.
 * The content may be terminal pane output or a JSONL conversation extract.
 * Includes attention detection to prefix summaries with emoji when user action is needed.
 */
export function buildConversationPrompt(conversationTail: string): string {
  return `IMPORTANT: Analyze the content to determine what language the user is using. Your response MUST be in the same language as the user's messages.

The following is the terminal output from a coding agent session (Claude Code or Codex). The agent appears to be idle.

Your task: determine whether the agent needs the user's attention, then write a short summary (15 words or less).

ATTENTION DETECTION — prefix with 🔔 when the agent is waiting for user action:
- Permission request (file delete, git push, command execution, tool use approval) → prefix with 🔔
- Question asking user to choose between options → prefix with 🔔
- Question asking for information or clarification → prefix with 🔔
- No user action needed (just completed work, status report) → NO emoji prefix

Examples:
- "🔔 Waiting for permission to delete 3 files"
- "🔔 Requesting approval to run git push"
- "🔔 Asking which database to use"
- "🔔 Needs clarification on auth method"
- "Completed refactoring auth module"
- "Tests passing, ready for next task"

Output ONLY the summary line, nothing else.

${conversationTail}`;
}

/**
 * Get the tail of pane content, limited by character count
 */
export function getContentTail(content: string): string {
  if (content.length <= ACTION_TAIL_CHARS) return content;
  return content.slice(-ACTION_TAIL_CHARS);
}

/**
 * Build the prompt for Gemini to detect what interaction the terminal expects.
 */
export function buildActionPrompt(contentTail: string): string {
  return `Analyze the following terminal output from a coding agent session (Claude Code or Codex).
Determine what type of user interaction is expected based on the last visible prompt or question.

Rules (apply in this priority order):
1. If the terminal shows a numbered list of options (e.g., "1. Option A", "2. Option B"), return type "choices". Use the number as the value and a short label for each. This rule takes priority — any numbered list is always "choices". IMPORTANT: Only include options that appear ABOVE the horizontal separator line (─────). Exclude any options below the separator such as "Chat about this" — those cannot be selected by number key.
2. If the terminal shows a Yes/No permission prompt (e.g., "Do you want to proceed?" with Yes/No options), return type "yesno".
3. If the terminal is waiting for free-form text input with NO numbered options (e.g., a standalone prompt asking for a name, path, or description), return type "freeform" with an appropriate placeholder.
4. If no interactive prompt is detected (e.g., the process is still running, just completed output, or showing a status report), return type "none".

autoEnter field for choices:
- Each option has an "autoEnter" boolean. Set to true for options that are complete selections (e.g., "1. Mango" — selecting it is the final action). Set to false for options that require further user input after selection (e.g., "Type something" or any option that opens a text input).

Coding agent UI patterns to recognize:
1. AskUserQuestion with numbered choices — bordered region with header, question text, numbered options (1. Option, 2. Option...), sometimes with a cursor, footer "Enter to select / to navigate / Esc to cancel". Options below the separator line (like "Chat about this") should be EXCLUDED.
2. Permission/confirmation prompt — "Do you want to proceed?" with Yes/No options and footer "Esc to cancel / Tab to amend"

Return ONLY valid JSON matching one of these schemas:
{"type":"choices","options":[{"label":"1. Mango","value":"1","autoEnter":true},{"label":"2. Strawberry","value":"2","autoEnter":true},{"label":"3. Type something","value":"3","autoEnter":false}]}
{"type":"yesno"}
{"type":"freeform","placeholder":"Enter your response..."}
{"type":"none"}

Terminal output:
${contentTail}`;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; id: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | ContentBlock[];
      is_error?: boolean;
    }
  | { type: "thinking"; thinking: string };

interface JournalEntry {
  type: string;
  message?: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
  };
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

function hasSubstantiveText(content: string | ContentBlock[]): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  return content.some((block) => block.type === "text" && block.text.trim().length > 0);
}

function extractTextFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;

  const parts: string[] = [];

  for (const block of content) {
    switch (block.type) {
      case "text":
        parts.push(block.text);
        break;
      case "tool_use":
        parts.push(`[Tool: ${block.name}]`);
        break;
      case "tool_result": {
        if (!block.is_error) break;
        const errorText =
          typeof block.content === "string"
            ? block.content
            : block.content
                .filter((b): b is { type: "text"; text: string } => b.type === "text")
                .map((b) => b.text)
                .join("\n");
        parts.push(`[Tool Error: ${errorText.slice(0, 500)}]`);
        break;
      }
      // skip "thinking" blocks
    }
  }

  return parts.join("\n");
}

export async function extractConversation(jsonlPath: string): Promise<ConversationMessage[]> {
  const text = await Bun.file(jsonlPath).text();
  const lines = text.split("\n").filter((line) => line.trim());

  const messages: ConversationMessage[] = [];

  for (const line of lines) {
    try {
      const entry: JournalEntry = JSON.parse(line);

      if (entry.type !== "user" && entry.type !== "assistant") continue;
      if (!entry.message?.content) continue;

      // Skip messages with no substantive text (e.g. assistant messages with only tool calls)
      if (!hasSubstantiveText(entry.message.content)) continue;

      const content = extractTextFromContent(entry.message.content);
      if (!content.trim()) continue;

      messages.push({
        role: entry.message.role,
        content,
      });
    } catch {
      console.error(`Skipping malformed line: ${line.slice(0, 100)}...`);
    }
  }

  return messages;
}

import { GoogleGenAI } from "@google/genai";
import type { ConversationMessage, SessionMetadata } from "./extractor";

interface KnowledgeEntry {
  title: string;
  symptom: string;
  root_cause: string;
  solution: string;
  prevention?: string;
  context: {
    technologies: string[];
    tools: string[];
    files_involved: string[];
  };
  tags: string[];
  confidence: "high" | "medium" | "low";
  session_id: string;
}

const EXTRACTION_PROMPT = `You are a senior software engineer analyzing Claude Code session logs to build a troubleshooting knowledge base for your team.

Your task: extract knowledge entries from the conversation log below. Each entry captures a moment where a problem was encountered, investigated, and resolved.

IMPORTANT: Prioritize precision over recall. Only extract entries you are confident represent genuine troubleshooting. It is far better to miss a borderline case than to include a false positive. If a conversation has no real troubleshooting, return an empty array [].

## What to Extract

Extract entries where ALL of these are present:
1. A concrete problem — an actual error message, unexpected behavior, test failure, build issue, or configuration problem that blocked progress
2. Non-trivial investigation — the assistant had to debug, try multiple approaches, read logs, or diagnose the cause (not just a single fix)
3. A resolution — the problem was ultimately fixed or worked around

A single conversation may contain multiple independent problems and solutions. Extract each as a separate entry.

## What NOT to Extract

- Routine code generation or refactoring that succeeded without issues
- Simple Q&A or explanations
- Tasks completed on first attempt without encountering problems
- Lint/format fixes applied mechanically (e.g. running a formatter, adding type annotations) — unless there was a non-obvious root cause
- Configuration changes that worked immediately without trial and error
- Feature implementation that went smoothly, even if it involved many files
- Pre-commit hook failures that were fixed by trivially re-running a formatter

## Confidence Levels

- high: Clear error message or failure → root cause explicitly identified → verified fix applied
- medium: Problem is evident but root cause is partially inferred, or fix was applied but not fully verified
- low: Problem is implicit or the resolution is incomplete/uncertain

## Output Schema

Return a JSON array of objects with these fields:

- "title": Concise problem title (under 60 characters)
- "symptom": What went wrong — error messages, observed behavior, failed commands
- "root_cause": Why it happened — the underlying cause
- "solution": How it was fixed — specific commands, code changes, or config updates
- "prevention": How to prevent recurrence (omit if unclear)
- "context.technologies": Languages, frameworks, libraries involved (e.g. ["TypeScript", "React", "Biome"])
- "context.tools": Tools or commands used during debugging (e.g. ["bun test", "biome check"])
- "context.files_involved": File paths that were modified or investigated
- "tags": 2-5 search tags for the knowledge base
- "confidence": "high", "medium", or "low"
- "session_id": Will be filled automatically, leave as empty string

## Positive Example (EXTRACT this)

Scenario: The assistant encounters a TypeScript compilation error because a newly added file uses \`import type\` incorrectly, investigates by reading tsconfig.json, discovers \`verbatimModuleSyntax\` is enabled, and fixes the import:

[
  {
    "title": "TypeScript verbatimModuleSyntax breaks re-export",
    "symptom": "tsc --noEmit fails with error TS1205: Re-exporting a type requires 'export type' when verbatimModuleSyntax is enabled",
    "root_cause": "The file used 'export { Foo }' to re-export a type, but tsconfig.json has verbatimModuleSyntax enabled which requires explicit 'export type' for type-only re-exports",
    "solution": "Changed 'export { Foo }' to 'export type { Foo }' in the barrel file",
    "prevention": "When adding re-exports in projects with verbatimModuleSyntax, always use 'export type' for type-only exports",
    "context": {
      "technologies": ["TypeScript"],
      "tools": ["tsc"],
      "files_involved": ["src/index.ts", "tsconfig.json"]
    },
    "tags": ["TypeScript", "tsconfig", "verbatimModuleSyntax", "imports"],
    "confidence": "high",
    "session_id": ""
  }
]

## Negative Examples (do NOT extract these)

1. "The assistant added type='button' to 35 button elements to fix Biome useButtonType warnings" → This is a mechanical lint fix, not troubleshooting. Do NOT extract.
2. "The assistant ran biome check --write and it auto-formatted 12 files" → Routine formatting. Do NOT extract.
3. "The assistant implemented a new API endpoint with tests and everything passed on first try" → Smooth implementation, no troubleshooting involved. Do NOT extract.
4. "The assistant read several files to understand the codebase architecture" → Research/exploration, not a problem. Do NOT extract.

## Session Context

`;

const MODEL = "gemini-3-flash-preview";
const MAX_CONTENT_LENGTH = 900_000;

function formatSessionContext(metadata: SessionMetadata): string {
  return `- Project: ${metadata.projectPath}\n- Branch: ${metadata.gitBranch}\n`;
}

function formatConversation(messages: ConversationMessage[]): string {
  return messages.map((m) => `### ${m.role.toUpperCase()}\n${m.content}`).join("\n\n---\n\n");
}

export async function extractKnowledge(
  messages: ConversationMessage[],
  metadata: SessionMetadata,
): Promise<KnowledgeEntry[]> {
  const ai = new GoogleGenAI({});

  const context = formatSessionContext(metadata);
  const formatted = formatConversation(messages);
  const truncated =
    formatted.length > MAX_CONTENT_LENGTH
      ? `${formatted.slice(0, MAX_CONTENT_LENGTH)}\n\n[... truncated ...]`
      : formatted;

  const prompt = `${EXTRACTION_PROMPT}${context}\n## Conversation Log\n\n${truncated}`;

  console.error(`Sending ${messages.length} messages (${truncated.length} chars) to ${MODEL}...`);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      httpOptions: { timeout: 120_000 },
    },
  });

  const text = response.text;
  if (!text) {
    console.error("Empty response from Gemini");
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      console.error("Expected JSON array from Gemini, got:", typeof parsed);
      return [];
    }
    // Fill in session_id from metadata
    return (parsed as KnowledgeEntry[]).map((entry) => ({
      ...entry,
      session_id: metadata.sessionId,
    }));
  } catch {
    console.error("Failed to parse Gemini response as JSON:", text.slice(0, 500));
    return [];
  }
}

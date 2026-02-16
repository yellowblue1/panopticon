import { GoogleGenAI } from "@google/genai";
import { bootstrapGeminiEnv } from "../../src/intelligence/infrastructure/gemini-config";
import { extractConversation } from "./extractor";

const MODEL = "gemini-3-pro-preview";

bootstrapGeminiEnv();
const ai = new GoogleGenAI({});

const jsonlPath = process.argv[2];
if (!jsonlPath) {
  console.error("Usage: bun scripts/knowledge-extractor/_run_pro.ts <jsonl_path>");
  process.exit(1);
}

const { messages, metadata } = await extractConversation(jsonlPath);

const analyzerSrc = await Bun.file(`${import.meta.dir}/analyzer.ts`).text();
const promptMatch = analyzerSrc.match(/const EXTRACTION_PROMPT = `([\s\S]*?)`;/);
if (!promptMatch) throw new Error("Could not extract prompt from analyzer.ts");
const EXTRACTION_PROMPT = promptMatch[1].replace(/\\`/g, "`").replace(/\\\$/g, "$");

const context = `- Project: ${metadata.projectPath}\n- Branch: ${metadata.gitBranch}\n`;
const formatted = messages
  .map((m: { role: string; content: string }) => `### ${m.role.toUpperCase()}\n${m.content}`)
  .join("\n\n---\n\n");
const prompt = `${EXTRACTION_PROMPT}${context}\n## Conversation Log\n\n${formatted}`;

console.error(`Model: ${MODEL}`);
console.error(`Messages: ${messages.length}, Chars: ${formatted.length}`);

const response = await ai.models.generateContent({
  model: MODEL,
  contents: prompt,
  config: { responseMimeType: "application/json", httpOptions: { timeout: 300_000 } },
});

const text = response.text;
if (!text) {
  console.error("Empty response");
  process.exit(1);
}
try {
  const parsed = JSON.parse(text);
  console.log(JSON.stringify(parsed, null, 2));
  console.error(`Entries: ${Array.isArray(parsed) ? parsed.length : 0}`);
} catch {
  console.error("Parse failed:", text.slice(0, 500));
}

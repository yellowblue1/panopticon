import { bootstrapGeminiEnv } from "../../src/intelligence/infrastructure/gemini-config";
import { extractKnowledge } from "./analyzer";
import { extractConversation } from "./extractor";

async function main() {
  const jsonlPath = process.argv[2];

  if (!jsonlPath) {
    console.error("Usage: bun run scripts/knowledge-extractor/main.ts <jsonl_path>");
    process.exit(1);
  }

  const file = Bun.file(jsonlPath);
  if (!(await file.exists())) {
    console.error(`File not found: ${jsonlPath}`);
    process.exit(1);
  }

  const backend = bootstrapGeminiEnv();
  if (!backend) {
    console.error("No Gemini credentials found. Set GEMINI_API_KEY or configure gcloud ADC.");
    process.exit(1);
  }
  console.error(`Using Gemini backend: ${backend}`);

  console.error("Extracting conversation...");
  const messages = await extractConversation(jsonlPath);
  console.error(`Extracted ${messages.length} messages`);

  if (messages.length === 0) {
    console.error("No conversation messages found");
    console.log("[]");
    process.exit(0);
  }

  console.error("Analyzing with Gemini...");
  const knowledge = await extractKnowledge(messages);
  console.error(`Extracted ${knowledge.length} knowledge entries`);

  console.log(JSON.stringify(knowledge, null, 2));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

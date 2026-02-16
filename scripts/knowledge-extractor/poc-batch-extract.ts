/**
 * POC: Batch knowledge extraction from Claude Code session logs.
 *
 * Finds the top N largest JSONL session logs and runs knowledge extraction
 * on each, saving results to an output directory.
 *
 * Usage:
 *   bun run scripts/knowledge-extractor/poc-batch-extract.ts [--count 50] [--concurrency 5]
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootstrapGeminiEnv } from "../../src/intelligence/infrastructure/gemini-config";
import { extractKnowledge } from "./analyzer";
import { extractConversation } from "./extractor";

const CLAUDE_PROJECTS_DIR = join(process.env.HOME ?? "", ".claude/projects");
const OUTPUT_DIR = resolve(import.meta.dir, "poc-output");

interface SessionFile {
  path: string;
  size: number;
}

function findSessionLogs(maxCount: number): SessionFile[] {
  const files: SessionFile[] = [];

  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error(`Claude projects directory not found: ${CLAUDE_PROJECTS_DIR}`);
    return [];
  }

  for (const projectDir of readdirSync(CLAUDE_PROJECTS_DIR)) {
    const projectPath = join(CLAUDE_PROJECTS_DIR, projectDir);
    try {
      if (!statSync(projectPath).isDirectory()) continue;
    } catch {
      continue;
    }

    for (const entry of readdirSync(projectPath)) {
      if (!entry.endsWith(".jsonl")) continue;
      // Skip subagent logs
      if (entry.includes("subagent")) continue;

      const filePath = join(projectPath, entry);
      try {
        const stat = statSync(filePath);
        files.push({ path: filePath, size: stat.size });
      } catch {
        // skip
      }
    }
  }

  // Sort by size descending, take top N
  files.sort((a, b) => b.size - a.size);
  return files.slice(0, maxCount);
}

async function processOneLog(
  file: SessionFile,
  index: number,
  total: number,
): Promise<{ file: string; entries: number; error?: string }> {
  const tag = `[${index + 1}/${total}]`;
  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  console.error(`${tag} Processing ${file.path} (${sizeMB} MB)...`);

  try {
    const { messages, metadata } = await extractConversation(file.path);

    if (messages.length === 0) {
      console.error(`${tag} No messages found, skipping`);
      return { file: file.path, entries: 0 };
    }

    console.error(`${tag} ${messages.length} messages, session=${metadata.sessionId}`);
    const knowledge = await extractKnowledge(messages, metadata);
    console.error(`${tag} Extracted ${knowledge.length} entries`);

    if (knowledge.length > 0) {
      // Save per-session output
      const outFile = join(OUTPUT_DIR, `${metadata.sessionId}.json`);
      await Bun.write(outFile, JSON.stringify(knowledge, null, 2));
    }

    return { file: file.path, entries: knowledge.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} ERROR: ${msg}`);
    return { file: file.path, entries: 0, error: msg };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const concurrencyIdx = args.indexOf("--concurrency");
  const maxCount = countIdx >= 0 ? Number(args[countIdx + 1]) : 50;
  const concurrency = concurrencyIdx >= 0 ? Number(args[concurrencyIdx + 1]) : 5;

  const backend = bootstrapGeminiEnv();
  if (!backend) {
    console.error("No Gemini credentials found. Set GEMINI_API_KEY or configure gcloud ADC.");
    process.exit(1);
  }
  console.error(`Using Gemini backend: ${backend}`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.error(`Finding top ${maxCount} largest session logs...`);
  const files = findSessionLogs(maxCount);
  console.error(`Found ${files.length} session logs`);

  if (files.length === 0) {
    console.error("No session logs found");
    process.exit(1);
  }

  const totalSizeMB = files.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024;
  console.error(`Total size: ${totalSizeMB.toFixed(1)} MB`);
  console.error(`Concurrency: ${concurrency}`);
  console.error(`Output directory: ${OUTPUT_DIR}`);
  console.error("---");

  // Process with concurrency limit
  const results: Awaited<ReturnType<typeof processOneLog>>[] = [];
  let cursor = 0;

  while (cursor < files.length) {
    const batch = files.slice(cursor, cursor + concurrency);
    const batchResults = await Promise.all(
      batch.map((file, i) => processOneLog(file, cursor + i, files.length)),
    );
    results.push(...batchResults);
    cursor += concurrency;
  }

  // Summary
  const succeeded = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const totalEntries = results.reduce((acc, r) => acc + r.entries, 0);

  console.error("\n=== SUMMARY ===");
  console.error(`Processed: ${succeeded.length}/${files.length}`);
  console.error(`Failed: ${failed.length}`);
  console.error(`Total knowledge entries: ${totalEntries}`);
  console.error(`Output directory: ${OUTPUT_DIR}`);

  if (failed.length > 0) {
    console.error("\nFailed files:");
    for (const f of failed) {
      console.error(`  ${f.file}: ${f.error}`);
    }
  }

  // Write summary
  await Bun.write(
    join(OUTPUT_DIR, "_summary.json"),
    JSON.stringify(
      { processed: succeeded.length, failed: failed.length, totalEntries, results },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

/**
 * POC: Deduplicated upload of knowledge entries to Gemini File Search.
 *
 * For each extracted knowledge entry:
 *   1. Queries the File Search store for similar existing entries
 *   2. Asks LLM to determine if the new entry is a duplicate
 *   3. Only uploads if it's genuinely new
 *
 * Usage:
 *   GOOGLE_API_KEY=... bun run scripts/knowledge-extractor/poc-dedup-upload.ts [--dry-run]
 *
 * Expects:
 *   - poc-output/*.json files from batch extraction
 *   - poc-output/_file_search_store.txt with the store name
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";

const OUTPUT_DIR = resolve(import.meta.dir, "poc-output");
const STORE_NAME_FILE = join(OUTPUT_DIR, "_file_search_store.txt");
const ENTRIES_DIR = join(OUTPUT_DIR, "entries");
const MODEL = "gemini-3-flash-preview";

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
  confidence: string;
  session_id: string;
}

interface DedupResult {
  isDuplicate: boolean;
  reason: string;
  existingTitle?: string;
}

function getClient(): GoogleGenAI {
  if (!process.env.GOOGLE_API_KEY) {
    console.error("ERROR: GOOGLE_API_KEY is required.");
    process.exit(1);
  }
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
}

function entryToMarkdown(entry: KnowledgeEntry): string {
  const lines = [
    `# ${entry.title}\n`,
    `**Confidence:** ${entry.confidence}`,
    `**Session:** ${entry.session_id}`,
    `**Technologies:** ${entry.context.technologies.join(", ")}`,
    `**Tools:** ${entry.context.tools.join(", ")}`,
    `**Tags:** ${entry.tags.join(", ")}\n`,
    `## Symptom\n${entry.symptom}\n`,
    `## Root Cause\n${entry.root_cause}\n`,
    `## Solution\n${entry.solution}\n`,
  ];
  if (entry.prevention) {
    lines.push(`## Prevention\n${entry.prevention}\n`);
  }
  lines.push(
    `## Files Involved\n${entry.context.files_involved.map((f) => `- ${f}`).join("\n")}\n`,
  );
  return lines.join("\n");
}

function entryToSlug(entry: KnowledgeEntry): string {
  return `${entry.session_id}_${entry.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)}`;
}

/**
 * Check if a new entry is a duplicate of existing entries in the store.
 * Uses File Search to find similar entries, then asks LLM to judge.
 */
async function checkDuplicate(
  ai: GoogleGenAI,
  storeName: string,
  entry: KnowledgeEntry,
): Promise<DedupResult> {
  const query = `Find existing knowledge entries similar to this problem:
Title: ${entry.title}
Symptom: ${entry.symptom}
Root Cause: ${entry.root_cause}
Solution: ${entry.solution}
Technologies: ${entry.context.technologies.join(", ")}

Determine if a substantially similar entry already exists in the knowledge base.
Two entries are duplicates if they describe the SAME problem with the SAME root cause,
even if the wording differs. Minor differences in solution steps do not make them unique.

Respond ONLY with JSON (no markdown fences):
{"isDuplicate": true, "reason": "...", "existingTitle": "..."} or {"isDuplicate": false, "reason": "..."}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: query,
      config: {
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [storeName],
            },
          },
        ],
        responseMimeType: "application/json",
        httpOptions: { timeout: 30_000 },
      },
    });

    const text = response.text?.trim();
    if (!text) return { isDuplicate: false, reason: "Empty response from LLM" };

    return JSON.parse(text) as DedupResult;
  } catch (err) {
    // If the store is empty or query fails, treat as non-duplicate
    console.error(`  Dedup check failed: ${err instanceof Error ? err.message : err}`);
    return { isDuplicate: false, reason: "Dedup check error, defaulting to non-duplicate" };
  }
}

/**
 * Upload a single knowledge entry with metadata.
 */
async function uploadEntry(
  ai: GoogleGenAI,
  storeName: string,
  entry: KnowledgeEntry,
  mdPath: string,
): Promise<void> {
  let op = await ai.fileSearchStores.uploadToFileSearchStore({
    file: mdPath,
    fileSearchStoreName: storeName,
    config: {
      displayName: entry.title.slice(0, 100),
      mimeType: "text/markdown",
      customMetadata: [
        { key: "session_id", stringValue: entry.session_id },
        { key: "confidence", stringValue: entry.confidence },
        { key: "created_at", numericValue: Math.floor(Date.now() / 1000) },
        { key: "technologies", stringValue: entry.context.technologies.join(",") },
        { key: "tags", stringValue: entry.tags.join(",") },
      ],
    },
  });

  let attempts = 0;
  while (!op.done && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    op = await ai.operations.get({ operation: op });
    attempts++;
  }

  if (!op.done) {
    throw new Error("Indexing timed out");
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const ai = getClient();

  if (!existsSync(STORE_NAME_FILE)) {
    console.error("No store found. Run 'poc-file-search.ts upload' first to create a store.");
    process.exit(1);
  }

  const storeName = (await Bun.file(STORE_NAME_FILE).text()).trim();
  console.error(`Store: ${storeName}`);
  console.error(`Dry run: ${dryRun}`);

  // Load all knowledge entries from poc-output
  const jsonFiles = readdirSync(OUTPUT_DIR).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_"),
  );

  const allEntries: KnowledgeEntry[] = [];
  for (const jsonFile of jsonFiles) {
    const entries = await Bun.file(join(OUTPUT_DIR, jsonFile)).json();
    if (Array.isArray(entries)) {
      allEntries.push(...(entries as KnowledgeEntry[]));
    }
  }

  console.error(`Total entries to check: ${allEntries.length}`);

  // Prepare entries directory for individual markdown files
  const { mkdirSync } = await import("node:fs");
  mkdirSync(ENTRIES_DIR, { recursive: true });

  let uploaded = 0;
  let skippedDup = 0;
  let failed = 0;

  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];
    const tag = `[${i + 1}/${allEntries.length}]`;
    console.error(`${tag} Checking: "${entry.title}"`);

    // Step 1: Dedup check
    const result = await checkDuplicate(ai, storeName, entry);

    if (result.isDuplicate) {
      console.error(`${tag}   SKIP (duplicate): ${result.reason}`);
      if (result.existingTitle) {
        console.error(`${tag}   Existing: "${result.existingTitle}"`);
      }
      skippedDup++;
      continue;
    }

    console.error(`${tag}   NEW: ${result.reason}`);

    if (dryRun) {
      uploaded++;
      continue;
    }

    // Step 2: Write individual markdown file
    const slug = entryToSlug(entry);
    const mdPath = join(ENTRIES_DIR, `${slug}.md`);
    const md = entryToMarkdown(entry);
    await Bun.write(mdPath, md);

    // Step 3: Upload with metadata
    try {
      await uploadEntry(ai, storeName, entry, mdPath);
      console.error(`${tag}   UPLOADED`);
      uploaded++;
    } catch (err) {
      console.error(`${tag}   FAILED: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.error(`\n=== SUMMARY ===`);
  console.error(`Total: ${allEntries.length}`);
  console.error(`Uploaded: ${uploaded}`);
  console.error(`Skipped (duplicate): ${skippedDup}`);
  console.error(`Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

/**
 * POC: Gemini File Search Tool with extracted knowledge.
 *
 * Subcommands:
 *   upload   - Create a File Search store and upload all extracted knowledge
 *   query    - Query the store with a question
 *   list     - List existing File Search stores
 *   delete   - Delete a File Search store
 *
 * Usage:
 *   GOOGLE_API_KEY=... bun run scripts/knowledge-extractor/poc-file-search.ts upload
 *   GOOGLE_API_KEY=... bun run scripts/knowledge-extractor/poc-file-search.ts query "How to fix TypeScript import errors?"
 *   GOOGLE_API_KEY=... bun run scripts/knowledge-extractor/poc-file-search.ts list
 *   GOOGLE_API_KEY=... bun run scripts/knowledge-extractor/poc-file-search.ts delete <store-name>
 *
 * NOTE: File Search Tool requires Google AI API (not Vertex AI).
 *       You MUST set GOOGLE_API_KEY environment variable.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";

const OUTPUT_DIR = resolve(import.meta.dir, "poc-output");
const STORE_NAME_FILE = join(OUTPUT_DIR, "_file_search_store.txt");
const MODEL = "gemini-3-flash-preview";

function getClient(): GoogleGenAI {
  if (!process.env.GOOGLE_API_KEY) {
    console.error("ERROR: GOOGLE_API_KEY is required for File Search Tool.");
    console.error("File Search is only available via Google AI API, not Vertex AI.");
    process.exit(1);
  }
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
}

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

/**
 * Convert knowledge entries to a markdown document for better searchability.
 */
function knowledgeToMarkdown(entries: KnowledgeEntry[], sessionId: string): string {
  const lines: string[] = [`# Knowledge Entries - Session ${sessionId}\n`];

  for (const entry of entries) {
    lines.push(`## ${entry.title}\n`);
    lines.push(`**Confidence:** ${entry.confidence}`);
    lines.push(`**Session:** ${entry.session_id}`);
    lines.push(`**Technologies:** ${entry.context.technologies.join(", ")}`);
    lines.push(`**Tools:** ${entry.context.tools.join(", ")}`);
    lines.push(`**Tags:** ${entry.tags.join(", ")}\n`);
    lines.push(`### Symptom\n${entry.symptom}\n`);
    lines.push(`### Root Cause\n${entry.root_cause}\n`);
    lines.push(`### Solution\n${entry.solution}\n`);
    if (entry.prevention) {
      lines.push(`### Prevention\n${entry.prevention}\n`);
    }
    lines.push(
      `### Files Involved\n${entry.context.files_involved.map((f) => `- ${f}`).join("\n")}\n`,
    );
    lines.push("---\n");
  }

  return lines.join("\n");
}

async function uploadCommand() {
  const ai = getClient();

  if (!existsSync(OUTPUT_DIR)) {
    console.error(`Output directory not found: ${OUTPUT_DIR}`);
    console.error("Run poc-batch-extract.ts first.");
    process.exit(1);
  }

  // Find all extracted knowledge JSON files
  const jsonFiles = readdirSync(OUTPUT_DIR).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_"),
  );

  if (jsonFiles.length === 0) {
    console.error("No knowledge files found in output directory.");
    process.exit(1);
  }

  console.error(`Found ${jsonFiles.length} knowledge files`);

  // Convert JSON knowledge files to markdown for upload
  const mdDir = join(OUTPUT_DIR, "markdown");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(mdDir, { recursive: true });

  let totalEntries = 0;
  const mdFiles: string[] = [];

  for (const jsonFile of jsonFiles) {
    const content = await Bun.file(join(OUTPUT_DIR, jsonFile)).json();
    if (!Array.isArray(content) || content.length === 0) continue;

    const sessionId = jsonFile.replace(".json", "");
    const md = knowledgeToMarkdown(content as KnowledgeEntry[], sessionId);
    const mdPath = join(mdDir, `${sessionId}.md`);
    await Bun.write(mdPath, md);
    mdFiles.push(mdPath);
    totalEntries += content.length;
  }

  console.error(`Converted ${mdFiles.length} files with ${totalEntries} total entries to markdown`);

  // Create File Search store
  console.error("Creating File Search store...");
  const store = await ai.fileSearchStores.create({
    config: { displayName: `panopticon-knowledge-poc-${Date.now()}` },
  });

  const storeName = store.name ?? "";
  if (!storeName) {
    console.error("Failed to get store name");
    process.exit(1);
  }
  console.error(`Created store: ${storeName}`);

  // Save store name for later queries
  await Bun.write(STORE_NAME_FILE, storeName);

  // Upload files with concurrency limit
  const UPLOAD_CONCURRENCY = 3;
  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < mdFiles.length; i += UPLOAD_CONCURRENCY) {
    const batch = mdFiles.slice(i, i + UPLOAD_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (mdPath) => {
        const fileName = mdPath.split("/").pop() ?? "unknown";
        console.error(`  Uploading ${fileName}...`);

        let op = await ai.fileSearchStores.uploadToFileSearchStore({
          file: mdPath,
          fileSearchStoreName: storeName,
          config: { displayName: fileName, mimeType: "text/markdown" },
        });

        // Wait for indexing
        let attempts = 0;
        while (!op.done && attempts < 60) {
          await new Promise((r) => setTimeout(r, 2000));
          op = await ai.operations.get({ operation: op });
          attempts++;
        }

        if (!op.done) {
          throw new Error(`Timed out waiting for indexing: ${fileName}`);
        }

        return fileName;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        uploaded++;
      } else {
        failed++;
        console.error(`  FAILED: ${r.reason}`);
      }
    }

    console.error(`  Progress: ${uploaded + failed}/${mdFiles.length} (${failed} failed)`);
  }

  console.error(`\n=== UPLOAD COMPLETE ===`);
  console.error(`Store: ${storeName}`);
  console.error(`Uploaded: ${uploaded}/${mdFiles.length}`);
  console.error(`Failed: ${failed}`);
  console.error(
    `\nTo query: bun run scripts/knowledge-extractor/poc-file-search.ts query "your question"`,
  );
}

async function queryCommand(question: string) {
  const ai = getClient();

  let storeName: string;
  if (existsSync(STORE_NAME_FILE)) {
    storeName = (await Bun.file(STORE_NAME_FILE).text()).trim();
  } else {
    console.error("No store name found. Run 'upload' first or pass store name as 3rd arg.");
    process.exit(1);
  }

  console.error(`Querying store: ${storeName}`);
  console.error(`Question: ${question}`);
  console.error("---");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: question,
    config: {
      tools: [
        {
          fileSearch: {
            fileSearchStoreNames: [storeName],
          },
        },
      ],
    },
  });

  console.log(response.text);

  // Print grounding metadata if available
  const metadata = response.candidates?.[0]?.groundingMetadata;
  if (metadata) {
    console.error("\n--- Grounding Metadata ---");
    console.error(JSON.stringify(metadata, null, 2));
  }
}

async function listCommand() {
  const ai = getClient();

  console.error("Listing File Search stores...");
  const pager = await ai.fileSearchStores.list();

  let found = false;
  for await (const store of pager) {
    found = true;
    console.log(`${store.name} - ${store.displayName} (created: ${store.createTime})`);
  }

  if (!found) {
    console.error("No stores found.");
  }
}

async function deleteCommand(storeName: string) {
  const ai = getClient();

  console.error(`Deleting store: ${storeName}...`);
  await ai.fileSearchStores.delete({ name: storeName, config: { force: true } });
  console.error("Deleted.");
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);

  switch (subcommand) {
    case "upload":
      await uploadCommand();
      break;
    case "query":
      if (rest.length === 0) {
        console.error("Usage: poc-file-search.ts query <question>");
        process.exit(1);
      }
      await queryCommand(rest.join(" "));
      break;
    case "list":
      await listCommand();
      break;
    case "delete":
      if (rest.length === 0) {
        console.error("Usage: poc-file-search.ts delete <store-name>");
        process.exit(1);
      }
      await deleteCommand(rest[0]);
      break;
    default:
      console.error("Usage: poc-file-search.ts <upload|query|list|delete> [args...]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

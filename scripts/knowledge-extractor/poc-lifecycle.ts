/**
 * POC: Lifecycle management for knowledge entries in Gemini File Search.
 *
 * Scans entries older than a threshold and asks LLM to evaluate whether
 * they are still valid/useful. Deletes entries deemed obsolete.
 *
 * Usage:
 *   GOOGLE_API_KEY=... bun run scripts/knowledge-extractor/poc-lifecycle.ts [--max-age-days 180] [--dry-run]
 *
 * Expects:
 *   - poc-output/_file_search_store.txt with the store name
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";

const OUTPUT_DIR = resolve(import.meta.dir, "poc-output");
const STORE_NAME_FILE = join(OUTPUT_DIR, "_file_search_store.txt");
const MODEL = "gemini-3-flash-preview";

interface ValidityResult {
  isValid: boolean;
  reason: string;
}

interface StoreDocument {
  name: string;
  displayName?: string;
  createTime?: string;
  customMetadata?: Array<{
    key: string;
    stringValue?: string;
    numericValue?: number;
  }>;
}

function getClient(): GoogleGenAI {
  if (!process.env.GOOGLE_API_KEY) {
    console.error("ERROR: GOOGLE_API_KEY is required.");
    process.exit(1);
  }
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
}

function getCreatedAtFromMetadata(doc: StoreDocument): number | null {
  const meta = doc.customMetadata?.find((m) => m.key === "created_at");
  if (meta?.numericValue) return meta.numericValue;

  // Fallback: parse createTime from API
  if (doc.createTime) {
    const ts = new Date(doc.createTime).getTime() / 1000;
    if (!Number.isNaN(ts)) return ts;
  }

  return null;
}

/**
 * Ask LLM to evaluate whether a knowledge entry is still valid and useful.
 */
async function evaluateValidity(
  ai: GoogleGenAI,
  storeName: string,
  _docName: string,
  displayName: string,
): Promise<ValidityResult> {
  // Use File Search to retrieve the document's content by querying its title
  const query = `Retrieve and evaluate the following knowledge entry: "${displayName}"

Determine whether this knowledge entry is still valid and useful for a development team.

An entry should be marked INVALID if ANY of these apply:
1. The technology or framework version mentioned has been superseded and the problem no longer occurs in current versions
2. The problem was caused by a bug that has since been fixed upstream
3. The solution references deprecated APIs, tools, or patterns
4. The entry describes a one-time setup issue that would never recur (e.g., initial project scaffolding)
5. The knowledge is too project-specific to be reusable (e.g., fixing a typo in a specific file path)

An entry should be marked VALID if:
1. It describes a conceptual pattern or common pitfall that could recur
2. The technologies mentioned are still in active use
3. The solution teaches a generalizable debugging approach
4. It documents a non-obvious interaction between tools/libraries

Respond ONLY with JSON (no markdown fences):
{"isValid": true, "reason": "..."} or {"isValid": false, "reason": "..."}`;

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
    if (!text) return { isValid: true, reason: "Empty response, defaulting to valid" };

    return JSON.parse(text) as ValidityResult;
  } catch (err) {
    console.error(`  Validity check failed: ${err instanceof Error ? err.message : err}`);
    return { isValid: true, reason: "Check failed, defaulting to valid (safe)" };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const maxAgeDaysIdx = args.indexOf("--max-age-days");
  const maxAgeDays = maxAgeDaysIdx >= 0 ? Number(args[maxAgeDaysIdx + 1]) : 180;

  const ai = getClient();

  if (!existsSync(STORE_NAME_FILE)) {
    console.error("No store found. Run 'poc-file-search.ts upload' first.");
    process.exit(1);
  }

  const storeName = (await Bun.file(STORE_NAME_FILE).text()).trim();
  console.error(`Store: ${storeName}`);
  console.error(`Max age: ${maxAgeDays} days`);
  console.error(`Dry run: ${dryRun}`);

  // List all documents in the store
  console.error("Listing documents...");
  const docsResponse = await ai.fileSearchStores.documents.list({
    parent: storeName,
  });

  const docs: StoreDocument[] = [];

  // The list API may return an async iterable or a direct array
  if (Symbol.asyncIterator in Object(docsResponse)) {
    for await (const doc of docsResponse as AsyncIterable<StoreDocument>) {
      docs.push(doc);
    }
  } else if (Array.isArray(docsResponse)) {
    docs.push(...docsResponse);
  } else if (docsResponse && typeof docsResponse === "object" && "documents" in docsResponse) {
    docs.push(...((docsResponse as { documents: StoreDocument[] }).documents ?? []));
  }

  console.error(`Found ${docs.length} documents`);

  if (docs.length === 0) {
    console.error("No documents found in store.");
    return;
  }

  // Filter for old documents
  const now = Math.floor(Date.now() / 1000);
  const maxAgeSeconds = maxAgeDays * 24 * 60 * 60;
  const cutoff = now - maxAgeSeconds;

  const oldDocs: StoreDocument[] = [];
  const unknownAgeDocs: StoreDocument[] = [];

  for (const doc of docs) {
    const createdAt = getCreatedAtFromMetadata(doc);
    if (createdAt === null) {
      unknownAgeDocs.push(doc);
    } else if (createdAt < cutoff) {
      oldDocs.push(doc);
    }
  }

  console.error(`Documents older than ${maxAgeDays} days: ${oldDocs.length}`);
  console.error(`Documents with unknown age: ${unknownAgeDocs.length}`);

  // For the POC, also evaluate unknown-age documents
  const toEvaluate = [...oldDocs, ...unknownAgeDocs];

  if (toEvaluate.length === 0) {
    console.error("No documents to evaluate.");
    return;
  }

  console.error(`\nEvaluating ${toEvaluate.length} documents...`);

  let valid = 0;
  let invalid = 0;
  let deleted = 0;
  let evalFailed = 0;

  for (let i = 0; i < toEvaluate.length; i++) {
    const doc = toEvaluate[i];
    const tag = `[${i + 1}/${toEvaluate.length}]`;
    const displayName = doc.displayName ?? doc.name;
    const createdAt = getCreatedAtFromMetadata(doc);
    const ageStr = createdAt ? `${Math.floor((now - createdAt) / 86400)} days old` : "unknown age";

    console.error(`${tag} Evaluating: "${displayName}" (${ageStr})`);

    const result = await evaluateValidity(ai, storeName, doc.name, displayName);

    if (result.isValid) {
      console.error(`${tag}   VALID: ${result.reason}`);
      valid++;
    } else {
      console.error(`${tag}   INVALID: ${result.reason}`);
      invalid++;

      if (dryRun) {
        console.error(`${tag}   Would delete (dry run)`);
      } else {
        try {
          await ai.fileSearchStores.documents.delete({ name: doc.name });
          console.error(`${tag}   DELETED`);
          deleted++;
        } catch (err) {
          console.error(`${tag}   DELETE FAILED: ${err instanceof Error ? err.message : err}`);
          evalFailed++;
        }
      }
    }

    // Rate limiting: small delay between evaluations
    if (i < toEvaluate.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.error(`\n=== SUMMARY ===`);
  console.error(`Evaluated: ${toEvaluate.length}`);
  console.error(`Valid: ${valid}`);
  console.error(`Invalid: ${invalid}`);
  console.error(`Deleted: ${deleted}`);
  if (evalFailed > 0) console.error(`Delete failed: ${evalFailed}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

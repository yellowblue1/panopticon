/**
 * Function type representing a Gemini generateContent call.
 * The infrastructure layer wraps the SDK client into this shape.
 */
export type GenerateContentFn = (
  prompt: string,
  options?: { responseMimeType?: string },
) => Promise<string | null>;

/**
 * Cache port: memoise an idempotent async computation by content key.
 *
 * Contract:
 * - On cache hit, return the cached value without calling the fetcher.
 * - On concurrent calls for the same key, dedupe to a single fetcher call.
 * - The fetcher returns either a value to cache (T) or `null` meaning
 *   "do not cache; the next caller will retry."
 * - Errors thrown from the fetcher are treated identically to a `null` return.
 */
export interface Cache<T> {
  fetch(content: string, fetcher: () => Promise<T | null>): Promise<T | null>;
}

/**
 * Dependencies for summary generation
 */
export interface SummaryDeps {
  generateContent: GenerateContentFn;
  cache: Cache<string>;
}

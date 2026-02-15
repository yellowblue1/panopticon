// FNV-1a hash for lightweight content change detection
export function hashContent(content: string): string {
  if (content === "") return "";

  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

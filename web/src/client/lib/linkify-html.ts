/**
 * Post-process fancy-ansi HTML output to make URLs and PR references clickable.
 *
 * Operates on HTML where:
 * - Text is escaped via escape-html (&amp; for &, &lt; for <, etc.)
 * - Only <span style="..."> tags exist (from fancy-ansi)
 *
 * Strategy:
 * 1. Split by HTML tags, linkify URLs in text segments only, rejoin.
 * 2. Linkify PR references across the full HTML (they may span multiple
 *    <span> elements due to ANSI color codes).
 */

/** Matches <span ...> and </span> tags from fancy-ansi output */
const TAG_RE = /(<[^>]+>)/;

/**
 * Matches http(s) URLs in HTML-escaped text.
 * Excludes & and \ from the general character class so that HTML entities
 * like &quot; &lt; &gt; properly terminate URL matching.
 * &amp; is allowed within URLs (for query parameters) but NOT when followed
 * by an HTML entity name (e.g., &amp;quot; &amp;lt;) which indicates
 * double-encoded entities in terminal code output.
 */
const URL_RE = /https?:\/\/(?:[^\s<>"'&\\]|&amp;(?![a-z]+;))+/g;

/**
 * Matches PR references like "PR #57" across <span> tag boundaries.
 * ANSI color codes cause fancy-ansi to split "PR #57" into separate <span>
 * elements (e.g. <span style="...">PR</span><span style="..."> </span>
 * <span style="...">#57</span>), so the regex allows <span>/<\/span> tags
 * and whitespace between "PR", "#", and the number.
 */
const TAG_FILLER = "(?:\\s|<\\/?span(?:\\s[^>]*)?>)*";
const PR_CROSS_TAG_RE = new RegExp(`\\bPR(?:${TAG_FILLER})#(?:${TAG_FILLER})(\\d+)\\b`, "g");

/** Characters to strip from end of matched URL */
const TRAILING_PUNCT_RE = /[.,;:!?)}\]>]+$/;

function linkifyUrls(text: string): string {
  return text.replace(URL_RE, (match) => {
    // Strip trailing punctuation that's likely not part of the URL
    const trailingMatch = match.match(TRAILING_PUNCT_RE);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const url = trailing ? match.slice(0, -trailing.length) : match;

    if (!url) return match;

    // Convert &amp; back to & for the href attribute
    const href = url.replaceAll("&amp;", "&");
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="terminal-link">${url}</a>${trailing}`;
  });
}

function linkifyPrReferences(html: string, githubRepoUrl: string): string {
  const baseUrl = githubRepoUrl.replace(/\/$/, "");

  return html.replace(PR_CROSS_TAG_RE, (match, prNumber, offset) => {
    // Skip if match is inside an already-linkified <a> tag
    const before = html.slice(0, offset);
    const lastAOpen = before.lastIndexOf("<a ");
    if (lastAOpen !== -1 && before.lastIndexOf("</a>") < lastAOpen) {
      return match;
    }

    const href = `${baseUrl}/pull/${prNumber}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="terminal-link">${match}</a>`;
  });
}

export function linkifyHtml(html: string, githubRepoUrl?: string | null): string {
  // Step 1: Split into tag and text segments, linkify URLs in text only
  const parts = html.split(TAG_RE);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Skip HTML tags and empty segments
    if (!part || part.startsWith("<")) continue;
    parts[i] = linkifyUrls(part);
  }

  let result = parts.join("");

  // Step 2: Linkify PR references across the full HTML (cross-tag aware)
  if (githubRepoUrl) {
    result = linkifyPrReferences(result, githubRepoUrl);
  }

  return result;
}

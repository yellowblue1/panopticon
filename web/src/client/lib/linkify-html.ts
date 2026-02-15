/**
 * Post-process fancy-ansi HTML output to make URLs and PR references clickable.
 *
 * Operates on HTML where:
 * - Text is escaped via escape-html (&amp; for &, &lt; for <, etc.)
 * - Only <span style="..."> tags exist (from fancy-ansi)
 *
 * Strategy: split by HTML tags, linkify only text segments, rejoin.
 */

/** Matches <span ...> and </span> tags from fancy-ansi output */
const TAG_RE = /(<[^>]+>)/;

/** Matches http(s) URLs in HTML-escaped text, allowing &amp; entities */
const URL_RE = /https?:\/\/(?:[^\s<>"']|&amp;)+/g;

/** Matches PR references like "PR #57" */
const PR_REF_RE = /\bPR\s*#(\d+)\b/g;

/** Characters to strip from end of matched URL */
const TRAILING_PUNCT_RE = /[.,;:!?)}\]>]+$/;

function linkifyText(text: string, githubRepoUrl: string | null | undefined): string {
  // Linkify HTTP(S) URLs
  let result = text.replace(URL_RE, (match) => {
    // Strip trailing punctuation that's likely not part of the URL
    const trailingMatch = match.match(TRAILING_PUNCT_RE);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const url = trailing ? match.slice(0, -trailing.length) : match;

    if (!url) return match;

    // Convert &amp; back to & for the href attribute
    const href = url.replaceAll("&amp;", "&");
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="terminal-link">${url}</a>${trailing}`;
  });

  // Linkify PR references (only if GitHub repo URL is available)
  if (githubRepoUrl) {
    const baseUrl = githubRepoUrl.replace(/\/$/, "");
    result = result.replace(PR_REF_RE, (match, prNumber) => {
      const href = `${baseUrl}/pull/${prNumber}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="terminal-link">${match}</a>`;
    });
  }

  return result;
}

export function linkifyHtml(html: string, githubRepoUrl?: string | null): string {
  // Split into tag and text segments
  const parts = html.split(TAG_RE);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Skip HTML tags and empty segments
    if (!part || part.startsWith("<")) continue;
    parts[i] = linkifyText(part, githubRepoUrl);
  }

  return parts.join("");
}

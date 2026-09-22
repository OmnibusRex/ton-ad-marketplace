const URL_WITH_USERINFO = /[a-z][a-z0-9+.-]*:\/\/[^\s@/]+@[^\s]+/gi;
const SECRET_ASSIGNMENT =
  /\b(?:telegram[_-]?bot[_-]?token|toncenter[_-]?api[_-]?key|api[_-]?key|access[_-]?token|mnemonic|seed[_-]?phrase|private[_-]?key)\b[=: ]+\S+/gi;

/**
 * Log text safe to print on a shared host. Connection strings and common
 * secret assignments are redacted. Objects are not serialized.
 */
export function sanitizeForLog(value: unknown): string {
  const text = value instanceof Error ? value.message || value.name : typeof value === "string" ? value : "unknown error";
  return text
    .replace(URL_WITH_USERINFO, (match) => {
      const scheme = match.slice(0, match.indexOf("://"));
      return `${scheme}://[redacted]`;
    })
    .replace(SECRET_ASSIGNMENT, (match) => `${match.split(/[=: ]/)[0]}=[redacted]`);
}

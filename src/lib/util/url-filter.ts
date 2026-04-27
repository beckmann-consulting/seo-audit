// Include / exclude URL filter for the crawler.
//
// Semantics:
//   - patterns are JavaScript regular expressions (string form, no
//     surrounding slashes), tested against the full URL (scheme + host
//     + path + query). Lets users anchor on protocol or host when they
//     want to.
//   - exclude wins: a URL matching ANY exclude is dropped, even if it
//     also matches an include.
//   - an empty include list means "any URL is acceptable" — only
//     excludes are applied.
//   - an explicitly non-empty include list narrows to URLs matching at
//     least one include pattern (and not matching any exclude).

export class FilterPatternError extends Error {
  constructor(public readonly pattern: string, public readonly cause: string) {
    super(`Invalid pattern "${pattern}": ${cause}`);
    this.name = 'FilterPatternError';
  }
}

// Compile an array of pattern strings into RegExp objects. Empty /
// whitespace-only entries are dropped silently so users can leave
// blank lines in the textarea without breaking the audit.
export function compileFilterPatterns(patterns: string[] | undefined): RegExp[] {
  if (!patterns) return [];
  const out: RegExp[] = [];
  for (const raw of patterns) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    try {
      out.push(new RegExp(trimmed));
    } catch (err) {
      throw new FilterPatternError(trimmed, err instanceof Error ? err.message : String(err));
    }
  }
  return out;
}

export function urlMatches(
  url: string,
  includes: RegExp[],
  excludes: RegExp[],
): boolean {
  for (const ex of excludes) {
    if (ex.test(url)) return false;
  }
  if (includes.length === 0) return true;
  for (const inc of includes) {
    if (inc.test(url)) return true;
  }
  return false;
}

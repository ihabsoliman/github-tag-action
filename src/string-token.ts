export const TOKEN_MATCH_MODES = ['word', 'substring'] as const;
export type TokenMatchMode = (typeof TOKEN_MATCH_MODES)[number];

export interface StringTokens {
  major: string;
  minor: string;
  patch: string;
  none: string;
}

export type StringTokenBump = 'major' | 'minor' | 'patch';

/**
 * The outcome of scanning a commit range for bump tokens.
 *
 * This is a discriminated union rather than `'major' | ... | 'none' | undefined`
 * on purpose: `'none'` must never be usable as a semver release type. A bare
 * `'none'` reaching `` `pre${bump}` `` would produce the release type
 * `'prenone'`, which makes `semver.inc()` return null and the run fail with
 * "Could not increment version." Keeping "an explicit none token matched"
 * (`none`) distinct from "no token matched at all" (`no-match`) also matters
 * because they take different paths: the former always skips, the latter falls
 * back to `default_bump`.
 */
export type StringTokenResult =
  | { kind: 'bump'; bump: StringTokenBump }
  | { kind: 'none' }
  | { kind: 'no-match' };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesToken(log: string, token: string, mode: TokenMatchMode) {
  // An empty token disables that bump level. Callers are expected to apply
  // their own defaults before getting here.
  if (!token) {
    return false;
  }

  if (mode === 'substring') {
    // Bug-compatible with anothrNick/github-tag-action, which matches with a
    // bash `case` glob (`*$token*`) over the whole log: case-sensitive, no word
    // boundaries. `#patchset` therefore matches `#patch`, which is a documented
    // sharp edge rather than an oversight.
    return log.includes(token);
  }

  // `word` mode requires the token to be delimited, so `#patches` does not
  // match `#patch`. A plain `\b` is no help here because tokens typically start
  // with a non-word character (`#`), so assert on the characters either side
  // instead. Case-insensitive, so `#MAJOR` matches `#major`.
  return new RegExp(`(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`, 'i').test(
    log,
  );
}

/**
 * Decide a bump from magic tokens in commit messages.
 *
 * Mirrors `entrypoint.sh`'s `case "$log" in` block: the whole commit range is
 * matched as one concatenated blob (legacy uses `git log --format=%B`, so a
 * token in any commit in the range counts), and precedence is
 * major > minor > patch > none on a first-match-wins basis. A range containing
 * both `#major` and `#none` therefore bumps major - `#none` only wins when no
 * other token appears anywhere.
 */
export function analyzeCommitsByStringToken(
  commits: { message: string }[],
  tokens: StringTokens,
  mode: TokenMatchMode,
): StringTokenResult {
  const log = commits.map((commit) => commit.message).join('\n');

  if (matchesToken(log, tokens.major, mode)) {
    return { kind: 'bump', bump: 'major' };
  }
  if (matchesToken(log, tokens.minor, mode)) {
    return { kind: 'bump', bump: 'minor' };
  }
  if (matchesToken(log, tokens.patch, mode)) {
    return { kind: 'bump', bump: 'patch' };
  }
  if (matchesToken(log, tokens.none, mode)) {
    return { kind: 'none' };
  }
  return { kind: 'no-match' };
}

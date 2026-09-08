import {
  analyzeCommitsByStringToken,
  StringTokens,
} from '../src/string-token.js';

const DEFAULT_TOKENS: StringTokens = {
  major: '#major',
  minor: '#minor',
  patch: '#patch',
  none: '#none',
};

function commits(...messages: string[]) {
  return messages.map((message) => ({ message }));
}

describe('analyzeCommitsByStringToken', () => {
  describe('token detection', () => {
    it.each([
      ['#major', 'major'],
      ['#minor', 'minor'],
      ['#patch', 'patch'],
    ] as const)('detects %s as a %s bump', (token, expected) => {
      const result = analyzeCommitsByStringToken(
        commits(`some change ${token} here`),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: expected });
    });

    it('detects the none token as an explicit skip', () => {
      const result = analyzeCommitsByStringToken(
        commits('docs only #none'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'none' });
    });

    it('reports no-match when no token is present', () => {
      const result = analyzeCommitsByStringToken(
        commits('just a normal commit', 'and another'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'no-match' });
    });

    it('matches a token in any commit in the range, not just the first', () => {
      const result = analyzeCommitsByStringToken(
        commits('first', 'second #minor', 'third'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'minor' });
    });

    it('matches a token in a commit body, not only the subject', () => {
      const result = analyzeCommitsByStringToken(
        commits('subject line\n\nbody explains why #major\n'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'major' });
    });

    it('supports custom tokens', () => {
      const result = analyzeCommitsByStringToken(
        commits('ship it [feature]'),
        { ...DEFAULT_TOKENS, minor: '[feature]' },
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'minor' });
    });

    it('treats a token containing regex metacharacters literally', () => {
      // If the token were interpolated into a RegExp unescaped, `[major]` would
      // be a character class matching any of m/a/j/o/r.
      const tokens = { ...DEFAULT_TOKENS, major: '[major]' };

      expect(
        analyzeCommitsByStringToken(commits('bump [major]'), tokens, 'word'),
      ).toEqual({ kind: 'bump', bump: 'major' });
      expect(
        analyzeCommitsByStringToken(commits('bump j'), tokens, 'word'),
      ).toEqual({ kind: 'no-match' });
    });

    it('disables a bump level when its token is empty', () => {
      const result = analyzeCommitsByStringToken(
        commits('this mentions #major'),
        { ...DEFAULT_TOKENS, major: '' },
        'word',
      );

      expect(result).toEqual({ kind: 'no-match' });
    });
  });

  describe('precedence', () => {
    it('prefers major over every other token', () => {
      const result = analyzeCommitsByStringToken(
        commits('#none', '#patch', '#minor', '#major'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'major' });
    });

    it('prefers minor over patch and none', () => {
      const result = analyzeCommitsByStringToken(
        commits('#none', '#patch', '#minor'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'minor' });
    });

    it('prefers patch over none', () => {
      const result = analyzeCommitsByStringToken(
        commits('#none', '#patch'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'patch' });
    });

    it('lets none win only when no other token appears anywhere in the range', () => {
      // Bug-compatible with entrypoint.sh, whose `case` arms are evaluated in
      // major/minor/patch/none order: a range that says both "#major" and
      // "#none" bumps major.
      const result = analyzeCommitsByStringToken(
        commits('chore: tidy #none', 'feat: thing #major'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'major' });
    });
  });

  describe('token_match_mode: substring (legacy)', () => {
    it('matches a token that is a prefix of a longer word', () => {
      // INTENTIONAL bug-compatibility with entrypoint.sh's bash `case` glob
      // (`*$token*`). Documented as a sharp edge, not an oversight.
      const result = analyzeCommitsByStringToken(
        commits('fix #patches in the docs'),
        DEFAULT_TOKENS,
        'substring',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'patch' });
    });

    it('is case-sensitive', () => {
      const result = analyzeCommitsByStringToken(
        commits('BREAKING #MAJOR change'),
        DEFAULT_TOKENS,
        'substring',
      );

      expect(result).toEqual({ kind: 'no-match' });
    });

    it('matches a token glued to surrounding text', () => {
      const result = analyzeCommitsByStringToken(
        commits('refactor(core):#minor'),
        DEFAULT_TOKENS,
        'substring',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'minor' });
    });
  });

  describe('token_match_mode: word (default)', () => {
    it('does not match a token that is a prefix of a longer word', () => {
      const result = analyzeCommitsByStringToken(
        commits('fix #patches in the docs'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'no-match' });
    });

    it('is case-insensitive', () => {
      const result = analyzeCommitsByStringToken(
        commits('BREAKING #MAJOR change'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'major' });
    });

    it('matches a token at the very start and end of the log', () => {
      expect(
        analyzeCommitsByStringToken(commits('#minor'), DEFAULT_TOKENS, 'word'),
      ).toEqual({ kind: 'bump', bump: 'minor' });
      expect(
        analyzeCommitsByStringToken(
          commits('do a thing #patch'),
          DEFAULT_TOKENS,
          'word',
        ),
      ).toEqual({ kind: 'bump', bump: 'patch' });
    });

    it('matches a token followed by punctuation', () => {
      const result = analyzeCommitsByStringToken(
        commits('bump it (#minor).'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'bump', bump: 'minor' });
    });

    it('does not match a token preceded by a word character', () => {
      const result = analyzeCommitsByStringToken(
        commits('see also ref#minor'),
        DEFAULT_TOKENS,
        'word',
      );

      expect(result).toEqual({ kind: 'no-match' });
    });
  });

  it('reports no-match for an empty commit range', () => {
    expect(analyzeCommitsByStringToken([], DEFAULT_TOKENS, 'word')).toEqual({
      kind: 'no-match',
    });
  });
});

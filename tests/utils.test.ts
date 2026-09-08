import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const getInputMock = jest.fn().mockReturnValue('');
const warningMock = jest.fn();
const getCommitRangeMock = jest.fn();
const getCompareStatusMock = jest.fn();
const isShallowRepositoryMock = jest.fn();
const listMergedTagsMock = jest.fn();

jest.unstable_mockModule('@actions/core', () => ({
  debug: jest.fn(),
  warning: warningMock,
  info: jest.fn(),
  getInput: getInputMock,
}));

jest.unstable_mockModule('../src/github.js', () => ({
  getCommitRange: getCommitRangeMock,
  getCompareStatus: getCompareStatusMock,
  isShallowRepository: isShallowRepositoryMock,
  listMergedTags: listMergedTagsMock,
  NO_PREVIOUS_TAG_SHA: 'HEAD',
}));

const mockContext: { payload: Record<string, unknown> } = { payload: {} };

jest.unstable_mockModule('@actions/github', () => ({
  context: mockContext,
}));

const utils = await import('../src/utils.js');
const { getValidTags } = utils;
const { defaultChangelogRules } = await import('../src/defaults.js');

function makeTag(name: string, sha: string) {
  return {
    name,
    commit: { sha, url: 'string' },
    zipball_url: 'string',
    tarball_url: 'string',
    node_id: 'string',
  };
}

const regex = /^v/;

describe('utils', () => {
  beforeEach(() => {
    getCommitRangeMock.mockReset();
    getCompareStatusMock.mockReset();
    isShallowRepositoryMock.mockReset();
    listMergedTagsMock.mockReset();
    warningMock.mockReset();
    getCommitRangeMock.mockResolvedValue([]);
    mockContext.payload = {};
  });

  it('extracts branch from ref', () => {
    /*
     * Given
     */
    const remoteRef = 'refs/heads/master';

    /*
     * When
     */
    const branch = utils.getBranchFromRef(remoteRef);

    /*
     * Then
     */
    expect(branch).toEqual('master');
  });

  it('test if ref is PR', () => {
    /*
     * Given
     */
    const remoteRef = 'refs/pull/123/merge';

    /*
     * When
     */
    const isPullRequest = utils.isPr(remoteRef);

    /*
     * Then
     */
    expect(isPullRequest).toEqual(true);
  });

  it('returns valid tags', async () => {
    /*
     * Given
     */
    const testTags = [
      {
        name: 'release-1.2.3',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.2.3',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
    ];

    /*
     * When
     */
    const validTags = await getValidTags(testTags, regex);

    /*
     * Then
     */
    expect(validTags).toHaveLength(1);
  });

  it('returns sorted tags', async () => {
    /*
     * Given
     */
    const testTags = [
      {
        name: 'v1.2.4-prerelease.1',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.2.4-prerelease.2',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.2.4-prerelease.0',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.2.3',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
    ];

    /*
     * When
     */
    const validTags = await getValidTags(testTags, regex);

    /*
     * Then
     */
    expect(validTags[0]).toEqual({
      name: 'v1.2.4-prerelease.2',
      commit: { sha: 'string', url: 'string' },
      zipball_url: 'string',
      tarball_url: 'string',
      node_id: 'string',
    });
  });

  it('returns only prefixed tags', async () => {
    /*
     * Given
     */
    const testTags = [
      {
        name: 'app2/5.0.0',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: '7.0.0',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'app1/3.0.0',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
    ];
    /*
     * When
     */
    const validTags = await getValidTags(testTags, /^app1\//);
    /*
     * Then
     */
    expect(validTags).toHaveLength(1);
    expect(validTags[0]).toEqual({
      name: 'app1/3.0.0',
      commit: { sha: 'string', url: 'string' },
      zipball_url: 'string',
      tarball_url: 'string',
      node_id: 'string',
    });
  });

  it('filters tags by pattern when tag_search_pattern is provided', async () => {
    /*
     * Given
     */
    const testTags = [
      {
        name: 'v1.2.3',
        commit: { sha: 'sha1', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v2.0.1',
        commit: { sha: 'sha2', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.3.0',
        commit: { sha: 'sha3', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
    ];

    getInputMock.mockImplementation((name) => {
      if (name === 'tag_search_pattern') {
        return 'v1.*';
      }
      return '';
    });

    /*
     * When
     */
    const validTags = await getValidTags(testTags, /^v/);

    /*
     * Then
     */
    expect(validTags).toHaveLength(2);
    expect(validTags[0].name).toEqual('v1.3.0'); // Tags should be sorted, with v1.3.0 before v1.2.3
    expect(validTags[1].name).toEqual('v1.2.3');
    expect(validTags.find((tag) => tag.name === 'v2.0.1')).toBeUndefined();

    // Clean up
    getInputMock.mockReturnValue('');
  });

  describe('getCommits', () => {
    it('forwards baseRef, headRef and options to getCommitRange', async () => {
      getCommitRangeMock.mockResolvedValue([
        { sha: 'abc', commit: { message: 'feat: thing' } },
      ]);

      const commits = await utils.getCommits('base', 'head', {
        gitCwd: '/repo',
        branchHistory: 'full',
      });

      expect(getCommitRangeMock).toHaveBeenCalledWith('base', 'head', {
        gitCwd: '/repo',
        branchHistory: 'full',
      });
      expect(commits).toEqual([{ message: 'feat: thing', hash: 'abc' }]);
    });

    it('returns an empty array (not a crash) when there are no commits and the event payload has no commits array (e.g. workflow_dispatch)', async () => {
      getCommitRangeMock.mockResolvedValue([]);
      mockContext.payload = {};

      const commits = await utils.getCommits('base', 'head');

      expect(commits).toEqual([]);
    });

    // These fixtures use the real `push` webhook payload shape - `{ id, message }`
    // with no nested `.commit`. They previously used an API-shaped
    // `{ sha, commit: { message } }`, which masked a bug: the code read
    // `commit.commit.message` and would throw on a real payload.
    it('falls back to the closed-PR commit list when the compare range is empty and the payload has one', async () => {
      getCommitRangeMock.mockResolvedValue([]);
      mockContext.payload = {
        commits: [{ id: 'closed-pr-sha', message: 'fix: y' }],
      };

      const commits = await utils.getCommits('base', 'head');

      expect(commits).toEqual([{ message: 'fix: y', hash: 'closed-pr-sha' }]);
    });

    it('does not use the closed-PR commit list in a pull_request event context', async () => {
      getCommitRangeMock.mockResolvedValue([]);
      mockContext.payload = {
        pull_request: {},
        commits: [{ id: 'closed-pr-sha', message: 'fix: y' }],
      };

      const commits = await utils.getCommits('base', 'head');

      expect(commits).toEqual([]);
    });

    it('skips payload commits with no message', async () => {
      getCommitRangeMock.mockResolvedValue([]);
      mockContext.payload = {
        commits: [
          { id: 'a', message: '' },
          { id: 'b', message: 'fix: kept' },
        ],
      };

      const commits = await utils.getCommits('base', 'head');

      expect(commits).toEqual([{ message: 'fix: kept', hash: 'b' }]);
    });

    it('does not use the closed-PR commit list when skipClosedPrFallback is set', async () => {
      getCommitRangeMock.mockResolvedValue([]);
      mockContext.payload = {
        commits: [{ id: 'closed-pr-sha', message: 'fix: y' }],
      };

      const commits = await utils.getCommits('base', 'head', {
        skipClosedPrFallback: true,
      });

      expect(commits).toEqual([]);
    });
  });

  describe('getLatestTag', () => {
    it('uses initialVersion for the fallback tag name when no tag matches', () => {
      const latest = utils.getLatestTag([], /^v/, 'v', '1.2.0');

      expect(latest).toEqual({
        name: 'v1.2.0',
        commit: { sha: 'HEAD' },
      });
    });

    it('defaults to 0.0.0 when initialVersion is not provided', () => {
      const latest = utils.getLatestTag([], /^v/, 'v');

      expect(latest).toEqual({
        name: 'v0.0.0',
        commit: { sha: 'HEAD' },
      });
    });
  });

  describe('filterTagsByBranchAncestry', () => {
    const regex = /^v/;

    it('uses local git merged-tag ancestry when the checkout is not shallow', async () => {
      const tags = [makeTag('v2.0.0', 'sha2'), makeTag('v1.0.0', 'sha1')];
      isShallowRepositoryMock.mockResolvedValue(false);
      listMergedTagsMock.mockResolvedValue(['v1.0.0']);

      const result = await utils.filterTagsByBranchAncestry(
        tags,
        'headsha',
        regex,
      );

      expect(result).toEqual([tags[1]]);
      expect(getCompareStatusMock).not.toHaveBeenCalled();
    });

    it('falls back to the API scan when the checkout is shallow', async () => {
      const tags = [makeTag('v2.0.0', 'sha2'), makeTag('v1.0.0', 'sha1')];
      isShallowRepositoryMock.mockResolvedValue(true);
      getCompareStatusMock
        .mockResolvedValueOnce('behind')
        .mockResolvedValueOnce('ahead');

      const result = await utils.filterTagsByBranchAncestry(
        tags,
        'headsha',
        regex,
      );

      expect(listMergedTagsMock).not.toHaveBeenCalled();
      expect(result).toEqual([tags[1]]);
    });

    it('distrusts an empty local merged-tag result and falls back to the API scan', async () => {
      const tags = [makeTag('v1.0.0', 'sha1')];
      isShallowRepositoryMock.mockResolvedValue(false);
      listMergedTagsMock.mockResolvedValue([]);
      getCompareStatusMock.mockResolvedValue('identical');

      const result = await utils.filterTagsByBranchAncestry(
        tags,
        'headsha',
        regex,
      );

      expect(getCompareStatusMock).toHaveBeenCalledWith('sha1', 'headsha');
      expect(result).toEqual([tags[0]]);
    });

    it('falls back to the API scan when the local git ancestry check throws', async () => {
      const tags = [makeTag('v1.0.0', 'sha1')];
      isShallowRepositoryMock.mockResolvedValue(false);
      listMergedTagsMock.mockRejectedValue(new Error('fatal: bad revision'));
      getCompareStatusMock.mockResolvedValue('ahead');

      const result = await utils.filterTagsByBranchAncestry(
        tags,
        'headsha',
        regex,
      );

      expect(result).toEqual([tags[0]]);
    });

    it('stops the API scan at the first non-prerelease ancestor, collecting newer prerelease ancestors along the way', async () => {
      const tags = [
        makeTag('v2.0.0-prerelease.0', 'shaPre'),
        makeTag('v1.0.0', 'shaRelease'),
        makeTag('v0.5.0', 'shaOld'),
      ];
      isShallowRepositoryMock.mockResolvedValue(true);
      getCompareStatusMock
        .mockResolvedValueOnce('ahead') // v2.0.0-prerelease.0 is an ancestor
        .mockResolvedValueOnce('ahead'); // v1.0.0 is an ancestor -> stop here

      const result = await utils.filterTagsByBranchAncestry(
        tags,
        'headsha',
        regex,
      );

      expect(result).toEqual([tags[0], tags[1]]);
      expect(getCompareStatusMock).toHaveBeenCalledTimes(2);
    });

    it('skips a tag whose ancestry check fails and continues scanning', async () => {
      const tags = [makeTag('v2.0.0', 'shaFail'), makeTag('v1.0.0', 'shaOk')];
      isShallowRepositoryMock.mockResolvedValue(true);
      getCompareStatusMock
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce('ahead');

      const result = await utils.filterTagsByBranchAncestry(
        tags,
        'headsha',
        regex,
      );

      expect(result).toEqual([tags[1]]);
    });

    it('caps the API scan at 50 calls', async () => {
      const tags = Array.from({ length: 60 }, (_, i) =>
        makeTag(`v0.0.${60 - i}`, `sha${60 - i}`),
      );
      isShallowRepositoryMock.mockResolvedValue(true);
      getCompareStatusMock.mockResolvedValue('behind');

      await utils.filterTagsByBranchAncestry(tags, 'headsha', regex);

      expect(getCompareStatusMock).toHaveBeenCalledTimes(50);
    });

    it('returns an empty array when given no tags', async () => {
      const result = await utils.filterTagsByBranchAncestry(
        [],
        'headsha',
        regex,
      );

      expect(result).toEqual([]);
      expect(isShallowRepositoryMock).not.toHaveBeenCalled();
    });
  });

  describe('custom release types', () => {
    it('maps custom release types', () => {
      /*
       * Given
       */
      const customReleasesString =
        'james:preminor,bond:premajor,007:major:Breaking Changes,feat:minor';

      /*
       * When
       */
      const mappedReleases = utils.mapCustomReleaseRules(customReleasesString);

      /*
       * Then
       */
      expect(mappedReleases).toEqual([
        { type: 'james', release: 'preminor' },
        { type: 'bond', release: 'premajor' },
        { type: '007', release: 'major', section: 'Breaking Changes' },
        {
          type: 'feat',
          release: 'minor',
          section: defaultChangelogRules['feat'].section,
        },
      ]);
    });

    it('filters out invalid custom release types', () => {
      /*
       * Given
       */
      const customReleasesString = 'james:pre-release,bond:premajor';

      /*
       * When
       */
      const mappedReleases = utils.mapCustomReleaseRules(customReleasesString);

      /*
       * Then
       */
      expect(mappedReleases).toEqual([{ type: 'bond', release: 'premajor' }]);
    });
  });

  describe('method: mergeWithDefaultChangelogRules', () => {
    it('combines non-existing type rules with default rules', () => {
      /**
       * Given
       */
      const newRule = {
        type: 'james',
        release: 'major',
        section: '007 Changes',
      };

      /**
       * When
       */
      const result = utils.mergeWithDefaultChangelogRules([newRule]);

      /**
       * Then
       */
      expect(result).toEqual([
        ...Object.values(defaultChangelogRules),
        newRule,
      ]);
    });

    it('overwrites existing default type rules with provided rules', () => {
      /**
       * Given
       */
      const newRule = {
        type: 'feat',
        release: 'minor',
        section: '007 Changes',
      };

      /**
       * When
       */
      const result = utils.mergeWithDefaultChangelogRules([newRule]);
      const overWrittenRule = result.find((rule) => rule.type === 'feat');

      /**
       * Then
       */
      expect(overWrittenRule?.section).toBe(newRule.section);
    });

    it('returns only the rules having changelog section', () => {
      /**
       * Given
       */
      const mappedReleaseRules = [
        { type: 'james', release: 'major', section: '007 Changes' },
        { type: 'bond', release: 'minor', section: undefined },
      ];

      /**
       * When
       */
      const result = utils.mergeWithDefaultChangelogRules(mappedReleaseRules);

      /**
       * Then
       */
      expect(result).toContainEqual(mappedReleaseRules[0]);
      expect(result).not.toContainEqual(mappedReleaseRules[1]);
    });
  });
});

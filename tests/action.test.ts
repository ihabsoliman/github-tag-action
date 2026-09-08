import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
} from '@jest/globals';
import {
  clearInputs,
  loadDefaultInputs,
  setBranch,
  setCommitSha,
  setInput,
  setInputs,
  setRepository,
} from './helper.test.js';

const realUtils: any = await import('../src/utils.js?real');
/*
 * `jest.fn()` with no type argument is typed `Mock<UnknownFunction>`, whose
 * parameter and resolved types collapse to `never` - which makes
 * `mockResolvedValue(...)`, `mockRejectedValue(...)` and
 * `mockImplementation(...)` reject every argument. These mocks stand in for
 * module and API shapes we deliberately do not model exactly (the fixtures are
 * partial on purpose), so give them a permissive signature instead of widening
 * every fixture to a full API type.
 */
type LooseFn = (...args: any[]) => any;
const mockFn = () => jest.fn<LooseFn>();

const getCommitsMock = mockFn();
const getValidTagsMock = mockFn();
const filterTagsByBranchAncestryMock = mockFn();

jest.unstable_mockModule('../src/utils.js', () => ({
  ...realUtils,
  getCommits: getCommitsMock,
  getValidTags: getValidTagsMock,
  filterTagsByBranchAncestry: filterTagsByBranchAncestryMock,
}));

const realGithub: any = await import('../src/github.js?real');
const listTagsMock = mockFn();
const mockCreateTag = mockFn().mockResolvedValue(undefined);

jest.unstable_mockModule('../src/github.js', () => ({
  // Spread the real module so non-mocked exports (constants such as
  // NO_PREVIOUS_TAG_SHA) resolve, matching how ../src/utils.js is mocked above.
  ...realGithub,
  listTags: listTagsMock,
  createTag: mockCreateTag,
}));

const realCore: any = await import('@actions/core?real');
const mockSetOutput = mockFn();
const mockSetFailed = mockFn();
const mockWarning = mockFn();

jest.unstable_mockModule('@actions/core', () => ({
  ...realCore,
  debug: mockFn(),
  info: mockFn(),
  warning: mockWarning,
  setOutput: mockSetOutput,
  setFailed: mockSetFailed,
}));

jest.spyOn(console, 'info').mockImplementation(() => {});

const action = (await import('../src/action.js')).default;
const utils = await import('../src/utils.js');
const github = await import('../src/github.js');
const core = await import('@actions/core');

beforeAll(() => {
  setRepository('https://github.com', 'org/repo');
});

describe('github-tag-action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks wipes call history but not implementations set by a
    // previous test; restore the real getValidTags as the default so tests
    // that only mock listTagsMock (not getValidTagsMock) exercise the real
    // filtering logic instead of an implementation left over from another test.
    getValidTagsMock.mockImplementation(realUtils.getValidTags);
    filterTagsByBranchAncestryMock.mockImplementation(
      async (tags: unknown) => tags,
    );
    setBranch('master');
    setCommitSha('79e0ea271c26aa152beef77c3275ff7b8f8d8274');
    clearInputs();
    loadDefaultInputs();
  });

  describe('special cases', () => {
    it('throws (rather than core.setFailed) when GITHUB_REF is missing, so soft_fail in main.ts can catch it', async () => {
      /*
       * Given
       */
      delete process.env['GITHUB_REF'];

      /*
       * When / Then
       */
      await expect(action()).rejects.toThrow('Missing GITHUB_REF.');
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('throws (rather than core.setFailed) when commit_sha/GITHUB_SHA is missing', async () => {
      /*
       * Given
       */
      delete process.env['GITHUB_SHA'];
      setInput('commit_sha', '');

      /*
       * When / Then
       */
      await expect(action()).rejects.toThrow(
        'Missing commit_sha or GITHUB_SHA.',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create initial tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags: any[] = [];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v0.0.1',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create patch tag without commits', async () => {
      /*
       * Given
       */
      const commits: any[] = [];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags: any[] = [];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v0.0.1',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('propagates a getCommits failure as a real failure (does not fabricate an empty commit range)', async () => {
      /*
       * Given
       */
      getCommitsMock.mockRejectedValue(
        new Error('Sorry, this diff is taking too long to generate.'),
      );

      const validTags: any[] = [];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When / Then
       */
      await expect(action()).rejects.toThrow(
        'Sorry, this diff is taking too long to generate.',
      );
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetOutput).toHaveBeenCalledWith('tag_created', 'false');
      expect(mockSetOutput).not.toHaveBeenCalledWith('tag_created', 'true');
    });

    it('does not create tag without commits and default_bump set to false', async () => {
      /*
       * Given
       */
      setInput('default_bump', 'false');
      const commits: any[] = [];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag using custom release types', async () => {
      /*
       * Given
       */
      setInput('custom_release_rules', 'james:patch,bond:major');
      const commits = [
        { message: 'james: is the new cool guy', hash: null },
        { message: 'bond: is his last name', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.0.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag using custom release types but non-custom commit message', async () => {
      /*
       * Given
       */
      setInput('custom_release_rules', 'james:patch,bond:major');
      const commits = [
        { message: 'fix: is the new cool guy', hash: null },
        { message: 'feat: is his last name', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does update existing tag when force enabled', async () => {
      /*
       * Given
       */
      setInput('force_update', 'true');
      setInput('custom_tag', 'latest');
      setInput('tag_prefix', '');
      const commits = [
        {
          message: 'feat: some new feature on a pre-release branch',
          hash: null,
        },
        { message: 'james: this should make a preminor', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'latest',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'latest',
        expect.any(Boolean),
        true,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create a tag, but does not push the tag', async () => {
      /*
       * Given
       */
      setInput('push_tag', 'false');
      const commits: any[] = [];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags: any[] = [];
      listTagsMock.mockImplementation(async () => validTags);
      /*
       * When
       */
      await action();
      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v0.0.1',
        expect.any(Boolean),
        false,
        expect.any(String),
        false,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does skip commits not included in scopes', async () => {
      /*
       * Given
       */
      setInput('scopes', 'yes');
      const commits = [
        { message: 'fix(YES): 1ne', hash: null },
        { message: 'feat(NO): 2wo', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('release branches', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      setBranch('release');
      setInput('release_branches', 'release');
      setInput('force_bump', '');
    });

    it('does create patch tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create minor tag', async () => {
      /*
       * Given
       */
      const commits = [
        { message: 'feat: this is my first feature', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag as specified by force_bump', async () => {
      setInput('force_bump', 'patch');
      /*
       * Given
       */
      const commits = [
        { message: 'feat: this is my first feature', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create major tag', async () => {
      /*
       * Given
       */
      const commits = [
        {
          message:
            'my commit message\nBREAKING CHANGE:\nthis is a breaking change',
          hash: null,
        },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.0.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does not create major tag when using default preset and bang(!) is present on prefix', async () => {
      /*
       * Given
       */
      setInput('commit_analyzer_preset', '');
      const commits = [
        {
          message: 'feat!: this is a breaking change',
          hash: null,
        },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create major tag when using conventionalcommits preset and bang(!) is present on prefix', async () => {
      /*
       * Given
       */
      setInput('commit_analyzer_preset', 'conventionalcommits');
      const commits = [
        {
          message: 'feat!: this is a breaking change',
          hash: null,
        },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.0.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag when pre-release tag is newer', async () => {
      /*
       * Given
       */
      const commits = [
        { message: 'feat: some new feature on a release branch', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v2.1.3-prerelease.0',
          commit: { sha: '678901', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v2.1.3-prerelease.1',
          commit: { sha: '234567', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.2.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag with custom release rules', async () => {
      /*
       * Given
       */
      setInput('custom_release_rules', 'james:preminor');
      const commits = [
        {
          message: 'feat: some new feature on a pre-release branch',
          hash: null,
        },
        { message: 'james: this should make a preminor', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('pre-release branches', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      setBranch('prerelease');
      loadDefaultInputs();
      setInput('pre_release_branches', 'prerelease');
      setInput('force_prerelease_bump', '');
    });

    it('does not create tag without commits and default_bump set to false', async () => {
      /*
       * Given
       */
      setInput('default_prerelease_bump', 'false');
      const commits: any[] = [];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag with force_prerelease_bump', async () => {
      /*
       * Given
       */
      setInput('force_prerelease_bump', 'prerelease');
      const commits = [{ message: 'this is my first fix', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create prerelease tag', async () => {
      /*
       * Given
       */
      setInput('default_prerelease_bump', 'prerelease');
      const commits = [{ message: 'this is my first fix', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    /** 1.3.0 commit =[minor, minor, prerelease]=> 1.4.0-pre.0 */
    it('does create prerelease tag respecting default_draft_bump', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      setInput('default_bump', 'minor');
      setInput('default_draft_bump', 'minor');
      setInput('default_prerelease_bump', 'prerelease');
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    /** 1.3.0-pre.0 + commit =[minor, minor, prerelease]=> 1.3.0-pre.1 */
    it('does update prerelease tag respecting default_draft_bump', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v1.3.0-prerelease.0',
          commit: { sha: '123456', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      setInput('default_bump', 'minor');
      setInput('default_draft_bump', 'minor');
      setInput('default_prerelease_bump', 'prerelease');
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0-prerelease.1',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    /** 1.3.0-pre.0 + commit =[minor, minor, preminor]=> 1.4.0-pre.0 */
    it('does update prerelease tag with preminor', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v1.3.0-prerelease.0',
          commit: { sha: '123456', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      setInput('default_bump', 'minor');
      setInput('default_draft_bump', 'minor');
      setInput('default_prerelease_bump', 'preminor');
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.4.0-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('normalizes a doubled pre-prefix (e.g. a misconfigured "prepreminor") instead of producing an invalid release type', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v1.3.0-prerelease.0',
          commit: { sha: '123456', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      setInput('default_bump', 'minor');
      setInput('default_draft_bump', 'minor');
      // Not a real release type - simulates a misconfigured input that
      // already carries more than one 'pre' prefix.
      setInput('default_prerelease_bump', 'prepreminor');
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.4.0-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    /**
     *  1.2.3 commit =[minor, -, prerelease]=> 1.2.4-pre.0
     * according to semver, a prerelease increment on a non-prerelease version drafts a new minor version
     */
    it('default_draft_bump defaults to default_prerelease_bump (prerelease)', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      setInput('default_bump', 'minor');
      setInput('default_prerelease_bump', 'prerelease');
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4-prerelease.0', // prerelease drafts patch upgrades
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    /**
     *  1.2.3 commit =[minor, -, prerelease]=> 1.2.4-pre.0
     * according to semver, a prerelease increment on a non-prerelease version drafts a new minor version
     */
    it('default_draft_bump defaults to default_prerelease_bump (preminor)', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      setInput('default_bump', 'minor');
      setInput('default_prerelease_bump', 'preminor');
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0-prerelease.0', // prerelease drafts patch upgrades
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create prepatch tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create preminor tag', async () => {
      /*
       * Given
       */
      const commits = [
        { message: 'feat: this is my first feature', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create premajor tag', async () => {
      /*
       * Given
       */
      const commits = [
        {
          message:
            'my commit message\nBREAKING CHANGE:\nthis is a breaking change',
          hash: null,
        },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.0.0-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag when release tag is newer', async () => {
      /*
       * Given
       */
      const commits = [
        {
          message: 'feat: some new feature on a pre-release branch',
          hash: null,
        },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3-prerelease.0',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v3.1.2-feature.0',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v2.1.4',
          commit: { sha: '234567', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.2.0-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag with custom release rules', async () => {
      /*
       * Given
       */
      setInput('custom_release_rules', 'james:preminor');
      const commits = [
        {
          message: 'feat: some new feature on a pre-release branch',
          hash: null,
        },
        { message: 'james: this should make a preminor', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0-prerelease.0',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('other branches', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      setBranch('development');
      setInput('pre_release_branches', 'prerelease');
      setInput('release_branches', 'release');
    });

    it('does output patch tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '1.2.4');
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does output minor tag', async () => {
      /*
       * Given
       */
      const commits = [
        { message: 'feat: this is my first feature', hash: null },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '1.3.0');
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does output major tag', async () => {
      /*
       * Given
       */
      const commits = [
        {
          message:
            'my commit message\nBREAKING CHANGE:\nthis is a breaking change',
          hash: null,
        },
      ];
      getCommitsMock.mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      listTagsMock.mockImplementation(async () => validTags);
      getValidTagsMock.mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '2.0.0');
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('tag_message', () => {
    beforeEach(() => {
      getCommitsMock.mockImplementation(async () => [
        { message: 'fix: this is my first fix', hash: null },
      ]);
      listTagsMock.mockImplementation(async () => []);
    });

    it('passes tag_message through to createTag', async () => {
      setInput('tag_message', 'Release notes');
      setInput('create_annotated_tag', 'true');

      await action();

      expect(mockCreateTag).toHaveBeenCalledWith(
        'v0.0.1',
        true,
        false,
        expect.any(String),
        true,
        'Release notes',
      );
    });

    it('passes an empty string when tag_message is not set', async () => {
      await action();

      expect(mockCreateTag).toHaveBeenCalledWith(
        'v0.0.1',
        expect.any(Boolean),
        false,
        expect.any(String),
        true,
        '',
      );
    });

    it('warns when tag_message is set but create_annotated_tag is false', async () => {
      setInput('tag_message', 'Release notes');
      setInput('create_annotated_tag', 'false');

      await action();

      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringContaining('tag_message'),
      );
    });

    it('does not warn when tag_message is not set', async () => {
      setInput('create_annotated_tag', 'false');

      await action();

      expect(mockWarning).not.toHaveBeenCalledWith(
        expect.stringContaining('tag_message'),
      );
    });
  });

  describe('initial_version', () => {
    it('uses initial_version as the fallback tag when no tag exists', async () => {
      setInput('initial_version', '1.5.0');
      getCommitsMock.mockImplementation(async () => [
        { message: 'fix: this is my first fix', hash: null },
      ]);
      listTagsMock.mockImplementation(async () => []);

      await action();

      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '1.5.1');
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('strips a leading v from initial_version', async () => {
      setInput('initial_version', 'v1.5.0');
      getCommitsMock.mockImplementation(async () => [
        { message: 'fix: this is my first fix', hash: null },
      ]);
      listTagsMock.mockImplementation(async () => []);

      await action();

      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '1.5.1');
    });

    it('throws (rather than core.setFailed) on an invalid initial_version', async () => {
      setInput('initial_version', 'not-a-semver');

      await expect(action()).rejects.toThrow(
        'not-a-semver is not a valid semver.',
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('defaults to 0.0.0 when initial_version is not set', async () => {
      getCommitsMock.mockImplementation(async () => [
        { message: 'fix: this is my first fix', hash: null },
      ]);
      listTagsMock.mockImplementation(async () => []);

      await action();

      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '0.0.1');
    });
  });

  describe('tag_context', () => {
    const releaseTag = {
      name: 'v1.0.0',
      commit: { sha: 'sha-v1', url: 'string' },
      zipball_url: 'string',
      tarball_url: 'string',
      node_id: 'string',
    };

    beforeEach(() => {
      getCommitsMock.mockImplementation(async () => [
        { message: 'fix: a fix', hash: null },
      ]);
      listTagsMock.mockImplementation(async () => [releaseTag]);
      getValidTagsMock.mockImplementation(async () => [releaseTag]);
    });

    it('defaults to repo (unfiltered tags), leaving filterTagsByBranchAncestry unused', async () => {
      await action();

      expect(filterTagsByBranchAncestryMock).not.toHaveBeenCalled();
      expect(mockSetOutput).toHaveBeenCalledWith('previous_version', '1.0.0');
    });

    it('branch mode filters tags via filterTagsByBranchAncestry', async () => {
      setInput('tag_context', 'branch');
      setInput('source', '/repo/checkout');
      filterTagsByBranchAncestryMock.mockResolvedValue([releaseTag]);

      await action();

      expect(filterTagsByBranchAncestryMock).toHaveBeenCalledWith(
        [releaseTag],
        expect.any(String),
        expect.any(RegExp),
        { gitCwd: '/repo/checkout' },
      );
      expect(mockSetOutput).toHaveBeenCalledWith('previous_version', '1.0.0');
    });

    it('falls back to initial_version when branch mode finds no ancestor tag', async () => {
      setInput('tag_context', 'branch');
      setInput('initial_version', '2.0.0');
      filterTagsByBranchAncestryMock.mockResolvedValue([]);

      await action();

      expect(mockSetOutput).toHaveBeenCalledWith('previous_version', '2.0.0');
    });

    it('keeps tag existence checks repo-global even in branch mode', async () => {
      setInput('tag_context', 'branch');
      filterTagsByBranchAncestryMock.mockResolvedValue([]);
      setInput('initial_version', '1.0.0');
      getCommitsMock.mockImplementation(async () => [
        { message: 'fix: a fix', hash: null },
      ]);

      await action();

      // The raw (unfiltered) tag list already contains v1.0.0, so the
      // computed next patch tag v1.0.1 does not already exist and the
      // action proceeds to create it - this only holds if tagExists
      // consulted the unfiltered `tags`, not the branch-filtered list.
      expect(mockCreateTag).toHaveBeenCalled();
    });

    it('warns and behaves as repo for an unrecognized tag_context value', async () => {
      setInput('tag_context', 'nonsense');

      await action();

      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringContaining('tag_context'),
      );
      expect(filterTagsByBranchAncestryMock).not.toHaveBeenCalled();
    });
  });

  describe('branch_history', () => {
    beforeEach(() => {
      getCommitsMock.mockImplementation(async () => [
        { message: 'fix: a fix', hash: null },
      ]);
      listTagsMock.mockImplementation(async () => []);
    });

    it('passes branch_history through the commit range options to getCommits', async () => {
      setInput('branch_history', 'full');
      setInput('default_branch', 'main');

      await action();

      expect(getCommitsMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          branchHistory: 'full',
          defaultBranch: 'main',
          currentBranch: 'master',
        }),
      );
    });

    it('defaults to compare', async () => {
      await action();

      expect(getCommitsMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ branchHistory: 'compare' }),
      );
    });

    it('warns and behaves as compare for an unrecognized branch_history value', async () => {
      setInput('branch_history', 'nonsense');

      await action();

      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringContaining('branch_history'),
      );
      expect(getCommitsMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ branchHistory: 'compare' }),
      );
    });
  });

  describe('source', () => {
    beforeEach(() => {
      getCommitsMock.mockImplementation(async () => [
        { message: 'fix: a fix', hash: null },
      ]);
      listTagsMock.mockImplementation(async () => []);
    });

    it('resolves gitCwd from the source input and forwards it to getCommits', async () => {
      setInput('source', '/some/checkout');

      await action();

      expect(getCommitsMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ gitCwd: '/some/checkout' }),
      );
    });

    it('defaults gitCwd to "." when source is not set', async () => {
      await action();

      expect(getCommitsMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ gitCwd: '.' }),
      );
    });
  });

  describe('bump_strategy: string-token', () => {
    /** Set up a string-token run the way the example-org shim does. */
    function setStringTokenInputs(overrides: Record<string, string> = {}) {
      setInputs({
        bump_strategy: 'string-token',
        token_match_mode: 'substring',
        major_string_token: '#major',
        minor_string_token: '#minor',
        patch_string_token: '#patch',
        none_string_token: '#none',
        default_bump: 'patch',
        fetch_all_tags: 'true',
        ...overrides,
      });
    }

    function tag(name: string, sha = 'tagsha') {
      return { name, commit: { sha } };
    }

    describe('configuration', () => {
      it('throws on an unrecognised bump_strategy so soft_fail can catch it', async () => {
        setInput('bump_strategy', 'conventional-tokens');

        await expect(action()).rejects.toThrow(
          'conventional-tokens is not a valid bump_strategy.',
        );
        expect(mockSetFailed).not.toHaveBeenCalled();
      });

      it('warns when token inputs are set but the strategy is not', async () => {
        getCommitsMock.mockImplementation(async () => [
          { message: 'fix: a thing', hash: null },
        ]);
        listTagsMock.mockImplementation(async () => []);
        setInput('major_string_token', '#major');

        await action();

        expect(mockWarning).toHaveBeenCalledWith(
          'String token inputs are ignored unless bump_strategy is set to string-token.',
        );
      });

      it('does not warn about token inputs on a default conventional-commits run', async () => {
        getCommitsMock.mockImplementation(async () => [
          { message: 'fix: a thing', hash: null },
        ]);
        listTagsMock.mockImplementation(async () => []);

        await action();

        expect(mockWarning).not.toHaveBeenCalledWith(
          'String token inputs are ignored unless bump_strategy is set to string-token.',
        );
      });

      it('warns that scopes is unsupported and does not filter commits by it', async () => {
        setStringTokenInputs({ tag_prefix: '', scopes: 'api' });
        // No conventional scope anywhere - the scope filter would drop this and
        // starve the matcher.
        getCommitsMock.mockImplementation(async () => [
          { message: 'rework the thing #minor', hash: null },
        ]);
        listTagsMock.mockImplementation(async () => [tag('1.0.0')]);

        await action();

        expect(mockWarning).toHaveBeenCalledWith(
          'scopes is not supported with bump_strategy: string-token and is ignored.',
        );
        expect(mockCreateTag).toHaveBeenCalledWith(
          '1.1.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('forwards fetch_all_tags so prefixed lineages past the first page are found', async () => {
        setStringTokenInputs({ tag_prefix: 'web-app_' });
        getCommitsMock.mockImplementation(async () => [
          { message: 'a change', hash: null },
        ]);
        listTagsMock.mockImplementation(async () => [tag('web-app_1.0.0')]);

        await action();

        expect(listTagsMock).toHaveBeenCalledWith(true);
      });
    });

    // Ported from the vendored fork's test/test_prefix.bats, which is the suite
    // that guarded the tag_prefix handling. Legacy defaults DEFAULT_BUMP to
    // minor and none of these commits carry a token, so every case exercises the
    // default-bump fall-through.
    describe('ported test_prefix.bats scenarios', () => {
      beforeEach(() => {
        setStringTokenInputs({ default_bump: 'minor' });
      });

      it('creates a new tag with no prefix', async () => {
        setInput('tag_prefix', '');
        listTagsMock.mockImplementation(async () => []);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          '0.1.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('bumps a tag with no prefix', async () => {
        setInput('tag_prefix', '');
        listTagsMock.mockImplementation(async () => [tag('1.0.0')]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'bump', hash: null },
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          '1.1.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('creates a new tag with a v prefix', async () => {
        setInput('tag_prefix', 'v');
        listTagsMock.mockImplementation(async () => []);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'v0.1.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('bumps a tag with a v prefix', async () => {
        setInput('tag_prefix', 'v');
        listTagsMock.mockImplementation(async () => [tag('v1.0.0')]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'bump', hash: null },
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'v1.1.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('creates a new tag with a slash prefix', async () => {
        setInput('tag_prefix', 'infra/');
        listTagsMock.mockImplementation(async () => []);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'infra/0.1.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('bumps a tag with a slash prefix', async () => {
        setInput('tag_prefix', 'infra/');
        listTagsMock.mockImplementation(async () => [tag('infra/1.0.0')]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'bump', hash: null },
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'infra/1.1.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('bumps only the tag matching the prefix, ignoring other lineages', async () => {
        // The isolation case: an unprefixed 2.x lineage must not leak into the
        // infra/ lineage's version history.
        setInput('tag_prefix', 'infra/');
        listTagsMock.mockImplementation(async () => [
          tag('2.0.0'),
          tag('infra/1.7.0'),
          tag('2.1.0'),
        ]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'bump', hash: null },
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'infra/1.8.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
        expect(mockCreateTag).not.toHaveBeenCalledWith(
          '2.2.0',
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
        );
      });
    });

    describe('token-driven bumps on a release branch', () => {
      beforeEach(() => {
        setStringTokenInputs({ tag_prefix: 'web-app_' });
        listTagsMock.mockImplementation(async () => [tag('web-app_1.4.0')]);
      });

      it.each([
        ['#major', 'web-app_2.0.0', 'major'],
        ['#minor', 'web-app_1.5.0', 'minor'],
        ['#patch', 'web-app_1.4.1', 'patch'],
      ])('bumps on %s', async (token, expectedTag, expectedType) => {
        getCommitsMock.mockImplementation(async () => [
          { message: `some work ${token}`, hash: null },
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          expectedTag,
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
        expect(mockSetOutput).toHaveBeenCalledWith(
          'release_type',
          expectedType,
        );
      });

      it('falls back to default_bump when no token matches', async () => {
        getCommitsMock.mockImplementation(async () => [
          { message: 'no markers here', hash: null },
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('bumps major when both #major and #none appear in the range', async () => {
        getCommitsMock.mockImplementation(async () => [
          { message: 'chore: tidy #none', hash: null },
          { message: 'feat: thing #major', hash: null },
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_2.0.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('re-tags an already-tagged HEAD (legacy FORCE_WITHOUT_CHANGES=true)', async () => {
        // Both consumers set FORCE_WITHOUT_CHANGES: "true", and this action has
        // no "no new commits" guard, so an empty range bumps by default_bump.
        getCommitsMock.mockImplementation(async () => []);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });
    });

    describe('skip paths always echo a tag', () => {
      beforeEach(() => {
        setStringTokenInputs({ tag_prefix: 'web-app_' });
      });

      it('skips on the none token and echoes the existing tag', async () => {
        listTagsMock.mockImplementation(async () => [tag('web-app_1.4.0')]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'docs only #none', hash: null },
        ]);

        await action();

        expect(mockCreateTag).not.toHaveBeenCalled();
        expect(mockSetOutput).toHaveBeenCalledWith('release_type', 'none');
        expect(mockSetOutput).toHaveBeenCalledWith('new_tag', 'web-app_1.4.0');
        expect(mockSetOutput).toHaveBeenCalledWith('new_version', '1.4.0');
        expect(mockSetOutput).toHaveBeenCalledWith('tag_created', 'false');
      });

      it('echoes the stable tag on a none skip even during a prerelease run', async () => {
        // entrypoint.sh's #none arm fires before its prerelease block, so it
        // echoes the release tag - never the prerelease one, which would
        // otherwise be published as a container tag.
        setInputs({ pre_release: 'true', append_to_pre_release_tag: 'RC' });
        listTagsMock.mockImplementation(async () => [
          tag('web-app_1.4.0'),
          tag('web-app_1.4.1-RC.3'),
        ]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'docs only #none', hash: null },
        ]);

        await action();

        expect(mockCreateTag).not.toHaveBeenCalled();
        expect(mockSetOutput).toHaveBeenCalledWith('new_tag', 'web-app_1.4.0');
      });

      it.each(['false', 'none'])(
        'skips and echoes when no token matches and default_bump is %s',
        async (defaultBump) => {
          setInput('default_bump', defaultBump);
          listTagsMock.mockImplementation(async () => [tag('web-app_1.4.0')]);
          getCommitsMock.mockImplementation(async () => [
            { message: 'no markers here', hash: null },
          ]);

          await action();

          expect(mockCreateTag).not.toHaveBeenCalled();
          expect(mockSetOutput).toHaveBeenCalledWith(
            'new_tag',
            'web-app_1.4.0',
          );
          expect(mockSetFailed).not.toHaveBeenCalled();
        },
      );
    });

    describe('first tag of a new prefixed lineage', () => {
      beforeEach(() => {
        setStringTokenInputs({ tag_prefix: 'web-app_' });
        listTagsMock.mockImplementation(async () => [tag('other_9.9.9')]);
      });

      it('does not scan history and uses default_bump', async () => {
        // Legacy's range is `git log ""..<sha>`, which git reads as HEAD..HEAD
        // and is empty. Scanning all commits reachable from HEAD instead would
        // let an unrelated historical token decide a new service's first tag.
        await action();

        expect(getCommitsMock).not.toHaveBeenCalled();
        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_0.0.1',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('respects initial_version', async () => {
        setInput('initial_version', '1.0.0');

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.0.1',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('starts a prerelease series at .0', async () => {
        setInputs({ pre_release: 'true', append_to_pre_release_tag: 'RC' });

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_0.0.1-RC.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });
    });

    describe('prereleases', () => {
      beforeEach(() => {
        setStringTokenInputs({ tag_prefix: 'web-app_' });
        setInputs({ pre_release: 'true', append_to_pre_release_tag: 'RC' });
        setBranch('test');
        getCommitsMock.mockImplementation(async () => [
          { message: 'fix a thing #patch', hash: null },
        ]);
      });

      it('continues an existing prerelease series rather than re-bumping the base version', async () => {
        // The divergence this whole seam exists for. Incrementing from
        // max(stable, prerelease) would yield web-app_1.4.2-RC.0; legacy computes
        // the target off the stable tag (1.4.1), sees the prerelease series is
        // already working towards it, and bumps the counter instead.
        listTagsMock.mockImplementation(async () => [
          tag('web-app_1.4.0'),
          tag('web-app_1.4.1-RC.3'),
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1-RC.4',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
        expect(mockSetOutput).toHaveBeenCalledWith('release_type', 'prepatch');
      });

      it('restarts the series at .0 when the token targets a different version', async () => {
        listTagsMock.mockImplementation(async () => [
          tag('web-app_1.4.0'),
          tag('web-app_1.4.1-RC.3'),
        ]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'feat: big thing #minor', hash: null },
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.5.0-RC.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('starts a series at .0 when no prerelease tag exists yet', async () => {
        listTagsMock.mockImplementation(async () => [tag('web-app_1.4.0')]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1-RC.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('ignores a prerelease series with a different identifier', async () => {
        listTagsMock.mockImplementation(async () => [
          tag('web-app_1.4.0'),
          tag('web-app_1.4.1-alpha.7'),
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1-RC.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('continues the series on a non-v prefix (the crash the vendored fork patched)', async () => {
        // Upstream anothrNick handed the prefixed tag straight to the semver CLI,
        // which rejected it and killed the run under `set -e`.
        setInput('tag_prefix', 'infra/');
        listTagsMock.mockImplementation(async () => [
          tag('infra/1.2.0'),
          tag('infra/1.2.1-RC.2'),
        ]);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'infra/1.2.1-RC.3',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
        expect(mockSetFailed).not.toHaveBeenCalled();
      });
    });

    describe('pre_release override', () => {
      beforeEach(() => {
        setStringTokenInputs({ tag_prefix: 'web-app_' });
        listTagsMock.mockImplementation(async () => [tag('web-app_1.4.0')]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'fix a thing #patch', hash: null },
        ]);
      });

      it('cuts a release tag on a non-release branch when pre_release is false', async () => {
        setBranch('test');
        setInput('pre_release', 'false');

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('cuts a prerelease on a release branch when pre_release is true', async () => {
        setBranch('master');
        setInputs({ pre_release: 'true', append_to_pre_release_tag: 'RC' });

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1-RC.0',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('infers from the branch when pre_release is unset', async () => {
        setBranch('master');

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('still tags on a branch in neither branch list', async () => {
        // pre_release_branches has no default, so ''.split(',') yields [''] and
        // match('') is truthy - which is what keeps the "neither a release nor a
        // pre-release branch" guard from suppressing tags on arbitrary branches.
        setBranch('some/feature-branch');
        setInput('pre_release', 'false');

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'web-app_1.4.1',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });
    });

    describe('commit range', () => {
      it('bypasses the closed-PR payload fallback', async () => {
        // entrypoint.sh has no equivalent fallback; using one would let the push
        // payload supply commits legacy never saw.
        setStringTokenInputs({ tag_prefix: 'web-app_' });
        listTagsMock.mockImplementation(async () => [tag('web-app_1.4.0')]);
        getCommitsMock.mockImplementation(async () => []);

        await action();

        expect(getCommitsMock).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.objectContaining({ skipClosedPrFallback: true }),
        );
      });

      it('keeps the fallback enabled for conventional-commits callers', async () => {
        listTagsMock.mockImplementation(async () => [tag('v1.4.0')]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'fix: thing', hash: null },
        ]);

        await action();

        expect(getCommitsMock).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.objectContaining({ skipClosedPrFallback: false }),
        );
      });

      it('computes the range from the stable tag, not the newer prerelease tag', async () => {
        setStringTokenInputs({ tag_prefix: 'web-app_' });
        setInputs({ pre_release: 'true', append_to_pre_release_tag: 'RC' });
        listTagsMock.mockImplementation(async () => [
          tag('web-app_1.4.0', 'stable-sha'),
          tag('web-app_1.4.1-RC.3', 'prerelease-sha'),
        ]);
        getCommitsMock.mockImplementation(async () => [
          { message: 'fix a thing #patch', hash: null },
        ]);

        await action();

        expect(getCommitsMock).toHaveBeenCalledWith(
          'stable-sha',
          expect.any(String),
          expect.anything(),
        );
        expect(mockSetOutput).toHaveBeenCalledWith(
          'previous_tag',
          'web-app_1.4.0',
        );
      });
    });

    /*
     * Real tag histories, taken from the two repositories that consume this via
     * the example-org tag-bump shim. Each case is an actual transition that the
     * bash action performed, so the expected value is not a prediction - it is
     * the tag that exists in the repository today.
     *
     * Lineages are trimmed to the tags that decide the outcome (the newest stable
     * tag and the prerelease series above it); the omitted older tags cannot
     * affect the result. Commit messages are representative: not one of the 1420
     * real messages sampled across these repos contains a bump token, so every
     * one of these transitions runs through default_bump.
     */
    describe('real consumer tag histories', () => {
      const REAL_COMMITS = [
        { message: 'PROJ-1234 wire up the exporter', hash: null },
        {
          message: 'Merge pull request #412 from example-org/contributor/fix',
          hash: null,
        },
        { message: 'fix flaky integration test', hash: null },
      ];

      interface RealCase {
        name: string;
        prefix: string;
        lineage: string[];
        prerelease: false | string;
        expected: string;
        why: string;
      }

      const CASES: RealCase[] = [
        {
          name: 'continues an alpha series',
          prefix: 'ledger-sync_',
          lineage: [
            'ledger-sync_0.0.11-alpha.1',
            'ledger-sync_0.0.11-alpha.0',
            'ledger-sync_0.0.11-RC.0',
            'ledger-sync_0.0.10',
          ],
          prerelease: 'alpha',
          expected: 'ledger-sync_0.0.11-alpha.2',
          why: 'target 0.0.11 from stable 0.0.10; the alpha series is already on it',
        },
        {
          name: 'continues an alpha series in another lineage',
          prefix: 'webhook-server_',
          lineage: [
            'webhook-server_0.0.5-alpha.4',
            'webhook-server_0.0.5-RC.0',
            'webhook-server_0.0.4',
          ],
          prerelease: 'alpha',
          expected: 'webhook-server_0.0.5-alpha.5',
          why: 'target 0.0.5 from stable 0.0.4; continue the alpha counter',
        },
        {
          name: 'promotes a prerelease series to a stable release',
          prefix: 'data-exporter_',
          lineage: [
            'data-exporter_0.0.9-alpha.3',
            'data-exporter_0.0.9-RC.0',
            'data-exporter_0.0.8',
          ],
          prerelease: false,
          expected: 'data-exporter_0.0.9',
          why: 'a release run ignores the prerelease series and bumps the stable tag',
        },
        {
          name: 'starts an RC series from a stable tag',
          prefix: 'cache-svc_',
          lineage: [
            'cache-svc_0.0.6',
            'cache-svc_0.0.6-alpha.1',
            'cache-svc_0.0.6-RC.0',
          ],
          prerelease: 'RC',
          expected: 'cache-svc_0.0.7-RC.0',
          why: 'the newest RC (0.0.6-RC.0) is not on target 0.0.7, so restart at .0',
        },
        {
          name: 'switches identifier mid-version without inheriting the other series',
          prefix: 'cache-svc_',
          lineage: [
            'cache-svc_0.0.7-RC.0',
            'cache-svc_0.0.6',
            'cache-svc_0.0.6-alpha.1',
          ],
          prerelease: 'alpha',
          expected: 'cache-svc_0.0.7-alpha.0',
          why: 'an alpha run must not continue the RC series; identifiers are separate',
        },
        {
          name: 'starts an alpha series for the next patch after a release',
          prefix: 'record-sync_',
          lineage: [
            'record-sync_0.0.17',
            'record-sync_0.0.17-alpha.3',
            'record-sync_0.0.17-RC.0',
            'record-sync_0.0.16',
          ],
          prerelease: 'alpha',
          expected: 'record-sync_0.0.18-alpha.0',
          why: 'target moves to 0.0.18, so the 0.0.17 alpha series does not apply',
        },
        {
          name: 'continues an alpha series in a lineage that has no stable tag yet',
          prefix: 'web-app_',
          lineage: [
            'web-app_0.0.1-alpha.2',
            'web-app_0.0.1-alpha.1',
            'web-app_0.0.1-alpha.0',
          ],
          prerelease: 'alpha',
          expected: 'web-app_0.0.1-alpha.3',
          why: 'no stable tag, so initial_version drives target 0.0.1 and the series continues',
        },
      ];

      it.each(CASES)('$name ($prefix): $why', async (testCase) => {
        setInputs({
          bump_strategy: 'string-token',
          token_match_mode: 'substring',
          default_bump: 'patch',
          release_branches: '^main$',
          fetch_all_tags: 'true',
          tag_prefix: testCase.prefix,
          pre_release: testCase.prerelease ? 'true' : 'false',
          append_to_pre_release_tag: testCase.prerelease || '',
        });
        setBranch(testCase.prerelease ? 'test' : 'main');
        listTagsMock.mockImplementation(async () =>
          testCase.lineage.map((name) => ({
            name,
            commit: { sha: `sha-${name}` },
          })),
        );
        getCommitsMock.mockImplementation(async () => REAL_COMMITS);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          testCase.expected,
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
        expect(mockSetFailed).not.toHaveBeenCalled();
      });

      it('isolates all eleven production lineages from each other', async () => {
        // Every service prefix in use across both repos, with their real latest
        // tags in one list - the shape getValidTags actually sees, since tags are
        // repository-global.
        const productionTags = [
          'job-runner_0.0.4',
          'record-sync_0.0.17',
          'data-exporter_0.0.9',
          'webhook-server_0.0.5',
          'cache-svc_0.0.7',
          'public-svc_0.0.1',
          'event-processor_0.0.1',
          'metrics-exporter_0.0.7',
          'ledger-sync_0.0.11',
          'web-app_0.0.1',
          'gateway_0.0.1',
          // Bare tags that belong to no service lineage.
          '0.0.2-alpha.5',
        ];
        const expectations: [string, string][] = [
          ['job-runner_', 'job-runner_0.0.5'],
          ['record-sync_', 'record-sync_0.0.18'],
          ['data-exporter_', 'data-exporter_0.0.10'],
          ['webhook-server_', 'webhook-server_0.0.6'],
          ['cache-svc_', 'cache-svc_0.0.8'],
          ['public-svc_', 'public-svc_0.0.2'],
          ['event-processor_', 'event-processor_0.0.2'],
          ['metrics-exporter_', 'metrics-exporter_0.0.8'],
          ['ledger-sync_', 'ledger-sync_0.0.12'],
          ['web-app_', 'web-app_0.0.2'],
          ['gateway_', 'gateway_0.0.2'],
        ];

        for (const [prefix, expected] of expectations) {
          jest.clearAllMocks();
          getValidTagsMock.mockImplementation(realUtils.getValidTags);
          filterTagsByBranchAncestryMock.mockImplementation(
            async (tags: unknown) => tags,
          );
          mockCreateTag.mockResolvedValue(undefined);
          clearInputs();
          loadDefaultInputs();
          setInputs({
            bump_strategy: 'string-token',
            token_match_mode: 'substring',
            default_bump: 'patch',
            release_branches: '^main$',
            fetch_all_tags: 'true',
            tag_prefix: prefix,
            pre_release: 'false',
          });
          setBranch('main');
          listTagsMock.mockImplementation(async () =>
            productionTags.map((name) => ({
              name,
              commit: { sha: `sha-${name}` },
            })),
          );
          getCommitsMock.mockImplementation(async () => REAL_COMMITS);

          await action();

          expect(mockCreateTag).toHaveBeenCalledWith(
            expected,
            expect.any(Boolean),
            false,
            expect.any(String),
            true,
            '',
          );
        }
      });

      it('finds the latest tag of a lineage in a list of production size', async () => {
        // container-services really has 270 tags across 9 lineages, which is why
        // the shim pins fetch_all_tags: true - three lineages had no tag at all in
        // the first 100-tag API page. Given the whole list, the newest tag of the
        // target lineage must still win regardless of position.
        const noise: string[] = [];
        for (let v = 1; v <= 17; v++) {
          for (const svc of [
            'record-sync_',
            'data-exporter_',
            'ledger-sync_',
          ]) {
            noise.push(`${svc}0.0.${v}`);
            noise.push(`${svc}0.0.${v}-alpha.0`);
            noise.push(`${svc}0.0.${v}-RC.0`);
          }
        }
        noise.push('ledger-sync_0.0.18');
        expect(noise.length).toBeGreaterThan(100);

        setInputs({
          bump_strategy: 'string-token',
          token_match_mode: 'substring',
          default_bump: 'patch',
          release_branches: '^main$',
          fetch_all_tags: 'true',
          tag_prefix: 'ledger-sync_',
          pre_release: 'false',
        });
        setBranch('main');
        listTagsMock.mockImplementation(async () =>
          noise.map((name) => ({ name, commit: { sha: `sha-${name}` } })),
        );
        getCommitsMock.mockImplementation(async () => REAL_COMMITS);

        await action();

        expect(mockCreateTag).toHaveBeenCalledWith(
          'ledger-sync_0.0.19',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });

      it('does not detect a bump token in representative real commit messages', async () => {
        // Not one of the 1420 real commit messages sampled from these repos
        // contains #major/#minor/#patch/#none, so these pipelines depend entirely
        // on default_bump. This pins that: a stray token match here would silently
        // change every service's versioning.
        setInputs({
          bump_strategy: 'string-token',
          token_match_mode: 'substring',
          default_bump: 'patch',
          release_branches: '^main$',
          tag_prefix: 'ledger-sync_',
          pre_release: 'false',
        });
        setBranch('main');
        listTagsMock.mockImplementation(async () => [
          { name: 'ledger-sync_0.0.11', commit: { sha: 'sha' } },
        ]);
        getCommitsMock.mockImplementation(async () => [
          ...REAL_COMMITS,
          {
            message: 'Merge pull request #1234 from example-org/dependabot/pip',
            hash: null,
          },
          {
            message: 'PROJ-1235 initialize ledger-sync project',
            hash: null,
          },
          {
            message: 'chore(deps): bump urllib3 from 2.2.1 to 2.2.2',
            hash: null,
          },
        ]);

        await action();

        expect(mockSetOutput).toHaveBeenCalledWith('release_type', 'patch');
        expect(mockCreateTag).toHaveBeenCalledWith(
          'ledger-sync_0.0.12',
          expect.any(Boolean),
          false,
          expect.any(String),
          true,
          '',
        );
      });
    });
  });
});

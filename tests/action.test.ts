import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import {
  clearInputs,
  loadDefaultInputs,
  setBranch,
  setCommitSha,
  setInput,
  setRepository,
} from './helper.test';

const realUtils: any = await import('../src/utils.js?real');
const getCommitsMock = jest.fn();
const getValidTagsMock = jest.fn();

jest.unstable_mockModule('../src/utils.js', () => ({
  ...realUtils,
  getCommits: getCommitsMock,
  getValidTags: getValidTagsMock,
}));

const listTagsMock = jest.fn();
const mockCreateTag = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../src/github.js', () => ({
  listTags: listTagsMock,
  createTag: mockCreateTag,
}));

const realCore: any = await import('@actions/core?real');
const mockSetOutput = jest.fn();
const mockSetFailed = jest.fn();

jest.unstable_mockModule('@actions/core', () => ({
  ...realCore,
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
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
        'Missing commit_sha or GITHUB_SHA.'
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create initial tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create patch tag without commits', async () => {
      /*
       * Given
       */
      const commits: any[] = [];
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('propagates a getCommits failure as a real failure (does not fabricate an empty commit range)', async () => {
      /*
       * Given
       */
      getCommitsMock
        .mockRejectedValue(
          new Error('Sorry, this diff is taking too long to generate.')
        );

      const validTags: any[] = [];
      listTagsMock.mockImplementation(async () => validTags);

      /*
       * When / Then
       */
      await expect(action()).rejects.toThrow(
        'Sorry, this diff is taking too long to generate.'
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create a tag, but does not push the tag', async () => {
      /*
       * Given
       */
      setInput('push_tag', 'false');
      const commits: any[] = [];
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        false
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create prerelease tag', async () => {
      /*
       * Given
       */
      setInput('default_prerelease_bump', 'prerelease');
      const commits = [{ message: 'this is my first fix', hash: null }];
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    /** 1.3.0 commit =[minor, minor, prerelease]=> 1.4.0-pre.0 */
    it('does create prerelease tag respecting default_draft_bump', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    /** 1.3.0-pre.0 + commit =[minor, minor, prerelease]=> 1.3.0-pre.1 */
    it('does update prerelease tag respecting default_draft_bump', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    /** 1.3.0-pre.0 + commit =[minor, minor, preminor]=> 1.4.0-pre.0 */
    it('does update prerelease tag with preminor', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'this is a commit', hash: null }];
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create prepatch tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
        true
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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
      getCommitsMock
        .mockImplementation(async (sha) => commits);

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
      getValidTagsMock
        .mockImplementation(async () => validTags);

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
});

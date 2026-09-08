import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const listTagsMock = jest.fn();
const compareCommitsMock = jest.fn();
const execMock = jest.fn();

jest.unstable_mockModule('@actions/github', () => ({
  context: { repo: { owner: 'mock-owner', repo: 'mock-repo' } },
  getOctokit: jest.fn().mockReturnValue({
    rest: {
      repos: {
        listTags: listTagsMock,
        compareCommits: compareCommitsMock,
      },
    },
  }),
}));

jest.unstable_mockModule('@actions/exec', () => ({
  exec: (...args: unknown[]) => execMock(...args),
}));

const { listTags, compareCommits } = await import('../src/github.js');

describe('github', () => {
  beforeEach(() => {
    listTagsMock.mockReset();
    listTagsMock.mockImplementation(({ page }: { page: number }) => {
      if (page === 6) {
        return { data: [] };
      }

      const res = [...new Array(100).keys()].map((_) => ({
        name: `v0.0.${_ + (page - 1) * 100}`,
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      }));

      return { data: res };
    });
  });

  it('returns all tags', async () => {
    const tags = await listTags(true);

    expect(tags.length).toEqual(500);
    expect(tags[499]).toEqual({
      name: 'v0.0.499',
      commit: { sha: 'string', url: 'string' },
      zipball_url: 'string',
      tarball_url: 'string',
      node_id: 'string',
    });
  });

  it('returns only the last 100 tags', async () => {
    const tags = await listTags(true);

    expect(tags.length).toEqual(500);
    expect(tags[99]).toEqual({
      name: 'v0.0.99',
      commit: { sha: 'string', url: 'string' },
      zipball_url: 'string',
      tarball_url: 'string',
      node_id: 'string',
    });
  });
});

describe('compareCommits', () => {
  beforeEach(() => {
    compareCommitsMock.mockReset();
    execMock.mockReset();
  });

  it('returns commits from the API on first success', async () => {
    compareCommitsMock.mockResolvedValue({
      data: {
        commits: [{ sha: 'abc', commit: { message: 'feat: thing' } }],
      },
    });

    const commits = await compareCommits('base', 'head');

    expect(commits).toEqual([
      { sha: 'abc', commit: { message: 'feat: thing' } },
    ]);
    expect(compareCommitsMock).toHaveBeenCalledTimes(1);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('retries transient 500-class API errors before succeeding', async () => {
    const serverError: any = new Error(
      'Server Error: Sorry, this diff is taking too long to generate.'
    );
    serverError.status = 500;

    compareCommitsMock
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce({
        data: { commits: [{ sha: 'def', commit: { message: 'fix: bug' } }] },
      });

    const commits = await compareCommits('base', 'head');

    expect(commits).toEqual([{ sha: 'def', commit: { message: 'fix: bug' } }]);
    expect(compareCommitsMock).toHaveBeenCalledTimes(2);
    expect(execMock).not.toHaveBeenCalled();
  }, 10000);

  it('falls back to local git log when the API keeps failing', async () => {
    const serverError: any = new Error(
      'Server Error: Sorry, this diff is taking too long to generate.'
    );
    serverError.status = 500;
    compareCommitsMock.mockRejectedValue(serverError);

    execMock.mockImplementation(
      (_cmd: string, _args: string[], options: any) => {
        options.listeners.stdout(
          Buffer.from(
            'sha1\x1fcommit message one\x1e\nsha2\x1fcommit message two\x1e\n'
          )
        );
        return Promise.resolve(0);
      }
    );

    const commits = await compareCommits('base', 'head');

    expect(commits).toEqual([
      { sha: 'sha1', commit: { message: 'commit message one' } },
      { sha: 'sha2', commit: { message: 'commit message two' } },
    ]);
  }, 10000);

  it('re-throws the original API error if the local git fallback also fails', async () => {
    const serverError: any = new Error(
      'Server Error: Sorry, this diff is taking too long to generate.'
    );
    serverError.status = 500;
    compareCommitsMock.mockRejectedValue(serverError);
    execMock.mockRejectedValue(new Error('fatal: bad revision'));

    await expect(compareCommits('base', 'head')).rejects.toThrow(
      'Sorry, this diff is taking too long to generate.'
    );
  }, 10000);

  it('does not retry or fall back to local git for non-retryable (e.g. 4xx) API errors', async () => {
    const authError: any = new Error('Bad credentials');
    authError.status = 401;
    compareCommitsMock.mockRejectedValue(authError);

    await expect(compareCommits('base', 'head')).rejects.toThrow(
      'Bad credentials'
    );
    expect(compareCommitsMock).toHaveBeenCalledTimes(1);
    expect(execMock).not.toHaveBeenCalled();
  });
});

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const listTagsMock = jest.fn();
const compareCommitsMock = jest.fn();
const getCommitMock = jest.fn();
const createTagMock = jest.fn();
const updateRefMock = jest.fn();
const createRefMock = jest.fn();
const execMock = jest.fn();

jest.unstable_mockModule('@actions/github', () => ({
  context: { repo: { owner: 'mock-owner', repo: 'mock-repo' } },
  getOctokit: jest.fn().mockReturnValue({
    rest: {
      repos: {
        listTags: listTagsMock,
        compareCommits: compareCommitsMock,
        getCommit: getCommitMock,
      },
      git: {
        createTag: createTagMock,
        updateRef: updateRefMock,
        createRef: createRefMock,
      },
    },
  }),
}));

jest.unstable_mockModule('@actions/exec', () => ({
  exec: (...args: unknown[]) => execMock(...args),
}));

const {
  listTags,
  compareCommits,
  compareCommitsViaLocalGit,
  isShallowRepository,
  listMergedTags,
  getCompareStatus,
  getLastCommit,
  getCommitRange,
  createTag,
} = await import('../src/github.js');

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

  it('forwards gitCwd to the local git fallback', async () => {
    const serverError: any = new Error('Server Error');
    serverError.status = 500;
    compareCommitsMock.mockRejectedValue(serverError);
    execMock.mockImplementation(
      (_cmd: string, _args: string[], options: any) => {
        options.listeners.stdout(Buffer.from(''));
        return Promise.resolve(0);
      }
    );

    await compareCommits('base', 'head', { gitCwd: '/repo/checkout' });

    expect(execMock).toHaveBeenCalledWith(
      'git',
      expect.any(Array),
      expect.objectContaining({ cwd: '/repo/checkout' })
    );
  }, 10000);
});

describe('compareCommitsViaLocalGit', () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it('defaults to ".." range when baseRef is provided', async () => {
    execMock.mockImplementation(
      (_cmd: string, args: string[], options: any) => {
        options.listeners.stdout(Buffer.from(''));
        return Promise.resolve(0);
      }
    );

    await compareCommitsViaLocalGit('base', 'head');

    expect(execMock).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['base..head']),
      expect.anything()
    );
  });

  it('uses headRef alone (no range) when baseRef is undefined', async () => {
    execMock.mockImplementation(
      (_cmd: string, args: string[], options: any) => {
        options.listeners.stdout(Buffer.from(''));
        return Promise.resolve(0);
      }
    );

    await compareCommitsViaLocalGit(undefined, 'head');

    expect(execMock).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['head']),
      expect.anything()
    );
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).not.toContain('..head');
  });
});

describe('isShallowRepository', () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it('returns true when git reports the repo is shallow', async () => {
    execMock.mockImplementation(
      (_cmd: string, _args: string[], options: any) => {
        options.listeners.stdout(Buffer.from('true\n'));
        return Promise.resolve(0);
      }
    );

    await expect(isShallowRepository()).resolves.toBe(true);
  });

  it('returns false when git reports the repo is not shallow', async () => {
    execMock.mockImplementation(
      (_cmd: string, _args: string[], options: any) => {
        options.listeners.stdout(Buffer.from('false\n'));
        return Promise.resolve(0);
      }
    );

    await expect(isShallowRepository()).resolves.toBe(false);
  });

  it('conservatively returns true when the git call fails', async () => {
    execMock.mockRejectedValue(new Error('not a git repository'));

    await expect(isShallowRepository()).resolves.toBe(true);
  });

  it('conservatively returns true on a non-zero exit code', async () => {
    execMock.mockImplementation(
      (_cmd: string, _args: string[], options: any) => {
        options.listeners.stdout(Buffer.from(''));
        return Promise.resolve(1);
      }
    );

    await expect(isShallowRepository()).resolves.toBe(true);
  });
});

describe('listMergedTags', () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it('parses tag names from git output', async () => {
    execMock.mockImplementation(
      (_cmd: string, _args: string[], options: any) => {
        options.listeners.stdout(Buffer.from('v1.0.0\nv1.1.0\n'));
        return Promise.resolve(0);
      }
    );

    await expect(listMergedTags('sha')).resolves.toEqual(['v1.0.0', 'v1.1.0']);
  });

  it('throws on a non-zero exit code', async () => {
    execMock.mockRejectedValue(new Error('fatal: bad revision'));

    await expect(listMergedTags('sha')).rejects.toThrow('fatal: bad revision');
  });
});

describe('getCompareStatus', () => {
  beforeEach(() => {
    compareCommitsMock.mockReset();
  });

  it('returns the compare API status field', async () => {
    compareCommitsMock.mockResolvedValue({
      data: { status: 'ahead', commits: [] },
    });

    await expect(getCompareStatus('base', 'head')).resolves.toBe('ahead');
  });
});

describe('getLastCommit', () => {
  beforeEach(() => {
    getCommitMock.mockReset();
  });

  it('maps the API response to the common commit shape', async () => {
    getCommitMock.mockResolvedValue({
      data: { sha: 'abc123', commit: { message: 'feat: thing' } },
    });

    await expect(getLastCommit('ref')).resolves.toEqual({
      sha: 'abc123',
      commit: { message: 'feat: thing' },
    });
  });
});

describe('getCommitRange', () => {
  beforeEach(() => {
    compareCommitsMock.mockReset();
    getCommitMock.mockReset();
    execMock.mockReset();
  });

  it('branch_history: last returns only the tagged commit via the API', async () => {
    getCommitMock.mockResolvedValue({
      data: { sha: 'headsha', commit: { message: 'feat: thing' } },
    });

    const commits = await getCommitRange('base', 'head', {
      branchHistory: 'last',
    });

    expect(commits).toEqual([
      { sha: 'headsha', commit: { message: 'feat: thing' } },
    ]);
    expect(compareCommitsMock).not.toHaveBeenCalled();
  });

  it('branch_history: full falls back to compare with a warning on a shallow checkout', async () => {
    execMock.mockImplementation(
      (_cmd: string, args: string[], options: any) => {
        if (args[0] === 'rev-parse') {
          options.listeners.stdout(Buffer.from('true\n'));
          return Promise.resolve(0);
        }
        options.listeners.stdout(Buffer.from(''));
        return Promise.resolve(0);
      }
    );
    compareCommitsMock.mockResolvedValue({
      data: { commits: [{ sha: 'x', commit: { message: 'fix: y' } }] },
    });

    const commits = await getCommitRange('base', 'head', {
      branchHistory: 'full',
    });

    expect(commits).toEqual([{ sha: 'x', commit: { message: 'fix: y' } }]);
  });

  it('branch_history: full uses local git narrowed to defaultBranch when it differs from currentBranch', async () => {
    execMock.mockImplementation(
      (_cmd: string, args: string[], options: any) => {
        if (args[0] === 'rev-parse') {
          options.listeners.stdout(Buffer.from('false\n'));
          return Promise.resolve(0);
        }
        options.listeners.stdout(
          Buffer.from('sha1\x1ffull log commit\x1e\n')
        );
        return Promise.resolve(0);
      }
    );

    const commits = await getCommitRange('base', 'head', {
      branchHistory: 'full',
      defaultBranch: 'main',
      currentBranch: 'feature',
    });

    expect(commits).toEqual([
      { sha: 'sha1', commit: { message: 'full log commit' } },
    ]);
    const logCall = execMock.mock.calls.find(
      (call) => call[1][0] === 'log'
    ) as any[];
    expect(logCall[1]).toContain('main..head');
  });

  it('branch_history: full uses no base ref when defaultBranch equals currentBranch', async () => {
    execMock.mockImplementation(
      (_cmd: string, args: string[], options: any) => {
        if (args[0] === 'rev-parse') {
          options.listeners.stdout(Buffer.from('false\n'));
          return Promise.resolve(0);
        }
        options.listeners.stdout(Buffer.from(''));
        return Promise.resolve(0);
      }
    );

    await getCommitRange('base', 'head', {
      branchHistory: 'full',
      defaultBranch: 'main',
      currentBranch: 'main',
    });

    const logCall = execMock.mock.calls.find(
      (call) => call[1][0] === 'log'
    ) as any[];
    expect(logCall[1]).toContain('head');
    expect(logCall[1]).not.toContain('main..head');
  });

  it('branch_history: full falls back to compare with a warning when git log fails', async () => {
    execMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse') {
        return Promise.resolve(0);
      }
      return Promise.reject(new Error('fatal: bad revision'));
    });
    compareCommitsMock.mockResolvedValue({
      data: { commits: [{ sha: 'x', commit: { message: 'fix: y' } }] },
    });

    const commits = await getCommitRange('base', 'head', {
      branchHistory: 'full',
    });

    expect(commits).toEqual([{ sha: 'x', commit: { message: 'fix: y' } }]);
  });

  it('branch_history: compare (default) behaves exactly like compareCommits', async () => {
    compareCommitsMock.mockResolvedValue({
      data: { commits: [{ sha: 'x', commit: { message: 'fix: y' } }] },
    });

    const commits = await getCommitRange('base', 'head', {});

    expect(commits).toEqual([{ sha: 'x', commit: { message: 'fix: y' } }]);
  });
});

describe('createTag', () => {
  beforeEach(() => {
    createTagMock.mockReset();
    updateRefMock.mockReset();
    createRefMock.mockReset();
    createTagMock.mockResolvedValue({ data: { sha: 'annotated-sha' } });
    updateRefMock.mockResolvedValue({});
    createRefMock.mockResolvedValue({});
  });

  it('uses tagMessage for the annotated tag object', async () => {
    await createTag('v1.0.0', true, false, 'sha', true, 'Release notes');

    expect(createTagMock).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.0.0', message: 'Release notes' })
    );
  });

  it('falls back to the tag name when tagMessage is not set', async () => {
    await createTag('v1.0.0', true, false, 'sha', true, '');

    expect(createTagMock).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.0.0', message: 'v1.0.0' })
    );
  });

  it('is ignored on lightweight tags (create_annotated_tag: false)', async () => {
    await createTag('v1.0.0', false, false, 'sha', true, 'Release notes');

    expect(createTagMock).not.toHaveBeenCalled();
    expect(createRefMock).toHaveBeenCalledWith(
      expect.objectContaining({ sha: 'sha' })
    );
  });
});

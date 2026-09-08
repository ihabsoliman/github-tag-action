import { context, getOctokit } from '@actions/github';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { Await } from './ts.js';

let octokitSingleton: ReturnType<typeof getOctokit>;

export type Tag = {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  zipball_url: string;
  tarball_url: string;
  node_id: string;
};

export type Tags = Await<ReturnType<typeof listTags>>;

export type GitOptions = {
  gitCwd?: string;
};

export type BranchHistory = 'compare' | 'last' | 'full';

export type CommitRangeOptions = GitOptions & {
  branchHistory?: BranchHistory;
  defaultBranch?: string;
  currentBranch?: string;
};

export type CompareStatus = 'diverged' | 'ahead' | 'behind' | 'identical';

export function getOctokitSingleton() {
  if (octokitSingleton) {
    return octokitSingleton;
  }
  const githubToken = core.getInput('github_token');
  octokitSingleton = getOctokit(githubToken);
  return octokitSingleton;
}

/**
 * Fetch all tags for a given repository recursively
 */
export async function listTags(
  shouldFetchAllTags = false,
  fetchedTags: Tag[] = [],
  page = 1,
): Promise<Tag[]> {
  const octokit = getOctokitSingleton();

  const tags = await octokit.rest.repos.listTags({
    ...context.repo,
    per_page: 100,
    page,
  });

  if (tags.data.length < 100 || shouldFetchAllTags === false) {
    return [...fetchedTags, ...tags.data];
  }

  return listTags(shouldFetchAllTags, [...fetchedTags, ...tags.data], page + 1);
}

type CommitLike = { sha: string; commit: { message: string } };

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const COMPARE_RETRY_ATTEMPTS = 3;
const COMPARE_RETRY_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether an error from the compare API looks transient (a 5xx server
 * error, or no HTTP response at all i.e. a network failure) as opposed to
 * a definitive client error (bad credentials, missing ref, etc.) that a
 * retry or a local-git fallback is very unlikely to fix, and that should
 * instead surface immediately rather than being silently worked around.
 */
function isRetryableError(error: any): boolean {
  const status = error?.status;
  return RETRYABLE_STATUS_CODES.has(status) || status === undefined;
}

/**
 * Sentinel `commit.sha` `getLatestTag` returns when no previous tag
 * exists, meaning "there's nothing to diff against - the whole history up
 * to `headRef` is the release." Not a real git ref; `compareCommits`
 * special-cases it instead of ever sending it to the compare API (which
 * would resolve the literal string "HEAD" to the current tip and diff it
 * against itself, silently reporting zero commits).
 */
export const NO_PREVIOUS_TAG_SHA = 'HEAD';

/**
 * Retry `fn` a few times on transient errors (see `isRetryableError`),
 * with a fixed delay between attempts. Shared by the compare and
 * list-all-commits API calls.
 */
async function withRetries<T>(fn: (attempt: number) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= COMPARE_RETRY_ATTEMPTS; attempt++) {
    core.debug(`API attempt ${attempt}/${COMPARE_RETRY_ATTEMPTS}`);
    try {
      return await fn(attempt);
    } catch (error: any) {
      if (!isRetryableError(error) || attempt === COMPARE_RETRY_ATTEMPTS) {
        throw error;
      }

      core.debug(
        `API call failed (attempt ${attempt}/${COMPARE_RETRY_ATTEMPTS}): ${error?.message}. Retrying in ${COMPARE_RETRY_DELAY_MS}ms.`,
      );
      await sleep(COMPARE_RETRY_DELAY_MS);
    }
  }

  // Unreachable, satisfies TS control-flow analysis.
  throw new Error('Unreachable');
}

/**
 * Compare `headRef` to `baseRef` via the GitHub compare API, retrying a
 * few times on transient server errors (e.g. "Sorry, this diff is taking
 * too long to generate."), which GitHub documents as generally resolving
 * itself on retry. Returns the full compare API response data (commits and
 * status), so callers needing either can share this one retry loop.
 * @param baseRef - old commit
 * @param headRef - new commit
 */
type CompareCommitsResponseData = Await<
  ReturnType<
    ReturnType<typeof getOctokitSingleton>['rest']['repos']['compareCommits']
  >
>['data'];

async function compareCommitsRequest(
  baseRef: string,
  headRef: string,
): Promise<CompareCommitsResponseData> {
  const octokit = getOctokitSingleton();

  // Logged at `info` (not `debug`) so the compare range is visible in a
  // normal run's output: a stray/misordered tag elsewhere in history can
  // make this span far more commits than expected (e.g. a one-off v1.0.0
  // tag sorting above an otherwise-continuous v0.x.y series), which is
  // otherwise invisible until the compare API times out with no context.
  core.info(`Comparing commits via API (${baseRef}...${headRef})`);

  return withRetries(async () => {
    const commits = await octokit.rest.repos.compareCommits({
      ...context.repo,
      base: baseRef,
      head: headRef,
    });

    return commits.data;
  });
}

/**
 * List every commit reachable from `headRef` via the GitHub API, oldest
 * first. Used instead of `compareCommitsViaApi` when there's no previous
 * tag to diff against (see `NO_PREVIOUS_TAG_SHA`) - the compare API always
 * needs two real refs, so "everything up to `headRef`" has to be a plain
 * listing instead of a diff.
 */
export async function listAllCommitsViaApi(
  headRef: string,
): Promise<CommitLike[]> {
  const octokit = getOctokitSingleton();

  core.info(
    `No previous tag found; listing all commits via API up to ${headRef}.`,
  );

  return withRetries(async () => {
    // listCommits is paginated newest-first; reverse to match the
    // oldest-first order compareCommits/compareCommitsViaLocalGit use.
    const commits = await octokit.paginate(octokit.rest.repos.listCommits, {
      ...context.repo,
      sha: headRef,
      per_page: 100,
    });

    return commits
      .map((commit) => ({
        sha: commit.sha,
        commit: { message: commit.commit.message },
      }))
      .reverse();
  });
}

/**
 * Compare `headRef` to `baseRef` via the GitHub compare API, retrying a
 * few times on transient server errors. See `compareCommitsRequest`.
 * @param baseRef - old commit
 * @param headRef - new commit
 */
export async function compareCommitsViaApi(
  baseRef: string,
  headRef: string,
): Promise<CommitLike[]> {
  const data = await compareCommitsRequest(baseRef, headRef);
  return data.commits;
}

/**
 * Get the GitHub compare API's `status` field (`ahead`/`behind`/
 * `identical`/`diverged`) for `baseRef` relative to `headRef`, without
 * discarding it the way `compareCommitsViaApi` does.
 */
export async function getCompareStatus(
  baseRef: string,
  headRef: string,
): Promise<CompareStatus> {
  const data = await compareCommitsRequest(baseRef, headRef);
  return data.status as CompareStatus;
}

/**
 * Fall back to the local git history to get commit hash/message pairs
 * between two refs, without calling the (sometimes flaky) GitHub compare
 * API. Requires both refs to be present in the local checkout (i.e. a
 * sufficiently deep/unshallow clone) - callers should be prepared for this
 * to throw if that's not the case.
 */
export async function compareCommitsViaLocalGit(
  baseRef: string | undefined,
  headRef: string,
  options: GitOptions = {},
): Promise<CommitLike[]> {
  const range = baseRef ? `${baseRef}..${headRef}` : headRef;
  core.info(`Comparing commits via local git (${range})`);

  const RECORD_SEP = '\x1e';
  const FIELD_SEP = '\x1f';
  let output = '';

  await exec.exec(
    'git',
    [
      'log',
      '--reverse',
      range,
      `--pretty=format:%H${FIELD_SEP}%B${RECORD_SEP}`,
    ],
    {
      silent: true,
      cwd: options.gitCwd,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
    },
  );

  return output
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, message] = record.split(FIELD_SEP);
      return { sha, commit: { message } };
    });
}

/**
 * Whether the local checkout at `gitCwd` is a shallow clone. Any failure
 * (e.g. not a git repository at all) is conservatively treated as shallow,
 * so callers fall back to the GitHub API instead of trusting incomplete
 * local history.
 */
export async function isShallowRepository(gitCwd?: string): Promise<boolean> {
  let output = '';
  try {
    const exitCode = await exec.exec(
      'git',
      ['rev-parse', '--is-shallow-repository'],
      {
        silent: true,
        cwd: gitCwd,
        ignoreReturnCode: true,
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString();
          },
        },
      },
    );
    if (exitCode !== 0) {
      return true;
    }
  } catch {
    return true;
  }
  return output.trim() === 'true';
}

/**
 * List the names of every tag that is an ancestor of `sha` in the local
 * checkout at `gitCwd`. Throws on failure (e.g. not a git repository) -
 * callers decide what to do (typically fall back to the API).
 */
export async function listMergedTags(
  sha: string,
  gitCwd?: string,
): Promise<string[]> {
  let output = '';
  await exec.exec('git', ['tag', '--list', '--merged', sha], {
    silent: true,
    cwd: gitCwd,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Fetch a single commit via the GitHub API, mapped to the same
 * `{sha, commit: {message}}` shape used elsewhere.
 */
export async function getLastCommit(ref: string): Promise<CommitLike> {
  const octokit = getOctokitSingleton();
  const { data } = await octokit.rest.repos.getCommit({
    ...context.repo,
    ref,
  });
  return { sha: data.sha, commit: { message: data.commit.message } };
}

/**
 * Compare `headRef` to `baseRef` (i.e. baseRef...headRef). Tries the GitHub
 * compare API first (with retries), then - only for the same class of
 * transient/retryable errors - falls back to a local `git log` so a
 * transient GitHub-side compare failure doesn't fail the whole tag push
 * (see the "Sorry, this diff is taking too long to generate." error).
 * Definitive client errors (bad credentials, invalid ref, etc.) are
 * re-thrown immediately without attempting the local-git fallback, since
 * that's very unlikely to help and risks silently proceeding with the
 * wrong commit range instead of surfacing a real configuration problem.
 * @param baseRef - old commit
 * @param headRef - new commit
 */
export async function compareCommits(
  baseRef: string,
  headRef: string,
  options: GitOptions = {},
): Promise<CommitLike[]> {
  const isFirstRelease = baseRef === NO_PREVIOUS_TAG_SHA;

  try {
    return isFirstRelease
      ? await listAllCommitsViaApi(headRef)
      : await compareCommitsViaApi(baseRef, headRef);
  } catch (apiError: any) {
    if (!isRetryableError(apiError)) {
      throw apiError;
    }

    core.warning(
      `Falling back to local git log after compare API failure: ${apiError?.message}`,
    );
    try {
      return await compareCommitsViaLocalGit(
        isFirstRelease ? undefined : baseRef,
        headRef,
        options,
      );
    } catch (gitError: any) {
      core.warning(
        `Local git log fallback also failed: ${gitError?.message}. Re-throwing original API error.`,
      );
      throw apiError;
    }
  }
}

/**
 * Dispatch the commit range for `branch_history`:
 * - `last` - only the tagged commit itself, via the API (no local git).
 * - `full` - every commit reachable from `headRef`, narrowed to
 *   `defaultBranch..headRef` when `defaultBranch` is set and differs from
 *   `currentBranch`. Requires local git; falls back to `compare` with a
 *   warning on a shallow checkout or any `git log` failure.
 * - anything else (including `compare`) - the existing API-first/local-git
 *   fallback compare behaviour.
 */
export async function getCommitRange(
  baseRef: string,
  headRef: string,
  options: CommitRangeOptions = {},
): Promise<CommitLike[]> {
  const { branchHistory, defaultBranch, currentBranch, ...gitOptions } =
    options;

  if (branchHistory === 'last') {
    return [await getLastCommit(headRef)];
  }

  if (branchHistory === 'full') {
    if (await isShallowRepository(gitOptions.gitCwd)) {
      core.warning(
        'branch_history: full requires a full clone (fetch-depth: 0); the checkout is shallow. Falling back to compare.',
      );
      return compareCommits(baseRef, headRef, gitOptions);
    }

    const fullBase =
      defaultBranch && defaultBranch !== currentBranch
        ? defaultBranch
        : undefined;

    try {
      return await compareCommitsViaLocalGit(fullBase, headRef, gitOptions);
    } catch (error: any) {
      core.warning(
        `branch_history: full failed to read local git history: ${error?.message}. Falling back to compare.`,
      );
      return compareCommits(baseRef, headRef, gitOptions);
    }
  }

  return compareCommits(baseRef, headRef, gitOptions);
}

export async function createTag(
  newTag: string,
  createAnnotatedTag: boolean,
  update: boolean,
  GITHUB_SHA: string,
  pushTag: boolean = true,
  tagMessage: string = '',
) {
  const octokit = getOctokitSingleton();
  let annotatedTag:
    Await<ReturnType<typeof octokit.rest.git.createTag>> | undefined =
    undefined;
  if (createAnnotatedTag) {
    core.debug(`Creating annotated tag.`);
    annotatedTag = await octokit.rest.git.createTag({
      ...context.repo,
      tag: newTag,
      message: tagMessage || newTag,
      object: GITHUB_SHA,
      type: 'commit',
    });
  }

  if (!pushTag) {
    core.debug(`Tag was not pushed to remote`);
  } else if (update) {
    core.info(`Updating existing tag ${newTag} on the repo.`);
    await octokit.rest.git.updateRef({
      ...context.repo,
      ref: `tags/${newTag}`,
      sha: annotatedTag ? annotatedTag.data.sha : GITHUB_SHA,
      force: true,
    });
  } else {
    core.info(`Pushing new tag to the repo.`);
    await octokit.rest.git.createRef({
      ...context.repo,
      ref: `refs/tags/${newTag}`,
      sha: annotatedTag ? annotatedTag.data.sha : GITHUB_SHA,
    });
  }
}

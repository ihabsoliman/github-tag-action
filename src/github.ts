import { context, getOctokit } from '@actions/github';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { Await } from './ts';

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
  page = 1
): Promise<Tag[]> {
  const octokit = getOctokitSingleton();

  const tags = await octokit.repos.listTags({
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
 * Compare `headRef` to `baseRef` via the GitHub compare API, retrying a
 * few times on transient server errors (e.g. "Sorry, this diff is taking
 * too long to generate."), which GitHub documents as generally resolving
 * itself on retry.
 * @param baseRef - old commit
 * @param headRef - new commit
 */
export async function compareCommitsViaApi(
  baseRef: string,
  headRef: string
): Promise<CommitLike[]> {
  const octokit = getOctokitSingleton();

  for (let attempt = 1; attempt <= COMPARE_RETRY_ATTEMPTS; attempt++) {
    core.debug(
      `Comparing commits via API (${baseRef}...${headRef}), attempt ${attempt}/${COMPARE_RETRY_ATTEMPTS}`
    );
    try {
      const commits = await octokit.repos.compareCommits({
        ...context.repo,
        base: baseRef,
        head: headRef,
      });

      return commits.data.commits;
    } catch (error: any) {
      const status = error?.status;
      const isRetryable =
        RETRYABLE_STATUS_CODES.has(status) || status === undefined;

      if (!isRetryable || attempt === COMPARE_RETRY_ATTEMPTS) {
        throw error;
      }

      core.warning(
        `compareCommits API call failed (attempt ${attempt}/${COMPARE_RETRY_ATTEMPTS}): ${error?.message}. Retrying in ${COMPARE_RETRY_DELAY_MS}ms.`
      );
      await sleep(COMPARE_RETRY_DELAY_MS);
    }
  }

  // Unreachable, satisfies TS control-flow analysis.
  return [];
}

/**
 * Fall back to the local git history to get commit hash/message pairs
 * between two refs, without calling the (sometimes flaky) GitHub compare
 * API. Requires both refs to be present in the local checkout (i.e. a
 * sufficiently deep/unshallow clone) - callers should be prepared for this
 * to throw if that's not the case.
 */
export async function compareCommitsViaLocalGit(
  baseRef: string,
  headRef: string
): Promise<CommitLike[]> {
  core.debug(`Comparing commits via local git (${baseRef}...${headRef})`);

  const RECORD_SEP = '\x1e';
  const FIELD_SEP = '\x1f';
  let output = '';

  await exec.exec(
    'git',
    [
      'log',
      `${baseRef}..${headRef}`,
      `--pretty=format:%H${FIELD_SEP}%B${RECORD_SEP}`,
    ],
    {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
    }
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
 * Compare `headRef` to `baseRef` (i.e. baseRef...headRef). Tries the GitHub
 * compare API first (with retries), then falls back to a local `git log`
 * so a transient GitHub-side compare failure doesn't fail the whole tag
 * push (see the "Sorry, this diff is taking too long to generate." error).
 * @param baseRef - old commit
 * @param headRef - new commit
 */
export async function compareCommits(
  baseRef: string,
  headRef: string
): Promise<CommitLike[]> {
  try {
    return await compareCommitsViaApi(baseRef, headRef);
  } catch (apiError: any) {
    core.warning(
      `Falling back to local git log after compare API failure: ${apiError?.message}`
    );
    try {
      return await compareCommitsViaLocalGit(baseRef, headRef);
    } catch (gitError: any) {
      core.warning(
        `Local git log fallback also failed: ${gitError?.message}. Re-throwing original API error.`
      );
      throw apiError;
    }
  }
}

export async function createTag(
  newTag: string,
  createAnnotatedTag: boolean,
  update: boolean,
  GITHUB_SHA: string,
  pushTag: boolean = true
) {
  const octokit = getOctokitSingleton();
  let annotatedTag:
    | Await<ReturnType<typeof octokit.git.createTag>>
    | undefined = undefined;
  if (createAnnotatedTag) {
    core.debug(`Creating annotated tag.`);
    annotatedTag = await octokit.git.createTag({
      ...context.repo,
      tag: newTag,
      message: newTag,
      object: GITHUB_SHA,
      type: 'commit',
    });
  }

  if (!pushTag) {
    core.debug(`Tag was not pushed to remote`);
  } else if (update) {
    core.info(`Updating existing tag ${newTag} on the repo.`);
    await octokit.git.updateRef({
      ...context.repo,
      ref: `tags/${newTag}`,
      sha: annotatedTag ? annotatedTag.data.sha : GITHUB_SHA,
      force: true,
    });
  } else {
    core.info(`Pushing new tag to the repo.`);
    await octokit.git.createRef({
      ...context.repo,
      ref: `refs/tags/${newTag}`,
      sha: annotatedTag ? annotatedTag.data.sha : GITHUB_SHA,
    });
  }
}

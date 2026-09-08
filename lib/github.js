import { context, getOctokit } from '@actions/github';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
let octokitSingleton;
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
export async function listTags(shouldFetchAllTags = false, fetchedTags = [], page = 1) {
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
const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const COMPARE_RETRY_ATTEMPTS = 3;
const COMPARE_RETRY_DELAY_MS = 2000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Whether an error from the compare API looks transient (a 5xx server
 * error, or no HTTP response at all i.e. a network failure) as opposed to
 * a definitive client error (bad credentials, missing ref, etc.) that a
 * retry or a local-git fallback is very unlikely to fix, and that should
 * instead surface immediately rather than being silently worked around.
 */
function isRetryableError(error) {
    const status = error?.status;
    return RETRYABLE_STATUS_CODES.has(status) || status === undefined;
}
async function compareCommitsRequest(baseRef, headRef) {
    const octokit = getOctokitSingleton();
    // Logged at `info` (not `debug`) so the compare range is visible in a
    // normal run's output: a stray/misordered tag elsewhere in history can
    // make this span far more commits than expected (e.g. a one-off v1.0.0
    // tag sorting above an otherwise-continuous v0.x.y series), which is
    // otherwise invisible until the compare API times out with no context.
    core.info(`Comparing commits via API (${baseRef}...${headRef})`);
    for (let attempt = 1; attempt <= COMPARE_RETRY_ATTEMPTS; attempt++) {
        core.debug(`Compare API attempt ${attempt}/${COMPARE_RETRY_ATTEMPTS}`);
        try {
            const commits = await octokit.rest.repos.compareCommits({
                ...context.repo,
                base: baseRef,
                head: headRef,
            });
            return commits.data;
        }
        catch (error) {
            const isRetryable = isRetryableError(error);
            if (!isRetryable || attempt === COMPARE_RETRY_ATTEMPTS) {
                throw error;
            }
            core.debug(`compareCommits API call failed (attempt ${attempt}/${COMPARE_RETRY_ATTEMPTS}): ${error?.message}. Retrying in ${COMPARE_RETRY_DELAY_MS}ms.`);
            await sleep(COMPARE_RETRY_DELAY_MS);
        }
    }
    // Unreachable, satisfies TS control-flow analysis.
    throw new Error('Unreachable');
}
/**
 * Compare `headRef` to `baseRef` via the GitHub compare API, retrying a
 * few times on transient server errors. See `compareCommitsRequest`.
 * @param baseRef - old commit
 * @param headRef - new commit
 */
export async function compareCommitsViaApi(baseRef, headRef) {
    const data = await compareCommitsRequest(baseRef, headRef);
    return data.commits;
}
/**
 * Get the GitHub compare API's `status` field (`ahead`/`behind`/
 * `identical`/`diverged`) for `baseRef` relative to `headRef`, without
 * discarding it the way `compareCommitsViaApi` does.
 */
export async function getCompareStatus(baseRef, headRef) {
    const data = await compareCommitsRequest(baseRef, headRef);
    return data.status;
}
/**
 * Fall back to the local git history to get commit hash/message pairs
 * between two refs, without calling the (sometimes flaky) GitHub compare
 * API. Requires both refs to be present in the local checkout (i.e. a
 * sufficiently deep/unshallow clone) - callers should be prepared for this
 * to throw if that's not the case.
 */
export async function compareCommitsViaLocalGit(baseRef, headRef, options = {}) {
    const range = baseRef ? `${baseRef}..${headRef}` : headRef;
    core.info(`Comparing commits via local git (${range})`);
    const RECORD_SEP = '\x1e';
    const FIELD_SEP = '\x1f';
    let output = '';
    await exec.exec('git', [
        'log',
        '--reverse',
        range,
        `--pretty=format:%H${FIELD_SEP}%B${RECORD_SEP}`,
    ], {
        silent: true,
        cwd: options.gitCwd,
        listeners: {
            stdout: (data) => {
                output += data.toString();
            },
        },
    });
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
export async function isShallowRepository(gitCwd) {
    let output = '';
    try {
        const exitCode = await exec.exec('git', ['rev-parse', '--is-shallow-repository'], {
            silent: true,
            cwd: gitCwd,
            ignoreReturnCode: true,
            listeners: {
                stdout: (data) => {
                    output += data.toString();
                },
            },
        });
        if (exitCode !== 0) {
            return true;
        }
    }
    catch {
        return true;
    }
    return output.trim() === 'true';
}
/**
 * List the names of every tag that is an ancestor of `sha` in the local
 * checkout at `gitCwd`. Throws on failure (e.g. not a git repository) -
 * callers decide what to do (typically fall back to the API).
 */
export async function listMergedTags(sha, gitCwd) {
    let output = '';
    await exec.exec('git', ['tag', '--list', '--merged', sha], {
        silent: true,
        cwd: gitCwd,
        listeners: {
            stdout: (data) => {
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
export async function getLastCommit(ref) {
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
export async function compareCommits(baseRef, headRef, options = {}) {
    try {
        return await compareCommitsViaApi(baseRef, headRef);
    }
    catch (apiError) {
        if (!isRetryableError(apiError)) {
            throw apiError;
        }
        core.warning(`Falling back to local git log after compare API failure: ${apiError?.message}`);
        try {
            return await compareCommitsViaLocalGit(baseRef, headRef, options);
        }
        catch (gitError) {
            core.warning(`Local git log fallback also failed: ${gitError?.message}. Re-throwing original API error.`);
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
export async function getCommitRange(baseRef, headRef, options = {}) {
    const { branchHistory, defaultBranch, currentBranch, ...gitOptions } = options;
    if (branchHistory === 'last') {
        return [await getLastCommit(headRef)];
    }
    if (branchHistory === 'full') {
        if (await isShallowRepository(gitOptions.gitCwd)) {
            core.warning('branch_history: full requires a full clone (fetch-depth: 0); the checkout is shallow. Falling back to compare.');
            return compareCommits(baseRef, headRef, gitOptions);
        }
        const fullBase = defaultBranch && defaultBranch !== currentBranch
            ? defaultBranch
            : undefined;
        try {
            return await compareCommitsViaLocalGit(fullBase, headRef, gitOptions);
        }
        catch (error) {
            core.warning(`branch_history: full failed to read local git history: ${error?.message}. Falling back to compare.`);
            return compareCommits(baseRef, headRef, gitOptions);
        }
    }
    return compareCommits(baseRef, headRef, gitOptions);
}
export async function createTag(newTag, createAnnotatedTag, update, GITHUB_SHA, pushTag = true, tagMessage = '') {
    const octokit = getOctokitSingleton();
    let annotatedTag = undefined;
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
    }
    else if (update) {
        core.info(`Updating existing tag ${newTag} on the repo.`);
        await octokit.rest.git.updateRef({
            ...context.repo,
            ref: `tags/${newTag}`,
            sha: annotatedTag ? annotatedTag.data.sha : GITHUB_SHA,
            force: true,
        });
    }
    else {
        core.info(`Pushing new tag to the repo.`);
        await octokit.rest.git.createRef({
            ...context.repo,
            ref: `refs/tags/${newTag}`,
            sha: annotatedTag ? annotatedTag.data.sha : GITHUB_SHA,
        });
    }
}

import * as core from '@actions/core';
import { prerelease, rcompare, valid } from 'semver';
import {
  CommitRangeOptions,
  getCommitRange,
  getCompareStatus,
  isShallowRepository,
  listMergedTags,
  NO_PREVIOUS_TAG_SHA,
  Tags,
} from './github.js';
import { defaultChangelogRules } from './defaults.js';
import { context } from '@actions/github';
import { minimatch } from 'minimatch';

const ANCESTRY_API_SCAN_LIMIT = 50;

// Release types supported by semver/npm, matching
// @semantic-release/commit-analyzer's own default-release-types constant
// (mirrored locally since that package no longer exposes it as a subpath
// import under its ESM-only exports map).
const DEFAULT_RELEASE_TYPES = [
  'major',
  'premajor',
  'minor',
  'preminor',
  'patch',
  'prepatch',
  'prerelease',
];

export async function getValidTags(tags: Tags, prefixRegex: RegExp) {
  const tagSearchPattern = core.getInput('tag_search_pattern');
  const invalidTags = tags.filter(
    (tag) =>
      !prefixRegex.test(tag.name) || !valid(tag.name.replace(prefixRegex, '')),
  );

  invalidTags.forEach((tag) => core.debug(`Found Invalid Tag: ${tag.name}.`));

  let validTags = tags
    .filter(
      (tag) =>
        prefixRegex.test(tag.name) && valid(tag.name.replace(prefixRegex, '')),
    )
    .sort((a, b) =>
      rcompare(
        a.name.replace(prefixRegex, ''),
        b.name.replace(prefixRegex, ''),
      ),
    );

  // Apply tag_search_pattern filtering if provided
  if (tagSearchPattern) {
    core.info(`Filtering tags with pattern: ${tagSearchPattern}`);
    validTags = validTags.filter((tag) => {
      const matches = minimatch(tag.name, tagSearchPattern);
      if (matches) {
        core.debug(`Tag ${tag.name} matches the pattern ${tagSearchPattern}`);
      }
      return matches;
    });

    if (validTags.length === 0) {
      core.warning(`No tags match the provided pattern: ${tagSearchPattern}`);
    }
  }

  validTags.forEach((tag) => core.debug(`Found Valid Tag: ${tag.name}.`));

  return validTags;
}
interface FinalCommit {
  sha: string | null;
  commit: {
    message: string;
  };
}

/** A commit as it appears in a `push` webhook payload. */
interface PushPayloadCommit {
  id?: string;
  message: string;
}

export type GetCommitsOptions = CommitRangeOptions & {
  /**
   * Skip the closed-PR payload fallback when the compare range is empty.
   *
   * The `string-token` bump strategy sets this: `entrypoint.sh` has no
   * equivalent fallback, and using one would diverge from it. Legacy's
   * `git log <tag_commit>..<HEAD>` on an already-tagged HEAD is simply empty,
   * which falls through to `default_bump`, whereas the payload fallback would
   * re-read the pushed commits and could find a token that legacy never saw.
   */
  skipClosedPrFallback?: boolean;
};

export async function getCommits(
  baseRef: string,
  headRef: string,
  options: GetCommitsOptions = {},
): Promise<{ message: string; hash: string | null }[]> {
  const { skipClosedPrFallback, ...rangeOptions } = options;
  let commits: Array<FinalCommit>;
  commits = await getCommitRange(baseRef, headRef, rangeOptions);
  core.info('We found ' + commits.length + ' commits using classic compare!');
  if (commits.length < 1 && !skipClosedPrFallback) {
    core.info(
      'We did not find enough commits, attempting to scan closed PR method.',
    );
    commits = getClosedPRCommits();
  }
  if (commits.length == 0) {
    return [];
  }

  return commits
    .filter((commit: FinalCommit) => !!commit.commit.message)
    .map((commit: FinalCommit) => ({
      message: commit.commit.message,
      hash: commit.sha,
    }));
}

function getClosedPRCommits() {
  let commits = Array<FinalCommit>();
  if (
    !('pull_request' in context.payload) &&
    Array.isArray(context.payload.commits)
  ) {
    core.debug('We are in a closed PR context continuing.');
    core.debug(JSON.stringify(context.payload.commits));
    let pr_commit_count = context.payload.commits.length;
    core.info(
      'We found ' + pr_commit_count + ' commits from the Closed PR method.',
    );
    // `push` payload commits are `{ id, message, author, ... }` - there is no
    // nested `.commit`, so they have to be normalised into `FinalCommit` shape
    // for the mapping below. Reading `commit.commit.message` directly here used
    // to throw; the bug went unnoticed because the second call was a `.filter`
    // (whose object literal is always truthy, so the original elements were
    // passed through untouched) rather than the intended `.map`.
    commits = context.payload.commits
      .filter((commit: PushPayloadCommit) => !!commit.message)
      .map((commit: PushPayloadCommit) => ({
        sha: commit.id ?? null,
        commit: { message: commit.message },
      }));
    core.debug(
      'After processing we are going to present ' +
        commits.length +
        ' commits!',
    );
  }
  return commits;
}

export function getBranchFromRef(ref: string) {
  return ref.replace('refs/heads/', '');
}

export function isPr(ref: string) {
  return ref.includes('refs/pull/');
}

export function getLatestTag(
  tags: Tags,
  prefixRegex: RegExp,
  tagPrefix: string,
  initialVersion: string = '0.0.0',
) {
  return (
    tags.find(
      (tag) =>
        prefixRegex.test(tag.name) &&
        !prerelease(tag.name.replace(prefixRegex, '')),
    ) || {
      name: `${tagPrefix}${initialVersion}`,
      commit: {
        sha: NO_PREVIOUS_TAG_SHA,
      },
    }
  );
}

export function getLatestPrereleaseTag(
  tags: Tags,
  identifier: string,
  prefixRegex: RegExp,
) {
  return tags
    .filter((tag) => prerelease(tag.name.replace(prefixRegex, '')))
    .find((tag) => tag.name.replace(prefixRegex, '').match(identifier));
}

/**
 * Restrict `tags` (already prefix-filtered/sorted newest-first, as returned
 * by `getValidTags`) to those that are ancestors of `sha`, for
 * `tag_context: branch`.
 *
 * Local-git-first: a shallow clone can't be trusted to answer ancestry
 * questions, so it's skipped entirely in that case. `git tag --list
 * --merged <sha>` answers the whole question in one call; an empty result
 * while `tags` is non-empty is treated as "tags were never fetched
 * locally" rather than "no ancestors", and falls back to the API.
 *
 * The API fallback scans `tags` newest-first, calling `getCompareStatus`
 * per tag (capped at `ANCESTRY_API_SCAN_LIMIT` calls) and stops at the
 * first non-prerelease ancestor found: anything older can never be
 * selected once a newer release ancestor exists, since callers pick
 * `max(latestTag, latestPrereleaseTag)`. Newer prerelease ancestors
 * encountered before that point are still collected.
 */
export async function filterTagsByBranchAncestry(
  tags: Tags,
  sha: string,
  prefixRegex: RegExp,
  options: { gitCwd?: string } = {},
): Promise<Tags> {
  if (tags.length === 0) {
    return tags;
  }

  if (!(await isShallowRepository(options.gitCwd))) {
    try {
      const mergedTagNames = await listMergedTags(sha, options.gitCwd);
      if (mergedTagNames.length > 0) {
        core.info(
          'tag_context: branch - using local git ancestry (git tag --list --merged).',
        );
        const mergedTagNameSet = new Set(mergedTagNames);
        return tags.filter((tag) => mergedTagNameSet.has(tag.name));
      }
      core.info(
        'tag_context: branch - local git reported no merged tags; falling back to the API scan (tags may never have been fetched locally).',
      );
    } catch (error: any) {
      core.warning(
        `tag_context: branch - local git ancestry check failed: ${error?.message}. Falling back to the API scan.`,
      );
    }
  } else {
    core.info(
      'tag_context: branch - checkout is shallow; using the API scan instead of local git.',
    );
  }

  core.info('tag_context: branch - scanning tags via the compare API.');
  const ancestorTags: Tags[number][] = [];
  let scans = 0;
  for (const tag of tags) {
    if (scans >= ANCESTRY_API_SCAN_LIMIT) {
      core.warning(
        `tag_context: branch - reached the API scan limit (${ANCESTRY_API_SCAN_LIMIT}); remaining tags were not checked.`,
      );
      break;
    }
    scans++;

    let status: Awaited<ReturnType<typeof getCompareStatus>>;
    try {
      status = await getCompareStatus(tag.commit.sha, sha);
    } catch (error: any) {
      core.warning(
        `tag_context: branch - ancestry check failed for tag ${tag.name}: ${error?.message}. Skipping.`,
      );
      continue;
    }

    const isAncestor = status === 'ahead' || status === 'identical';
    if (!isAncestor) {
      continue;
    }

    ancestorTags.push(tag);

    if (!prerelease(tag.name.replace(prefixRegex, ''))) {
      break;
    }
  }

  return ancestorTags;
}

export function mapCustomReleaseRules(customReleaseTypes: string) {
  const releaseRuleSeparator = ',';
  const releaseTypeSeparator = ':';

  return customReleaseTypes
    .split(releaseRuleSeparator)
    .filter((customReleaseRule) => {
      const parts = customReleaseRule.split(releaseTypeSeparator);

      if (parts.length < 2) {
        core.warning(
          `${customReleaseRule} is not a valid custom release definition.`,
        );
        return false;
      }

      const defaultRule = defaultChangelogRules[parts[0].toLowerCase()];
      if (customReleaseRule.length !== 3) {
        core.debug(
          `${customReleaseRule} doesn't mention the section for the changelog.`,
        );
        core.debug(
          defaultRule
            ? `Default section (${defaultRule.section}) will be used instead.`
            : "The commits matching this rule won't be included in the changelog.",
        );
      }

      if (!DEFAULT_RELEASE_TYPES.includes(parts[1])) {
        core.warning(`${parts[1]} is not a valid release type.`);
        return false;
      }

      return true;
    })
    .map((customReleaseRule) => {
      const [type, release, section] =
        customReleaseRule.split(releaseTypeSeparator);
      const defaultRule = defaultChangelogRules[type.toLowerCase()];

      return {
        type,
        release,
        section: section || defaultRule?.section,
      };
    });
}

export function mergeWithDefaultChangelogRules(
  mappedReleaseRules: ReturnType<typeof mapCustomReleaseRules> = [],
) {
  const mergedRules = mappedReleaseRules.reduce(
    (acc, curr) => ({
      ...acc,
      [curr.type]: curr,
    }),
    { ...defaultChangelogRules },
  );

  return Object.values(mergedRules).filter((rule) => !!rule.section);
}

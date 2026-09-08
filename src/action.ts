import * as core from '@actions/core';
import { CommitParser } from 'conventional-commits-parser';
import { gte, inc, parse, ReleaseType, SemVer, valid } from 'semver';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import createConventionalCommitsPreset from 'conventional-changelog-conventionalcommits';
import {
  filterTagsByBranchAncestry,
  getBranchFromRef,
  isPr,
  getCommits,
  getLatestPrereleaseTag,
  getLatestTag,
  getValidTags,
  mapCustomReleaseRules,
  mergeWithDefaultChangelogRules,
} from './utils.js';
import {
  BranchHistory,
  createTag,
  listTags,
  NO_PREVIOUS_TAG_SHA,
} from './github.js';
import {
  analyzeCommitsByStringToken,
  StringTokenResult,
  TOKEN_MATCH_MODES,
  TokenMatchMode,
} from './string-token.js';
import { Await } from './ts.js';

const TAG_CONTEXTS = ['repo', 'branch'] as const;
type TagContext = (typeof TAG_CONTEXTS)[number];

const BRANCH_HISTORIES: BranchHistory[] = ['compare', 'last', 'full'];

const BUMP_STRATEGIES = ['conventional-commits', 'string-token'] as const;
type BumpStrategy = (typeof BUMP_STRATEGIES)[number];

const DEFAULT_STRING_TOKENS = {
  major: '#major',
  minor: '#minor',
  patch: '#patch',
  none: '#none',
} as const;

export default async function main() {
  core.setOutput('tag_created', 'false');

  const defaultBump = core.getInput('default_bump') as ReleaseType | 'false';
  const forceBump = core.getInput('force_bump') as ReleaseType | 'false' | '';
  const defaultPreReleaseBump = core.getInput('default_prerelease_bump') as
    ReleaseType | 'false';
  const forcePreReleaseBump = core.getInput('force_prerelease_bump') as
    ReleaseType | 'false' | '';
  const defaultDraftBump =
    (core.getInput('default_draft_bump') as ReleaseType | 'false') ||
    defaultPreReleaseBump;
  const tagPrefix = core.getInput('tag_prefix');
  const customTag = core.getInput('custom_tag');
  const forceUpdate = /true/i.test(core.getInput('force_update'));
  const releaseBranches = core.getInput('release_branches');
  const preReleaseBranches = core.getInput('pre_release_branches');
  const scopes = core.getInput('scopes');
  const appendToPreReleaseTag = core.getInput('append_to_pre_release_tag');
  const createAnnotatedTag = /true/i.test(
    core.getInput('create_annotated_tag'),
  );
  const dryRun = core.getInput('dry_run');
  const customReleaseRules = core.getInput('custom_release_rules');
  const shouldFetchAllTags = core.getInput('fetch_all_tags');
  const commitSha = core.getInput('commit_sha');
  const pushTag = core.getBooleanInput('push_tag');
  const commitAnalyzerPreset = core.getInput('commit_analyzer_preset');

  const gitCwd = core.getInput('source');
  const tagMessage = core.getInput('tag_message');

  const bumpStrategyInput =
    core.getInput('bump_strategy') || 'conventional-commits';
  if (!(BUMP_STRATEGIES as readonly string[]).includes(bumpStrategyInput)) {
    throw new Error(
      `${bumpStrategyInput} is not a valid bump_strategy. Expected one of ${BUMP_STRATEGIES.join(', ')}.`,
    );
  }
  const bumpStrategy = bumpStrategyInput as BumpStrategy;
  const isStringTokenStrategy = bumpStrategy === 'string-token';

  // Deliberately no `default:` in action.yml for these: `core.getInput` cannot
  // tell a caller-supplied value from a declared default, so the "you set a
  // token but not the strategy" warning below would fire on every single
  // conventional-commits run if the defaults were declared there.
  const rawStringTokens = {
    major: core.getInput('major_string_token'),
    minor: core.getInput('minor_string_token'),
    patch: core.getInput('patch_string_token'),
    none: core.getInput('none_string_token'),
  };
  const stringTokens = {
    major: rawStringTokens.major || DEFAULT_STRING_TOKENS.major,
    minor: rawStringTokens.minor || DEFAULT_STRING_TOKENS.minor,
    patch: rawStringTokens.patch || DEFAULT_STRING_TOKENS.patch,
    none: rawStringTokens.none || DEFAULT_STRING_TOKENS.none,
  };

  if (!isStringTokenStrategy && Object.values(rawStringTokens).some(Boolean)) {
    core.warning(
      'String token inputs are ignored unless bump_strategy is set to string-token.',
    );
  }

  const tokenMatchModeInput = core.getInput('token_match_mode') || 'word';
  let tokenMatchMode: TokenMatchMode = 'word';
  if ((TOKEN_MATCH_MODES as readonly string[]).includes(tokenMatchModeInput)) {
    tokenMatchMode = tokenMatchModeInput as TokenMatchMode;
  } else {
    core.warning(
      `${tokenMatchModeInput} is not a valid token_match_mode. Falling back to word.`,
    );
  }

  if (tagMessage && !createAnnotatedTag) {
    core.warning(
      'tag_message was set but create_annotated_tag is false; tag_message is ignored for lightweight tags.',
    );
  }

  const initialVersionInput = core.getInput('initial_version') || '0.0.0';
  const initialVersion = valid(initialVersionInput.replace(/^v/, ''));
  if (!initialVersion) {
    throw new Error(`${initialVersionInput} is not a valid semver.`);
  }

  const tagContextInput = core.getInput('tag_context') || 'repo';
  let tagContext: TagContext = 'repo';
  if ((TAG_CONTEXTS as readonly string[]).includes(tagContextInput)) {
    tagContext = tagContextInput as TagContext;
  } else {
    core.warning(
      `${tagContextInput} is not a valid tag_context. Falling back to repo.`,
    );
  }

  const branchHistoryInput = core.getInput('branch_history') || 'compare';
  let branchHistory: BranchHistory = 'compare';
  if (BRANCH_HISTORIES.includes(branchHistoryInput as BranchHistory)) {
    branchHistory = branchHistoryInput as BranchHistory;
  } else {
    core.warning(
      `${branchHistoryInput} is not a valid branch_history. Falling back to compare.`,
    );
  }

  const defaultBranch = core.getInput('default_branch');

  let mappedReleaseRules;
  if (customReleaseRules) {
    mappedReleaseRules = mapCustomReleaseRules(customReleaseRules);
  }

  const { GITHUB_REF, GITHUB_SHA } = process.env;

  if (!GITHUB_REF) {
    throw new Error('Missing GITHUB_REF.');
  }

  const commitRef = commitSha || GITHUB_SHA;
  if (!commitRef) {
    throw new Error('Missing commit_sha or GITHUB_SHA.');
  }

  const currentBranch = getBranchFromRef(GITHUB_REF);
  const isReleaseBranch = releaseBranches
    .split(',')
    .some((branch) => currentBranch.match(branch));
  const isPreReleaseBranch = preReleaseBranches
    .split(',')
    .some((branch) => currentBranch.match(branch));
  const isPullRequest = isPr(GITHUB_REF);
  // An explicit `pre_release` wins outright; leaving it unset keeps the
  // branch-derived behaviour. Note this only decides whether the *version* is a
  // prerelease - the "neither a release nor a pre-release branch" guard further
  // down still uses the branch matches.
  const preReleaseInput = core.getInput('pre_release');
  const isPrerelease =
    preReleaseInput !== ''
      ? /true/i.test(preReleaseInput)
      : !isReleaseBranch && !isPullRequest && isPreReleaseBranch;

  const commitRangeOptions = {
    gitCwd,
    branchHistory,
    defaultBranch,
    currentBranch,
  };

  // Sanitize identifier according to
  // https://semver.org/#backusnaur-form-grammar-for-valid-semver-versions
  const identifier = (
    appendToPreReleaseTag ? appendToPreReleaseTag : currentBranch
  ).replace(/[^a-zA-Z0-9-]/g, '-');

  const prefixRegex = new RegExp(`^${tagPrefix}`);

  const tags = await listTags(/true/i.test(shouldFetchAllTags));
  const allValidTags = await getValidTags(tags, prefixRegex);
  const validTags =
    tagContext === 'branch'
      ? await filterTagsByBranchAncestry(allValidTags, commitRef, prefixRegex, {
          gitCwd,
        })
      : allValidTags;
  const latestTag = getLatestTag(
    validTags,
    prefixRegex,
    tagPrefix,
    initialVersion,
  );
  const latestPrereleaseTag = getLatestPrereleaseTag(
    validTags,
    identifier,
    prefixRegex,
  );

  let commits: Await<ReturnType<typeof getCommits>>;

  let newVersion: string;

  if (customTag) {
    commits = await getCommits(
      latestTag.commit.sha,
      commitRef,
      commitRangeOptions,
    );

    core.setOutput('release_type', 'custom');
    newVersion = customTag;
  } else {
    let previousTag: ReturnType<typeof getLatestTag> | null;
    let previousVersion: SemVer | null;
    if (isStringTokenStrategy) {
      // entrypoint.sh always computes the bump off the stable tag and treats the
      // prerelease tag purely as a continue-or-restart switch (applied further
      // down). Selecting max(stable, prerelease) here instead - as the
      // conventional-commits path does - would increment from the prerelease
      // version and produce e.g. 1.4.2-RC.0 where legacy produces 1.4.1-RC.4.
      previousTag = latestTag;
    } else if (!latestPrereleaseTag) {
      previousTag = latestTag;
    } else {
      previousTag = gte(
        latestTag.name.replace(prefixRegex, ''),
        latestPrereleaseTag.name.replace(prefixRegex, ''),
      )
        ? latestTag
        : latestPrereleaseTag;
    }

    if (!previousTag) {
      throw new Error('Could not find previous tag.');
    }

    previousVersion = parse(previousTag.name.replace(prefixRegex, ''));

    if (!previousVersion) {
      throw new Error('Could not parse previous tag.');
    }

    core.info(
      `Previous tag was ${previousTag.name}, previous version was ${previousVersion.version}.`,
    );
    core.setOutput('previous_version', previousVersion.version);
    core.setOutput('previous_tag', previousTag.name);
    const previousWasPrerelease = previousVersion.prerelease.length != 0;

    if (
      isStringTokenStrategy &&
      previousTag.commit.sha === NO_PREVIOUS_TAG_SHA
    ) {
      // No tag matches this prefix yet. legacy's range is
      // `git log <empty>..<sha>`, which git reads as HEAD..HEAD and is empty, so
      // the first tag of a new prefixed lineage always comes from default_bump.
      // Falling through to the API here would walk the entire repo history and
      // let an unrelated historical `#major` mint e.g. web-app_1.0.0 instead of
      // web-app_0.0.1.
      core.info(
        'No previous tag for this prefix; treating the commit range as empty.',
      );
      commits = [];
    } else {
      commits = await getCommits(previousTag.commit.sha, commitRef, {
        ...commitRangeOptions,
        skipClosedPrFallback: isStringTokenStrategy,
      });
    }
    core.debug('We found ' + commits.length + ' commits to consider!');

    if (scopes.length && isStringTokenStrategy) {
      // The scope filter parses commits as conventional commits and drops
      // everything that isn't one, which would starve the token matcher.
      core.warning(
        'scopes is not supported with bump_strategy: string-token and is ignored.',
      );
    } else if (scopes.length) {
      const commitParser = new CommitParser();
      const isInScope = (scope: string) =>
        scopes.split(',').some((includedScope) => scope.match(includedScope));
      commits = commits.filter((commit) => {
        const scope = commitParser.parse(commit.message).scope;
        if (scope) {
          const isInScopes = scopes
            .split(',')
            .some((includedScope) => scope.match(includedScope));
          return isInScopes;
        } else {
          return false;
        }
      });
    }

    if (isStringTokenStrategy) {
      const tokenResult: StringTokenResult = analyzeCommitsByStringToken(
        commits,
        stringTokens,
        tokenMatchMode,
      );
      const stableVersion = latestTag.name.replace(prefixRegex, '');

      // A `none` token always skips, and it does so before any force override is
      // considered - legacy has no force concept and the shim never sets one. A
      // range with no token at all falls back to default_bump, unless that is
      // itself a skip sentinel (`false` here; `none` in the legacy interface,
      // accepted too so a stray legacy value can't reach semver.inc()).
      if (
        tokenResult.kind === 'none' ||
        (tokenResult.kind === 'no-match' &&
          (defaultBump === 'false' || String(defaultBump) === 'none'))
      ) {
        core.info(
          'No commit specifies the version bump. Skipping the tag creation.',
        );
        core.setOutput('release_type', 'none');
        // legacy never leaves new_tag empty - every skip path echoes the existing
        // tag, so a consumer feeding it into an image tag always has a value.
        // It echoes the *stable* tag even on a prerelease run, because legacy's
        // `#none` arm fires before its prerelease block.
        core.setOutput('new_version', stableVersion);
        core.setOutput('new_tag', latestTag.name);
        return;
      }

      const part = (
        tokenResult.kind === 'bump' ? tokenResult.bump : defaultBump
      ) as ReleaseType;

      if (isPrerelease) {
        const target = inc(stableVersion, part);
        if (!target) {
          throw new Error('Could not increment version.');
        }
        const previousPrereleaseName = latestPrereleaseTag?.name;
        // Mirrors legacy's
        // `[[ "$pre_tag" =~ $new ]] && [[ "$pre_tag" =~ $suffix ]]`: continue the
        // existing prerelease series only when it is already working towards this
        // same target version with this same identifier, otherwise start a fresh
        // one at `.0` (not `.1`).
        const continuesExistingPrerelease =
          !!previousPrereleaseName &&
          previousPrereleaseName.includes(target) &&
          previousPrereleaseName.includes(identifier);

        newVersion = continuesExistingPrerelease
          ? (inc(
              previousPrereleaseName.replace(prefixRegex, ''),
              'prerelease',
              identifier,
            ) ?? '')
          : `${target}-${identifier}.0`;

        core.setOutput('release_type', `pre${part}`);
      } else {
        newVersion = inc(stableVersion, part) ?? '';
        core.setOutput('release_type', part);
      }

      if (!newVersion || !valid(newVersion)) {
        throw new Error(`${newVersion} is not a valid semver.`);
      }
    } else {
      const isDefaultCommitAnalyzerPreset =
        commitAnalyzerPreset.toLowerCase() === 'angular';

      const analyzeCommitsContext = {
        commits,
        logger: { log: console.info.bind(console) },
        cwd: process.cwd(),
      };

      let bump = await analyzeCommits(
        {
          ...(isDefaultCommitAnalyzerPreset
            ? {}
            : { preset: commitAnalyzerPreset }),
          releaseRules: mappedReleaseRules
            ? // analyzeCommits doesn't appreciate rules with a section /shrug
              mappedReleaseRules.map(({ section, ...rest }) => ({ ...rest }))
            : undefined,
        },
        analyzeCommitsContext,
      );

      // Determine if we should continue with tag creation based on main vs prerelease branch
      let shouldContinue = true;
      if (isPrerelease) {
        if (!bump && !previousWasPrerelease && defaultDraftBump === 'false')
          shouldContinue = false;
        if (!bump && defaultPreReleaseBump === 'false') {
          shouldContinue = false;
        }
      } else {
        if (!bump && defaultBump === 'false') {
          shouldContinue = false;
        }
      }

      // Determine if we should override the bump to a given `force` version
      if (isPrerelease && forcePreReleaseBump !== '') {
        bump = forcePreReleaseBump;
      }
      if (!isPrerelease && forceBump !== '') {
        bump = forceBump;
      }

      // Default bump is set to false and we did not find an automatic bump
      if (!shouldContinue) {
        core.debug(
          'No commit specifies the version bump. Skipping the tag creation.',
        );
        return;
      }

      // If we don't have an automatic bump for the prerelease, just set our bump as the default
      if (isPrerelease && !bump) {
        if (!previousWasPrerelease)
          // previous version is a prerelease -> draft a new version with the default bump and make it a prerelease
          bump = defaultDraftBump;
        else bump = defaultPreReleaseBump;
      }

      // `bump` can already carry a 'pre' prefix here (e.g. 'preminor' from a
      // custom release rule or default_prerelease_bump), but a prerelease
      // branch always gets exactly one 'pre' prefix added below - strip any
      // that are already there first, so the result is 'preminor' rather
      // than 'preprepatch'/'prepreminor'.
      if (isPrerelease) {
        bump = bump.replace(/^(pre)+/, '');
      }

      const releaseType: ReleaseType = isPrerelease
        ? `pre${bump}`
        : bump || defaultBump;
      core.setOutput('release_type', releaseType);

      const incrementedVersion = inc(previousVersion, releaseType, identifier);

      if (!incrementedVersion) {
        throw new Error('Could not increment version.');
      }

      if (!valid(incrementedVersion)) {
        throw new Error(`${incrementedVersion} is not a valid semver.`);
      }

      newVersion = incrementedVersion;
    }
  }

  core.info(`New version is ${newVersion}.`);
  core.setOutput('new_version', newVersion);

  const newTag = `${tagPrefix}${newVersion}`;
  core.info(`New tag after applying prefix is ${newTag}.`);
  core.setOutput('new_tag', newTag);

  const conventionalCommitsPreset = createConventionalCommitsPreset({
    types: mergeWithDefaultChangelogRules(mappedReleaseRules),
  });

  const generateNotesContext = {
    commits,
    logger: { log: console.info.bind(console) },
    cwd: process.cwd(),
    options: {
      repositoryUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`,
    },
    lastRelease: { gitTag: latestTag.name },
    nextRelease: { gitTag: newTag, version: newVersion },
  };

  const changelog = await generateNotes(
    {
      parserOpts: conventionalCommitsPreset.parser,
      writerOpts: conventionalCommitsPreset.writer,
    },
    generateNotesContext,
  );
  core.info(`Changelog is ${changelog}.`);
  core.setOutput('changelog', changelog);

  if (!isReleaseBranch && !isPreReleaseBranch) {
    core.info(
      'This branch is neither a release nor a pre-release branch. Skipping the tag creation.',
    );
    return;
  }

  const tagExists = tags.map((tag) => tag.name).includes(newTag);
  if (tagExists && !forceUpdate) {
    core.info('This tag already exists. Skipping the tag creation.');
    return;
  }

  if (/true/i.test(dryRun)) {
    core.info('Dry run: not performing tag action.');
    return;
  }

  await createTag(
    newTag,
    createAnnotatedTag,
    tagExists,
    commitRef,
    pushTag,
    tagMessage,
  );
  core.setOutput('tag_created', 'true');
}

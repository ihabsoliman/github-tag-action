# GitHub Tag Action

A GitHub Action to automatically bump and tag master, on merge, with the latest SemVer formatted version. Works on any platform.

> This is a copy of [mathieudutour/github-tag-action](https://github.com/mathieudutour/github-tag-action), with a handful of open community pull requests cherry-picked in and additional fixes made with the help of Claude Code. See [Credits](#credits) for details.

## Usage

```yaml
name: Bump version
on:
  push:
    branches:
      - master
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: Bump version and push tag
        id: tag_version
        uses: ihabsoliman/github-tag-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
      - name: Create a GitHub release
        uses: ncipollo/release-action@339a81892b84b4eeb0f6e744e4574d79d0d9b8dd # v1.21.0
        with:
          tag: ${{ steps.tag_version.outputs.new_tag }}
          name: Release ${{ steps.tag_version.outputs.new_tag }}
          body: ${{ steps.tag_version.outputs.changelog }}
```

### 📥 Inputs

- **github_token** _(required)_ - Required for permission to tag the repo. Usually `${{ secrets.GITHUB_TOKEN }}`.
- **commit_sha** _(optional)_ - The commit SHA value to add the tag. If specified, it uses this value instead GITHUB_SHA. It could be useful when a previous step merged a branch into github.ref.
- **source** _(optional)_ - Path to the local git checkout used for local-git operations (the `git log` fallback of the compare API, the shallow-clone probe, and `tag_context: branch` ancestry checks). GitHub API calls are repository-global and unaffected (default: `.`).

#### Fetch all tags

- **fetch_all_tags** _(optional)_ - By default, this action fetch the last 100 tags from Github. Sometimes, this is not enough and using this action will fetch all tags recursively (default: `false`).

#### Filter branches

- **release_branches** _(optional)_ - Comma separated list of branches (JavaScript regular expression accepted) that will generate the release tags. Other branches and pull-requests generate versions postfixed with the commit hash and do not generate any repository tag. Examples: `^master$` or `.*` or `^release.*,^hotfix.*,^master$`... (default: `^master$,^main$`).
- **pre_release_branches** _(optional)_ - Comma separated list of branches (JavaScript regular expression accepted) that will generate the pre-release tags.
- **pre_release** _(optional)_ - Force pre-release on (`true`) or off (`false`), overriding what `release_branches`/`pre_release_branches` would infer. Leave unset to keep inferring from the branch. Useful when the caller already knows whether a run is a pre-release (e.g. a reusable workflow that decides from its own inputs) and doesn't want to encode that as branch regexes.

#### Filter commits

- **scopes** _(optional)_ - Comma separated list of scopes (JavaScript regular expression accepted) to consider when tagging, and to include in the changelog. If this option is specified, then commits with scopes not matching this list will not be analyzed nor included in the changelog.
- **branch_history** _(optional)_ - Which commits feed the commit analyzer and the changelog (default: `compare`).
  - `compare` - commits between the previous tag and the tagged commit (existing behaviour).
  - `last` - only the tagged commit itself (useful for squash-merge workflows).
  - `full` - every commit reachable from the tagged commit, narrowed to `default_branch..<commit>` when `default_branch` is set and differs from the current branch. Requires a full clone (`fetch-depth: 0`); falls back to `compare` with a warning on a shallow checkout.

  Unrecognized values fall back to `compare` with a warning.
- **default_branch** _(optional)_ - The repository's default branch (e.g. `main`). Only used by `branch_history: full`, to narrow the range to the commits unique to the current branch. Not auto-detected.

#### Choose a bump strategy

- **bump_strategy** _(optional)_ - How the bump is derived from commit messages (default: `conventional-commits`). See [Bump strategies](#bump-strategies).
  - `conventional-commits` - parse commits with a conventional-commit analyzer.
  - `string-token` - scan commit messages for magic tokens such as `#major`.
- **major_string_token** _(optional)_ - Token that triggers a major bump under `bump_strategy: string-token` (default: `#major`).
- **minor_string_token** _(optional)_ - Token that triggers a minor bump under `bump_strategy: string-token` (default: `#minor`).
- **patch_string_token** _(optional)_ - Token that triggers a patch bump under `bump_strategy: string-token` (default: `#patch`).
- **none_string_token** _(optional)_ - Token that suppresses tagging under `bump_strategy: string-token` (default: `#none`).
- **token_match_mode** _(optional)_ - How tokens are matched (default: `word`). See [Matching modes](#matching-modes).

Setting any `*_string_token` without also setting `bump_strategy: string-token` logs a warning and has no effect. Setting an empty string for one of them disables that bump level entirely.

#### Customize the tag

- **default_bump** _(optional)_ - Which type of bump to use when [none is explicitly provided](#bumping) when commiting to a release branch (default: `patch`). You can also set `false` to avoid generating a new tag when none is explicitly provided. Can be `patch, minor or major`.
- **default_prerelease_bump** _(optional)_ - Which type of bump to use when [none is explicitly provided](#bumping) when commiting to a prerelease branch (default: `prerelease`). You can also set `false` to avoid generating a new tag when none is explicitly provided. Can be `prerelease, prepatch, preminor or premajor`.
- **default_draft_bump** _(optional)_ - Which type of bump to use when [none is explicitly provided](#bumping) when commiting to a prerelease branch with no previous prerelease version (default: `prerelease`). You can also set `false` to avoid generating a new tag when none is explicitly provided. Can be `prerelease, patch, minor or major`.
- **force_bump** _(optional)_ - If specified, it ignores the type of bump provided when committing to a release branch, as well as `default_bump`. You can also set `false` to avoid generating a new tag. Can be `patch, minor or major`.
- **force_prerelease_bump** _(optional)_ - If specified, it ignores the type of bump provided when committing to a release branch, as well as `default_bump`. You can also set `false` to avoid generating a new tag. Can be `prerelease, prepatch, preminor or premajor`.
- **custom_tag** _(optional)_ - Custom tag name. If specified, it overrides bump settings.
- **force_update** _(optional)_ - Updates the sha of a tag if it already exists (default: `false`).
- **create_annotated_tag** _(optional)_ - Boolean to create an annotated rather than a lightweight one (default: `false`).
- **tag_message** _(optional)_ - Message for the annotated tag object (default: the tag name). Only used when `create_annotated_tag` is `true`; setting it with `create_annotated_tag: false` logs a warning and is otherwise ignored.
- **tag_prefix** _(optional)_ - A prefix to the tag name (default: `v`).
- **initial_version** _(optional)_ - The version to assume as the previous version when no matching tag exists yet, i.e. the base for the very first tag this action creates (default: `0.0.0`). Must be a valid semver; a leading `v` is stripped. The action fails if it is not valid semver.
- **tag_search_pattern** _(optional)_ - A glob pattern to filter tags to consider for version bumping (e.g. `v0.*`). Useful for projects with multiple major versions supported simultaneously with different root commits.
- **tag_context** _(optional)_ - Which tags to consider when picking the previous tag (default: `repo`).
  - `repo` - considers every tag in the repository.
  - `branch` - considers only tags that are ancestors of the tagged commit.

  Unrecognized values fall back to `repo` with a warning.
- **append_to_pre_release_tag** _(optional)_ - A suffix to the pre-release tag name (default: `<branch>`).
- **commit_analyzer_preset** _(optional)_ - A supported `conventional-changelog` preset (default: `angular`). See ![list of supported values](https://github.com/semantic-release/commit-analyzer#options)

#### Customize the conventional commit messages & titles of changelog sections

- **custom_release_rules** _(optional)_ - Comma separated list of release rules.

  __Format__: `<keyword>:<release_type>:<changelog_section>` where `<changelog_section>` is optional. The `<changelog_section>` will default to the convention associated with the selected `commit_analyzer_preset`. Two of the most common conventions:
    * [Angular's conventions](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-angular).
    * [ConventionalCommit's conventions](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-conventionalcommits).

  __Examples__:
    1. `hotfix:patch,pre-feat:preminor`,
    2. `bug:patch:Bug Fixes,chore:patch:Chores`

#### Create a tag without pushing it
- **push_tag** _(optional)_ - Push the tag to the remote. If false, tag is created but not pushed. (default: `true`)

#### Debugging

- **dry_run** _(optional)_ - Do not perform tagging, just calculate next version and changelog, then exit
- **soft_fail** _(optional)_ - If true, an unrecoverable error (after retries/fallbacks) is reported as a warning and the step exits successfully without creating a tag, instead of failing the job (default: `false`).

### 📤 Outputs

- **new_tag** - The value of the newly calculated tag. Note that if there hasn't been any new commit, this will be `undefined`.
- **new_version** - The value of the newly created tag without the prefix. Note that if there hasn't been any new commit, this will be `undefined`.
- **previous_tag** - The value of the previous tag (or `v0.0.0` if none). Note that if `custom_tag` is set, this will be `undefined`.
- **previous_version** - The value of the previous tag (or `0.0.0` if none) without the prefix. Note that if `custom_tag` is set, this will be `undefined`.
- **release_type** - The computed release type (`major`, `minor`, `patch` or `custom` - can be prefixed with `pre`). Under `bump_strategy: string-token` it is `none` when a `none` token suppressed the bump.
- **changelog** - The [conventional changelog](https://github.com/conventional-changelog/conventional-changelog) since the previous tag.
- **tag_created** - Whether a tag was actually created/pushed (`true`/`false`). Other outputs (`new_tag`, `new_version`, etc.) may be populated even when this is `false` (e.g. `dry_run`, or a `soft_fail`'d error) - check this output before acting on them.

> **_Note:_** This action creates a [lightweight tag](https://developer.github.com/v3/git/refs/#create-a-reference) by default.

### Bump strategies

Two strategies are available, selected with `bump_strategy`.

| | `conventional-commits` (default) | `string-token` |
| --- | --- | --- |
| How the bump is decided | Commits are parsed as conventional commits and analyzed structurally | Commit messages are scanned for magic substrings |
| Example commit | `feat(api): add pagination` | `add pagination #minor` |
| Configured by | `commit_analyzer_preset`, `custom_release_rules`, `scopes` | `major_string_token`, `minor_string_token`, `patch_string_token`, `none_string_token`, `token_match_mode` |

Everything else - prefix-scoped tag discovery, prerelease handling, tag creation - is shared, so the two strategies differ only in how they read intent from commit messages.

Some vocabulary used throughout this README:

- **Bump strategy** - how a commit range is turned into `major`/`minor`/`patch`/nothing.
- **Prefix-scoped version lineage** - the set of tags sharing one `tag_prefix`. Each prefix has an independent version history, so `gateway_1.4.0` and `web-app_2.9.0` never influence each other's bumps.
- **Release branch** - a branch matching `release_branches`; it produces plain version tags. Everything else produces prereleases if it matches `pre_release_branches` (or if `pre_release: true` is set).
- **Prerelease identifier** - the label in `1.4.1-RC.3`, taken from `append_to_pre_release_tag` and defaulting to the branch name.

#### Bumping with string tokens

Set `bump_strategy: string-token` when your team doesn't write conventional commits but does mark intent in commit messages:

```yaml
- uses: ihabsoliman/github-tag-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    bump_strategy: string-token
```

That's the whole configuration - the four tokens default to `#major`, `#minor`, `#patch` and `#none`. Override them for a different house style:

```yaml
    bump_strategy: string-token
    major_string_token: "[breaking]"
    minor_string_token: "[feature]"
    patch_string_token: "[fix]"
```

Rules:

- Every commit message in the range is searched, subject and body alike. A token in any commit counts.
- **Precedence is `major` > `minor` > `patch` > `none`.** A range containing both `#major` and `#none` bumps major - `#none` only wins when no other token appears anywhere in the range.
- When no token matches, `default_bump` applies (set `default_bump: false` to tag nothing instead).
- When the `none` token matches, no tag is created and `new_tag`/`new_version` echo the existing tag rather than being empty, so a workflow using them as an image tag always has a value.
- `scopes` is not supported with this strategy (it filters to conventional commits, which would discard the very commits being scanned) and is ignored with a warning.

##### Matching modes

`token_match_mode` controls how strictly tokens are matched:

- **`word`** (default) - the token must be delimited by non-word characters or a string boundary, and matching is case-insensitive. `#patches` does **not** trigger `#patch`; `#MAJOR` does trigger `#major`.
- **`substring`** - a case-sensitive plain substring search. This is bug-compatible with [anothrNick/github-tag-action](https://github.com/anothrNick/github-tag-action), whose bash implementation used a glob: under this mode `#patches` **does** trigger `#patch`, and `#MAJOR` does **not** match `#major`. Use it when migrating from that action and you need identical results.

> **_Note:_** the `substring` sharp edge is real - a commit body mentioning "fixed #patches in the docs" will cut a patch release. Prefer distinctive tokens (`[fix]`, `#bump-patch`) if you must use `substring`.

### Bumping

The action will parse the new commits since the last tag using the [semantic-release](https://github.com/semantic-release/semantic-release) conventions.

semantic-release uses the commit messages to determine the type of changes in the codebase. Following formalized conventions for commit messages, semantic-release automatically determines the next [semantic version](https://semver.org) number.

By default semantic-release uses [Angular Commit Message Conventions](https://github.com/angular/angular.js/blob/master/DEVELOPERS.md#-git-commit-guidelines), but different conventions can be used via the `commit_analyzer_preset` option.

Here is an example of the release type that will be done based on a commit messages, using the default settings:

<table>
<tr>
<td> Commit message </td> <td> Release type </td>
</tr>
<tr>
<td>

```
fix(pencil): stop graphite breaking when too much pressure applied
```

</td>
<td>Patch Release</td>
</tr>
<tr>
<td>

```
feat(pencil): add 'graphiteWidth' option
```

</td>
<td>Minor Release</td>
</tr>
<tr>
<td>

```
perf(pencil): remove graphiteWidth option

BREAKING CHANGE: The graphiteWidth option has been removed.
The default graphite width of 10mm is always used for performance reasons.
```

</td>
<td>Major Release</td>
</tr>
</table>

If no commit message contains any information, then **default_bump** will be used.

## Releasing

`main` is protected by a repo ruleset (required review, signed commits, linear history) that
blocks direct pushes, so cutting a release is a two-step, PR-based process rather than a single
click:

1. **Prepare** — run the [`Prepare release`](.github/workflows/prepare-release.yml) workflow
   (`gh workflow run prepare-release.yml`, or via the Actions tab). It does a `dry_run` of this
   action against `main`'s current HEAD to compute the next version from the conventional commits
   since the last tag, bumps `package.json`'s `version` accordingly, and opens a
   `chore(release): vX.Y.Z` pull request with the changelog as its description. `package.json`'s
   version is cosmetic only (the package is `private: true` and never published to npm) — it
   exists so the release PR has something to review and merge.
2. **Review and merge** — review the PR like any other and merge it (squash or rebase, per the
   ruleset). Merging is the point of no return: it's what actually cuts the release.
3. **Release** — merging fires [`Release`](.github/workflows/release.yml) automatically. It runs
   this action for real (not a dry run) against the merge commit, which computes the same version
   again and creates + pushes the `vX.Y.Z` tag directly on `main`'s new HEAD — no synthetic or
   detached commits involved. It then creates a GitHub release from that tag via
   [`ncipollo/release-action`](https://github.com/ncipollo/release-action), using this action's
   `changelog` output as the release body.
4. **Publish** — the new GitHub release (`release: published`) triggers
   [`Publish Immutable Action Version`](.github/workflows/publish-immutable-actions.yml)
   automatically, which publishes that tag to GitHub's immutable actions registry.

Every push to `main` and every PR also runs [`Check dist`](.github/workflows/check-dist.yml),
which rebuilds `lib/` and fails if the committed output doesn't match a fresh build — this is
what makes it safe for `release.yml` to tag `main`'s HEAD directly without rebuilding first.

### Moving a floating major tag

If you want consumers to be able to pin to a floating major tag (e.g. `uses: owner/repo@v1`) the
way most GitHub Actions do, run
[`Update major version tag`](.github/workflows/update-main-version.yml) after cutting a release:
give it the major tag (`v1`) and the target (`v1.4.2`), and it force-moves `v1` to point at that
commit. This repo doesn't do this by default — it's a manual, deliberate step, not part of the
automated release above.

## Credits

This is a fork of [mathieudutour/github-tag-action](https://github.com/mathieudutour/github-tag-action), snapshotted after upstream became unmaintained, with a set of open community pull requests cherry-picked in.

[anothrNick/github-tag-action](https://github.com/anothrNick/github-tag-action) - a similar action using a Dockerfile (hence not working on macOS)

# GitHub Tag Action

A GitHub Action to automatically bump and tag master, on merge, with the latest SemVer formatted version. Works on any platform.

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

#### Filter commits

- **scopes** _(optional)_ - Comma separated list of scopes (JavaScript regular expression accepted) to consider when tagging, and to include in the changelog. If this option is specified, then commits with scopes not matching this list will not be analyzed nor included in the changelog.
- **branch_history** _(optional)_ - Which commits feed the commit analyzer and the changelog (default: `compare`).
  - `compare` - commits between the previous tag and the tagged commit (existing behaviour).
  - `last` - only the tagged commit itself (useful for squash-merge workflows).
  - `full` - every commit reachable from the tagged commit, narrowed to `default_branch..<commit>` when `default_branch` is set and differs from the current branch. Requires a full clone (`fetch-depth: 0`); falls back to `compare` with a warning on a shallow checkout.

  Unrecognized values fall back to `compare` with a warning.
- **default_branch** _(optional)_ - The repository's default branch (e.g. `main`). Only used by `branch_history: full`, to narrow the range to the commits unique to the current branch. Not auto-detected.

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
- **release_type** - The computed release type (`major`, `minor`, `patch` or `custom` - can be prefixed with `pre`).
- **changelog** - The [conventional changelog](https://github.com/conventional-changelog/conventional-changelog) since the previous tag.
- **tag_created** - Whether a tag was actually created/pushed (`true`/`false`). Other outputs (`new_tag`, `new_version`, etc.) may be populated even when this is `false` (e.g. `dry_run`, or a `soft_fail`'d error) - check this output before acting on them.

> **_Note:_** This action creates a [lightweight tag](https://developer.github.com/v3/git/refs/#create-a-reference) by default.

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

## Credits

This is a fork of [mathieudutour/github-tag-action](https://github.com/mathieudutour/github-tag-action), snapshotted after upstream became unmaintained, with a set of open community pull requests cherry-picked in.

[anothrNick/github-tag-action](https://github.com/anothrNick/github-tag-action) - a similar action using a Dockerfile (hence not working on macOS)

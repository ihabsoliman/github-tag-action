declare module 'conventional-changelog-conventionalcommits' {
  interface ConventionalCommitsPresetConfig {
    types?: Array<{ type: string; section?: string; hidden?: boolean }>;
    ignoreCommits?: unknown;
  }

  interface ConventionalCommitsPreset {
    commits: { ignore: unknown; merges: boolean };
    parser: Record<string, unknown>;
    writer: Record<string, unknown>;
    whatBump: (commits: unknown[], options: unknown) => unknown;
  }

  export default function createPreset(
    config?: ConventionalCommitsPresetConfig,
  ): ConventionalCommitsPreset;
}

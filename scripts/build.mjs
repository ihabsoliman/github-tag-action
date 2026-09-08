import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: 'lib/main.cjs',
  // import.meta.url has no CJS equivalent; esbuild replaces it with an empty
  // object, which breaks a transitive dependency that calls
  // createRequire(import.meta.url). The value is never actually used at
  // runtime for our code paths, so a placeholder is safe.
  define: { 'import.meta.url': '"file:///github-tag-action-bundle.cjs"' },
});

/*
 * The suites obtain the *unmocked* version of a module by importing it with a
 * `?real` query suffix, e.g. `await import('../src/utils.js?real')`. The suffix
 * makes it a distinct module specifier, so the factory registered for the
 * unqueried path by `jest.unstable_mockModule` does not apply to it, while the
 * ESM resolver still resolves it to the same file. Nothing in jest.config.cjs is
 * involved - `moduleNameMapper` only rewrites specifiers ending in `.js`.
 *
 * TypeScript has no notion of that suffix, so declare it here rather than
 * repeating `@ts-expect-error` at each import site.
 */
declare module '*?real';

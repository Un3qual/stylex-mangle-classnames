# Extracted StyleX CSS Compatibility Design

## Goal

Keep mangled JavaScript class references and extracted StyleX CSS selectors consistent in Vite production builds when StyleX uses `runtimeInjection: false`.

The fix must not turn `stylex-mangle-classnames` into a StyleX compiler or CSS extractor. A StyleX bundler plugin remains responsible for converting Babel metadata into CSS.

## Confirmed Root Cause

Three production paths were reproduced against Vite 8.2.0:

1. With `runtimeInjection: true`, StyleX rules remain in JavaScript. The existing `generateBundle` pass sees and rewrites both class references and injected selectors.
2. With `runtimeInjection: false` and `@stylexjs/rollup-plugin`, StyleX emits CSS during `generateBundle`. The existing mangler already rewrites the JavaScript and CSS consistently.
3. With `runtimeInjection: false` and `@stylexjs/unplugin/vite`, when no ordinary CSS asset exists, StyleX falls back to writing `assets/stylex.css` during `writeBundle`. That happens after the mangler's `generateBundle` pass. The reproduced output used class `a` in JavaScript and selector `.sx1e2nbdu` in CSS.

The README's current Babel-only example is also incomplete for `runtimeInjection: false`: the Babel wrapper discards StyleX metadata and no component extracts a stylesheet. The mangler cannot reconstruct complete CSS rules from class names alone.

## Runtime Design

Retain `generateBundle` as the primary pass. It continues to discover the complete in-bundle class set, allocate deterministic short names, check authored-CSS collisions, and rewrite JavaScript, CSS, and HTML assets before Vite writes them.

Add a post-ordered `writeBundle` hook for CSS created directly on disk by an earlier plugin's `writeBundle` hook:

1. Resolve the current output directory from `outputOptions.dir` or the parent of `outputOptions.file`.
2. Recursively enumerate `.css` files under that output directory without following directory symlinks.
3. Build absolute paths for CSS assets already present in the Rollup bundle and exclude them. Those assets were handled during `generateBundle`; processing them again would misclassify an already-mangled selector such as `.a` as authored CSS.
4. Read every remaining CSS file before changing any file.
5. Collect all canonical StyleX class names from those late files, sort them, and add them to the existing build-wide mapping.
6. Run the same authored-class collision check used for bundled CSS.
7. Rewrite changed late CSS files with the existing mapping.

The late pass uses the mapping already established from JavaScript during `generateBundle`, so `.sx1e2nbdu` becomes the same `a` already written into the JavaScript chunk.

## Boundaries and Failure Behavior

- Scan only the active Rollup/Vite output directory and only `.css` files.
- Do not read or change source CSS, external stylesheets, JavaScript, HTML, or CSS bundle assets already handled in memory.
- Ignore symlinked directories rather than following output paths outside the build directory.
- If there are no late CSS files, do nothing.
- Read and validate all late CSS before writing any of it, so a collision does not leave a partially rewritten output directory.
- Reuse the existing collision error and fail the build if a late-generated short name collides with authored CSS.
- Allow filesystem errors to fail the build with the affected operation and path rather than silently shipping mismatched output.
- Keep the existing production source-map prohibition; this change does not add map rewriting.

## Tests

Add a production integration test using the existing Vite development dependency and a small fake upstream plugin. The fake plugin emits a JavaScript class reference into the bundle, then writes StyleX-like CSS directly to disk during its own `writeBundle` hook. With the mangler ordered afterward, the test must prove the final JavaScript and late CSS use the same short name.

Add a second late-output case that writes an authored `.a` selector alongside `.sx1`; the Vite build must fail with the existing collision message before the late CSS is rewritten.

Keep the existing unit test that proves CSS already present in the bundle is rewritten during `generateBundle`. Run the full typecheck, unit/integration tests, build, and package dry run.

## Documentation and Versioning

Update the README to distinguish two supported configurations:

- `runtimeInjection: true`: the existing Babel configuration is sufficient because StyleX injects rules through JavaScript.
- `runtimeInjection: false`: users must configure a StyleX bundler plugin that extracts CSS and place `stylex-mangle-classnames` after it. Provide a complete `@stylexjs/rollup-plugin` Vite example and explain that Babel alone cannot extract CSS.

Add this compatibility fix to the existing unreleased `0.1.0` changelog entry. Do not add a patch changeset: `0.1.0` has not been published, so there is no released version to increment to `0.1.1`.

## Completion Criteria

- The exact late-CSS mismatch reproduces before the implementation and passes afterward.
- Runtime-injected and ordinary bundled-CSS behavior remains green.
- Late CSS collision protection is verified.
- The README no longer implies that setting Babel's `runtimeInjection` to `false` is sufficient.
- No StyleX compiler or extractor dependency is added to this package.
- The package remains unpublished and at version `0.1.0`.

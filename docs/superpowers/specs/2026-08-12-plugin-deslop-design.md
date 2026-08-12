# Plugin Cleanup Design

## Goal

Reduce duplication, indirection, and repository-only process artifacts across the plugin without weakening its supported behavior.

## Scope

- Keep `src/class-names.ts` responsible for pure StyleX class discovery and rewriting.
- Keep `src/index.ts` responsible for Vite lifecycle integration and output-file handling.
- Remove repeated class discovery and rewrite passes within each build phase.
- Flatten production flow so bundled and late-emitted CSS follow the same register, validate, and rewrite sequence.
- Simplify test scaffolding where it obscures public behavior.
- Remove `docs/superpowers/` from the final repository.
- Retain public documentation, community files, CI, and Changesets configuration.

## Non-goals

- No new abstraction layer, class hierarchy, dependency injection, or generic utility module.
- No deliberate change to the default export, the required `classNamePrefix` option, Node support, or the Vite 5 through 8 peer range.
- No loss of support for StyleX CSS emitted during either `generateBundle` or a preceding `writeBundle` hook.

## Runtime Design

Development transforms register and rewrite the current module once.

During `generateBundle`, the plugin gathers emitted text, registers the complete sorted StyleX class set for deterministic output, validates authored CSS collisions, and rewrites each emitted text output. Rewriting uses the already-established mapping and does not rediscover names.

During `writeBundle`, the plugin finds CSS files not represented in the Rollup bundle, reads all of them before making changes, registers all newly discovered classes, validates collisions across the complete late-emitted set, and writes only changed files. Directory symlinks remain ignored and filesystem errors remain visible.

## Verification

Tests remain focused on observable contracts:

- deterministic short-name assignment;
- consistent rewriting across JavaScript, CSS, and HTML;
- exclusions for StyleX constants, custom properties, keyframes, and authored classes;
- collision failures before output mutation;
- development and production hook behavior;
- the production source-map guard;
- real Vite handling of late-emitted CSS.

The final gate is `pnpm run check`, Changesets status, a package dry run, and a clean Git diff.

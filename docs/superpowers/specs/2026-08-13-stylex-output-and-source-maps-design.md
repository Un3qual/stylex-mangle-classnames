# StyleX Output and Source Maps Design

## Objective

Support class-name mangling for both runtime-injected and extracted StyleX output, preserve accurate production JavaScript source maps, and describe the package in direct, release-ready language.

## Compatibility

- Vite 5 through Vite 8 remain supported.
- The plugin supports StyleX builds with `runtimeInjection` enabled or disabled.
- `classNamePrefix` must exactly match the prefix used by the StyleX compiler.
- The plugin must not depend on private state or metadata from another StyleX plugin.
- Independently executed client and SSR builds still require the same generated class set to produce the same mapping.

## Generated Class Discovery

Runtime-injected output retains the existing rule-based discovery. A canonical prefixed class found in an emitted StyleX `ltr` or `rtl` rule is registered as generated.

Extracted output is discovered from the generated class values in compiled StyleX style objects. This is emitted program output rather than private state from the StyleX plugin, and it distinguishes generated classes from unrelated prefix-shaped strings without waiting for CSS assets.

Discovery runs across transformed JavaScript modules before rendering. The complete class set is sorted once, then JavaScript chunks are rewritten in `renderChunk` so content hashes incorporate the final code. CSS and HTML assets already present in the output bundle are rewritten in `generateBundle`.

Extracted builds must provide a CSS asset for `@stylexjs/unplugin` to update during `generateBundle`. Its CSS-free fallback is written during `writeBundle`, after chunk hashes and related metadata are final, so that fallback is left unchanged.

## Rewriting and Collisions

Only registered generated classes are rewritten. Runtime `constKey` registrations, CSS custom-property names, keyframe suffixes, unrelated authored classes, and unrelated application data remain unchanged.

Collision detection scans CSS selector preludes rather than declarations, strings, or comments. Registered canonical StyleX selectors are excluded; a generated short name still causes a build failure when that name already appears as a separate authored selector.

## Production Source Maps

Class-name edits to JavaScript chunks produce a high-resolution edit map from `renderChunk`. Rollup composes that map with preceding transforms and serializes the result, so generated positions continue to resolve to the original source files. This applies to Vite's supported source-map modes:

- `true`: an external map and source-map comment;
- `"hidden"`: an external map without a source-map comment; and
- `"inline"`: an inline data URL.

CSS and HTML source maps are outside this change because Vite does not expose corresponding output maps for the text assets rewritten by this plugin.

## Documentation

The README uses `@stylexjs/unplugin` as the primary current StyleX configuration. It states that both extracted CSS and runtime injection are supported, describes plugin ordering, and replaces the milestone-oriented "MVP limitations" section with factual compatibility notes.

Repository documentation will avoid conversational filler, release-process narration in user-facing sections, and speculative wording. The changelog and a patch changeset will describe the observable behavior changes.

## Verification

Automated tests will cover:

- runtime-injected rule discovery;
- extracted CSS discovery from compiled StyleX style objects;
- preservation of uncorroborated prefix-shaped CSS and application data;
- collision detection with extracted output;
- source-map modes `true`, `"hidden"`, and `"inline"`;
- mapping a rewritten generated position back to the original source position;
- hashed chunk filenames, inline map text, and missing source content; and
- the existing development and production behavior.

The full `pnpm run check` and `pnpm pack --dry-run` commands must pass before completion.

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

Extracted output uses corroborated discovery. A canonical prefixed class is registered only when it appears both:

1. as a selector in emitted CSS; and
2. as an exact class reference in emitted JavaScript, HTML, or another non-CSS text output.

This supports the current `@stylexjs/unplugin` Vite flow without treating every prefix-shaped selector as StyleX. A prefix-shaped authored selector with no matching emitted reference remains unchanged, and a prefix-shaped application value with no matching emitted CSS selector remains unchanged.

Discovery runs across the complete output bundle before any replacements, so every output uses one deterministic mapping. CSS written by an earlier `writeBundle` hook is also eligible for corroborated discovery against the already-emitted non-CSS bundle output. When late CSS adds newly discovered classes, the plugin rewrites the emitted JavaScript, HTML, CSS, and JavaScript source-map files on disk as one operation.

## Rewriting and Collisions

Only registered generated classes are rewritten. Runtime `constKey` registrations, CSS custom-property names, keyframe suffixes, unrelated authored classes, and unrelated application data remain unchanged.

Collision detection distinguishes StyleX selectors used to corroborate extracted output from authored CSS. A generated short name still causes a build failure when that name already appears as a separate authored selector.

## Production Source Maps

Class-name edits to JavaScript chunks produce a high-resolution edit map. The edit map is composed with the chunk's existing Rollup/Vite map so generated positions continue to resolve to the original source files.

The plugin updates the chunk map before Rollup serializes it. If late StyleX CSS requires an on-disk rewrite, it applies the same edit-map composition to the emitted chunk and rewrites the serialized map. This applies to Vite's supported source-map modes:

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
- extracted CSS discovery from matching CSS selectors and emitted references;
- preservation of uncorroborated prefix-shaped CSS and application data;
- collision detection with extracted output;
- source-map modes `true`, `"hidden"`, and `"inline"`;
- mapping a rewritten generated position back to the original source position;
- late-emitted extracted CSS together with its JavaScript references and source map; and
- the existing development and production behavior.

The full `pnpm run check` and `pnpm pack --dry-run` commands must pass before completion.

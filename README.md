# @un3qual/stylex-mangle-classnames

[![CI](https://github.com/Un3qual/stylex-mangle-classnames/actions/workflows/ci.yml/badge.svg)](https://github.com/Un3qual/stylex-mangle-classnames/actions/workflows/ci.yml)

A Vite plugin that shortens generated StyleX atomic class names to a contiguous alphabetic sequence:

```text
a, b, c, ... z, aa, ab, ...
```

The plugin discovers generated classes from StyleX output and rewrites their references consistently across emitted JavaScript, CSS, and HTML. It does not rewrite unrelated application data or authored CSS that happens to use the same prefix.

## Install

```sh
pnpm add --save-dev @un3qual/stylex-mangle-classnames
```

`vite` is a peer dependency.

## Configure

Place the mangler after the plugin that compiles StyleX and after any other plugin with a post-ordered `generateBundle` hook that reads emitted filenames. Use the same `classNamePrefix` in both plugins.

### Extracted CSS

Use `@stylexjs/unplugin` for extracted CSS:

```ts
import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import stylexMangleClassNames from "@un3qual/stylex-mangle-classnames";

const classNamePrefix = "sx";

export default defineConfig({
  plugins: [
    stylex.vite({ classNamePrefix }),
    ...react(),
    stylexMangleClassNames({ classNamePrefix }),
  ],
});
```

Ensure the application emits a CSS asset, for example by importing an application stylesheet. Current `@stylexjs/unplugin` builds append extracted StyleX rules to that asset during `generateBundle`, where the mangler can rewrite them before output is written. A CSS-free extracted build fails with an actionable error because StyleX writes its fallback stylesheet after output metadata is finalized.

### Runtime-injected CSS

Runtime injection is also supported:

```ts
stylex.vite({
  classNamePrefix,
  runtimeInjection: true,
});
```

During Vite development, runtime-injected rules are shortened in module transforms. With extracted CSS, `@stylexjs/unplugin` serves its development stylesheet directly; those development class names remain unchanged, while production output is shortened.

## API

```ts
stylexMangleClassNames({ classNamePrefix: string }): Plugin
```

`classNamePrefix` must start with an ASCII letter and contain only ASCII letters and numbers. It must exactly match the prefix configured in StyleX.

## Behavior

- Generated classes are discovered from compiled StyleX style objects and runtime `ltr` or `rtl` rules before chunks are rendered.
- Only canonical lowercase base-36 StyleX class names are shortened.
- Runtime `constKey` registrations, CSS custom properties, keyframe suffixes, unrelated classes, and unrelated application data remain unchanged.
- One deterministic mapping is used for the complete class set in each output bundle.
- The build fails if a generated short name collides with an authored CSS class.
- JavaScript source maps remain accurate for Vite's external, hidden, and inline production source-map modes.

Short names are build artifacts. Do not persist them or depend on a specific StyleX rule retaining the same short name when the generated class set changes.

## Compatibility

- Vite 5 through Vite 8.
- ESM projects.
- Extracted and runtime-injected StyleX output.
- The mangler must run after other `generateBundle` hooks that call Rollup's `getFileName`; Rollup does not provide an API for synchronizing file-reference IDs after an output filename changes.
- Extracted builds must emit a CSS asset before `writeBundle`; CSS-free extracted builds fail instead of emitting mismatched JavaScript and CSS.
- Client and SSR builds that contain the same generated StyleX class set. Independently executed builds with different class sets may assign different short names because mappings are not shared across build processes.

## Development

```sh
corepack enable
pnpm install
pnpm run check
pnpm pack --dry-run
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and release requirements. Report security issues through the private process in [SECURITY.md](./SECURITY.md).

## License

MIT.

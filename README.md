# stylex-mangle-classnames

[![CI](https://github.com/Un3qual/stylex-mangle-classnames/actions/workflows/ci.yml/badge.svg)](https://github.com/Un3qual/stylex-mangle-classnames/actions/workflows/ci.yml)

A small Vite plugin that shortens generated StyleX atomic class names to a contiguous alphabetic sequence:

```text
a, b, c, ... z, aa, ab, ...
```

It discovers atomic classes from emitted StyleX `ltr` and `rtl` rules, then rewrites those exact class references consistently across emitted JavaScript, CSS, and HTML. Prefix-shaped application data and authored CSS are left untouched. It also handles Vite development transforms so local output uses the same short-name format.

## Install

This package is not published to npm yet. After the first release, install it with:

```sh
pnpm add --save-dev stylex-mangle-classnames
```

`vite` is a peer dependency. The MVP supports Vite 5 through Vite 8 and is ESM-only.

## Configure

Use one prefix for both the StyleX compiler and this plugin. The mangler must run after the plugin that compiles StyleX:

When StyleX uses `runtimeInjection: true`, its Babel plugin keeps the generated rules in JavaScript:

```ts
import stylexPlugin from "@stylexjs/babel-plugin";
import babel from "@rolldown/plugin-babel";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import stylexMangleClassNames from "stylex-mangle-classnames";

const classNamePrefix = "sx";

export default defineConfig({
  plugins: [
    ...react(),
    babel({
      plugins: [
        [
          stylexPlugin,
          {
            classNamePrefix,
            dev: process.env.NODE_ENV !== "production",
            runtimeInjection: true,
          },
        ],
      ],
    }),
    stylexMangleClassNames({ classNamePrefix }),
  ],
});
```

`classNamePrefix` must exactly match the prefix given to this plugin.

## API

```ts
stylexMangleClassNames({ classNamePrefix: string }): Plugin
```

The prefix must start with an ASCII letter and contain only ASCII letters and numbers.

## Behavior

- Only canonical lowercase base-36 classes discovered in emitted StyleX `ltr` or `rtl` rules are shortened.
- Prefix-shaped application data and authored CSS without a matching StyleX rule are preserved.
- Runtime `constKey` registrations, CSS custom-property names, keyframe suffixes, and unrelated authored classes are left intact.
- Production mappings are deterministic for the complete class set in one output bundle.
- The build fails if a generated short name would collide with an authored class in emitted CSS.
- Short names are build artifacts. Do not persist them or rely on a particular StyleX rule keeping the same short name after the generated class set changes.

## MVP limitations

- Vite is the only supported bundler.
- StyleX must use `runtimeInjection: true` so the plugin can identify generated classes without guessing from a prefix. Extracted-only StyleX output is not supported yet.
- Independently executed client and SSR builds must contain the same generated StyleX class set to receive the same mapping. A shared cross-build manifest is not implemented yet.
- Production source maps are not rewritten yet. This version fails configuration when `build.sourcemap` is enabled rather than emitting stale mappings.

## Development

```sh
corepack enable
pnpm install
pnpm run check
pnpm pack --dry-run
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Report security issues using the private process in [SECURITY.md](./SECURITY.md).

## License

MIT.

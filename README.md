# @un3qual/stylex-mangle-classnames

[![CI](https://github.com/Un3qual/stylex-mangle-classnames/actions/workflows/ci.yml/badge.svg)](https://github.com/Un3qual/stylex-mangle-classnames/actions/workflows/ci.yml)

A Vite plugin that shortens generated StyleX atomic class names to a contiguous alphabetic sequence:

```text
a, b, c, ... z, aa, ab, ...
```

The plugin discovers classes from runtime-injected StyleX rules and rewrites JavaScript during chunk rendering, before Vite calculates output hashes and source maps.

## Install

```sh
pnpm add --save-dev @un3qual/stylex-mangle-classnames
```

Vite 8 is a peer dependency.

## Configure

Use the same `classNamePrefix` in StyleX and the mangler. Place the mangler after the plugin that compiles StyleX, and enable runtime injection so generated rules remain in JavaScript:

```ts
import stylexPlugin from "@stylexjs/babel-plugin";
import babel from "@rolldown/plugin-babel";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import stylexMangleClassNames from "@un3qual/stylex-mangle-classnames";

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

## API

```ts
stylexMangleClassNames({ classNamePrefix: string }): Plugin
```

`classNamePrefix` must start with an ASCII letter, contain only ASCII letters and numbers, and exactly match the StyleX compiler configuration.

## Behavior

- Only canonical lowercase base-36 classes found in StyleX `ltr` or `rtl` rules are shortened.
- One sorted mapping is used for all JavaScript chunks in a build.
- JavaScript is rewritten before Vite calculates chunk hashes.
- External, hidden, and inline production source maps retain their original positions.
- Runtime `constKey` registrations, CSS custom properties, keyframe suffixes, unrelated classes, and prefix-shaped application data remain unchanged.
- The build fails if a generated short name collides with an authored class selector in a Rollup-emitted CSS rule.

Short names are build artifacts. Their assignments may change when the generated class set changes.

Collision checks do not scan files copied from Vite's `publicDir` or selector-like syntax in at-rule preludes such as `@scope`.

## Compatibility

- Vite 8.
- Node.js 20.19+ or 22.12+.
- ESM projects.
- StyleX builds with `runtimeInjection: true`.

Extracted StyleX output is not supported. The current StyleX unplugin emits extracted CSS during `generateBundle`, after Vite's chunk transformation and hashing stages. Supporting that lifecycle would require this package to take ownership of output hashing and filename references.

Client and SSR builds must contain the same generated StyleX class set to produce the same mapping.

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

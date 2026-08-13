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

Place the mangler after the plugin that compiles StyleX. Use the same `classNamePrefix` in both plugins.

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

The mangler identifies an extracted class only when the emitted CSS selector has a matching class reference in JavaScript or HTML. This avoids treating every prefix-shaped selector as generated StyleX output.

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

- Runtime-injected classes are discovered from emitted StyleX `ltr` and `rtl` rules.
- Extracted classes are discovered from matching emitted CSS selectors and JavaScript or HTML references.
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

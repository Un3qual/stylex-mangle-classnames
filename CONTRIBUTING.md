# Contributing

Thanks for helping improve `@un3qual/stylex-mangle-classnames`.

## Development setup

Local development uses Node.js 20.19 or newer and pnpm 11.18.0 through Corepack:

```sh
corepack enable
pnpm install
pnpm run check
```

Fork the repository, create a focused branch, and keep each change limited to one clear concern. The plugin supports Node.js 18 for consumers because Vite 5 remains in its peer range; the newer local Node requirement comes from the current Vite development dependency.

## Tests

Add or update focused behavior tests for runtime changes. Tests should assert the public plugin contract rather than private implementation structure.

Run the full validation suite before opening a pull request:

```sh
pnpm run check
pnpm pack --dry-run
```

Review the package dry-run output for unintended files.

## Changesets

Run `pnpm changeset` for user-visible fixes and features. Select the package, choose the semantic-version impact, and describe the outcome for users. Documentation, tests, CI, and repository-only maintenance do not require a changeset.

Changesets do not publish this package automatically.

## Pull requests

- Explain the problem and the chosen solution.
- Keep unrelated cleanup out of the change.
- Include verification commands and results.
- Update the README when configuration, guarantees, or limitations change.
- Confirm whether the change needs a changeset.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [SECURITY.md](./SECURITY.md).

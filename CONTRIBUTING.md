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

## Releases

### First npm release

The initial `0.1.0` release bootstraps npm trusted publishing:

1. Confirm that you own or can publish public packages under the `@un3qual` npm scope.
2. Run the complete local release checks:

   ```sh
   pnpm run check
   pnpm changeset status
   pnpm pack --dry-run --json
   npm publish --dry-run --access public
   ```

3. Authenticate locally with npm, then publish `0.1.0` exactly once:

   ```sh
   npm login
   npm publish --access public
   ```

4. Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) with these values:

   - Provider: GitHub Actions
   - Organization or user: `Un3qual`
   - Repository: `stylex-mangle-classnames`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`

5. Create the non-prerelease GitHub Release `v0.1.0`. The workflow recognizes that the exact version is already published and exits successfully.

The repository does not store an npm publishing token.

### Future releases

Commit a Changeset with every user-visible change. When a release is ready, run `pnpm version-packages`, review the resulting package version and changelog, then commit and push those changes to `main`. Create a non-prerelease GitHub Release whose tag is exactly `v${package.json.version}`.

The publishing workflow verifies and publishes that version through npm trusted publishing. It never selects or changes a version.

## Pull requests

- Explain the problem and the chosen solution.
- Keep unrelated cleanup out of the change.
- Include verification commands and results.
- Update the README when configuration, guarantees, or limitations change.
- Confirm whether the change needs a changeset.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [SECURITY.md](./SECURITY.md).

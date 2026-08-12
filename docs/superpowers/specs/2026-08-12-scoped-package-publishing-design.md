# Scoped Package Publishing Design

## Goal

Prepare the repository to publish `@un3qual/stylex-mangle-classnames` as a public npm package, bootstrap version `0.1.0` manually, and publish later releases through GitHub Actions without a stored npm token.

## Package Identity

- Set the package name to `@un3qual/stylex-mangle-classnames`.
- Keep version `0.1.0`; the npm registry currently returns 404 for that scoped name.
- Publish publicly to `https://registry.npmjs.org`.
- Update the README title, installation command, and import examples to use the scoped name.
- Update Changesets and contributor guidance to use the scoped name.
- Keep the Vite plugin name and runtime error prefix as `stylex-mangle-classnames`; these identify the plugin in build output rather than the npm package.
- Keep the empty bootstrap Changeset so the unreleased initial version remains valid.

## Release Workflow

Add `.github/workflows/publish.yml`, triggered by a published GitHub Release. The publish job uses:

- a GitHub-hosted Ubuntu runner;
- Node.js 24;
- pinned pnpm through Corepack;
- npm 11.5.1 or newer;
- `contents: read` and `id-token: write` permissions;
- the `npm` deployment environment;
- no `NPM_TOKEN`.

The job rejects prereleases, requires the release tag to equal `v${package.json.version}`, installs frozen dependencies, and checks whether the exact package version already exists. An existing version exits successfully, making the workflow safe when the `v0.1.0` GitHub Release is created after the manual bootstrap. Otherwise, `npm publish --access public` invokes the existing `prepack` gate and publishes through npm trusted publishing with automatic provenance.

Version selection stays outside the workflow. Changesets updates `package.json` and `CHANGELOG.md`; the maintainer then creates the matching GitHub Release.

## Bootstrap and Trust Configuration

The first publish cannot use npm trusted publishing because npm only allows a trusted publisher to be configured after the package exists. The documented bootstrap is:

1. Confirm ownership of the `@un3qual` npm scope.
2. Run the complete local verification and dry-run commands.
3. Publish `0.1.0` manually with public access.
4. Configure npm trusted publishing for GitHub repository `Un3qual/stylex-mangle-classnames`, workflow `publish.yml`, environment `npm`, and `npm publish` permission.
5. Use published GitHub Releases for later versions.

No real npm publication is part of this implementation.

## Failure Behavior

- A release tag that does not match `package.json` fails before publication.
- A prerelease never reaches the publish command.
- An already-published exact version exits successfully.
- Installation, typecheck, tests, build, packaging, or npm authentication failures remain visible.
- The workflow never derives or mutates a package version.

## Verification

- `pnpm run check`
- `pnpm changeset status`
- parse all workflow YAML files
- `pnpm pack --dry-run --json`
- `npm publish --dry-run --access public`
- inspect package metadata and packed contents for the scoped name
- confirm no token secret appears in the workflow

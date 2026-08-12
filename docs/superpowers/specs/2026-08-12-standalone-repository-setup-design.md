# Standalone Repository Setup Design

## Goal

Turn the extracted StyleX class-name mangler into a clean, trustworthy open-source repository that is ready for collaborative development and a later npm release. Preserve the MIT license already committed on GitHub. Do not publish the package or add automated release/publish jobs in this setup.

## Repository and History

- Connect the local checkout to `https://github.com/Un3qual/stylex-mangle-classnames` as `origin`.
- Preserve GitHub's existing initial commit and its MIT `LICENSE` rather than force-pushing over it.
- Replace the extracted GPL license file and every GPL metadata/documentation reference with the repository's existing MIT license and `MIT` SPDX identifier.
- Integrate the local work with the remote history, then push only after the complete audit and verification pass.
- Keep generated files, dependency directories, archives, editor files, and OS metadata out of Git.

## Extraction Audit

Audit every tracked source, test, configuration, and documentation file before the first push.

A file or behavior stays only when it supports one of these plugin responsibilities:

1. Validate the configured StyleX class-name prefix.
2. Find canonical generated StyleX atomic class names without rewriting protected StyleX runtime identifiers or unrelated authored names.
3. Allocate deterministic short alphabetic names.
4. Rewrite matching Vite development transforms and production text outputs consistently.
5. Detect authored-CSS collisions.
6. Fail closed for unsupported production source maps.
7. Build, test, typecheck, package, document, or maintain the standalone plugin.

Delete extracted application code, fixtures, scripts, dependencies, configuration, or tests that cannot be mapped to that contract. Retain focused edge-case tests because they define safety behavior, not merely because they existed in the source project. Avoid changing runtime behavior during repository setup unless the audit finds an actual standalone-packaging defect.

## Package Surface

The npm package remains ESM-only and exports one default Vite plugin plus its public options type. Its package metadata will include accurate MIT licensing, repository, homepage, bug-tracker, keywords, supported Node/Vite ranges, and published-file boundaries.

The build will emit JavaScript, declarations, declaration maps, and source maps into `dist`. The package tarball must contain only the runtime distribution and intended public documents. Package verification will inspect the actual dry-run tarball contents rather than infer them from configuration.

No npm credentials, provenance job, release token, GitHub release workflow, or automated publish workflow will be added yet.

## Open-Source Project Surface

Add a focused project scaffold:

- `CONTRIBUTING.md` with prerequisites, setup, checks, changeset expectations, and pull-request guidance.
- `CODE_OF_CONDUCT.md` using the Contributor Covenant.
- `SECURITY.md` with supported-version and private-reporting instructions.
- `CHANGELOG.md` and Changesets configuration for recording user-visible changes without publishing them automatically.
- Bug-report and feature-request issue forms, issue-form configuration, and a pull-request template.
- Dependabot configuration for npm and GitHub Actions updates.
- Editor-independent defaults where useful, without adding a formatter or linter merely for ceremony.

The README will remain user-first: installation, configuration, API, guarantees, limitations, development commands, contribution/security links, and MIT licensing. It will not claim the package is published until that is true.

## Continuous Integration

Add one minimal GitHub Actions CI workflow that runs on pull requests and pushes to `main`. It will:

1. Check out the repository.
2. Install the declared pnpm version through Corepack.
3. Install dependencies from the frozen lockfile.
4. Run the repository's full check command.
5. Run the package dry run so accidental publish-surface changes fail CI.

Use a currently supported Node version compatible with the development Vite version. Compatibility with the declared peer range is primarily maintained through Vite's public plugin types and the plugin's focused hook tests; no unnecessarily large version matrix will be added in this setup.

## GitHub Configuration

After the verified code is pushed, align low-risk repository settings with the committed project files: description, homepage when appropriate, topic tags, automatic deletion of merged branches, and private vulnerability reporting. Do not configure npm publishing, release automation, branch protection rules that could lock out the maintainer, or external services.

## Verification and Completion

Before the first code push:

- Confirm the worktree contains no unrelated extraction residue.
- Confirm all license signals say MIT and the license text matches the existing GitHub file.
- Run typechecking, unit tests, and the production build through the full check command.
- Run the package dry run and review every included path.
- Inspect Git status and the final diff for generated or private files.
- Integrate the remote MIT commit without rewriting remote history.
- Push the verified commits and confirm the remote branch state.

The setup is complete when GitHub contains the audited plugin, open-source scaffold, passing CI configuration, accurate MIT/package metadata, and no publishing automation.

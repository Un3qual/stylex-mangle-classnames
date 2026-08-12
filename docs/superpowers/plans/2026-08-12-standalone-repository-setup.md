# Standalone Repository Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the audited StyleX class-name mangler source to its existing GitHub repository as a polished MIT-licensed open-source project, without npm publishing or release automation.

**Architecture:** Preserve the GitHub MIT root commit and replay the approved design onto it so the extracted GPL commit never reaches the remote. Keep the runtime plugin behavior unchanged, tighten the package boundary and metadata, then layer maintainership documents, GitHub templates, dependency updates, and one CI workflow around the focused TypeScript package.

**Tech Stack:** TypeScript 5.9, Vite 5-8 plugin API, Vitest 4, pnpm 11, Changesets, GitHub Actions, GitHub issue forms, Dependabot.

## Global Constraints

- Use the MIT license already committed at `Un3qual/stylex-mangle-classnames`; no GPL license signal may remain on the branch or in the package tarball.
- Audit every extracted source, test, dependency, configuration, and document before the first push.
- Keep runtime behavior unchanged unless the audit identifies a standalone-packaging defect.
- Keep the package ESM-only with one default Vite plugin export and its public options type.
- Do not add npm credentials, provenance, GitHub release jobs, automated publishing, branch protection, or external services.
- Do not push until the full local check, package-content review, diff review, and history review pass.

---

### Task 1: Normalize History and Audit the Extracted Package

**Files:**
- Preserve from remote: `LICENSE`
- Restore and audit: `.gitignore`
- Restore and audit: `README.md`
- Restore and audit: `package.json`
- Restore and audit: `pnpm-lock.yaml`
- Restore and audit: `src/class-names.ts`
- Restore and audit: `src/index.ts`
- Restore and audit: `test/plugin.test.ts`
- Restore and audit: `tsconfig.json`
- Restore and audit: `tsconfig.build.json`
- Restore and audit: `vitest.config.ts`
- Create: `.editorconfig`
- Create: `.gitattributes`

**Interfaces:**
- Consumes: GitHub commit `8fbae63c0b34fb0d75e178174cd27005317f9576`, which owns the canonical MIT `LICENSE`; extracted source commit `e63eec9`.
- Produces: a `main` history rooted at `origin/main`, an audited standalone package, and accurate npm metadata consumed by CI and package verification.

- [ ] **Step 1: Attach the GitHub repository and fetch its MIT root**

```bash
git branch extracted-mvp-backup e63eec9
git remote add origin https://github.com/Un3qual/stylex-mangle-classnames.git
git fetch origin main
git rebase --onto origin/main e63eec9 main
```

Expected: `main` contains the GitHub MIT initial commit followed by the rebased design commit; `extracted-mvp-backup` retains the extracted files locally but is never pushed.

- [ ] **Step 2: Restore only the candidate standalone-package files**

```bash
git restore --source extracted-mvp-backup -- .gitignore README.md package.json pnpm-lock.yaml src test tsconfig.json tsconfig.build.json vitest.config.ts
git status --short
```

Expected: the plugin source, its focused test file, and build/package configuration appear as additions; the GPL `LICENSE`, `dist`, `node_modules`, and `.DS_Store` do not appear.

- [ ] **Step 3: Map every restored file to the plugin contract**

Review `src/class-names.ts`, `src/index.ts`, and every case in `test/plugin.test.ts` against the seven responsibilities in the approved design. Review each dependency and configuration key against build, typecheck, test, package, or Vite-peer needs.

Expected audit disposition:

| Item | Disposition | Reason |
| --- | --- | --- |
| `src/class-names.ts` | Keep | Finds, allocates, and rewrites canonical StyleX class names. |
| `src/index.ts` | Keep | Implements the Vite hooks, validation, collision checks, and source-map fail-closed behavior. |
| `test/plugin.test.ts` | Keep all focused cases | Each case asserts a documented mapping, protection, collision, validation, development, build, or source-map guarantee. |
| TypeScript and Vitest configs | Keep | Build declarations and execute the package contract tests. |
| `typescript`, `vite`, `vitest` | Keep | Compiler, peer API/type source, and test runner. |
| `dist`, `node_modules`, `.DS_Store` | Exclude | Generated, installed, or machine-local content. |

Delete any item whose actual contents do not match this table before continuing.

- [ ] **Step 4: Correct package metadata and public scripts**

Update `package.json` to retain the existing build/check/prepack scripts and add these exact public metadata fields:

```json
{
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Un3qual/stylex-mangle-classnames.git"
  },
  "homepage": "https://github.com/Un3qual/stylex-mangle-classnames#readme",
  "bugs": {
    "url": "https://github.com/Un3qual/stylex-mangle-classnames/issues"
  },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"]
}
```

Retain `engines.node` as `>=18`, the Vite peer range as `>=5.0.0 <9.0.0`, and `publishConfig.access` as `public`. Do not add a publish script.

- [ ] **Step 5: Make repository hygiene explicit**

Set `.gitignore` to ignore `dist/`, `node_modules/`, `coverage/`, `*.tgz`, `*.log`, and `.DS_Store`. Add `.gitattributes` with `* text=auto eol=lf`. Add `.editorconfig` with UTF-8, LF endings, final newlines, two-space indentation for TypeScript/JSON/YAML, and trailing-whitespace preservation only for Markdown.

- [ ] **Step 6: Update the README for pre-publication and MIT status**

Keep the usage example, API, guarantees, and limitations. Change installation copy to say the package is not yet published and show the future npm command without claiming it currently succeeds. Add repository setup commands using pnpm, link `CONTRIBUTING.md` and `SECURITY.md`, and change the license section to `MIT`.

- [ ] **Step 7: Verify the audited package baseline**

Run:

```bash
rg -n -i 'GPL|GNU General Public License|copyleft' --glob '!pnpm-lock.yaml' --glob '!docs/superpowers/**' .
pnpm run check
git diff --check
git status --short
```

Expected: the license scan has no matches, the check command passes, the diff check is silent, and Git status lists only intended package/repository files.

- [ ] **Step 8: Commit the audited standalone package**

```bash
git add .gitattributes .editorconfig .gitignore LICENSE README.md package.json pnpm-lock.yaml src test tsconfig.json tsconfig.build.json vitest.config.ts
git commit -m "feat: add audited standalone plugin"
```

### Task 2: Add Changelog and Contributor Documentation

**Files:**
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`
- Create: `CHANGELOG.md`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the package commands and metadata from Task 1.
- Produces: `pnpm changeset` for recording user-visible work and stable contributor/security policies linked from the README.

- [ ] **Step 1: Install Changesets without release automation**

```bash
pnpm add --save-dev @changesets/cli
```

Add only these scripts to `package.json`:

```json
{
  "changeset": "changeset",
  "version-packages": "changeset version"
}
```

Do not add `changeset publish` or a release workflow.

- [ ] **Step 2: Configure Changesets for a single public package**

Create `.changeset/config.json` with:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

Create `.changeset/README.md` explaining that contributors run `pnpm changeset` for user-visible fixes/features, select the package and semver impact, and omit changesets for documentation, tests, and repository-only maintenance.

- [ ] **Step 3: Add the initial changelog**

Create `CHANGELOG.md` with a Keep a Changelog-style `0.1.0` entry dated `2026-08-12`, labelled as not yet published, covering the Vite development/build rewriting, deterministic mapping, collision protection, and unsupported source-map guard.

- [ ] **Step 4: Add contribution, conduct, and security policies**

Create:

- `CONTRIBUTING.md`: Node 20.19+ for local development, pnpm 11.18.0 through Corepack, fork/branch/install/check workflow, focused-test expectations, changeset rules, and pull-request checklist.
- `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1 with enforcement reports directed privately through the maintainer's contact links on the `Un3qual` GitHub profile; prohibit posting sensitive reports in public issues.
- `SECURITY.md`: pre-1.0 support policy, GitHub private vulnerability-reporting URL, requested reproduction/impact/version details, and a warning not to open public vulnerability issues.

- [ ] **Step 5: Verify documentation and Changesets configuration**

Run:

```bash
pnpm changeset status
pnpm run check
git diff --check
```

Expected: Changesets recognizes the single package and reports no pending changesets, the package check passes, and the diff check is silent.

- [ ] **Step 6: Commit the project-maintenance layer**

```bash
git add .changeset CHANGELOG.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md package.json pnpm-lock.yaml
git commit -m "docs: add open source project guidance"
```

### Task 3: Add GitHub Collaboration Templates and Dependency Updates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: the checks, support limits, and reporting channels documented in Tasks 1 and 2.
- Produces: structured issue intake, a concrete pull-request checklist, and weekly grouped dependency-update pull requests.

- [ ] **Step 1: Add structured issue forms**

Create a bug form requiring plugin version/source revision, Vite version, Node version, package manager, operating system, minimal reproduction, configuration, actual behavior, and expected behavior. Create a feature form requiring the use case, proposed behavior, alternatives, and scope fit. Disable blank issues and link security reports to `https://github.com/Un3qual/stylex-mangle-classnames/security/advisories/new`.

- [ ] **Step 2: Add a focused pull-request template**

Require a summary, motivation, verification commands, behavioral-risk notes, documentation confirmation, and a changeset checkbox with an explicit repository-only exception.

- [ ] **Step 3: Configure Dependabot**

Create weekly Monday updates for `npm` and `github-actions`, each limited to five open pull requests. Group npm development dependencies into one update group and assign the `dependencies` label. Use `/` as the package directory.

- [ ] **Step 4: Validate the GitHub YAML files**

Run:

```bash
ruby -e 'require "yaml"; Dir[".github/**/*.yml"].each { |path| YAML.load_file(path); puts path }'
git diff --check
```

Expected: every `.yml` path prints without a parser exception and the diff check is silent.

- [ ] **Step 5: Commit the collaboration configuration**

```bash
git add .github/ISSUE_TEMPLATE .github/pull_request_template.md .github/dependabot.yml
git commit -m "chore: add GitHub collaboration defaults"
```

### Task 4: Add Continuous Integration

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `packageManager`, `pnpm-lock.yaml`, `pnpm run check`, and the npm `files` allowlist.
- Produces: a required-quality signal for pushes and pull requests, without any release or publish permissions.

- [ ] **Step 1: Add the CI workflow**

Create `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - run: corepack install
      - run: pnpm install --frozen-lockfile
      - run: pnpm run check
      - run: pnpm pack --dry-run
```

- [ ] **Step 2: Add a CI badge without an npm-release claim**

Add the badge target `https://github.com/Un3qual/stylex-mangle-classnames/actions/workflows/ci.yml` below the README title. Do not add npm version, download, or release badges.

- [ ] **Step 3: Validate CI locally**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml"); puts "workflow YAML parsed"'
pnpm install --frozen-lockfile
pnpm run check
pnpm pack --dry-run
git diff --check
```

Expected: YAML parses, the frozen install and all checks pass, the dry run lists only intended package files, and the diff check is silent.

- [ ] **Step 4: Commit CI**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: verify builds and package contents"
```

### Task 5: Final Audit, Push, and GitHub Settings

**Files:**
- Review: all tracked files
- Review: generated `dist/**`
- Review: package dry-run manifest
- Modify remote settings only through GitHub API after push

**Interfaces:**
- Consumes: all deliverables and checks from Tasks 1-4.
- Produces: the first verified source push and aligned GitHub repository metadata.

- [ ] **Step 1: Run the fresh verification suite**

```bash
pnpm run check
pnpm pack --dry-run --json
rg -n -i 'GPL|GNU General Public License|copyleft' --glob '!pnpm-lock.yaml' --glob '!docs/superpowers/**' .
git diff --check
git status --short --branch
```

Expected: checks pass; the tarball contains only `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, and `dist` JavaScript/type/map outputs; the GPL scan is empty; the worktree is clean.

- [ ] **Step 2: Review history and extraction scope**

```bash
git log --oneline --decorate origin/main..main
git diff --stat origin/main...main
git ls-files
```

Expected: the pushed range starts after GitHub's MIT initial commit, contains coherent design/package/docs/GitHub/CI commits, and contains no extracted GPL root, generated output, dependency directory, archive, or machine-local file.

- [ ] **Step 3: Remove the local extraction backup after confirming recovery is unnecessary**

```bash
git branch -D extracted-mvp-backup
```

Expected: only `main` remains locally; all audited source is already committed on `main`.

- [ ] **Step 4: Push without rewriting remote history**

```bash
git push --set-upstream origin main
```

Expected: fast-forward push succeeds because `origin/main` is an ancestor of local `main`.

- [ ] **Step 5: Align GitHub repository settings**

Use the GitHub API to set:

- Description: `Shorten generated StyleX atomic class names in Vite builds.`
- Homepage: `https://github.com/Un3qual/stylex-mangle-classnames#readme`
- Topics: `stylex`, `vite`, `css`, `minification`, `typescript`.
- Delete head branches automatically after merge: enabled.
- Private vulnerability reporting: enabled.

Do not enable a release workflow, npm integration, or branch protection.

- [ ] **Step 6: Confirm the remote result**

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
gh api repos/Un3qual/stylex-mangle-classnames --jq '{default_branch,delete_branch_on_merge,description,homepage,topics,license:.license.spdx_id}'
gh run list --repo Un3qual/stylex-mangle-classnames --workflow ci.yml --limit 1
```

Expected: the local and remote SHAs match, the branch tracks `origin/main`, metadata reports MIT and the intended values, and the CI run exists or is queued.

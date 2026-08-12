# Scoped Package Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare `@un3qual/stylex-mangle-classnames` for a one-time manual `0.1.0` bootstrap and tokenless npm publication from future GitHub Releases.

**Architecture:** Package metadata and user-facing examples use the scoped npm name. A dedicated GitHub Actions workflow validates the release tag, skips an already-published exact version, and otherwise publishes with npm trusted publishing through GitHub OIDC; version selection remains an explicit Changesets and maintainer responsibility.

**Tech Stack:** npm registry, npm CLI 11.6.2, pnpm 11.18.0, Node.js 24, GitHub Actions, Changesets 3.

## Global Constraints

- Publish the package as `@un3qual/stylex-mangle-classnames` version `0.1.0` with public access.
- Keep the Vite plugin name and runtime error prefix as `stylex-mangle-classnames`.
- Keep the empty bootstrap Changeset for the unreleased initial version.
- Do not store or reference an `NPM_TOKEN` in the publishing workflow.
- Do not perform a real npm publish.
- Use GitHub Release `published` events, the `npm` deployment environment, and GitHub OIDC.
- Remove `docs/superpowers/` from the final repository.

---

### Task 1: Adopt the Scoped npm Package Identity

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.changeset/README.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: the existing ESM package exports and version `0.1.0`.
- Produces: npm metadata and documentation consistently naming `@un3qual/stylex-mangle-classnames`.

- [ ] **Step 1: Prove the scoped metadata assertion is initially red**

Run:

```bash
node --input-type=module --eval 'import packageJson from "./package.json" with { type: "json" }; if (packageJson.name !== "@un3qual/stylex-mangle-classnames") process.exit(1)'
```

Expected: exit 1 because the package is currently unscoped.

- [ ] **Step 2: Update registry-facing package metadata**

Set these exact values in `package.json`:

```json
{
  "name": "@un3qual/stylex-mangle-classnames",
  "version": "0.1.0",
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  }
}
```

Keep the existing repository, exports, files, scripts, engines, peer dependencies, and plugin implementation unchanged.

- [ ] **Step 3: Update package-consumer documentation**

Change the README heading, install command, and both import examples to `@un3qual/stylex-mangle-classnames`. Keep the pre-publication note accurate:

```markdown
# @un3qual/stylex-mangle-classnames

This package is ready for its first npm release. After `0.1.0` is published, install it with:

```sh
pnpm add --save-dev @un3qual/stylex-mangle-classnames
```
```

- [ ] **Step 4: Update maintainer-facing package references**

In `.changeset/README.md`, tell maintainers to select `@un3qual/stylex-mangle-classnames` when adding a changeset. In `CONTRIBUTING.md`, use the scoped package name in the introduction while retaining the existing development and Changesets guidance.

- [ ] **Step 5: Verify the scoped identity and commit**

Run:

```bash
node --input-type=module --eval 'import packageJson from "./package.json" with { type: "json" }; if (packageJson.name !== "@un3qual/stylex-mangle-classnames" || packageJson.version !== "0.1.0" || packageJson.publishConfig.access !== "public" || packageJson.publishConfig.registry !== "https://registry.npmjs.org") process.exit(1)'
rg -n 'from "stylex-mangle-classnames"|pnpm add --save-dev stylex-mangle-classnames|Select `stylex-mangle-classnames`' README.md CONTRIBUTING.md .changeset || true
pnpm changeset status
git diff --check
```

Expected: metadata assertion passes, no stale unscoped consumer references remain, Changesets succeeds without a version bump, and the diff check is silent.

Commit:

```bash
git add package.json README.md CONTRIBUTING.md .changeset/README.md
git commit -m "chore: scope npm package under un3qual"
```

---

### Task 2: Add the Tokenless GitHub Release Workflow

**Files:**
- Create: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: `package.json` fields `name`, `version`, `packageManager`, and `publishConfig`.
- Produces: a GitHub Release workflow that calls `npm publish --access public` only for an unpublished matching version.

- [ ] **Step 1: Prove the workflow-presence assertion is initially red**

Run:

```bash
test -f .github/workflows/publish.yml
```

Expected: exit 1 because no publish workflow exists.

- [ ] **Step 2: Add the publish workflow**

Create `.github/workflows/publish.yml` with this exact structure:

```yaml
name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read

jobs:
  publish:
    if: ${{ !github.event.release.prerelease }}
    runs-on: ubuntu-latest
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          package-manager-cache: false
      - run: corepack enable
      - run: corepack install
      - run: npm install --global npm@11.6.2
      - run: pnpm install --frozen-lockfile
      - name: Verify release tag
        env:
          RELEASE_TAG: ${{ github.event.release.tag_name }}
        run: |
          PACKAGE_VERSION="$(node --print "require('./package.json').version")"
          EXPECTED_TAG="v${PACKAGE_VERSION}"
          if [ "${RELEASE_TAG}" != "${EXPECTED_TAG}" ]; then
            echo "::error::Release tag ${RELEASE_TAG} must match ${EXPECTED_TAG}"
            exit 1
          fi
      - name: Check published version
        id: registry
        run: |
          PACKAGE_NAME="$(node --print "require('./package.json').name")"
          PACKAGE_VERSION="$(node --print "require('./package.json').version")"
          ERROR_FILE="$(mktemp)"
          if npm view "${PACKAGE_NAME}@${PACKAGE_VERSION}" version >/dev/null 2>"${ERROR_FILE}"; then
            echo "published=true" >> "${GITHUB_OUTPUT}"
          elif grep -q "E404" "${ERROR_FILE}"; then
            echo "published=false" >> "${GITHUB_OUTPUT}"
          else
            cat "${ERROR_FILE}" >&2
            exit 1
          fi
      - name: Publish package
        if: steps.registry.outputs.published != 'true'
        run: npm publish --access public
```

- [ ] **Step 3: Parse and inspect the workflow**

Run:

```bash
ruby -e 'require "yaml"; Dir[".github/workflows/*.{yml,yaml}"].each { |file| YAML.parse_file(file) }'
rg -n 'release:|types: \[published\]|id-token: write|environment: npm|npm@11\.6\.2|npm publish --access public' .github/workflows/publish.yml
if rg -n 'NPM_TOKEN|NODE_AUTH_TOKEN' .github/workflows/publish.yml; then exit 1; fi
git diff --check
```

Expected: YAML parsing and required workflow checks pass, no token reference exists, and the diff check is silent.

- [ ] **Step 4: Commit the publishing workflow**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: publish npm releases with OIDC"
```

---

### Task 3: Document Bootstrap and Future Releases

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `.github/workflows/publish.yml` and the scoped npm metadata.
- Produces: an executable one-time bootstrap procedure and future release checklist.

- [ ] **Step 1: Add the one-time bootstrap checklist**

Add a `First npm release` section to `CONTRIBUTING.md` with this order:

1. Confirm the maintainer owns or can publish public packages under the `@un3qual` npm scope.
2. Run `pnpm run check`, `pnpm changeset status`, `pnpm pack --dry-run --json`, and `npm publish --dry-run --access public`.
3. Authenticate locally with npm and run `npm publish --access public` exactly once for `0.1.0`.
4. On npm, configure a GitHub Actions trusted publisher for organization/user `Un3qual`, repository `stylex-mangle-classnames`, workflow `publish.yml`, environment `npm`, and permission `npm publish`.
5. Create the `v0.1.0` GitHub Release; the workflow detects that version as already published and exits successfully.

State explicitly that this repository does not store an npm publishing token.

- [ ] **Step 2: Add the future release checklist**

Document that future releases require committed Changesets, `pnpm version-packages`, review of the version and changelog, a commit and push to `main`, then a non-prerelease GitHub Release whose tag is exactly `v${package.json.version}`. State that the workflow publishes but never selects or changes a version.

- [ ] **Step 3: Link maintainers to the release procedure**

Add one sentence under README `Development`:

```markdown
Maintainers should follow the bootstrap and automated release process in [CONTRIBUTING.md](./CONTRIBUTING.md#releases).
```

- [ ] **Step 4: Verify and commit the documentation**

Run:

```bash
rg -n '@un3qual|First npm release|publish\.yml|trusted publisher|GitHub Release|does not store' README.md CONTRIBUTING.md
git diff --check
```

Expected: package users and maintainers have exact scoped-package and release instructions, and the diff check is silent.

Commit:

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: add npm release process"
```

---

### Task 4: Remove Temporary Process Artifacts and Verify Publication Readiness

**Files:**
- Delete: `docs/superpowers/plans/2026-08-12-scoped-package-publishing.md`
- Delete: `docs/superpowers/specs/2026-08-12-scoped-package-publishing-design.md`

**Interfaces:**
- Consumes: the scoped package, workflow, and release documentation.
- Produces: a clean, publication-ready repository and verification evidence without performing a real publish.

- [ ] **Step 1: Delete the temporary design and plan**

Delete both files listed above and remove the empty `docs/superpowers/` directories.

- [ ] **Step 2: Run the complete project and release gates**

```bash
pnpm run check
pnpm changeset status
ruby -e 'require "yaml"; Dir[".github/workflows/*.{yml,yaml}"].each { |file| YAML.parse_file(file) }'
pnpm pack --dry-run --json
npm publish --dry-run --access public
```

Expected: typecheck, 12 tests, build, Changesets, YAML parsing, package dry run, and npm publish dry run pass. The package reports the name `@un3qual/stylex-mangle-classnames` and version `0.1.0`; no real publication occurs.

- [ ] **Step 3: Inspect final metadata, contents, and repository state**

```bash
node --input-type=module --eval 'import packageJson from "./package.json" with { type: "json" }; console.log(JSON.stringify({ name: packageJson.name, version: packageJson.version, publishConfig: packageJson.publishConfig }))'
if rg -n 'NPM_TOKEN|NODE_AUTH_TOKEN' .github/workflows/publish.yml; then exit 1; fi
test ! -e docs/superpowers
git diff --check
git status --short --branch
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Expected: scoped public registry metadata, no token reference, no internal process directory, clean diff, and focused commits.

- [ ] **Step 4: Commit process-artifact removal**

```bash
git add -A docs/superpowers
git commit -m "chore: remove publishing plan artifacts"
```

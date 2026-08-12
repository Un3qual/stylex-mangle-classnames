# Extracted StyleX CSS Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Vite production JavaScript and StyleX CSS emitted during `writeBundle` on the same deterministic short class-name mapping when `runtimeInjection` is false.

**Architecture:** Preserve the existing in-memory `generateBundle` rewrite as the primary path. Add one post-ordered `writeBundle` pass that scans only late `.css` files absent from the Rollup bundle, reads and validates all of them, then rewrites them using the mapping already established from JavaScript.

**Tech Stack:** TypeScript 5.9, Vite/Rollup plugin hooks, Vitest 4, Node.js filesystem APIs, pnpm 11.

## Global Constraints

- Do not add a StyleX compiler or extractor dependency to this package.
- Keep the package ESM-only, unpublished, and at version `0.1.0`.
- Preserve the existing deterministic mapping, authored-CSS collision behavior, and production source-map prohibition.
- Scan only `.css` files inside the active output directory and do not follow symlinked directories.
- Skip CSS assets already represented in the Rollup bundle because `generateBundle` already processed them.
- Read and validate every late CSS file before writing any of them.
- Do not add a patch changeset; update the unreleased `0.1.0` changelog entry instead.

---

### Task 1: Reproduce and Rewrite Late-Emitted CSS

**Files:**
- Create: `test/production.test.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the existing `Map<string, string>` mapping populated from JavaScript during `generateBundle`.
- Produces: a post-ordered `writeBundle` hook that rewrites CSS written directly into the output directory by an earlier plugin hook.

- [ ] **Step 1: Add explicit Node.js development types**

Run:

```bash
pnpm add --save-dev --save-exact @types/node@22
```

Expected: `package.json` declares the exact resolved Node 22 type package and `pnpm-lock.yaml` records it. No runtime dependency is added.

- [ ] **Step 2: Write the failing production integration test**

Create `test/production.test.ts` with a real Vite build and a fake upstream plugin whose `writeBundle` hook creates `assets/stylex.css` after bundle generation:

```ts
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { build, type Plugin } from "vite";
import stylexMangleClassNames from "../src/index.js";

const PREFIX = "sx";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

function virtualEntry(): Plugin {
  return {
    name: "virtual-entry",
    resolveId(id) {
      return id === "virtual:entry" ? "/virtual-entry.js" : null;
    },
    load(id) {
      return id === "/virtual-entry.js"
        ? `globalThis.className = "${PREFIX}1";`
        : null;
    },
  };
}

function lateCss(source: string): Plugin {
  return {
    name: "late-stylex-css",
    async writeBundle(options) {
      if (!options.dir) {
        throw new Error("Expected Vite to configure an output directory");
      }

      const assetsDirectory = join(options.dir, "assets");
      await mkdir(assetsDirectory, { recursive: true });
      await writeFile(join(assetsDirectory, "stylex.css"), source, "utf8");
    },
  };
}

async function buildWithLateCss(css: string): Promise<{ css: string; javascript: string }> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualEntry(),
      lateCss(css),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const javascriptFile = (await readdir(assetsDirectory)).find((file) => file.endsWith(".js"));

  if (!javascriptFile) {
    throw new Error("Expected Vite to emit a JavaScript asset");
  }

  return {
    css: await readFile(join(assetsDirectory, "stylex.css"), "utf8"),
    javascript: await readFile(join(assetsDirectory, javascriptFile), "utf8"),
  };
}

describe("production output", () => {
  test("rewrites StyleX CSS emitted by an earlier writeBundle hook", async () => {
    const output = await buildWithLateCss(`.${PREFIX}1{color:red}`);

    expect(output.javascript).toContain('globalThis.className = "a";');
    expect(output.css).toBe(".a{color:red}");
  });
});
```

- [ ] **Step 3: Run the regression test and verify the mismatch**

Run:

```bash
pnpm test test/production.test.ts
```

Expected: FAIL because JavaScript contains class `a` while the late CSS remains `.sx1{color:red}`.

- [ ] **Step 4: Add late-CSS file discovery**

In `src/index.ts`, import `readdir`, `readFile`, and `writeFile` from `node:fs/promises`, plus `dirname` and `resolve` from `node:path`. Add these module-level helpers:

```ts
async function cssFilesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        return cssFilesIn(absolutePath);
      }

      return entry.isFile() && entry.name.endsWith(".css") ? [absolutePath] : [];
    }),
  );

  return files.flat().sort();
}

function outputDirectory(options: Rollup.NormalizedOutputOptions): string | null {
  if (options.dir) {
    return resolve(options.dir);
  }

  return options.file ? dirname(resolve(options.file)) : null;
}
```

- [ ] **Step 5: Add the minimal post-write rewrite**

Inside `stylexMangleClassNames`, add a `rememberSources` helper that unions canonical names from all supplied sources and calls `rememberClassName` in sorted order:

```ts
function rememberSources(sources: readonly string[]): void {
  const originals = new Set<string>();

  for (const source of sources) {
    for (const original of findStylexClassNames(source, classNamePrefix)) {
      originals.add(original);
    }
  }

  for (const original of [...originals].sort()) {
    rememberClassName(original);
  }
}
```

Add `rewriteLateCss` inside the plugin closure:

```ts
async function rewriteLateCss(
  outputOptions: Rollup.NormalizedOutputOptions,
  bundle: Rollup.OutputBundle,
): Promise<void> {
  const directory = outputDirectory(outputOptions);

  if (directory === null) {
    return;
  }

  const bundledCssFiles = new Set(
    Object.values(bundle)
      .filter((output) => output.type === "asset" && output.fileName.endsWith(".css"))
      .map((output) => resolve(directory, output.fileName)),
  );
  const fileNames = (await cssFilesIn(directory)).filter(
    (fileName) => !bundledCssFiles.has(fileName),
  );
  const files = await Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      source: await readFile(fileName, "utf8"),
    })),
  );

  rememberSources(files.map((file) => file.source));

  await Promise.all(
    files.map(async ({ fileName, source }) => {
      const result = rewriteStylexClassNames(source, classNamePrefix, classNames);

      if (result.changed) {
        await writeFile(fileName, result.code, "utf8");
      }
    }),
  );
}
```

Replace the duplicated original-name collection in `rewriteBundle` with `rememberSources` and add this plugin hook after `generateBundle`:

```ts
writeBundle: {
  order: "post",
  async handler(outputOptions, bundle) {
    await rewriteLateCss(outputOptions, bundle);
  },
},
```

- [ ] **Step 6: Run the focused and full tests**

Run:

```bash
pnpm test test/production.test.ts
pnpm test
```

Expected: the focused test passes; all existing tests remain green.

- [ ] **Step 7: Commit the late-output compatibility path**

```bash
git add package.json pnpm-lock.yaml src/index.ts test/production.test.ts
git commit -m "fix: rewrite late-emitted StyleX CSS"
```

### Task 2: Preserve Collision Protection for Late CSS

**Files:**
- Modify: `test/production.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: the late CSS source list and generated-name mapping added in Task 1.
- Produces: one collision validator shared by in-bundle and late CSS, invoked before any late file write.

- [ ] **Step 1: Add the failing late collision test**

Append this test inside the existing `production output` suite:

```ts
test("fails before rewriting late CSS that collides with an authored class", async () => {
  await expect(buildWithLateCss(`.${PREFIX}1{color:red}.a{color:blue}`)).rejects.toThrow(
    'generated class ".a" would collide with authored CSS',
  );
});
```

- [ ] **Step 2: Run the collision test and verify it fails for the right reason**

Run:

```bash
pnpm test test/production.test.ts -t "fails before rewriting late CSS"
```

Expected: FAIL because the build resolves instead of rejecting; the first task rewrites late CSS but does not validate authored collisions yet.

- [ ] **Step 3: Share collision validation across both output phases**

Inside `stylexMangleClassNames`, add:

```ts
function assertNoAuthoredCssCollisions(
  context: Rollup.PluginContext,
  sources: readonly string[],
): void {
  for (const source of sources) {
    const originalNames = findStylexClassNames(source, classNamePrefix);

    for (const className of authoredCssClasses(source)) {
      const original = generatedNames.get(className);

      if (original !== undefined && !originalNames.has(className)) {
        context.error(collisionMessage(className, original));
      }
    }
  }
}
```

In `rewriteBundle`, collect bundled CSS sources into an array and call `assertNoAuthoredCssCollisions(this, cssSources)` after `rememberSources` and before rewriting outputs. Remove the old inline collision loop.

Change `rewriteLateCss` to accept `context: Rollup.PluginContext`, call `assertNoAuthoredCssCollisions(context, files.map((file) => file.source))` after `rememberSources`, and only then start the write loop. Pass `this` from the `writeBundle` handler.

- [ ] **Step 4: Verify both late-output behaviors and all existing collision behavior**

Run:

```bash
pnpm test test/production.test.ts
pnpm test test/plugin.test.ts -t "collide"
pnpm test
```

Expected: both production tests pass, the original bundled-CSS collision test passes, and the full suite is green.

- [ ] **Step 5: Commit shared late collision protection**

```bash
git add src/index.ts test/production.test.ts
git commit -m "test: protect late StyleX CSS from collisions"
```

### Task 3: Document Extracted CSS Configuration

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the supported runtime-injected, Rollup-extracted, and Vite-unplugin late-output behavior.
- Produces: an exact user configuration that does not discard StyleX CSS metadata when runtime injection is disabled.

- [ ] **Step 1: Separate runtime-injected and extracted-CSS setup**

Keep the current Babel example under a `Runtime-injected CSS` heading and state that it requires `runtimeInjection: true`.

Add an `Extracted CSS` heading explaining that `runtimeInjection: false` requires a StyleX bundler plugin. Include this complete minimal Vite example:

```ts
import stylex from "@stylexjs/rollup-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import stylexMangleClassNames from "stylex-mangle-classnames";

const classNamePrefix = "sx";

export default defineConfig({
  plugins: [
    ...react(),
    stylex({
      classNamePrefix,
      dev: process.env.NODE_ENV !== "production",
      runtimeInjection: false,
    }),
    stylexMangleClassNames({ classNamePrefix }),
  ],
});
```

State that the mangler must appear after the StyleX extractor and that using the Babel plugin alone with `runtimeInjection: false` produces class references but no stylesheet.

- [ ] **Step 2: Update the unreleased changelog without a changeset**

Add an item to the existing `0.1.0` `Added` section:

```markdown
- Consistent mangling for extracted StyleX CSS emitted late in Vite's production `writeBundle` phase.
```

Do not create another file in `.changeset/`.

- [ ] **Step 3: Verify documentation and repository state**

Run:

```bash
rg -n "runtimeInjection|rollup-plugin|Babel plugin alone|writeBundle" README.md CHANGELOG.md
pnpm changeset status
git diff --check
```

Expected: both configurations and the late-output fix are documented, Changesets reports no package bump, and the diff check is silent.

- [ ] **Step 4: Commit extracted-CSS documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: explain extracted StyleX CSS setup"
```

### Task 4: Final Verification

**Files:**
- Review: `src/index.ts`
- Review: `test/plugin.test.ts`
- Review: `test/production.test.ts`
- Review: `README.md`
- Review: `CHANGELOG.md`
- Review: package dry-run manifest

**Interfaces:**
- Consumes: all code, tests, and documentation from Tasks 1-3.
- Produces: fresh evidence that the production fix is complete without changing the package boundary or version.

- [ ] **Step 1: Run the complete quality gate**

```bash
pnpm run check
pnpm changeset status
pnpm pack --dry-run --json
git diff --check
git status --short --branch
```

Expected: typecheck, all unit/integration tests, and build pass; Changesets queues no version bump; the package remains `0.1.0` with the same intended public file categories; the worktree is clean.

- [ ] **Step 2: Review the focused diff and history**

```bash
git diff origin/main...HEAD -- src/index.ts test README.md CHANGELOG.md package.json pnpm-lock.yaml
git log --oneline --decorate origin/main..HEAD
```

Expected: the diff contains only late CSS support, its regression tests, explicit Node development types, extracted-CSS documentation, and the already-approved design/plan artifacts.

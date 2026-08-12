# Plugin Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate work, incidental complexity, and internal process artifacts while preserving the plugin's supported runtime contract.

**Architecture:** Keep pure class-name matching in `src/class-names.ts` and Vite lifecycle integration in `src/index.ts`. Each phase registers names once, validates CSS once, and rewrites once; no new abstraction layer or source module is introduced.

**Tech Stack:** TypeScript 5.9, Vite 5–8 plugin API, Vitest 4, pnpm 11.

## Global Constraints

- Preserve the default export and required `classNamePrefix` option.
- Preserve Node.js 18+ and Vite 5 through 8 support.
- Preserve both bundled CSS and late-emitted CSS handling.
- Keep failures visible and validate collisions before mutating CSS.
- Do not add dependencies or a new source module.
- Remove `docs/superpowers/` from the final repository.

---

### Task 1: Simplify Class Registration and Output Rewriting

**Files:**
- Modify: `src/class-names.ts`
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`
- Test: `test/production.test.ts`

**Interfaces:**
- Consumes: existing `findStylexClassNames`, `mangleStylexClassName`, and `rewriteStylexClassNames` functions.
- Produces: the unchanged `stylexMangleClassNames(options): Plugin` public API with one registration and rewrite pass per build phase.

- [ ] **Step 1: Run the baseline behavior suite**

Run:

```bash
pnpm test
```

Expected: 12 tests pass.

- [ ] **Step 2: Add a regression for arbitrarily spaced `constKey` output**

Extend the existing exclusions test in `test/plugin.test.ts` with a StyleX registration whose key and colon are separated by more than 32 characters:

```ts
const spacedConstKey = `register({ constKey${" ".repeat(40)}:${" ".repeat(40)}"${atomic}" });`;
```

Include `spacedConstKey` unchanged in the expected output.

- [ ] **Step 3: Verify the regression fails for the right reason**

Run:

```bash
pnpm test test/plugin.test.ts -t preserves
```

Expected: FAIL because the atomic class inside `spacedConstKey` is rewritten.

- [ ] **Step 4: Remove the fixed-width `constKey` lookbehind**

Replace the 32-character slice in `src/class-names.ts` with a bounded lookup based on the nearest preceding `constKey` token:

```ts
function isStylexConstKey(source: string, classNameOffset: number): boolean {
  const keyOffset = source.lastIndexOf("constKey", classNameOffset);

  if (keyOffset < 0 || /[A-Za-z0-9_$]/.test(source[keyOffset - 1] ?? "")) {
    return false;
  }

  return /^\s*:\s*["'`]$/.test(
    source.slice(keyOffset + "constKey".length, classNameOffset),
  );
}
```

- [ ] **Step 5: Verify the exclusion behavior is green**

Run:

```bash
pnpm test test/plugin.test.ts -t preserves
```

Expected: PASS.

- [ ] **Step 6: Consolidate bundle text collection**

Add one internal record and collector in `src/index.ts`:

```ts
type TextOutput = {
  output: Rollup.OutputAsset | Rollup.OutputChunk;
  source: string;
};

function textOutputs(bundle: Rollup.OutputBundle): TextOutput[] {
  const outputs: TextOutput[] = [];

  for (const output of Object.values(bundle)) {
    if (output.type === "chunk") {
      outputs.push({ output, source: output.code });
    } else if (isTextAsset(output.fileName)) {
      outputs.push({ output, source: assetSourceToString(output.source) });
    }
  }

  return outputs;
}
```

- [ ] **Step 7: Remove repeated discovery during rewriting**

Rename `rememberSources` to `registerClassNames`, delete `remember` and `rewrite`, and make each phase explicit:

```ts
const outputs = textOutputs(bundle);
registerClassNames(outputs.map(({ source }) => source));
assertNoAuthoredCssCollisions(
  this,
  outputs
    .filter(({ output }) => output.type === "asset" && output.fileName.endsWith(".css"))
    .map(({ source }) => source),
);

for (const { output, source } of outputs) {
  const result = rewriteStylexClassNames(source, classNamePrefix, classNames);

  if (!result.changed) continue;
  if (output.type === "chunk") output.code = result.code;
  else output.source = result.code;
}
```

Use `registerClassNames([code])` before the development transform rewrite and `registerClassNames(files.map(({ source }) => source))` before late-CSS validation. Late CSS continues to write only when `result.changed` is true.

- [ ] **Step 8: Simplify test cleanup without changing coverage**

Replace the nested `Promise.all(...splice().map())` in `test/production.test.ts` with a direct loop:

```ts
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});
```

- [ ] **Step 9: Verify and commit the source cleanup**

Run:

```bash
pnpm run check
git diff --check
```

Expected: typecheck, 12 tests, and build pass; diff check is silent.

Commit:

```bash
git add src/class-names.ts src/index.ts test/plugin.test.ts test/production.test.ts
git commit -m "refactor: simplify plugin output flow"
```

---

### Task 2: Remove Internal Process Artifacts

**Files:**
- Delete: `docs/superpowers/plans/2026-08-12-plugin-deslop.md`
- Delete: `docs/superpowers/plans/2026-08-12-runtime-injection-false.md`
- Delete: `docs/superpowers/plans/2026-08-12-standalone-repository-setup.md`
- Delete: `docs/superpowers/specs/2026-08-12-plugin-deslop-design.md`
- Delete: `docs/superpowers/specs/2026-08-12-runtime-injection-false-design.md`
- Delete: `docs/superpowers/specs/2026-08-12-standalone-repository-setup-design.md`
- Delete: `.changeset/calm-hoops-exist.md`

**Interfaces:**
- Consumes: the completed source refactor.
- Produces: a repository containing only user-facing, contributor-facing, build, test, and release files.

- [ ] **Step 1: Delete internal plans, specs, and the bootstrap-only empty changeset**

Delete every file listed above. Leave `.changeset/README.md` and `.changeset/config.json` intact.

- [ ] **Step 2: Verify no public document points to removed files**

Run:

```bash
rg -n "docs/superpowers|calm-hoops-exist" README.md CONTRIBUTING.md CHANGELOG.md SECURITY.md .github .changeset || true
pnpm changeset status
git diff --check
```

Expected: no references are found, Changesets reports no package bump, and the diff check is silent.

- [ ] **Step 3: Commit repository cleanup**

```bash
git add -A docs/superpowers .changeset/calm-hoops-exist.md
git commit -m "chore: remove internal planning artifacts"
```

---

### Task 3: Final Verification

**Files:**
- Verify only; modify files only if a failing check reveals a concrete defect.

**Interfaces:**
- Consumes: the cleaned source and repository tree.
- Produces: release-ready verification evidence.

- [ ] **Step 1: Run the complete project gate**

```bash
pnpm run check
```

Expected: typecheck, all tests, and package build pass.

- [ ] **Step 2: Validate release metadata and package contents**

```bash
pnpm changeset status
pnpm pack --dry-run --json
```

Expected: no package bump is queued and only `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`, and package metadata are packed.

- [ ] **Step 3: Review the final repository state**

```bash
git diff --check
git status --short --branch
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Expected: a clean working tree on `codex/deslop-plugin`, with focused cleanup commits and no internal planning directory in the final tree.

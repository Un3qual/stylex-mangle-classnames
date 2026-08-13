# StyleX Output and Source Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mangle current StyleX extracted and runtime-injected output while preserving accurate Vite production source maps and presenting the package in direct user-facing language.

**Architecture:** Discover generated classes from compiled StyleX style objects and runtime `ltr`/`rtl` rules during JavaScript transforms. Sort the complete set before rendering, rewrite JavaScript in `renderChunk`, and return a high-resolution edit map for Rollup to compose. Rewrite bundled CSS and HTML assets in `generateBundle`.

**Tech Stack:** TypeScript, Vite/Rollup plugin hooks, MagicString, Vitest, pnpm.

## Global Constraints

- Vite 5 through Vite 8 remain supported.
- The plugin supports StyleX builds with `runtimeInjection` enabled or disabled.
- `classNamePrefix` must exactly match the prefix used by the StyleX compiler.
- The plugin must not depend on private state or metadata from another StyleX plugin.
- Independently executed client and SSR builds still require the same generated class set to produce the same mapping.
- Prefix-shaped authored CSS and application data without corroborating StyleX output remain unchanged.

---

### Task 1: Extracted StyleX discovery

**Files:**
- Modify: `src/class-names.ts`
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`
- Test: `test/production.test.ts`

**Interfaces:**
- Consumes: compiled JavaScript plus `classNamePrefix`.
- Produces: exact generated class-name sets from compiled StyleX style objects and runtime rules.

- [ ] **Step 1: Write failing bundle tests**

Add tests showing that classes in compiled StyleX style objects are rewritten in JavaScript, CSS, and HTML without an `ltr`/`rtl` rule. Add preservation tests for prefix-shaped selectors and application values that are not part of compiled StyleX output. Add a collision test in which extracted StyleX CSS and a separate authored short selector coexist.

- [ ] **Step 2: Run the focused tests and confirm expected failures**

Run: `corepack pnpm vitest run test/plugin.test.ts`

Expected: extracted-output assertions fail because registration currently reads only JavaScript `ltr`/`rtl` rules.

- [ ] **Step 3: Implement compiled-output discovery**

Expose a helper in `src/class-names.ts` that reads generated class values only from compiled StyleX objects marked `$$css: true`. In `src/index.ts`, collect those classes together with runtime-rule classes during JavaScript transforms and register the sorted union before chunk rendering.

- [ ] **Step 4: Run focused and full tests**

Run: `corepack pnpm vitest run test/plugin.test.ts test/production.test.ts`

Expected: all discovery, preservation, collision, development, and bundled-CSS tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/class-names.ts src/index.ts test/plugin.test.ts test/production.test.ts
git commit -m "feat: support extracted StyleX output"
```

### Task 2: Production JavaScript source maps

**Files:**
- Create: `src/source-maps.ts`
- Modify: `src/class-names.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `test/plugin.test.ts`
- Test: `test/production.test.ts`

**Interfaces:**
- Consumes: ordered class-name replacement offsets and rendered chunk code.
- Produces: rewritten code and an edit map that Rollup composes with earlier source maps.

- [ ] **Step 1: Write failing production source-map tests**

Replace the fail-closed configuration test with acceptance tests for `build.sourcemap` values `true`, `"hidden"`, and `"inline"`. Build a virtual entry containing a runtime-discovered class, inspect the output comment/map representation for each mode, and trace the rewritten class position to its literal original source line and column.

- [ ] **Step 2: Run the focused source-map tests and confirm expected failures**

Run: `corepack pnpm vitest run test/plugin.test.ts test/production.test.ts`

Expected: configuration rejects enabled source maps.

- [ ] **Step 3: Add explicit map dependencies**

Run: `corepack pnpm add magic-string`

Use `magic-string` to generate edit maps. Keep it as a runtime dependency because the published plugin imports it.

- [ ] **Step 4: Implement edit-map generation and composition**

Change class-name rewriting to retain exact replacement offsets. Add `src/source-maps.ts` to apply those edits with MagicString. Return the edit map from `renderChunk` so Rollup composes and serializes it. Remove the `configResolved` source-map rejection.

- [ ] **Step 5: Run focused and full tests**

Run: `corepack pnpm vitest run test/plugin.test.ts test/production.test.ts`

Expected: all tests pass, including original-position checks for external, hidden, and inline maps.

- [ ] **Step 6: Commit**

```sh
git add package.json pnpm-lock.yaml src/class-names.ts src/index.ts src/source-maps.ts test/plugin.test.ts test/production.test.ts
git commit -m "fix: preserve production source maps"
```

### Task 3: Pre-hash rewriting and source-map edge cases

**Files:**
- Modify: `src/index.ts`
- Modify: `src/source-maps.ts`
- Test: `test/production.test.ts`

**Interfaces:**
- Consumes: the complete transformed class set and rendered JavaScript chunks.
- Produces: rewritten chunks whose filenames, integrity metadata, and source maps describe the final code.

- [ ] **Step 1: Write failing output-lifecycle tests**

Build two outputs in which a class added to a separate chunk changes the bundle-wide mapping for an otherwise unchanged entry. Assert that the rewritten entry filename changes with its contents. Add regressions for a short name that is also a canonical source name, inline source-map text in application code, and missing `sourcesContent`.

- [ ] **Step 2: Run the integration test and confirm the expected failure**

Run: `corepack pnpm vitest run test/production.test.ts`

Expected: the entry filename remains unchanged, a second pass merges distinct classes, or source-map serialization loses input data.

- [ ] **Step 3: Move rewriting before output finalization**

Collect generated classes during transforms, register the complete sorted set in `renderStart`, and rewrite JavaScript in `renderChunk`. Remove the on-disk `writeBundle` pass and manual inline/external map serialization. Keep CSS and HTML rewriting in `generateBundle` and limit CSS parsing to selector preludes.

- [ ] **Step 4: Run focused and full tests**

Run: `corepack pnpm vitest run test/production.test.ts`

Run: `corepack pnpm test`

Expected: all tests pass and output metadata matches the final rewritten chunks.

- [ ] **Step 5: Commit**

```sh
git add src/index.ts src/source-maps.ts test/production.test.ts
git commit -m "fix: finalize mangling before chunk hashing"
```

### Task 4: Direct user-facing documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `.changeset/quiet-maps-shorten.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: verified plugin behavior and current official StyleX 0.19 Vite configuration.
- Produces: installation, configuration, behavior, compatibility, development, and release notes that match the implemented contract.

- [ ] **Step 1: Rewrite README configuration and compatibility sections**

Use `@stylexjs/unplugin` as the primary example, place the mangler after StyleX, describe extracted CSS as the default supported path, and state that `runtimeInjection: true` is also supported. Replace “MVP limitations” with “Compatibility” and factual constraints. Remove filler such as “small,” “MVP,” “yet,” and process-oriented narration from user-facing copy.

- [ ] **Step 2: Align changelog and contributor language**

Add concise unreleased entries for extracted StyleX output and production source maps. Tighten adjacent repository prose only where it contains the same meta or conversational wording; do not rewrite the standard Code of Conduct or security policy.

- [ ] **Step 3: Add a patch changeset**

Create `.changeset/quiet-maps-shorten.md` with:

```markdown
---
"@un3qual/stylex-mangle-classnames": patch
---

Support extracted StyleX output and preserve production JavaScript source maps while mangling class names.
```

- [ ] **Step 4: Verify documentation against code and package contents**

Run: `rg -n -i 'MVP|runtimeInjection: true.*must|source maps are not supported|not supported yet|rewritten yet' README.md CHANGELOG.md CONTRIBUTING.md`

Expected: no stale limitation or milestone language remains.

- [ ] **Step 5: Commit**

```sh
git add README.md CHANGELOG.md CONTRIBUTING.md .changeset
git commit -m "docs: clarify StyleX build support"
```

### Task 5: Final verification

**Files:**
- Verify: all changed files

**Interfaces:**
- Consumes: completed implementation and documentation.
- Produces: fresh evidence that the repository passes its full validation and packages only intended files.

- [ ] **Step 1: Inspect the final diff and repository state**

Run: `git diff HEAD~4 --check`

Run: `git status --short`

Expected: no whitespace errors and no unintended files.

- [ ] **Step 2: Run the complete validation suite**

Run: `corepack pnpm run check`

Expected: typecheck, all Vitest tests, and the TypeScript package build pass.

- [ ] **Step 3: Verify the package archive**

Run: `corepack pnpm pack --dry-run`

Expected: the archive contains the intended `dist`, README, license, and changelog files without test or planning artifacts.

- [ ] **Step 4: Commit any verification-only corrections**

If verification required corrections, stage only those files and commit them with a focused message. Otherwise leave the verified commits unchanged.

# StyleX Output and Source Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mangle current StyleX extracted and runtime-injected output while preserving accurate Vite production source maps and presenting the package in direct user-facing language.

**Architecture:** Discover runtime-generated classes from `ltr`/`rtl` rule objects and extracted classes from the intersection of emitted CSS selectors and non-CSS class references. Represent replacements as offset edits so JavaScript rewrites can produce a high-resolution map, then compose that edit map with Vite's chunk map. Apply the same discovery and rewrite pipeline to files emitted by earlier `writeBundle` hooks.

**Tech Stack:** TypeScript, Vite/Rollup plugin hooks, MagicString, source-map composition, Vitest, pnpm.

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
- Consumes: emitted JavaScript, HTML, and CSS strings plus `classNamePrefix`.
- Produces: selector and reference discovery functions that return canonical prefixed class-name sets; bundle registration uses their intersection plus runtime rule discoveries.

- [ ] **Step 1: Write failing bundle tests**

Add tests showing that a class present in both an emitted CSS selector and a JavaScript or HTML reference is rewritten in every output without an `ltr`/`rtl` rule. Add paired preservation tests for a CSS-only selector and a reference-only application value. Add a collision test in which extracted StyleX CSS and a separate authored short selector coexist.

- [ ] **Step 2: Run the focused tests and confirm expected failures**

Run: `corepack pnpm vitest run test/plugin.test.ts`

Expected: extracted-output assertions fail because registration currently reads only JavaScript `ltr`/`rtl` rules.

- [ ] **Step 3: Implement corroborated discovery**

Expose focused helpers in `src/class-names.ts` for canonical selector discovery and exact non-CSS reference discovery. In `src/index.ts`, register the sorted union of runtime-rule classes and the intersection of CSS selectors with non-CSS references before rewriting outputs. Exclude the corroborating generated selectors from authored-CSS collision checks while retaining failures for separate authored short selectors.

- [ ] **Step 4: Run focused and full tests**

Run: `corepack pnpm vitest run test/plugin.test.ts test/production.test.ts`

Expected: all discovery, preservation, collision, development, and late-CSS tests pass.

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
- Consumes: ordered class-name replacement offsets, rewritten chunk code, and `Rollup.SourceMap`.
- Produces: rewritten code and a composed `Rollup.SourceMap` that maps generated positions through the class-name edit to the original source.

- [ ] **Step 1: Write failing production source-map tests**

Replace the fail-closed configuration test with acceptance tests for `build.sourcemap` values `true`, `"hidden"`, and `"inline"`. Build a virtual entry containing a runtime-discovered class, inspect the output comment/map representation for each mode, and trace the rewritten class position to its literal original source line and column.

- [ ] **Step 2: Run the focused source-map tests and confirm expected failures**

Run: `corepack pnpm vitest run test/plugin.test.ts test/production.test.ts`

Expected: configuration rejects enabled source maps.

- [ ] **Step 3: Add explicit map dependencies**

Run: `corepack pnpm add magic-string @ampproject/remapping`

Use `magic-string` to generate edit maps and `@ampproject/remapping` to compose them with existing chunk maps. Keep both as runtime dependencies because the published plugin imports them.

- [ ] **Step 4: Implement edit-map generation and composition**

Change class-name rewriting to retain exact replacement offsets. Add `src/source-maps.ts` to apply those edits with MagicString and compose the generated edit map over the existing Vite/Rollup map. Remove the `configResolved` source-map rejection and assign the composed map to rewritten chunks during `generateBundle`.

- [ ] **Step 5: Run focused and full tests**

Run: `corepack pnpm vitest run test/plugin.test.ts test/production.test.ts`

Expected: all tests pass, including original-position checks for external, hidden, and inline maps.

- [ ] **Step 6: Commit**

```sh
git add package.json pnpm-lock.yaml src/class-names.ts src/index.ts src/source-maps.ts test/plugin.test.ts test/production.test.ts
git commit -m "fix: preserve production source maps"
```

### Task 3: Late extracted CSS and serialized source maps

**Files:**
- Modify: `src/index.ts`
- Modify: `src/source-maps.ts`
- Test: `test/production.test.ts`

**Interfaces:**
- Consumes: emitted output-directory files, late CSS selector sets, existing mapping state, external or inline JavaScript source maps.
- Produces: mutually consistent on-disk JavaScript, HTML, CSS, and JavaScript map files after a late StyleX stylesheet introduces generated classes.

- [ ] **Step 1: Write a failing late-CSS integration test**

Build extracted output in which JavaScript contains a canonical StyleX class reference, no runtime rule is present, and an earlier `writeBundle` hook writes the matching stylesheet. Enable an external source map. Assert that late CSS and JavaScript both use the short class and that the JavaScript position traces to the original virtual module.

- [ ] **Step 2: Run the integration test and confirm the expected failure**

Run: `corepack pnpm vitest run test/production.test.ts`

Expected: CSS and JavaScript remain unmangled or become inconsistent because late CSS is not part of bundle discovery.

- [ ] **Step 3: Implement the on-disk rewrite path**

Read late CSS and emitted bundle text before registering new classes. When registration grows, rewrite all relevant output files on disk. For JavaScript, load external or inline maps, compose the edit map, write the updated code/map representation, and preserve hidden-map behavior. Keep collision validation ahead of writes.

- [ ] **Step 4: Run focused and full tests**

Run: `corepack pnpm vitest run test/production.test.ts`

Run: `corepack pnpm test`

Expected: all tests pass and late extracted output remains internally consistent.

- [ ] **Step 5: Commit**

```sh
git add src/index.ts src/source-maps.ts test/production.test.ts
git commit -m "fix: rewrite late extracted StyleX output"
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

# Selector Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual CSS selector scanning with `postcss-selector-parser` while preserving collision detection, class rewriting, and source-map offsets.

**Architecture:** PostCSS continues to locate selector-bearing stylesheet fragments. A single selector-AST helper parses each fragment and serves both discovery and rewriting so those paths cannot diverge. Class selector edits use the parser's node offsets; class-valued attribute edits replace the parsed attribute node after changing its decoded value through the parser API.

**Tech Stack:** TypeScript, PostCSS, postcss-selector-parser 7.1.4, Vitest, pnpm.

## Global Constraints

- `postcss-selector-parser` must replace manual selector tokenization rather than add a parallel parsing path.
- The resulting selector-processing code must be materially smaller and easier to follow.
- Existing Node 18+, Vite 5 through Vite 8, and ESM compatibility must remain unchanged.
- Existing CSS rewrite and source-map offsets must remain accurate.
- Invalid selector syntax must continue to fail closed.

---

### Task 1: Replace manual selector tokenization

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/class-names.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: selector fragments from `cssSelectorFragments(source)` and the current `Map<string, string>` class mapping.
- Produces: decoded class names for discovery and parser-derived edits relative to each selector fragment.

- [ ] **Step 1: Add a failing behavioral regression for parsed attribute names**

Add a collision test alongside the existing class attribute-selector test:

```ts
test("detects a collision through an escaped class attribute name", () => {
  const javascript = outputChunk(`inject({ ltr: ".${PREFIX}1{color:red}" });`);
  const css = outputAsset(
    "styles.css",
    `.${PREFIX}1{color:red}[cl\\61 ss~="a"]{color:blue}`,
  );

  expect(() =>
    runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
      [javascript.fileName]: javascript,
      [css.fileName]: css,
    }),
  ).toThrow('generated class ".a" would collide with authored CSS');
});
```

This catches the manual attribute-name regex, which cannot decode `cl\61 ss` to `class`.

- [ ] **Step 2: Run the focused test and verify red**

Run: `corepack pnpm vitest run test/plugin.test.ts -t "escaped class attribute name"`

Expected: FAIL because the current collision scan does not recognize the escaped attribute name.

- [ ] **Step 3: Add the selector parser runtime dependency**

Run: `corepack pnpm add postcss-selector-parser@7.1.4`

Expected: `package.json` lists `postcss-selector-parser` under `dependencies` and `pnpm-lock.yaml` records version 7.1.4.

- [ ] **Step 4: Implement one selector-AST path**

In `src/class-names.ts`, import the parser and its relevant node types:

```ts
import selectorParser, {
  type Attribute,
  type ClassName,
} from "postcss-selector-parser";
```

Replace `selectorClassText`, `decodeCssIdentifier`, `classSelectorPattern`, `classAttributeSelectorPattern`, and their supporting identifier regexes with one parser-backed helper:

```ts
type SelectorClassReference = {
  end: number;
  start: number;
  value: string;
};

function selectorClassReferences(selector: string): SelectorClassReference[] {
  const references: SelectorClassReference[] = [];
  const ast = selectorParser().astSync(selector);

  ast.walkClasses((node: ClassName) => {
    const rendered = node.toString();
    references.push({
      end: node.sourceIndex + rendered.length,
      start: node.sourceIndex + 1,
      value: node.value,
    });
  });

  ast.walkAttributes((node: Attribute) => {
    if (node.attribute.toLowerCase() !== "class" || node.value === undefined) {
      return;
    }

    for (const match of node.value.matchAll(/\S+/g)) {
      references.push({
        end: node.sourceIndex + node.toString().length,
        start: node.sourceIndex,
        value: match[0],
      });
    }
  });

  return references;
}
```

The final implementation may keep discovery references and rewrite edits as separate small types. For class nodes, replace only the identifier range from `sourceIndex + 1` through the rendered node end. For a class-valued attribute, split the parser-decoded value on whitespace for discovery; when rewriting is needed, clone the attribute node, update its decoded value while preserving whitespace and quote style, serialize it through the parser, and replace the original attribute-node range. This makes escaped attribute names and values the parser's responsibility without introducing another selector tokenizer or CSS escape decoder.

Update these consumers to use the same tokens:

```ts
findCssClassNamesInSelectors(source)
findStylexClassNamesInSelectors(source, classNamePrefix)
rewriteStylexClassNamesInCssSelectors(source, classNamePrefix, classNames)
```

Filter StyleX discovery and rewriting with the existing canonical generated-name rule and exact `classNames` map membership.

- [ ] **Step 5: Run focused selector tests and verify green**

Run: `corepack pnpm vitest run test/plugin.test.ts -t "selector|Unicode|escaped|collision"`

Expected: all matching selector, Unicode, escape, collision, and source-map regressions pass.

- [ ] **Step 6: Commit the parser migration**

```sh
git add package.json pnpm-lock.yaml src/class-names.ts test/plugin.test.ts
git commit -m "refactor: parse CSS selectors with PostCSS"
```

### Task 2: Verify simplification and package output

**Files:**
- Inspect: `src/class-names.ts`
- Inspect: `package.json`
- Inspect: `pnpm-lock.yaml`
- Inspect: `test/plugin.test.ts`

**Interfaces:**
- Consumes: the parser-backed `selectorClassTokens` implementation from Task 1.
- Produces: a verified runtime package and pushed PR branch.

- [ ] **Step 1: Review the selector-processing diff**

Run:

```sh
git diff HEAD^ -- src/class-names.ts package.json pnpm-lock.yaml test/plugin.test.ts
```

Confirm that the manual scanner, escape decoder, and selector regexes are gone; selector parsing has one AST-backed path; and no unrelated refactor was introduced.

- [ ] **Step 2: Run the full repository gate**

Run: `corepack pnpm run check`

Expected: TypeScript typecheck, all Vitest tests, and package build pass.

- [ ] **Step 3: Verify package contents and whitespace**

Run:

```sh
corepack pnpm pack --dry-run
git diff --check
```

Expected: the package dry run includes the normal published files and both commands exit successfully.

- [ ] **Step 4: Push the existing PR branch**

Run: `git push origin codex/support-extracted-stylex-source-maps`

Expected: the new parser-migration commit is pushed to PR #5's existing branch.

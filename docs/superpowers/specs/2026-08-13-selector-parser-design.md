# Selector Parser Design

## Goal

Replace the plugin's manual CSS selector scanning with `postcss-selector-parser` while preserving current class discovery, collision detection, rewrite offsets, and source-map behavior.

## Scope

PostCSS remains responsible for parsing stylesheets and locating rule selectors and selector-bearing at-rule parameters. `postcss-selector-parser` parses those selector fragments into an AST.

The change removes selector-specific manual parsing where the library provides the same behavior:

- `selectorClassText`
- custom class-selector identifier and escape regexes
- the class-valued attribute-selector regex
- custom CSS identifier decoding for parsed selector nodes

Generic JavaScript and HTML class-reference handling remains separate because those inputs are not CSS selectors.

## Selector Processing

For each selector fragment located by PostCSS:

1. Parse the fragment with `postcss-selector-parser`.
2. Visit class nodes and record their decoded values and source indexes.
3. Visit attribute nodes whose attribute name is `class` and whose operator can match class values.
4. Treat whitespace-separated values for `[class~="..."]` as individual class tokens. Preserve the existing handling of other supported class attribute operators and case-sensitivity flags.
5. Convert selector-relative indexes into stylesheet-relative edits using the PostCSS fragment offset.

Discovery and rewriting use the same parsed token representation so they cannot disagree about CSS escapes, comments, quoted text, nested pseudo-classes, Unicode identifiers, or attribute-selector boundaries.

## Error Handling

Valid selectors supported by the parser are processed without custom syntax heuristics. Invalid selector syntax may throw the parser's normal error and fail the build, consistent with the current fail-closed behavior for malformed CSS.

The parser's default nesting-depth limit remains enabled. No application-controlled parser configuration is added.

## Testing

Existing regressions remain the behavioral contract, including:

- escaped and Unicode class selectors
- selector-bearing at-rules
- class-valued attribute selectors
- collision detection
- precise CSS rewrite offsets and source maps

Add focused selector cases that manual scanning is especially likely to mishandle, such as nested functional pseudo-classes, comments adjacent to class selectors, escaped class values, and quoted attribute values containing selector-like text. Tests assert emitted behavior, not the presence of the dependency or removal of a function.

## Dependency and Packaging

Add `postcss-selector-parser` as a runtime dependency because selector parsing occurs when consumers run the Vite plugin. Keep PostCSS as the stylesheet parser. The package remains ESM-only and supports the existing Node and Vite ranges.

## Acceptance Criteria

- Selector parsing code is materially smaller and easier to follow than the manual implementation.
- No new parallel selector tokenizer or escape decoder is introduced.
- All selector discovery and rewrite behavior is covered by real output assertions.
- Typecheck, full tests, build, package dry run, and diff validation pass.

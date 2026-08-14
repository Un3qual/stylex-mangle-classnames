import { decodeHTMLAttribute } from "entities/decode";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import {
  findHtmlAttributes,
  findHtmlStartTags,
  htmlAttributeValueTokens,
} from "./html.js";

const SHORT_CLASS_NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const CSS_IDENTIFIER_CHARACTER = String.raw`\p{ID_Continue}-`;

export type StylexRewriteResult = {
  changed: boolean;
  code: string;
  edits: StylexClassNameEdit[];
};

export type StylexClassNameEdit = {
  end: number;
  replacement: string;
  start: number;
};

type SourceFragment = {
  source: string;
  start: number;
};

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function atomicClassPattern(classNamePrefix: string): RegExp {
  const prefix = escapeRegularExpression(classNamePrefix);

  return new RegExp(
    `(^|[^${CSS_IDENTIFIER_CHARACTER}])(${prefix}(?:0|[1-9a-z][0-9a-z]*))(?![${CSS_IDENTIFIER_CHARACTER}])`,
    "gu",
  );
}

const stylexRulePattern = /\b(?:ltr|rtl)\s*:\s*(?:`([^`]*)`|"((?:\\.|[^"\\])*)")/g;

type SelectorClassReference = {
  classNames: string[];
  end: number;
  replacement: (classNames: Map<string, string>) => string | null;
  start: number;
};

function classNameReplacement(
  replacements: ReadonlyMap<string, string>,
  className: string,
  insensitive: boolean,
): string | undefined {
  const exact = replacements.get(className);

  if (exact !== undefined || !insensitive) {
    return exact;
  }

  const normalized = className.toLowerCase();

  for (const [candidate, replacement] of replacements) {
    if (candidate.toLowerCase() === normalized) {
      return replacement;
    }
  }

  return undefined;
}

function selectorClassReferences(selector: string): SelectorClassReference[] {
  const references: SelectorClassReference[] = [];
  const ast = selectorParser().astSync(selector);

  ast.walkClasses((node) => {
    const rendered = node.toString();
    references.push({
      classNames: [node.value],
      end: node.sourceIndex + rendered.length - node.rawSpaceAfter.length,
      replacement: (classNames) => classNames.get(node.value) ?? null,
      start: node.sourceIndex + 1,
    });
  });

  ast.walkAttributes((node) => {
    if (
      node.attribute.toLowerCase() !== "class" ||
      node.operator === undefined ||
      node.value === undefined
    ) {
      return;
    }

    const insensitive = node.insensitive === true;
    const normalize = insensitive
      ? (className: string) => className.toLowerCase()
      : (className: string) => className;
    const classNames = [...node.value.matchAll(/\S+/g)].map((match) =>
      normalize(match[0]),
    );

    references.push({
      classNames,
      end: node.sourceIndex + node.toString().length,
      replacement: (replacements) => {
        const value = node.value?.replace(
          /\S+/g,
          (className) =>
            classNameReplacement(replacements, className, insensitive) ??
            className,
        );

        if (value === undefined || value === node.value) {
          return null;
        }

        const replacement = node.clone();
        replacement.setValue(value, { quoteMark: node.quoteMark });
        return replacement.toString();
      },
      start: node.sourceIndex,
    });
  });

  return references;
}

function isStylexConstKey(source: string, classNameOffset: number): boolean {
  const keyOffset = source.lastIndexOf("constKey", classNameOffset);

  if (keyOffset < 0 || /[A-Za-z0-9_$]/.test(source[keyOffset - 1] ?? "")) {
    return false;
  }

  return /^\s*:\s*["'`]$/.test(
    source.slice(keyOffset + "constKey".length, classNameOffset),
  );
}

function shortStylexClassName(index: number): string {
  let remainder = index;
  let result = "";

  do {
    result = SHORT_CLASS_NAME_ALPHABET.charAt(
      remainder % SHORT_CLASS_NAME_ALPHABET.length,
    ) + result;
    remainder = Math.floor(remainder / SHORT_CLASS_NAME_ALPHABET.length) - 1;
  } while (remainder >= 0);

  return result;
}

function isStylexClassName(className: string, classNamePrefix: string): boolean {
  return (
    className.startsWith(classNamePrefix) &&
    /^(?:0|[1-9a-z][0-9a-z]*)$/.test(className.slice(classNamePrefix.length))
  );
}

export function mangleStylexClassName(
  className: string,
  classNamePrefix: string,
  classNames: Map<string, string>,
): string | null {
  if (!isStylexClassName(className, classNamePrefix)) {
    return null;
  }

  const existing = classNames.get(className);

  if (existing !== undefined) {
    return existing;
  }

  const mangled = shortStylexClassName(classNames.size);
  classNames.set(className, mangled);
  return mangled;
}

const selectorAtRuleNames = new Set(["custom-selector", "nest", "scope"]);

function scopeSelectorFragments(source: string, start: number): SourceFragment[] {
  const fragments: SourceFragment[] = [];
  let comment = false;
  let depth = 0;
  let escaped = false;
  let fragmentStart = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source.charAt(index);

    if (comment) {
      if (character === "*" && source[index + 1] === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }

    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && source[index + 1] === "*") {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "\\") {
      index += 1;
    } else if (character === "(") {
      if (depth === 0) {
        fragmentStart = index + 1;
      }
      depth += 1;
    } else if (character === ")" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        fragments.push({
          source: source.slice(fragmentStart, index),
          start: start + fragmentStart,
        });
      }
    }
  }

  return fragments;
}

function cssSelectorFragments(source: string): SourceFragment[] {
  const fragments: SourceFragment[] = [];
  const root = postcss.parse(source);

  root.walkRules((rule) => {
    const start = rule.source?.start?.offset;

    if (start === undefined) {
      return;
    }

    fragments.push({
      source: rule.raws.selector?.raw ?? rule.selector,
      start,
    });
  });

  root.walkAtRules((atRule) => {
    if (!selectorAtRuleNames.has(atRule.name.toLowerCase())) {
      return;
    }

    const nodeStart = atRule.source?.start?.offset;

    if (nodeStart === undefined) {
      return;
    }

    const params = atRule.raws.params?.raw ?? atRule.params;
    const start =
      nodeStart +
      1 +
      atRule.name.length +
      (atRule.raws.afterName ?? "").length;

    if (atRule.name.toLowerCase() === "scope") {
      fragments.push(...scopeSelectorFragments(params, start));
    } else {
      fragments.push({ source: params, start });
    }
  });

  return fragments;
}

export function findCssClassNamesInSelectors(source: string): Set<string> {
  const classNames = new Set<string>();

  for (const fragment of cssSelectorFragments(source)) {
    for (const reference of selectorClassReferences(fragment.source)) {
      for (const className of reference.classNames) {
        classNames.add(className);
      }
    }
  }

  return classNames;
}

export function findStylexClassNamesInSelectors(
  source: string,
  classNamePrefix: string,
): Set<string> {
  return new Set(
    [...findCssClassNamesInSelectors(source)].filter((className) =>
      isStylexClassName(className, classNamePrefix),
    ),
  );
}

export function findStylexClassNameReferences(
  source: string,
  classNamePrefix: string,
): Set<string> {
  const classNames = new Set<string>();

  for (const match of source.matchAll(atomicClassPattern(classNamePrefix))) {
    const boundary = match[1];
    const className = match[2];

    if (boundary === undefined || className === undefined) {
      continue;
    }

    const classNameOffset = match.index + boundary.length;

    if (!isStylexConstKey(source, classNameOffset)) {
      classNames.add(className);
    }
  }

  return classNames;
}

type AstRecord = Record<string, unknown>;

function astRecord(value: unknown): AstRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as AstRecord)
    : null;
}

function propertyName(property: AstRecord): string | null {
  const key = astRecord(property.key);

  if (key?.type === "Identifier" && typeof key.name === "string") {
    return key.name;
  }

  return key?.type === "Literal" && typeof key.value === "string" ? key.value : null;
}

function literalValue(property: AstRecord): unknown {
  const value = astRecord(property.value);
  return value?.type === "Literal" ? value.value : undefined;
}

export function findStylexClassNamesInCompiledObjects(
  ast: unknown,
  classNamePrefix: string,
): Set<string> {
  const classNames = new Set<string>();

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }

      return;
    }

    const node = astRecord(value);

    if (node === null) {
      return;
    }

    if (node.type === "ObjectExpression" && Array.isArray(node.properties)) {
      const properties = node.properties
        .map(astRecord)
        .filter((property): property is AstRecord => property !== null);
      const isCompiledStyle = properties.some(
        (property) => propertyName(property) === "$$css" && literalValue(property) === true,
      );

      if (isCompiledStyle) {
        for (const property of properties) {
          if (propertyName(property) === "$$css") {
            continue;
          }

          const value = literalValue(property);

          if (typeof value === "string") {
            for (const className of findStylexClassNameReferences(value, classNamePrefix)) {
              classNames.add(className);
            }
          }
        }
      }
    }

    for (const child of Object.values(node)) {
      visit(child);
    }
  }

  visit(ast);
  return classNames;
}

export function findStylexClassNamesInRules(source: string, classNamePrefix: string): Set<string> {
  const classNames = new Set<string>();

  for (const rule of findStylexRules(source)) {
    try {
      for (const className of findStylexClassNamesInSelectors(rule, classNamePrefix)) {
        classNames.add(className);
      }
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "CssSyntaxError") {
        throw error;
      }
    }
  }

  return classNames;
}

function findStylexRules(source: string): Set<string> {
  const rules = new Set<string>();

  for (const match of source.matchAll(stylexRulePattern)) {
    rules.add(match[1] ?? JSON.parse(`"${match[2]}"`));
  }

  return rules;
}

export function rewriteStylexClassNames(
  source: string,
  classNamePrefix: string,
  classNames: Map<string, string>,
): StylexRewriteResult {
  if (classNames.size === 0) {
    return { changed: false, code: source, edits: [] };
  }

  let changed = false;
  const edits: StylexClassNameEdit[] = [];
  const code = source.replace(
    atomicClassPattern(classNamePrefix),
    (match, boundary: string, className: string, offset: number) => {
      const classNameOffset = offset + boundary.length;

      if (isStylexConstKey(source, classNameOffset)) {
        return match;
      }

      const mangled = classNames.get(className);

      if (mangled === undefined) {
        return match;
      }

      changed = true;
      edits.push({
        end: classNameOffset + className.length,
        replacement: mangled,
        start: classNameOffset,
      });
      return `${boundary}${mangled}`;
    },
  );

  return { changed, code, edits };
}

function applyStylexClassNameEdits(
  source: string,
  edits: readonly StylexClassNameEdit[],
): string {
  let result = source;

  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`;
  }

  return result;
}

export function rewriteStylexClassNamesInCssSelectors(
  source: string,
  _classNamePrefix: string,
  classNames: Map<string, string>,
): StylexRewriteResult {
  const edits = cssSelectorFragments(source).flatMap((fragment) =>
    selectorClassReferences(fragment.source).flatMap((reference) => {
      const replacement = reference.replacement(classNames);

      return replacement === null
        ? []
        : [
            {
              end: fragment.start + reference.end,
              replacement,
              start: fragment.start + reference.start,
            },
          ];
    }),
  );

  return {
    changed: edits.length > 0,
    code: applyStylexClassNameEdits(source, edits),
    edits,
  };
}

function inlineCssFragmentsInHtml(source: string): SourceFragment[] {
  const fragments: SourceFragment[] = [];

  for (const tag of findHtmlStartTags(source)) {
    if (tag.tagName !== "style") {
      continue;
    }

    const type = findHtmlAttributes(tag).find(
      (attribute) => attribute.name === "type",
    )?.value;
    const decodedType =
      type === undefined ? "" : decodeHTMLAttribute(type).trim();

    if (
      (decodedType !== "" && decodedType.toLowerCase() !== "text/css") ||
      tag.contentStart === undefined ||
      tag.contentEnd === undefined
    ) {
      continue;
    }

    fragments.push({
      source: source.slice(tag.contentStart, tag.contentEnd),
      start: tag.contentStart,
    });
  }

  return fragments;
}

export function findInlineCssSourcesInHtml(source: string): string[] {
  return inlineCssFragmentsInHtml(source).map((fragment) => fragment.source);
}

export function rewriteStylexClassNamesInHtml(
  source: string,
  classNamePrefix: string,
  classNames: Map<string, string>,
): StylexRewriteResult {
  const edits: StylexClassNameEdit[] = [];

  for (const tag of findHtmlStartTags(source)) {
    for (const attribute of findHtmlAttributes(tag)) {
      if (
        attribute.name !== "class" ||
        attribute.value === undefined ||
        attribute.valueStart === undefined
      ) {
        continue;
      }

      for (const token of htmlAttributeValueTokens(attribute.value)) {
        const replacement = classNames.get(token.value);

        if (replacement === undefined) {
          continue;
        }

        const start = tag.start + attribute.valueStart + token.start;
        edits.push({
          end: tag.start + attribute.valueStart + token.end,
          replacement,
          start,
        });
      }
    }
  }

  for (const fragment of inlineCssFragmentsInHtml(source)) {
    const rewrite = rewriteStylexClassNamesInCssSelectors(
      fragment.source,
      classNamePrefix,
      classNames,
    );

    edits.push(
      ...rewrite.edits.map((edit) => ({
        ...edit,
        end: fragment.start + edit.end,
        start: fragment.start + edit.start,
      })),
    );
  }

  return {
    changed: edits.length > 0,
    code: applyStylexClassNameEdits(source, edits),
    edits,
  };
}

import postcss from "postcss";

const SHORT_CLASS_NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const CSS_IDENTIFIER_CHARACTER = "A-Za-z0-9_-";

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

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function atomicClassPattern(classNamePrefix: string): RegExp {
  const prefix = escapeRegularExpression(classNamePrefix);

  return new RegExp(
    `(^|[^${CSS_IDENTIFIER_CHARACTER}])(${prefix}(?:0|[1-9a-z][0-9a-z]*))(?![${CSS_IDENTIFIER_CHARACTER}])`,
    "g",
  );
}

function atomicClassSelectorPattern(classNamePrefix: string): RegExp {
  const prefix = escapeRegularExpression(classNamePrefix);

  return new RegExp(`\\.(${prefix}(?:0|[1-9a-z][0-9a-z]*))(?![${CSS_IDENTIFIER_CHARACTER}])`, "g");
}

const cssEscapePattern = String.raw`\\(?:[0-9A-Fa-f]{1,6}[ \t\r\n\f]?|[^\r\n\f])`;
const cssIdentifierStartPattern =
  String.raw`(?:[_A-Za-z\u0080-\uFFFF]|${cssEscapePattern}|-(?:[_A-Za-z\u0080-\uFFFF-]|${cssEscapePattern}))`;
const cssIdentifierRestPattern =
  String.raw`(?:[_A-Za-z0-9\u0080-\uFFFF-]|${cssEscapePattern})*`;
const classSelectorPattern = new RegExp(
  String.raw`\.(${cssIdentifierStartPattern}${cssIdentifierRestPattern})`,
  "g",
);

const stylexRulePattern = /\b(?:ltr|rtl)\s*:\s*(?:`([^`]*)`|"((?:\\.|[^"\\])*)")/g;

function selectorClassText(selector: string): string {
  let bracketDepth = 0;
  let comment = false;
  let escaped = false;
  let quote: '"' | "'" | null = null;
  let result = "";

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector.charAt(index);
    const nextCharacter = selector[index + 1];

    if (comment) {
      if (character === "*" && nextCharacter === "/") {
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

    if (character === "/" && nextCharacter === "*") {
      comment = true;
      result += " ";
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
      result += " ";
    } else if (character === "[") {
      bracketDepth += 1;
      result += " ";
    } else if (character === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
      result += " ";
    } else if (bracketDepth === 0) {
      result += character;
    }
  }

  return result;
}

function decodeCssIdentifier(identifier: string): string {
  return identifier.replace(
    /\\([0-9A-Fa-f]{1,6}[ \t\r\n\f]?|[^\r\n\f])/g,
    (_escape, escaped: string) => {
      if (!/^[0-9A-Fa-f]/.test(escaped)) {
        return escaped;
      }

      const codePoint = Number.parseInt(escaped.trim(), 16);

      if (
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return "\uFFFD";
      }

      return String.fromCodePoint(codePoint);
    },
  );
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

export function mangleStylexClassName(
  className: string,
  classNamePrefix: string,
  classNames: Map<string, string>,
): string | null {
  if (!className.startsWith(classNamePrefix)) {
    return null;
  }

  const hash = className.slice(classNamePrefix.length);

  if (!/^(?:0|[1-9a-z][0-9a-z]*)$/.test(hash)) {
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

function findClassNamesInSelectors(
  source: string,
  pattern: RegExp,
  normalize: (className: string) => string = (className) => className,
): Set<string> {
  const classNames = new Set<string>();

  postcss.parse(source).walkRules((rule) => {
    for (const selector of rule.selectors) {
      for (const match of selectorClassText(selector).matchAll(pattern)) {
        const className = match[1];

        if (className !== undefined) {
          classNames.add(normalize(className));
        }
      }
    }
  });

  return classNames;
}

export function findCssClassNamesInSelectors(source: string): Set<string> {
  return findClassNamesInSelectors(source, classSelectorPattern, decodeCssIdentifier);
}

export function findStylexClassNamesInSelectors(
  source: string,
  classNamePrefix: string,
): Set<string> {
  return findClassNamesInSelectors(source, atomicClassSelectorPattern(classNamePrefix));
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

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

const classSelectorPattern = /\.([_A-Za-z][_A-Za-z0-9-]*)/g;

const stylexRulePattern = /\b(?:ltr|rtl)\s*:\s*(?:`([^`]*)`|"((?:\\.|[^"\\])*)")/g;

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
    result = SHORT_CLASS_NAME_ALPHABET[remainder % SHORT_CLASS_NAME_ALPHABET.length]! + result;
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

function findClassNamesInSelectorPreludes(source: string, pattern: RegExp): Set<string> {
  const classNames = new Set<string>();
  let comment = false;
  let escaped = false;
  let prelude = "";
  let quote: '"' | "'" | null = null;

  function collectPrelude(): void {
    const selector = prelude.trim();

    if (selector !== "" && !selector.startsWith("@")) {
      for (const match of selector.matchAll(pattern)) {
        classNames.add(match[1]!);
      }
    }

    prelude = "";
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const nextCharacter = source[index + 1];

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
      prelude += " ";
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
      prelude += " ";
    } else if (character === "{") {
      collectPrelude();
    } else if (character === ";" || character === "}") {
      prelude = "";
    } else {
      prelude += character;
    }
  }

  return classNames;
}

export function findCssClassNamesInSelectors(source: string): Set<string> {
  return findClassNamesInSelectorPreludes(source, classSelectorPattern);
}

export function findStylexClassNamesInSelectors(
  source: string,
  classNamePrefix: string,
): Set<string> {
  return findClassNamesInSelectorPreludes(source, atomicClassSelectorPattern(classNamePrefix));
}

export function findStylexClassNameReferences(
  source: string,
  classNamePrefix: string,
): Set<string> {
  const classNames = new Set<string>();

  for (const match of source.matchAll(atomicClassPattern(classNamePrefix))) {
    const classNameOffset = match.index + match[1]!.length;

    if (!isStylexConstKey(source, classNameOffset)) {
      classNames.add(match[2]!);
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
    for (const className of findStylexClassNamesInSelectors(rule, classNamePrefix)) {
      classNames.add(className);
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

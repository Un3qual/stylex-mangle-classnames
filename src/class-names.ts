const SHORT_CLASS_NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const CSS_IDENTIFIER_CHARACTER = "A-Za-z0-9_-";

export type StylexRewriteResult = {
  changed: boolean;
  code: string;
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

export function findStylexClassNamesInRules(source: string, classNamePrefix: string): Set<string> {
  const classNames = new Set<string>();

  for (const rule of findStylexRules(source)) {
    for (const match of rule.matchAll(atomicClassSelectorPattern(classNamePrefix))) {
      classNames.add(match[1]!);
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
    return { changed: false, code: source };
  }

  let changed = false;
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
      return `${boundary}${mangled}`;
    },
  );

  return { changed, code };
}

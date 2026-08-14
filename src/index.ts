import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import type { Plugin, ResolvedConfig, Rollup } from "vite";
import {
  findStylexClassNamesInRules,
  mangleStylexClassName,
  rewriteStylexClassNames,
} from "./class-names.js";
import { rewriteWithSourceMap } from "./source-maps.js";

export type StylexMangleClassNamesOptions = {
  /** Must exactly match the classNamePrefix passed to the StyleX compiler. */
  classNamePrefix: string;
};

function assetSourceToString(source: string | Uint8Array): string {
  return typeof source === "string" ? source : new TextDecoder().decode(source);
}

function cssClassNames(source: string): Set<string> {
  const classNames = new Set<string>();

  postcss.parse(source).walkRules((rule) => {
    selectorParser((selectors) => {
      selectors.walkClasses((className) => {
        classNames.add(className.value);
      });
    }).processSync(rule.selector);
  });

  return classNames;
}

function collisionMessage(className: string, original: string): string {
  return `StyleX mangling generated class ".${className}" would collide with authored CSS (source class: ".${original}").`;
}

function assertValidPrefix(classNamePrefix: string): void {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(classNamePrefix)) {
    throw new Error(
      "stylex-mangle-classnames: classNamePrefix must start with a letter and contain only ASCII letters and numbers",
    );
  }
}

function isJavaScriptModule(id: string): boolean {
  return !/\.css(?:$|\?)/i.test(id) && !/\.html$/i.test(id);
}

/** Shortens runtime-injected StyleX atomic class names in Vite output. */
export default function stylexMangleClassNames(
  options: StylexMangleClassNamesOptions,
): Plugin {
  const { classNamePrefix } = options;
  assertValidPrefix(classNamePrefix);

  const classNames = new Map<string, string>();
  const generatedNames = new Map<string, string>();
  const pendingBuildClassNames = new Set<string>();
  const renderedClassNames = new Set<string>();
  let command: ResolvedConfig["command"] = "build";

  function reset(): void {
    classNames.clear();
    generatedNames.clear();
    pendingBuildClassNames.clear();
    renderedClassNames.clear();
  }

  function registerClassNames(originals: ReadonlySet<string>): void {
    for (const original of [...originals].sort()) {
      const mangled = mangleStylexClassName(
        original,
        classNamePrefix,
        classNames,
      );

      if (mangled !== null) {
        generatedNames.set(mangled, original);
      }
    }
  }

  function discoverBuildClassNames(source: string): void {
    for (const original of findStylexClassNamesInRules(
      source,
      classNamePrefix,
    )) {
      pendingBuildClassNames.add(original);
    }
  }

  function assertNoAuthoredCssCollisions(
    context: Rollup.PluginContext,
    bundle: Rollup.OutputBundle,
  ): void {
    for (const output of Object.values(bundle)) {
      if (output.type !== "asset" || !output.fileName.endsWith(".css")) {
        continue;
      }

      for (const className of cssClassNames(assetSourceToString(output.source))) {
        if (classNames.has(className)) {
          continue;
        }

        const original = generatedNames.get(className);

        if (original !== undefined && renderedClassNames.has(className)) {
          context.error(collisionMessage(className, original));
        }
      }
    }
  }

  return {
    name: "stylex-mangle-classnames",
    enforce: "post",
    buildStart() {
      reset();
    },
    configResolved(config) {
      command = config.command;
    },
    transform(code, id) {
      if (!isJavaScriptModule(id)) {
        return null;
      }

      const originals = findStylexClassNamesInRules(code, classNamePrefix);

      if (command === "build") {
        for (const original of originals) {
          pendingBuildClassNames.add(original);
        }
        return null;
      }

      registerClassNames(originals);
      const result = rewriteStylexClassNames(
        code,
        classNamePrefix,
        classNames,
      );
      return result.changed ? { code: result.code, map: null } : null;
    },
    moduleParsed(module) {
      if (
        command === "build" &&
        module.code !== null &&
        isJavaScriptModule(module.id)
      ) {
        discoverBuildClassNames(module.code);
      }
    },
    renderStart() {
      registerClassNames(pendingBuildClassNames);
    },
    renderChunk(code, chunk) {
      const result = rewriteStylexClassNames(
        code,
        classNamePrefix,
        classNames,
      );

      if (!result.changed) {
        return null;
      }

      for (const edit of result.edits) {
        renderedClassNames.add(edit.replacement);
      }

      return rewriteWithSourceMap(code, chunk.fileName, result.edits);
    },
    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle) {
        assertNoAuthoredCssCollisions(this, bundle);
      },
    },
  };
}

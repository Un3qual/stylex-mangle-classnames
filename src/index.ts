import type { Plugin, ResolvedConfig, Rollup } from "vite";
import {
  findCssClassNamesInSelectors,
  findStylexClassNamesInCompiledObjects,
  findStylexClassNamesInRules,
  mangleStylexClassName,
  rewriteStylexClassNames,
} from "./class-names.js";
import { rewriteWithSourceMap } from "./source-maps.js";

export type StylexMangleClassNamesOptions = {
  /** Must exactly match the classNamePrefix passed to the StyleX compiler. */
  classNamePrefix: string;
};

type TextAsset = {
  output: Rollup.OutputAsset;
  source: string;
};

function assetSourceToString(source: string | Uint8Array): string {
  return typeof source === "string" ? source : new TextDecoder().decode(source);
}

function isTextAsset(fileName: string): boolean {
  return /\.(?:css|html)$/.test(fileName);
}

function textAssets(bundle: Rollup.OutputBundle): TextAsset[] {
  return Object.values(bundle)
    .filter(
      (output): output is Rollup.OutputAsset =>
        output.type === "asset" && isTextAsset(output.fileName),
    )
    .map((output) => ({ output, source: assetSourceToString(output.source) }));
}

function isCssAsset({ output }: TextAsset): boolean {
  return output.fileName.endsWith(".css");
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

function isJavaScriptModule(id: string, moduleType?: string): boolean {
  if (moduleType !== undefined) {
    return moduleType === "js";
  }

  return !/\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss|html)(?:$|\?)/.test(id);
}

/**
 * Shortens canonical StyleX atomic class names in Vite development transforms
 * and production output bundles.
 */
export default function stylexMangleClassNames(
  options: StylexMangleClassNamesOptions,
): Plugin {
  const { classNamePrefix } = options;
  assertValidPrefix(classNamePrefix);

  const classNames = new Map<string, string>();
  const generatedNames = new Map<string, string>();
  const pendingCompiledClassNames = new Set<string>();
  const pendingRuntimeClassNames = new Set<string>();
  let command: ResolvedConfig["command"] = "build";

  function rememberClassName(original: string): void {
    const mangled = mangleStylexClassName(original, classNamePrefix, classNames);

    if (mangled !== null) {
      generatedNames.set(mangled, original);
    }
  }

  function registerClassNames(originals: ReadonlySet<string>): void {
    for (const original of [...originals].sort()) {
      rememberClassName(original);
    }
  }

  function findGeneratedClassNames(
    context: Pick<Rollup.PluginContext, "parse">,
    source: string,
  ): { compiled: Set<string>; runtime: Set<string> } {
    return {
      compiled: findStylexClassNamesInCompiledObjects(context.parse(source), classNamePrefix),
      runtime: findStylexClassNamesInRules(source, classNamePrefix),
    };
  }

  function assertNoAuthoredCssCollisions(
    context: Rollup.PluginContext,
    sources: readonly string[],
  ): void {
    for (const source of sources) {
      for (const className of findCssClassNamesInSelectors(source)) {
        if (classNames.has(className)) {
          continue;
        }

        const original = generatedNames.get(className);

        if (original !== undefined) {
          context.error(collisionMessage(className, original));
        }
      }
    }
  }

  return {
    name: "stylex-mangle-classnames",
    enforce: "post",
    buildStart() {
      classNames.clear();
      generatedNames.clear();
      pendingCompiledClassNames.clear();
      pendingRuntimeClassNames.clear();
    },
    configResolved(config) {
      command = config.command;
    },
    transform(code, id, transformOptions) {
      if (!isJavaScriptModule(id, transformOptions?.moduleType)) {
        return null;
      }

      if (command === "build") {
        return null;
      }

      const discovered = findGeneratedClassNames(this, code);
      const originals = new Set([...discovered.compiled, ...discovered.runtime]);
      registerClassNames(originals);
      const result = rewriteStylexClassNames(code, classNamePrefix, classNames);
      return result.changed ? { code: result.code, map: null } : null;
    },
    moduleParsed(moduleInfo) {
      if (
        command !== "build" ||
        moduleInfo.code === null ||
        !isJavaScriptModule(moduleInfo.id)
      ) {
        return;
      }

      const discovered = findGeneratedClassNames(this, moduleInfo.code);

      for (const original of discovered.compiled) {
        pendingCompiledClassNames.add(original);
      }

      for (const original of discovered.runtime) {
        pendingRuntimeClassNames.add(original);
      }
    },
    renderStart() {
      registerClassNames(
        new Set([...pendingCompiledClassNames, ...pendingRuntimeClassNames]),
      );
    },
    renderChunk(code, chunk) {
      const result = rewriteStylexClassNames(code, classNamePrefix, classNames);

      return result.changed
        ? rewriteWithSourceMap(code, chunk.fileName, result.edits)
        : null;
    },
    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle) {
        const assets = textAssets(bundle);
        const cssSources = assets.filter(isCssAsset).map(({ source }) => source);
        const hasExtractedClasses = [...pendingCompiledClassNames].some(
          (className) => !pendingRuntimeClassNames.has(className),
        );

        if (hasExtractedClasses && cssSources.length === 0) {
          this.error(
            "stylex-mangle-classnames: extracted StyleX output requires a bundled CSS asset; import a stylesheet so StyleX can emit CSS before writeBundle",
          );
        }

        assertNoAuthoredCssCollisions(this, cssSources);

        for (const { output, source } of assets) {
          const result = rewriteStylexClassNames(source, classNamePrefix, classNames);

          if (result.changed) {
            output.source = result.code;
          }
        }
      },
    },
  };
}

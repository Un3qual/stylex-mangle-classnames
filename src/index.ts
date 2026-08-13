import { createHash } from "node:crypto";
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

function isCssPreRenderedAsset(asset: Rollup.PreRenderedAsset): boolean {
  return [...asset.names, ...asset.originalFileNames].some((name) => name.endsWith(".css"));
}

function replaceHashPlaceholders(pattern: string, source: string): string {
  return pattern.replace(/\[hash(?::(\d+))?\]/g, (_placeholder, size: string | undefined) => {
    const length = size === undefined ? 8 : Number.parseInt(size, 10);
    return createHash("sha256").update(source).digest("base64url").slice(0, length);
  });
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
  let buildEmitsAssets = true;

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
      buildEmitsAssets =
        !config.build.ssr || config.build.ssrEmitAssets || config.build.emitAssets;
    },
    outputOptions(outputOptions) {
      const assetFileNames =
        outputOptions.assetFileNames ?? "assets/[name]-[hash][extname]";

      return {
        ...outputOptions,
        assetFileNames(asset) {
          const pattern =
            typeof assetFileNames === "function"
              ? assetFileNames(asset)
              : assetFileNames;

          if (!isCssPreRenderedAsset(asset)) {
            return pattern;
          }

          const source = assetSourceToString(asset.source);
          const result = rewriteStylexClassNames(source, classNamePrefix, classNames);

          return result.changed
            ? replaceHashPlaceholders(pattern, result.code)
            : pattern;
        },
      };
    },
    transform(code, id, transformOptions) {
      if (!isJavaScriptModule(id, transformOptions?.moduleType)) {
        return null;
      }

      if (command === "build") {
        return null;
      }

      const discovered = findGeneratedClassNames(this, code);
      registerClassNames(discovered.runtime);
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

        if (buildEmitsAssets && hasExtractedClasses && cssSources.length === 0) {
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

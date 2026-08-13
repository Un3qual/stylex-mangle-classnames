import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Plugin, ResolvedConfig, Rollup } from "vite";
import {
  findStylexClassNameReferences,
  findStylexClassNamesInRules,
  findStylexClassNamesInSelectors,
  mangleStylexClassName,
  rewriteStylexClassNames,
} from "./class-names.js";
import { rewriteWithSourceMap } from "./source-maps.js";

export type StylexMangleClassNamesOptions = {
  /** Must exactly match the classNamePrefix passed to the StyleX compiler. */
  classNamePrefix: string;
};

type TextOutput = {
  output: Rollup.OutputAsset | Rollup.OutputChunk;
  source: string;
};

function assetSourceToString(source: string | Uint8Array): string {
  return typeof source === "string" ? source : new TextDecoder().decode(source);
}

function isTextAsset(fileName: string): boolean {
  return /\.(?:css|html|js|mjs|cjs)$/.test(fileName);
}

function textOutputs(bundle: Rollup.OutputBundle): TextOutput[] {
  const outputs: TextOutput[] = [];

  for (const output of Object.values(bundle)) {
    if (output.type === "chunk") {
      outputs.push({ output, source: output.code });
    } else if (isTextAsset(output.fileName)) {
      outputs.push({ output, source: assetSourceToString(output.source) });
    }
  }

  return outputs;
}

function isCssOutput({ output }: TextOutput): boolean {
  return output.type === "asset" && output.fileName.endsWith(".css");
}

function authoredCssClasses(source: string): Set<string> {
  return new Set([...source.matchAll(/\.([_A-Za-z][_A-Za-z0-9-]*)/g)].map((match) => match[1]!));
}

function collisionMessage(className: string, original: string): string {
  return `StyleX mangling generated class ".${className}" would collide with authored CSS (source class: ".${original}").`;
}

function updateSourceMapOutput(
  bundle: Rollup.OutputBundle,
  output: Rollup.OutputChunk,
  map: Rollup.SourceMap,
): void {
  output.map = map;

  if (output.sourcemapFileName) {
    const mapAsset = bundle[output.sourcemapFileName];

    if (mapAsset?.type === "asset") {
      mapAsset.source = map.toString();
    }

    return;
  }

  const inlineMapPattern =
    /sourceMappingURL=data:application\/json;charset=utf-8;base64,[A-Za-z0-9+/=]+/;

  if (inlineMapPattern.test(output.code)) {
    output.code = output.code.replace(inlineMapPattern, `sourceMappingURL=${map.toUrl()}`);
  }
}

function assertValidPrefix(classNamePrefix: string): void {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(classNamePrefix)) {
    throw new Error(
      "stylex-mangle-classnames: classNamePrefix must start with a letter and contain only ASCII letters and numbers",
    );
  }
}

async function cssFilesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        return cssFilesIn(absolutePath);
      }

      return entry.isFile() && entry.name.endsWith(".css") ? [absolutePath] : [];
    }),
  );

  return files.flat().sort();
}

function outputDirectory(options: Rollup.NormalizedOutputOptions): string | null {
  if (options.dir) {
    return resolve(options.dir);
  }

  return options.file ? dirname(resolve(options.file)) : null;
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

  function registerClassNamesFromRules(sources: readonly string[]): void {
    const originals = new Set<string>();

    for (const source of sources) {
      for (const original of findStylexClassNamesInRules(source, classNamePrefix)) {
        originals.add(original);
      }
    }

    registerClassNames(originals);
  }

  function registerClassNamesFromOutputs(outputs: readonly TextOutput[]): void {
    const originals = new Set<string>();
    const selectors = new Set<string>();
    const references = new Set<string>();

    for (const { source } of outputs) {
      for (const original of findStylexClassNamesInRules(source, classNamePrefix)) {
        originals.add(original);
      }
    }

    for (const { source } of outputs.filter(isCssOutput)) {
      for (const selector of findStylexClassNamesInSelectors(source, classNamePrefix)) {
        selectors.add(selector);
      }
    }

    for (const { source } of outputs.filter((output) => !isCssOutput(output))) {
      for (const reference of findStylexClassNameReferences(source, classNamePrefix)) {
        references.add(reference);
      }
    }

    for (const selector of selectors) {
      if (references.has(selector)) {
        originals.add(selector);
      }
    }

    registerClassNames(originals);
  }

  function assertNoAuthoredCssCollisions(
    context: Rollup.PluginContext,
    sources: readonly string[],
  ): void {
    for (const source of sources) {
      for (const className of authoredCssClasses(source)) {
        const original = generatedNames.get(className);

        if (original !== undefined) {
          context.error(collisionMessage(className, original));
        }
      }
    }
  }

  function rewriteBundle(this: Rollup.PluginContext, bundle: Rollup.OutputBundle): void {
    const outputs = textOutputs(bundle);

    registerClassNamesFromOutputs(outputs);
    assertNoAuthoredCssCollisions(
      this,
      outputs
        .filter(({ output }) => output.type === "asset" && output.fileName.endsWith(".css"))
        .map(({ source }) => source),
    );

    for (const { output, source } of outputs) {
      const result = rewriteStylexClassNames(source, classNamePrefix, classNames);

      if (!result.changed) {
        continue;
      }

      if (output.type === "chunk") {
        if (output.map) {
          const rewritten = rewriteWithSourceMap(
            source,
            output.fileName,
            result.edits,
            output.map,
          );
          output.code = rewritten.code;
          updateSourceMapOutput(bundle, output, rewritten.map);
        } else {
          output.code = result.code;
        }
      } else {
        output.source = result.code;
      }
    }
  }

  async function rewriteLateCss(
    context: Rollup.PluginContext,
    outputOptions: Rollup.NormalizedOutputOptions,
    bundle: Rollup.OutputBundle,
  ): Promise<void> {
    const directory = outputDirectory(outputOptions);

    if (directory === null) {
      return;
    }

    const bundledCssFiles = new Set(
      Object.values(bundle)
        .filter((output) => output.type === "asset" && output.fileName.endsWith(".css"))
        .map((output) => resolve(directory, output.fileName)),
    );
    const fileNames = (await cssFilesIn(directory)).filter(
      (fileName) => !bundledCssFiles.has(fileName),
    );
    const files = await Promise.all(
      fileNames.map(async (fileName) => ({
        fileName,
        source: await readFile(fileName, "utf8"),
      })),
    );

    assertNoAuthoredCssCollisions(
      context,
      files.map((file) => file.source),
    );

    await Promise.all(
      files.map(async ({ fileName, source }) => {
        const result = rewriteStylexClassNames(source, classNamePrefix, classNames);

        if (result.changed) {
          await writeFile(fileName, result.code, "utf8");
        }
      }),
    );
  }

  return {
    name: "stylex-mangle-classnames",
    enforce: "post",
    configResolved(config) {
      command = config.command;
    },
    transform(code) {
      if (command !== "serve") {
        return null;
      }

      registerClassNamesFromRules([code]);
      const result = rewriteStylexClassNames(code, classNamePrefix, classNames);

      return result.changed ? { code: result.code, map: null } : null;
    },
    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle) {
        rewriteBundle.call(this, bundle);
      },
    },
    writeBundle: {
      order: "post",
      async handler(outputOptions, bundle) {
        await rewriteLateCss(this, outputOptions, bundle);
      },
    },
  };
}

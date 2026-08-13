import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Plugin, ResolvedConfig, Rollup } from "vite";
import {
  findCssClassNamesInSelectors,
  findStylexClassNamesInCompiledObjects,
  findStylexClassNamesInRules,
  mangleStylexClassName,
  rewriteStylexClassNames,
  type StylexClassNameEdit,
} from "./class-names.js";
import { composeWithSourceMap, rewriteWithSourceMap } from "./source-maps.js";

export type StylexMangleClassNamesOptions = {
  /** Must exactly match the classNamePrefix passed to the StyleX compiler. */
  classNamePrefix: string;
};

type TextAsset = {
  output: Rollup.OutputAsset;
  source: string;
};

type DiscoveredClassNames = {
  compiled: Set<string>;
  runtime: Set<string>;
};

type HashCharacters = NonNullable<Rollup.OutputOptions["hashCharacters"]>;

type HashMarker = {
  length: number;
  token: string;
};

type CompatiblePreRenderedAsset = Rollup.PreRenderedAsset & {
  name?: string;
  names?: readonly string[];
  originalFileName?: string;
  originalFileNames?: readonly string[];
};

type RenderChunkMeta = {
  chunks?: Record<string, Rollup.RenderedChunk>;
};

const sourceMapDirectivePattern = /\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\/\s*$/;

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

function isCssPreRenderedAsset(
  asset: Rollup.PreRenderedAsset,
  pattern: string,
): boolean {
  const compatible = asset as CompatiblePreRenderedAsset;
  const names = [
    ...(compatible.names ?? []),
    ...(compatible.originalFileNames ?? []),
    compatible.name,
    compatible.originalFileName,
  ].filter((name): name is string => name !== undefined);

  return (
    pattern.endsWith(".css") ||
    names.some((name) => name.endsWith(".css"))
  );
}

function contentHash(source: string, hashCharacters: HashCharacters): string {
  const digest = createHash("sha256").update(source).digest();

  if (hashCharacters === "hex") {
    return digest.toString("hex");
  }

  if (hashCharacters === "base36") {
    return BigInt(`0x${digest.toString("hex")}`).toString(36).padStart(50, "0");
  }

  return digest.toString("base64url");
}

function markHashPlaceholders(
  pattern: string,
  markerId: number,
  markers: Map<string, HashMarker>,
): string {
  return pattern.replace(/\[hash(?::(\d+))?\]/g, (_placeholder, size: string | undefined) => {
    const length = size === undefined ? 8 : Number.parseInt(size, 10);
    const core = `_S${markerId.toString(36).toUpperCase()}_`;

    if (core.length > length) {
      throw new Error(
        `stylex-mangle-classnames: CSS hash length ${length} is too short for final-content hashing`,
      );
    }

    const token = core.padEnd(length, "_");
    markers.set(token, { length, token });
    return token;
  });
}

function replaceHashMarkers(value: string, hashes: ReadonlyMap<string, string>): string {
  let result = value;

  for (const [marker, hash] of hashes) {
    result = result.replaceAll(marker, hash);
  }

  return result;
}

function replaceFileNameReferences(
  value: string,
  replacements: ReadonlyMap<string, string>,
): string {
  let result = value;

  for (const [fileName, replacement] of replacements) {
    result = result.replaceAll(fileName, replacement);
  }

  return result;
}

function fileNameReplacements(
  outputs: readonly (readonly [string, Rollup.OutputChunk | Rollup.OutputAsset])[],
  hashes: ReadonlyMap<string, string>,
): Map<string, string> {
  const replacements = new Map<string, string>();

  for (const [, output] of outputs) {
    const updatedFileName = replaceHashMarkers(output.fileName, hashes);

    if (updatedFileName === output.fileName) {
      continue;
    }

    replacements.set(output.fileName, updatedFileName);

    const baseName = posix.basename(output.fileName);
    const updatedBaseName = posix.basename(updatedFileName);

    if (baseName !== output.fileName) {
      replacements.set(baseName, updatedBaseName);
    }
  }

  return replacements;
}

function sourceMapAsset(
  bundle: Rollup.OutputBundle,
  cssFileName: string,
  sourceMapUrl?: string,
): Rollup.OutputAsset | null {
  const sourceMapPath = sourceMapUrl?.replace(/[?#].*$/, "");
  const fileName =
    sourceMapPath === undefined
      ? `${cssFileName}.map`
      : posix.normalize(
          posix.join(posix.dirname(cssFileName), decodeURIComponent(sourceMapPath)),
        );
  const output = bundle[fileName];

  return output?.type === "asset" ? output : null;
}

function rewriteCssWithSourceMap(
  bundle: Rollup.OutputBundle,
  asset: Rollup.OutputAsset,
  source: string,
  edits: readonly StylexClassNameEdit[],
): string {
  const rewrite = rewriteWithSourceMap(source, asset.fileName, edits);
  const directive = source.match(sourceMapDirectivePattern);
  const sourceMapUrl = directive?.[1];

  if (sourceMapUrl?.startsWith("data:application/json") === true) {
    const inline = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/.exec(
      sourceMapUrl,
    );

    if (inline === null) {
      return rewrite.code;
    }

    const inlineData = inline[2];

    if (inlineData === undefined) {
      return rewrite.code;
    }

    const inputMap = inline[1]
      ? Buffer.from(inlineData, "base64").toString("utf8")
      : decodeURIComponent(inlineData);
    const composed = composeWithSourceMap(rewrite, inputMap);
    const encoded = inline[1]
      ? Buffer.from(composed).toString("base64")
      : encodeURIComponent(composed);
    const updatedUrl = `data:application/json${inline[1] ? ";base64" : ""},${encoded}`;

    return rewrite.code.replace(sourceMapUrl, updatedUrl);
  }

  const mapAsset = sourceMapAsset(bundle, asset.fileName, sourceMapUrl);

  if (mapAsset !== null) {
    mapAsset.source = composeWithSourceMap(
      rewrite,
      assetSourceToString(mapAsset.source),
    );
  }

  return rewrite.code;
}

function finalizeOutputHashMarkers(
  bundle: Rollup.OutputBundle,
  cssAssets: readonly TextAsset[],
  hashCharacters: HashCharacters,
  cssMarkers: ReadonlyMap<string, HashMarker>,
  chunkMarkers: ReadonlyMap<string, HashMarker>,
): void {
  const hashes = new Map<string, string>();

  for (const { output } of cssAssets) {
    const source = assetSourceToString(output.source);
    let normalizedSource = source;

    for (const { length, token } of cssMarkers.values()) {
      normalizedSource = normalizedSource.replaceAll(token, "0".repeat(length));
    }

    const hash = contentHash(normalizedSource, hashCharacters);

    for (const { length, token } of cssMarkers.values()) {
      if (output.fileName.includes(token)) {
        hashes.set(token, hash.slice(0, length));
      }
    }
  }

  if (hashes.size === 0 && chunkMarkers.size === 0) {
    return;
  }

  const outputs = Object.entries(bundle);
  const cssFileNameReplacements = fileNameReplacements(outputs, hashes);
  const chunksByMarker = new Map<string, Rollup.OutputChunk>();

  for (const [, output] of outputs) {
    if (output.type !== "chunk") {
      continue;
    }

    for (const { token } of chunkMarkers.values()) {
      if (output.fileName.includes(token)) {
        chunksByMarker.set(token, output);
      }
    }
  }

  const computingChunkHashes = new Set<string>();

  function computeChunkHash(token: string): string {
    const existing = hashes.get(token);

    if (existing !== undefined) {
      return existing;
    }

    const marker = chunkMarkers.get(token);
    const output = chunksByMarker.get(token);

    if (marker === undefined || output === undefined) {
      return token;
    }

    if (computingChunkHashes.has(token)) {
      return "0".repeat(marker.length);
    }

    computingChunkHashes.add(token);
    let source = replaceFileNameReferences(output.code, cssFileNameReplacements);

    for (const [dependencyToken, dependencyOutput] of chunksByMarker) {
      if (!source.includes(dependencyToken)) {
        continue;
      }

      const dependencyHash = computeChunkHash(dependencyToken);
      const dependencyReplacements = fileNameReplacements(
        [[dependencyOutput.fileName, dependencyOutput]],
        new Map([[dependencyToken, dependencyHash]]),
      );
      source = replaceFileNameReferences(source, dependencyReplacements);
    }

    for (const { length, token: unresolvedToken } of chunkMarkers.values()) {
      source = source.replaceAll(unresolvedToken, "0".repeat(length));
    }

    computingChunkHashes.delete(token);
    const hash = contentHash(source, hashCharacters).slice(0, marker.length);
    hashes.set(token, hash);
    return hash;
  }

  for (const token of chunksByMarker.keys()) {
    computeChunkHash(token);
  }

  const finalizedFileNameReplacements = fileNameReplacements(outputs, hashes);

  for (const [, output] of outputs) {
    if (output.type === "chunk") {
      output.code = replaceFileNameReferences(output.code, finalizedFileNameReplacements);
    } else {
      const source = assetSourceToString(output.source);
      const updatedSource = replaceFileNameReferences(
        source,
        finalizedFileNameReplacements,
      );

      if (updatedSource !== source) {
        output.source = updatedSource;
      }
    }
  }

  for (const [, output] of outputs) {
    const updatedFileName = finalizedFileNameReplacements.get(output.fileName);

    if (updatedFileName === undefined) {
      continue;
    }

    output.fileName = updatedFileName;
  }
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
  let assetHashMarkerIds = new WeakMap<object, number>();
  let chunkHashMarkerIds = new WeakMap<object, number>();
  const cssHashMarkers = new Map<string, HashMarker>();
  const chunkHashMarkers = new Map<string, HashMarker>();
  let nextHashMarkerId = 0;
  let cssAssetsFinalized = false;

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
  ): DiscoveredClassNames {
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
      cssAssetsFinalized = false;
    },
    closeBundle() {
      assetHashMarkerIds = new WeakMap<object, number>();
      chunkHashMarkerIds = new WeakMap<object, number>();
      cssHashMarkers.clear();
      chunkHashMarkers.clear();
      nextHashMarkerId = 0;
    },
    configResolved(config) {
      command = config.command;
      buildEmitsAssets =
        !config.build.ssr || config.build.ssrEmitAssets || config.build.emitAssets;
    },
    outputOptions(outputOptions) {
      const assetFileNames =
        outputOptions.assetFileNames ?? "assets/[name]-[hash][extname]";
      const entryFileNames = outputOptions.entryFileNames;
      const chunkFileNames = outputOptions.chunkFileNames;

      function markedChunkFileName(
        pattern: string | ((chunk: Rollup.PreRenderedChunk) => string),
        chunk: Rollup.PreRenderedChunk,
      ): string {
        const resolvedPattern =
          typeof pattern === "function" ? pattern(chunk) : pattern;
        let markerId = chunkHashMarkerIds.get(chunk);

        if (markerId === undefined) {
          markerId = nextHashMarkerId;
          nextHashMarkerId += 1;
          chunkHashMarkerIds.set(chunk, markerId);
        }

        return markHashPlaceholders(resolvedPattern, markerId, chunkHashMarkers);
      }

      return {
        ...outputOptions,
        ...(entryFileNames === undefined
          ? {}
          : {
              entryFileNames: (chunk: Rollup.PreRenderedChunk) =>
                markedChunkFileName(entryFileNames, chunk),
            }),
        ...(chunkFileNames === undefined
          ? {}
          : {
              chunkFileNames: (chunk: Rollup.PreRenderedChunk) =>
                markedChunkFileName(chunkFileNames, chunk),
            }),
        assetFileNames(asset) {
          const pattern =
            typeof assetFileNames === "function"
              ? assetFileNames(asset)
              : assetFileNames;

          if (cssAssetsFinalized || !isCssPreRenderedAsset(asset, pattern)) {
            return pattern;
          }

          let markerId = assetHashMarkerIds.get(asset);

          if (markerId === undefined) {
            markerId = nextHashMarkerId;
            nextHashMarkerId += 1;
            assetHashMarkerIds.set(asset, markerId);
          }

          return markHashPlaceholders(pattern, markerId, cssHashMarkers);
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

      registerClassNames(findStylexClassNamesInRules(code, classNamePrefix));
      const result = rewriteStylexClassNames(code, classNamePrefix, classNames);
      return result.changed ? { code: result.code, map: null } : null;
    },
    renderStart() {
      cssAssetsFinalized = false;
      pendingCompiledClassNames.clear();
      pendingRuntimeClassNames.clear();
    },
    renderChunk(code, chunk, _outputOptions, meta?: RenderChunkMeta) {
      const renderedChunks = meta?.chunks
        ? Object.values(meta.chunks)
        : [chunk];
      const renderedSources = new Set<string>();

      for (const renderedChunk of renderedChunks) {
        for (const renderedModule of Object.values(renderedChunk.modules)) {
          if (renderedModule.code !== null) {
            renderedSources.add(renderedModule.code);
          }
        }
      }

      for (const source of renderedSources) {
        const discovered = findGeneratedClassNames(this, source);

        for (const original of discovered.compiled) {
          pendingCompiledClassNames.add(original);
        }

        for (const original of discovered.runtime) {
          pendingRuntimeClassNames.add(original);
        }
      }

      registerClassNames(
        new Set([...pendingCompiledClassNames, ...pendingRuntimeClassNames]),
      );
      const result = rewriteStylexClassNames(code, classNamePrefix, classNames);

      return result.changed
        ? rewriteWithSourceMap(code, chunk.fileName, result.edits)
        : null;
    },
    generateBundle: {
      order: "post",
      handler(outputOptions, bundle) {
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
            output.source = isCssAsset({ output, source })
              ? rewriteCssWithSourceMap(bundle, output, source, result.edits)
              : result.code;
          }
        }

        finalizeOutputHashMarkers(
          bundle,
          assets.filter(isCssAsset),
          outputOptions.hashCharacters ?? "base64",
          cssHashMarkers,
          chunkHashMarkers,
        );
        cssAssetsFinalized = true;
      },
    },
  };
}

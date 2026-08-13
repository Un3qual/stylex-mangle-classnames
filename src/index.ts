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
  sentinel: string;
};

type RenderChunkMeta = {
  chunks?: Record<string, Rollup.RenderedChunk>;
};

type CompatibleOutputChunk = Rollup.OutputChunk & {
  implicitlyLoadedBefore?: string[];
  referencedFiles?: string[];
};

type OutputFile = Rollup.OutputChunk | Rollup.OutputAsset;

const sourceMapDirectivePattern = /\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\/\s*$/;
const javascriptSourceMapDirectivePattern =
  /\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/;
const hashMarkerSentinelPattern = /__STYLEX_HASH_[0-9a-z]+_[0-9a-z]+__/g;

function assetSourceToString(source: string | Uint8Array): string {
  return typeof source === "string" ? source : new TextDecoder().decode(source);
}

function isTextAsset(fileName: string): boolean {
  return /\.(?:cjs|css|html|js|mjs)$/.test(fileName);
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
  let occurrence = 0;

  return pattern.replace(
    /\[hash(?::(\d+))?\]/g,
    (placeholder, size: string | undefined) => {
      const length = size === undefined ? 8 : Number.parseInt(size, 10);
      const sentinel = `__STYLEX_HASH_${markerId.toString(36)}_${occurrence.toString(36)}__`;
      occurrence += 1;
      markers.set(sentinel, { length, sentinel });
      return `${placeholder}${sentinel}`;
    },
  );
}

function replaceHashMarkers(
  value: string,
  hashes: ReadonlyMap<string, string>,
  markers: ReadonlyMap<string, HashMarker>,
): string {
  let result = value;

  for (const [sentinel, hash] of hashes) {
    const marker = markers.get(sentinel);

    if (marker === undefined) {
      continue;
    }

    let sentinelIndex = result.indexOf(sentinel);

    while (sentinelIndex >= marker.length) {
      const hashStart = sentinelIndex - marker.length;
      result = `${result.slice(0, hashStart)}${hash}${result.slice(
        sentinelIndex + sentinel.length,
      )}`;
      sentinelIndex = result.indexOf(sentinel, hashStart + hash.length);
    }
  }

  return result;
}

function nativeHashForMarker(value: string, marker: HashMarker): string | null {
  const sentinelIndex = value.indexOf(marker.sentinel);

  if (sentinelIndex < marker.length) {
    return null;
  }

  return value.slice(sentinelIndex - marker.length, sentinelIndex);
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

function sourceMapAsset(
  bundle: Rollup.OutputBundle,
  outputFileName: string,
  sourceMapUrl?: string,
  explicitFileName?: string | null,
): Rollup.OutputAsset | null {
  const sourceMapPath = sourceMapUrl?.replace(/[?#].*$/, "");
  const fileName =
    explicitFileName ??
    (sourceMapPath === undefined
      ? `${outputFileName}.map`
      : posix.normalize(
          posix.join(posix.dirname(outputFileName), decodeURIComponent(sourceMapPath)),
        ));
  const output = bundle[fileName];

  return output?.type === "asset" ? output : null;
}

function rewriteChunkWithSourceMap(
  bundle: Rollup.OutputBundle,
  chunk: Rollup.OutputChunk,
  source: string,
  edits: readonly StylexClassNameEdit[],
): string {
  const rewrite = rewriteWithSourceMap(source, chunk.fileName, edits);
  const directive = source.match(javascriptSourceMapDirectivePattern);
  const sourceMapUrl = directive?.[1];

  if (sourceMapUrl?.startsWith("data:application/json") === true) {
    const inline = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/.exec(
      sourceMapUrl,
    );
    const inlineData = inline?.[2];

    if (inline === null || inlineData === undefined) {
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

  const mapAsset = sourceMapAsset(
    bundle,
    chunk.fileName,
    sourceMapUrl,
    chunk.sourcemapFileName,
  );

  if (mapAsset !== null) {
    mapAsset.source = composeWithSourceMap(
      rewrite,
      assetSourceToString(mapAsset.source),
    );
  }

  return rewrite.code;
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

function requiredMapValue<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
  description: string,
): Value {
  const value = map.get(key);

  if (value === undefined) {
    throw new Error(`stylex-mangle-classnames: missing ${description}`);
  }

  return value;
}

function metadataValues(output: OutputFile): string[] {
  if (output.type !== "chunk") {
    return [];
  }

  const compatible = output as CompatibleOutputChunk;

  return [
    ...(output.imports ?? []),
    ...(output.dynamicImports ?? []),
    ...(compatible.implicitlyLoadedBefore ?? []),
    ...(compatible.referencedFiles ?? []),
    ...(output.sourcemapFileName === null || output.sourcemapFileName === undefined
      ? []
      : [output.sourcemapFileName]),
  ];
}

function textValue(output: OutputFile): string | null {
  if (output.type === "chunk") {
    return output.code;
  }

  return typeof output.source === "string" ? output.source : null;
}

function markersInFileName(
  fileName: string,
  markers: ReadonlyMap<string, HashMarker>,
): HashMarker[] {
  return (fileName.match(hashMarkerSentinelPattern) ?? []).flatMap((sentinel) => {
    const marker = markers.get(sentinel);
    return marker === undefined ? [] : [marker];
  });
}

function neutralizeHashMarkers(
  fileName: string,
  markers: ReadonlyMap<string, HashMarker>,
): string {
  const zeroHashes = new Map(
    markersInFileName(fileName, markers).map(({ length, sentinel }) => [
      sentinel,
      "0".repeat(length),
    ]),
  );

  return replaceHashMarkers(fileName, zeroHashes, markers);
}

function addFileNameReplacement(
  replacements: Map<string, string>,
  before: string,
  after: string,
): void {
  replacements.set(before, after);
  const beforeBaseName = posix.basename(before);

  if (beforeBaseName !== before) {
    replacements.set(beforeBaseName, posix.basename(after));
  }
}

function replaceInlineSourceMapFileNameReferences(
  value: string,
  replacements: ReadonlyMap<string, string>,
): string {
  const directive =
    value.match(javascriptSourceMapDirectivePattern) ??
    value.match(sourceMapDirectivePattern);
  const sourceMapUrl = directive?.[1];

  if (sourceMapUrl?.startsWith("data:application/json") !== true) {
    return value;
  }

  const commaIndex = sourceMapUrl.indexOf(",");

  if (commaIndex < 0) {
    return value;
  }

  const prefix = sourceMapUrl.slice(0, commaIndex + 1);
  const encodedMap = sourceMapUrl.slice(commaIndex + 1);
  const isBase64 = /;base64,$/i.test(prefix);

  try {
    const sourceMap = isBase64
      ? Buffer.from(encodedMap, "base64").toString("utf8")
      : decodeURIComponent(encodedMap);
    const updatedMap = replaceFileNameReferences(sourceMap, replacements);

    if (updatedMap === sourceMap) {
      return value;
    }

    const updatedEncodedMap = isBase64
      ? Buffer.from(updatedMap).toString("base64")
      : encodeURIComponent(updatedMap);

    return value.replace(sourceMapUrl, `${prefix}${updatedEncodedMap}`);
  } catch {
    return value;
  }
}

function normalizeFileNameReferences(
  value: string,
  externalReplacements: ReadonlyMap<string, string>,
  internalReplacements: ReadonlyMap<string, string>,
): string {
  const replacements = new Map([
    ...externalReplacements,
    ...internalReplacements,
  ]);
  const updatedValue = replaceFileNameReferences(value, replacements);

  return replaceInlineSourceMapFileNameReferences(updatedValue, replacements);
}

function outputDependencies(
  outputs: readonly OutputFile[],
  preliminaryFileNames: ReadonlyMap<OutputFile, string>,
  markers: ReadonlyMap<string, HashMarker>,
): Map<OutputFile, Set<OutputFile>> {
  const outputBySentinel = new Map<string, OutputFile>();

  for (const output of outputs) {
    const fileName = requiredMapValue(
      preliminaryFileNames,
      output,
      "preliminary output filename",
    );

    for (const marker of markersInFileName(fileName, markers)) {
      outputBySentinel.set(marker.sentinel, output);
    }
  }

  return new Map(
    outputs.map((output) => {
      const dependencies = new Set<OutputFile>();
      const values = [textValue(output) ?? "", ...metadataValues(output)];

      for (const value of values) {
        for (const sentinel of value.match(hashMarkerSentinelPattern) ?? []) {
          const dependency = outputBySentinel.get(sentinel);

          if (dependency !== undefined) {
            dependencies.add(dependency);
          }
        }
      }

      return [output, dependencies] as const;
    }),
  );
}

function stronglyConnectedOutputGroups(
  outputs: readonly OutputFile[],
  dependencies: ReadonlyMap<OutputFile, ReadonlySet<OutputFile>>,
): OutputFile[][] {
  const indices = new Map<OutputFile, number>();
  const lowLinks = new Map<OutputFile, number>();
  const stack: OutputFile[] = [];
  const onStack = new Set<OutputFile>();
  const groups: OutputFile[][] = [];
  let nextIndex = 0;

  function connect(output: OutputFile): void {
    indices.set(output, nextIndex);
    lowLinks.set(output, nextIndex);
    nextIndex += 1;
    stack.push(output);
    onStack.add(output);

    for (const dependency of dependencies.get(output) ?? []) {
      if (!indices.has(dependency)) {
        connect(dependency);
        lowLinks.set(
          output,
          Math.min(
            requiredMapValue(lowLinks, output, "output low link"),
            requiredMapValue(lowLinks, dependency, "dependency low link"),
          ),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          output,
          Math.min(
            requiredMapValue(lowLinks, output, "output low link"),
            requiredMapValue(indices, dependency, "dependency index"),
          ),
        );
      }
    }

    if (
      requiredMapValue(lowLinks, output, "output low link") !==
      requiredMapValue(indices, output, "output index")
    ) {
      return;
    }

    const group: OutputFile[] = [];
    let member: OutputFile;

    do {
      const popped = stack.pop();

      if (popped === undefined) {
        throw new Error("stylex-mangle-classnames: invalid output dependency graph");
      }

      member = popped;
      onStack.delete(member);
      group.push(member);
    } while (member !== output);

    groups.push(group);
  }

  for (const output of outputs) {
    if (!indices.has(output)) {
      connect(output);
    }
  }

  return groups;
}

function stableOutputKey(
  output: OutputFile,
  preliminaryFileNames: ReadonlyMap<OutputFile, string>,
  markers: ReadonlyMap<string, HashMarker>,
): string {
  const fileName = requiredMapValue(
    preliminaryFileNames,
    output,
    "preliminary output filename",
  );
  const outputName =
    output.type === "chunk"
      ? output.name
      : ((output as Rollup.OutputAsset & { name?: string }).name ?? "");

  return JSON.stringify([
    neutralizeHashMarkers(fileName, markers),
    output.type,
    outputName,
  ]);
}

function computeFinalFileNames(
  outputs: readonly OutputFile[],
  preliminaryFileNames: ReadonlyMap<OutputFile, string>,
  dependencies: ReadonlyMap<OutputFile, ReadonlySet<OutputFile>>,
  groups: readonly (readonly OutputFile[])[],
  markers: ReadonlyMap<string, HashMarker>,
  hashCharacters: HashCharacters,
): Map<OutputFile, string> {
  const groupByOutput = new Map<OutputFile, number>();

  groups.forEach((group, groupIndex) => {
    for (const output of group) {
      groupByOutput.set(output, groupIndex);
    }
  });

  const hashes = new Map<string, string>();
  const finalFileNames = new Map<OutputFile, string>();
  const completedGroups = new Set<number>();

  function computeGroup(groupIndex: number): void {
    if (completedGroups.has(groupIndex)) {
      return;
    }

    const group = groups[groupIndex];

    if (group === undefined) {
      throw new Error("stylex-mangle-classnames: missing output dependency group");
    }

    const groupSet = new Set(group);

    for (const output of group) {
      for (const dependency of dependencies.get(output) ?? []) {
        const dependencyGroup = requiredMapValue(
          groupByOutput,
          dependency,
          "dependency group",
        );

        if (dependencyGroup !== groupIndex) {
          computeGroup(dependencyGroup);
        }
      }
    }

    const externalReplacements = new Map<string, string>();
    const internalReplacements = new Map<string, string>();
    const orderedGroup = [...group].sort((left, right) =>
      stableOutputKey(left, preliminaryFileNames, markers).localeCompare(
        stableOutputKey(right, preliminaryFileNames, markers),
      ),
    );

    for (const output of outputs) {
      const finalFileName = finalFileNames.get(output);

      if (finalFileName !== undefined && !groupSet.has(output)) {
        addFileNameReplacement(
          externalReplacements,
          requiredMapValue(
            preliminaryFileNames,
            output,
            "preliminary output filename",
          ),
          finalFileName,
        );
      }
    }

    orderedGroup.forEach((output, memberIndex) => {
      addFileNameReplacement(
        internalReplacements,
        requiredMapValue(
          preliminaryFileNames,
          output,
          "preliminary output filename",
        ),
        `__STYLEX_INTERNAL_${memberIndex}__`,
      );
    });

    const groupSeed = orderedGroup
      .map((output) => {
        const fileName = requiredMapValue(
          preliminaryFileNames,
          output,
          "preliminary output filename",
        );
        const outputMarkers = markersInFileName(fileName, markers);
        const nativeHashes = outputMarkers.map(
          (marker) => nativeHashForMarker(fileName, marker) ?? "",
        );
        const source =
          output.type === "asset" && typeof output.source !== "string"
            ? `binary:${Buffer.from(output.source).toString("base64")}`
            : normalizeFileNameReferences(
                textValue(output) ?? "",
                externalReplacements,
                internalReplacements,
              );
        const metadata = metadataValues(output).map((value) =>
          normalizeFileNameReferences(
            value,
            externalReplacements,
            internalReplacements,
          ),
        );

        return JSON.stringify({
          fileName: neutralizeHashMarkers(fileName, markers),
          metadata,
          nativeHashes,
          source,
          type: output.type,
        });
      })
      .join("\0");

    orderedGroup.forEach((output, memberIndex) => {
      const fileName = requiredMapValue(
        preliminaryFileNames,
        output,
        "preliminary output filename",
      );

      markersInFileName(fileName, markers).forEach((marker, markerIndex) => {
        hashes.set(
          marker.sentinel,
          contentHash(
            `${groupSeed}\0${memberIndex}\0${markerIndex}`,
            hashCharacters,
          ).slice(0, marker.length),
        );
      });
    });

    for (const output of orderedGroup) {
      const preliminaryFileName = requiredMapValue(
        preliminaryFileNames,
        output,
        "preliminary output filename",
      );
      finalFileNames.set(
        output,
        replaceHashMarkers(preliminaryFileName, hashes, markers),
      );
    }

    completedGroups.add(groupIndex);
  }

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    computeGroup(groupIndex);
  }

  return finalFileNames;
}

function assertUniqueFinalFileNames(
  outputs: readonly OutputFile[],
  finalFileNames: ReadonlyMap<OutputFile, string>,
): void {
  const outputByFileName = new Map<string, OutputFile>();

  for (const output of outputs) {
    const fileName = finalFileNames.get(output) ?? output.fileName;

    if (outputByFileName.has(fileName)) {
      throw new Error(
        `stylex-mangle-classnames: finalized output filename collision for "${fileName}"; increase the configured [hash] length`,
      );
    }

    outputByFileName.set(fileName, output);
  }
}

function updateOutputFileNameReferences(
  outputs: readonly OutputFile[],
  replacements: ReadonlyMap<string, string>,
): void {
  for (const output of outputs) {
    if (output.type === "chunk") {
      const updatedCode = replaceFileNameReferences(output.code, replacements);
      output.code = replaceInlineSourceMapFileNameReferences(
        updatedCode,
        replacements,
      );
      output.imports = (output.imports ?? []).map((value) =>
        replaceFileNameReferences(value, replacements),
      );
      output.dynamicImports = (output.dynamicImports ?? []).map((value) =>
        replaceFileNameReferences(value, replacements),
      );
      const compatible = output as CompatibleOutputChunk;

      if (compatible.implicitlyLoadedBefore !== undefined) {
        compatible.implicitlyLoadedBefore = compatible.implicitlyLoadedBefore.map(
          (value) => replaceFileNameReferences(value, replacements),
        );
      }

      if (compatible.referencedFiles !== undefined) {
        compatible.referencedFiles = compatible.referencedFiles.map((value) =>
          replaceFileNameReferences(value, replacements),
        );
      }

      if (output.sourcemapFileName !== null && output.sourcemapFileName !== undefined) {
        output.sourcemapFileName = replaceFileNameReferences(
          output.sourcemapFileName,
          replacements,
        );
      }
    } else if (typeof output.source === "string") {
      const updatedSource = replaceFileNameReferences(output.source, replacements);
      output.source = replaceInlineSourceMapFileNameReferences(
        updatedSource,
        replacements,
      );
    }
  }
}

function rekeyOutputBundle(
  bundle: Rollup.OutputBundle,
  entries: readonly (readonly [string, OutputFile])[],
): void {
  const canRekeyBundle = entries.every(([, output]) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      output,
      output.type === "chunk" ? "code" : "source",
    );

    return descriptor?.get === undefined;
  });

  if (!canRekeyBundle) {
    return;
  }

  for (const [bundleKey, output] of entries) {
    if (bundleKey !== output.fileName) {
      Reflect.deleteProperty(bundle, bundleKey);
    }
  }

  for (const [bundleKey, output] of entries) {
    if (bundleKey !== output.fileName) {
      bundle[output.fileName] = output;
    }
  }
}

function finalizeOutputHashMarkers(
  bundle: Rollup.OutputBundle,
  hashCharacters: HashCharacters,
  assetMarkers: ReadonlyMap<string, HashMarker>,
  chunkMarkers: ReadonlyMap<string, HashMarker>,
): void {
  const markers = new Map([...assetMarkers, ...chunkMarkers]);

  if (markers.size === 0) {
    return;
  }

  const outputs = Object.entries(bundle);
  const outputValues = outputs.map(([, output]) => output);
  const preliminaryFileNames = new Map(
    outputValues.map((output) => [output, output.fileName] as const),
  );
  const dependencies = outputDependencies(
    outputValues,
    preliminaryFileNames,
    markers,
  );
  const groups = stronglyConnectedOutputGroups(outputValues, dependencies);
  const finalFileNames = computeFinalFileNames(
    outputValues,
    preliminaryFileNames,
    dependencies,
    groups,
    markers,
    hashCharacters,
  );

  assertUniqueFinalFileNames(outputValues, finalFileNames);

  const finalizedFileNameReplacements = new Map<string, string>();

  for (const output of outputValues) {
    const before = requiredMapValue(
      preliminaryFileNames,
      output,
      "preliminary output filename",
    );
    const after = finalFileNames.get(output) ?? before;

    if (before !== after) {
      addFileNameReplacement(finalizedFileNameReplacements, before, after);
    }
  }

  updateOutputFileNameReferences(outputValues, finalizedFileNameReplacements);

  for (const [, output] of outputs) {
    output.fileName = finalFileNames.get(output) ?? output.fileName;
  }

  rekeyOutputBundle(bundle, outputs);
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
  const assetHashMarkers = new Map<string, HashMarker>();
  const chunkHashMarkers = new Map<string, HashMarker>();
  let nextHashMarkerId = 0;
  let cssAssetsFinalized = false;
  let hasCompleteRenderChunkGraph = false;

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
      assetHashMarkers.clear();
      chunkHashMarkers.clear();
      nextHashMarkerId = 0;
    },
    configResolved(config) {
      command = config.command;
      buildEmitsAssets =
        !config.build.ssr || config.build.ssrEmitAssets || config.build.emitAssets;
    },
    outputOptions(outputOptions) {
      assetHashMarkerIds = new WeakMap<object, number>();
      chunkHashMarkerIds = new WeakMap<object, number>();
      assetHashMarkers.clear();
      chunkHashMarkers.clear();
      nextHashMarkerId = 0;
      cssAssetsFinalized = false;
      const assetFileNames =
        outputOptions.assetFileNames ?? "assets/[name]-[hash][extname]";
      const entryFileNames = outputOptions.entryFileNames;
      const chunkFileNames = outputOptions.chunkFileNames;
      const sourcemapFileNames = outputOptions.sourcemapFileNames;

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
        ...(sourcemapFileNames === undefined
          ? {}
          : {
              sourcemapFileNames: (chunk: Rollup.PreRenderedChunk) => {
                const resolvedPattern =
                  typeof sourcemapFileNames === "function"
                    ? sourcemapFileNames(chunk)
                    : sourcemapFileNames;
                let markerId = assetHashMarkerIds.get(chunk);

                if (markerId === undefined) {
                  markerId = nextHashMarkerId;
                  nextHashMarkerId += 1;
                  assetHashMarkerIds.set(chunk, markerId);
                }

                return markHashPlaceholders(
                  resolvedPattern,
                  markerId,
                  assetHashMarkers,
                );
              },
            }),
        assetFileNames(asset) {
          const pattern =
            typeof assetFileNames === "function"
              ? assetFileNames(asset)
              : assetFileNames;

          if (cssAssetsFinalized) {
            return pattern;
          }

          let markerId = assetHashMarkerIds.get(asset);

          if (markerId === undefined) {
            markerId = nextHashMarkerId;
            nextHashMarkerId += 1;
            assetHashMarkerIds.set(asset, markerId);
          }

          return markHashPlaceholders(pattern, markerId, assetHashMarkers);
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
      hasCompleteRenderChunkGraph = false;
      pendingCompiledClassNames.clear();
      pendingRuntimeClassNames.clear();
    },
    renderChunk(code, chunk, _outputOptions, meta?: RenderChunkMeta) {
      if (meta?.chunks === undefined) {
        return null;
      }

      hasCompleteRenderChunkGraph = true;
      const renderedChunks = Object.values(meta.chunks);
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
        if (!hasCompleteRenderChunkGraph) {
          for (const output of Object.values(bundle)) {
            if (output.type !== "chunk") {
              continue;
            }

            for (const renderedModule of Object.values(output.modules)) {
              if (renderedModule.code === null) {
                continue;
              }

              const discovered = findGeneratedClassNames(this, renderedModule.code);

              for (const original of discovered.compiled) {
                pendingCompiledClassNames.add(original);
              }

              for (const original of discovered.runtime) {
                pendingRuntimeClassNames.add(original);
              }
            }
          }

          registerClassNames(
            new Set([...pendingCompiledClassNames, ...pendingRuntimeClassNames]),
          );

          for (const output of Object.values(bundle)) {
            if (output.type !== "chunk") {
              continue;
            }

            const result = rewriteStylexClassNames(
              output.code,
              classNamePrefix,
              classNames,
            );

            if (result.changed) {
              output.code = rewriteChunkWithSourceMap(
                bundle,
                output,
                output.code,
                result.edits,
              );
            }
          }
        }

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
          outputOptions.hashCharacters ?? "base64",
          assetHashMarkers,
          chunkHashMarkers,
        );
        cssAssetsFinalized = true;
      },
    },
  };
}

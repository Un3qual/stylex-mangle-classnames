import remappingModule, {
  type SourceMap as RemappedSourceMap,
  type SourceMapInput,
} from "@ampproject/remapping";
import MagicString from "magic-string";
import type { Rollup } from "vite";
import type { StylexClassNameEdit } from "./class-names.js";

export type SourceMappedRewrite = {
  code: string;
  map: Rollup.SourceMap;
};

const remapping = remappingModule as unknown as typeof import("@ampproject/remapping").default;

function rollupSourceMap(map: RemappedSourceMap): Rollup.SourceMap {
  if (typeof map.mappings !== "string") {
    throw new Error("stylex-mangle-classnames: expected an encoded JavaScript source map");
  }

  const sourceMap: Omit<Rollup.SourceMap, "toString" | "toUrl"> = {
    file: map.file ?? "",
    mappings: map.mappings,
    names: map.names,
    sources: map.sources.map((source) => source ?? ""),
    sourcesContent: (map.sourcesContent ?? []).map((content) => content ?? ""),
    version: map.version,
  };

  return {
    ...sourceMap,
    toString: () => JSON.stringify(sourceMap),
    toUrl: () =>
      `data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(sourceMap)).toString("base64")}`,
  };
}

export function rewriteWithSourceMap(
  source: string,
  fileName: string,
  edits: readonly StylexClassNameEdit[],
  inputMap: Rollup.SourceMap,
): SourceMappedRewrite {
  const rewritten = new MagicString(source);

  for (const edit of edits) {
    rewritten.overwrite(edit.start, edit.end, edit.replacement);
  }

  const editMap = rewritten.generateMap({
    file: fileName,
    hires: true,
    includeContent: true,
    source: fileName,
  });
  const map = remapping(
    [JSON.parse(editMap.toString()) as SourceMapInput, inputMap as SourceMapInput],
    () => null,
  );

  return {
    code: rewritten.toString(),
    map: rollupSourceMap(map),
  };
}

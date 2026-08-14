import MagicString from "magic-string";
import type { Rollup } from "vite";
import type { StylexClassNameEdit } from "./class-names.js";

export type SourceMappedRewrite = {
  code: string;
  map: Rollup.SourceMap;
};

export function rewriteWithSourceMap(
  source: string,
  fileName: string,
  edits: readonly StylexClassNameEdit[],
): SourceMappedRewrite {
  const rewritten = new MagicString(source);

  for (const edit of edits) {
    rewritten.overwrite(edit.start, edit.end, edit.replacement);
  }

  return {
    code: rewritten.toString(),
    map: rewritten.generateMap({
      file: fileName,
      hires: true,
      includeContent: true,
      source: fileName,
    }) as Rollup.SourceMap,
  };
}

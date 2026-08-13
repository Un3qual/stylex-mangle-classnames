import { posix } from "node:path";
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from "source-map-js";
import { describe, expect, test } from "vitest";
import { parseAst, type Plugin, type ResolvedConfig, type Rollup } from "vite";
import { findStylexClassNamesInSelectors } from "../src/class-names.js";
import stylexMangleClassNames from "../src/index.js";

const PREFIX = "sx";

function outputChunk(code: string): Rollup.OutputChunk {
  return {
    code,
    fileName: "entry.js",
    moduleIds: ["entry.js"],
    modules: {
      "entry.js": {
        code,
        renderedExports: [],
        renderedLength: code.length,
      },
    },
    type: "chunk",
  } as unknown as Rollup.OutputChunk;
}

function outputAsset(fileName: string, source: string): Rollup.OutputAsset {
  return {
    fileName,
    name: fileName,
    source,
    type: "asset",
  } as unknown as Rollup.OutputAsset;
}

function materializeHashPlaceholders(pattern: string, hash: string): string {
  return pattern.replace(/\[hash(?::(\d+))?\]/g, (_placeholder, size: string | undefined) =>
    hash.slice(0, size === undefined ? 8 : Number.parseInt(size, 10)),
  );
}

function outputOptionsResult(
  plugin: Plugin,
  outputOptions: Rollup.OutputOptions,
): Rollup.OutputOptions {
  const hook = plugin.outputOptions;

  if (!hook) {
    throw new Error("Expected the plugin to define outputOptions");
  }

  const handler = typeof hook === "function" ? hook : hook.handler;
  const result = handler.call({} as Rollup.PluginContext, outputOptions);

  if (result instanceof Promise || !result) {
    throw new Error("Expected synchronous output options");
  }

  return result;
}

function runGenerateBundle(plugin: Plugin, bundle: Rollup.OutputBundle): void {
  const moduleIds = Object.values(bundle)
    .filter((output): output is Rollup.OutputChunk => output.type === "chunk")
    .map((output) => output.fileName);
  const context = {
    error(error: Rollup.RollupError | string): never {
      throw new Error(typeof error === "string" ? error : error.message);
    },
    getModuleIds: () => moduleIds.values(),
    parse: parseAst,
  } as unknown as Rollup.PluginContext;
  const buildStart = plugin.buildStart;

  if (buildStart) {
    const handler = typeof buildStart === "function" ? buildStart : buildStart.handler;
    handler.call(context, {} as Rollup.NormalizedInputOptions);
  }

  const transform = plugin.transform;

  if (transform) {
    const handler = typeof transform === "function" ? transform : transform.handler;

    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk") {
        continue;
      }

      const result = handler.call(
        context as unknown as Rollup.TransformPluginContext,
        output.code,
        output.fileName,
        { moduleType: "js" },
      ) as { code: string } | string | null;

      if (result instanceof Promise) {
        throw new Error("Expected the test transform hook to be synchronous");
      }

      if (typeof result === "string") {
        output.code = result;
      } else if (result?.code) {
        output.code = result.code;
      }
    }
  }

  const moduleParsed = plugin.moduleParsed;

  if (moduleParsed) {
    const handler = typeof moduleParsed === "function" ? moduleParsed : moduleParsed.handler;

    for (const output of Object.values(bundle)) {
      if (output.type === "chunk") {
        handler.call(context, {
          code: output.code,
          id: output.fileName,
        } as Rollup.ModuleInfo);
      }
    }
  }

  const renderStart = plugin.renderStart;

  if (renderStart) {
    const handler = typeof renderStart === "function" ? renderStart : renderStart.handler;
    handler.call(
      context,
      {} as Rollup.NormalizedOutputOptions,
      {} as Rollup.NormalizedInputOptions,
    );
  }

  const renderChunk = plugin.renderChunk;

  if (renderChunk) {
    const handler = typeof renderChunk === "function" ? renderChunk : renderChunk.handler;

    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk") {
        continue;
      }

      const result = handler.call(
        context,
        output.code,
        output,
        {} as Rollup.NormalizedOutputOptions,
        {} as never,
      ) as { code: string } | string | null;

      if (result instanceof Promise) {
        throw new Error("Expected the test renderChunk hook to be synchronous");
      }

      if (typeof result === "string") {
        output.code = result;
      } else if (result?.code) {
        output.code = result.code;
      }
    }
  }

  const hook = plugin.generateBundle;

  if (!hook) {
    throw new Error("Expected the plugin to define generateBundle");
  }

  const handler = typeof hook === "function" ? hook : hook.handler;

  handler.call(
    context,
    {} as Rollup.NormalizedOutputOptions,
    bundle,
    false,
  );
}

function rewriteBundle(code: string): string {
  const chunk = outputChunk(code);

  runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
    [chunk.fileName]: chunk,
  });

  return chunk.code;
}

async function runConfigResolved(
  plugin: Plugin,
  command: ResolvedConfig["command"],
  sourcemap: ResolvedConfig["build"]["sourcemap"] = false,
): Promise<void> {
  const hook = plugin.configResolved;

  if (!hook) {
    throw new Error("Expected the plugin to define configResolved");
  }

  const handler = typeof hook === "function" ? hook : hook.handler;
  await handler.call({} as never, { build: { sourcemap }, command } as ResolvedConfig);
}

function runTransform(plugin: Plugin, code: string) {
  const hook = plugin.transform;

  if (!hook) {
    throw new Error("Expected the plugin to define transform");
  }

  const handler = typeof hook === "function" ? hook : hook.handler;
  return Promise.resolve(
    handler.call(
      { parse: parseAst } as unknown as Rollup.TransformPluginContext,
      code,
      "/virtual-entry.js",
      { moduleType: "js" },
    ),
  );
}

function runTransformForModule(
  plugin: Plugin,
  code: string,
  id: string,
  moduleType?: "js" | "css",
) {
  const hook = plugin.transform;

  if (!hook) {
    throw new Error("Expected the plugin to define transform");
  }

  const handler = typeof hook === "function" ? hook : hook.handler;
  return Promise.resolve(
    handler.call(
      { parse: parseAst } as unknown as Rollup.TransformPluginContext,
      code,
      id,
      (moduleType === undefined ? {} : { moduleType }) as never,
    ),
  );
}

describe("stylexMangleClassNames", () => {
  test("accepts Rollup 4.2 singular asset metadata", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const hook = plugin.outputOptions;

    if (!hook) {
      throw new Error("Expected the plugin to define outputOptions");
    }

    const handler = typeof hook === "function" ? hook : hook.handler;
    const result = handler.call({} as Rollup.PluginContext, {
      assetFileNames: "assets/[name]-[hash][extname]",
    } as Rollup.OutputOptions);

    if (result instanceof Promise || !result || typeof result.assetFileNames !== "function") {
      throw new Error("Expected a synchronous asset filename callback");
    }

    const fileName = result.assetFileNames({
      name: "stylex.css",
      source: `.${PREFIX}1{color:red}`,
      type: "asset",
    } as Rollup.PreRenderedAsset);

    expect(fileName).toMatch(
      /^assets\/\[name\]-\[hash\]__STYLEX_HASH_[0-9a-z]+_[0-9a-z]+__\[extname\]$/,
    );
  });

  test.each([1, 2, 3, 4])("preserves valid [hash:%i] output patterns", (length) => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const resolved = outputOptionsResult(plugin, {
      assetFileNames: `assets/[name]-[hash:${length}][extname]`,
      entryFileNames: `assets/[name]-[hash:${length}].js`,
    });

    const assetFileNames = resolved.assetFileNames;
    const entryFileNames = resolved.entryFileNames;

    if (typeof assetFileNames !== "function" || typeof entryFileNames !== "function") {
      throw new Error("Expected filename callbacks");
    }

    expect(() =>
      assetFileNames({
        name: "stylex.css",
        source: `.${PREFIX}1{color:red}`,
        type: "asset",
      } as Rollup.PreRenderedAsset),
    ).not.toThrow();
    expect(() =>
      entryFileNames({ name: "entry" } as Rollup.PreRenderedChunk),
    ).not.toThrow();
  });

  test("does not mark CSS assets emitted after its generateBundle hook", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const outputOptions = plugin.outputOptions;
    const generateBundle = plugin.generateBundle;

    if (!outputOptions || !generateBundle) {
      throw new Error("Expected outputOptions and generateBundle hooks");
    }

    const outputOptionsHandler =
      typeof outputOptions === "function" ? outputOptions : outputOptions.handler;
    const resolved = outputOptionsHandler.call({} as Rollup.PluginContext, {
      assetFileNames: "assets/[name]-[hash][extname]",
    } as Rollup.OutputOptions);

    if (
      resolved instanceof Promise ||
      !resolved ||
      typeof resolved.assetFileNames !== "function"
    ) {
      throw new Error("Expected a synchronous asset filename callback");
    }

    const cssAsset = {
      name: "stylex.css",
      source: `.${PREFIX}1{color:red}`,
      type: "asset",
    } as Rollup.PreRenderedAsset;

    expect(resolved.assetFileNames(cssAsset)).toContain("__STYLEX_HASH_");

    const generateBundleHandler =
      typeof generateBundle === "function" ? generateBundle : generateBundle.handler;
    generateBundleHandler.call(
      {
        error(error: Rollup.RollupError | string): never {
          throw new Error(typeof error === "string" ? error : error.message);
        },
      } as Rollup.PluginContext,
      {} as Rollup.NormalizedOutputOptions,
      {},
      false,
    );

    expect(resolved.assetFileNames({ ...cssAsset })).toContain("[hash]");
  });

  test("starts hash finalization again for every Rollup output", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const cssAsset = {
      name: "stylex.css",
      source: `.${PREFIX}1{color:red}`,
      type: "asset",
    } as Rollup.PreRenderedAsset;

    const first = outputOptionsResult(plugin, {
      assetFileNames: "assets/[name]-[hash][extname]",
    });

    if (typeof first.assetFileNames !== "function") {
      throw new Error("Expected an asset filename callback");
    }

    const firstPattern = first.assetFileNames(cssAsset);
    expect(firstPattern).not.toBe("assets/[name]-[hash][extname]");

    const generateBundle = plugin.generateBundle;

    if (!generateBundle) {
      throw new Error("Expected generateBundle");
    }

    const handler =
      typeof generateBundle === "function" ? generateBundle : generateBundle.handler;
    handler.call(
      { error: (error: string): never => { throw new Error(error); } } as Rollup.PluginContext,
      {} as Rollup.NormalizedOutputOptions,
      {},
      false,
    );

    const second = outputOptionsResult(plugin, {
      assetFileNames: "assets/[name]-[hash][extname]",
    });

    if (typeof second.assetFileNames !== "function") {
      throw new Error("Expected an asset filename callback");
    }

    expect(second.assetFileNames({ ...cssAsset })).not.toBe(
      "assets/[name]-[hash][extname]",
    );
  });

  test("renames bundle keys and filename-bearing chunk metadata together", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const resolved = outputOptionsResult(plugin, {
      assetFileNames: "assets/[name]-[hash].css",
      chunkFileNames: "assets/[name]-[hash].js",
      entryFileNames: "assets/[name]-[hash].js",
    });

    if (
      typeof resolved.assetFileNames !== "function" ||
      typeof resolved.entryFileNames !== "function" ||
      typeof resolved.chunkFileNames !== "function"
    ) {
      throw new Error("Expected filename callbacks");
    }

    const cssName = materializeHashPlaceholders(
      resolved.assetFileNames({
        name: "stylex.css",
        source: `.${PREFIX}1{color:red}`,
        type: "asset",
      } as Rollup.PreRenderedAsset),
      "csshash0",
    ).replace("[name]", "stylex");
    const dependencyName = materializeHashPlaceholders(
      resolved.chunkFileNames({ name: "dependency" } as Rollup.PreRenderedChunk),
      "dephash0",
    ).replace("[name]", "dependency");
    const entryName = materializeHashPlaceholders(
      resolved.entryFileNames({ name: "entry" } as Rollup.PreRenderedChunk),
      "entryhas",
    ).replace("[name]", "entry");
    const css = outputAsset(cssName, `.${PREFIX}1{color:red}`);
    const dependency = outputChunk(`globalThis.className = "${PREFIX}1";`);
    dependency.fileName = dependencyName;
    const entry = outputChunk(`import "./${posix.basename(dependencyName)}";`);
    entry.fileName = entryName;
    entry.imports = [dependencyName];
    entry.dynamicImports = [dependencyName];
    const compatibleEntry = entry as Rollup.OutputChunk & {
      implicitlyLoadedBefore: string[];
      referencedFiles: string[];
    };
    compatibleEntry.implicitlyLoadedBefore = [dependencyName];
    compatibleEntry.referencedFiles = [cssName];
    const bundle: Rollup.OutputBundle = {
      [cssName]: css,
      [dependencyName]: dependency,
      [entryName]: entry,
    };

    runGenerateBundle(plugin, bundle);

    expect(Object.entries(bundle).every(([key, output]) => key === output.fileName)).toBe(
      true,
    );
    expect(entry.imports).toEqual([dependency.fileName]);
    expect(entry.dynamicImports).toEqual([dependency.fileName]);
    expect(compatibleEntry.implicitlyLoadedBefore).toEqual([dependency.fileName]);
    expect(compatibleEntry.referencedFiles).toEqual([css.fileName]);
  });

  test("updates Vite filename metadata when outputs are finalized", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const resolved = outputOptionsResult(plugin, {
      assetFileNames: "assets/[name]-[hash][extname]",
      entryFileNames: "assets/[name]-[hash].js",
    });

    if (
      typeof resolved.assetFileNames !== "function" ||
      typeof resolved.entryFileNames !== "function"
    ) {
      throw new Error("Expected filename callbacks");
    }

    const cssName = materializeHashPlaceholders(
      resolved.assetFileNames({
        name: "stylex.css",
        source: `.${PREFIX}1{color:red}`,
        type: "asset",
      } as Rollup.PreRenderedAsset),
      "csshash0",
    )
      .replace("[name]", "stylex")
      .replace("[extname]", ".css");
    const assetName = materializeHashPlaceholders(
      resolved.assetFileNames({
        name: "data.txt",
        source: "data",
        type: "asset",
      } as Rollup.PreRenderedAsset),
      "assethas",
    )
      .replace("[name]", "data")
      .replace("[extname]", ".txt");
    const entryName = materializeHashPlaceholders(
      resolved.entryFileNames({ name: "entry" } as Rollup.PreRenderedChunk),
      "entryhas",
    ).replace("[name]", "entry");
    const css = outputAsset(cssName, `.${PREFIX}1{color:red}`);
    const asset = outputAsset(assetName, "data");
    const entry = outputChunk(`globalThis.className = "${PREFIX}1";`);
    entry.fileName = entryName;
    const viteEntry = entry;
    viteEntry.viteMetadata = {
      __modules: entry.modules,
      importedAssets: new Set([assetName]),
      importedCss: new Set([cssName]),
    };

    runGenerateBundle(plugin, {
      [assetName]: asset,
      [cssName]: css,
      [entryName]: entry,
    });

    expect(viteEntry.viteMetadata.importedAssets).toEqual(new Set([asset.fileName]));
    expect(viteEntry.viteMetadata.importedCss).toEqual(new Set([css.fileName]));
  });

  test("rewrites generated class names in JavaScript emitted as an asset", () => {
    const chunk = outputChunk(
      [
        `inject({ ltr: ".${PREFIX}1{color:red}" });`,
        `globalThis.chunkClass = "${PREFIX}1";`,
      ].join("\n"),
    );
    const asset = outputAsset(
      "worker.js",
      `globalThis.workerClass = "${PREFIX}1";`,
    );

    runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
      [chunk.fileName]: chunk,
      [asset.fileName]: asset,
    });

    expect(asset.source).toBe('globalThis.workerClass = "a";');
  });

  test.each(["external", "inline"] as const)(
    "composes %s source maps for JavaScript emitted as an asset",
    (mode) => {
      const source = `globalThis.workerClass = "${PREFIX}1";globalThis.afterValue = 1;`;
      const afterColumn = source.indexOf("globalThis.afterValue");
      const sourceMap = new SourceMapGenerator({ file: "worker.js" });

      for (const column of [0, afterColumn]) {
        sourceMap.addMapping({
          generated: { column, line: 1 },
          original: { column, line: 1 },
          source: "worker-source.js",
        });
      }

      sourceMap.setSourceContent("worker-source.js", source);
      const serializedMap = sourceMap.toString();
      const sourceMapUrl =
        mode === "inline"
          ? `data:application/json;base64,${Buffer.from(serializedMap).toString("base64")}`
          : "worker.js.map";
      const chunk = outputChunk(`inject({ ltr: ".${PREFIX}1{color:red}" });`);
      const asset = outputAsset(
        "worker.js",
        `${source}\n//# sourceMappingURL=${sourceMapUrl}`,
      );
      const mapAsset = outputAsset("worker.js.map", serializedMap);
      const bundle: Rollup.OutputBundle = {
        [chunk.fileName]: chunk,
        [asset.fileName]: asset,
        ...(mode === "external" ? { [mapAsset.fileName]: mapAsset } : {}),
      };

      runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), bundle);

      const rewritten = String(asset.source);
      const rewrittenAfterColumn = rewritten.indexOf("globalThis.afterValue");
      const rewrittenInlineMap = rewritten.match(
        /sourceMappingURL=data:application\/json;base64,([^\n]+)/,
      )?.[1];
      const outputMap =
        mode === "inline"
          ? Buffer.from(rewrittenInlineMap ?? "", "base64").toString("utf8")
          : String(mapAsset.source);
      const originalPosition = new SourceMapConsumer(
        JSON.parse(outputMap) as RawSourceMap,
      ).originalPositionFor({ column: rewrittenAfterColumn, line: 1 });

      expect(rewritten).toContain('globalThis.workerClass = "a";');
      expect(originalPosition).toMatchObject({
        column: afterColumn,
        line: 1,
        source: "worker-source.js",
      });
    },
  );

  test("updates finalized chunk filenames inside inline source maps", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const resolved = outputOptionsResult(plugin, {
      entryFileNames: "assets/[name]-[hash].js",
    });

    if (typeof resolved.entryFileNames !== "function") {
      throw new Error("Expected an entry filename callback");
    }

    const preliminaryFileName = materializeHashPlaceholders(
      resolved.entryFileNames({ name: "entry" } as Rollup.PreRenderedChunk),
      "native00",
    ).replace("[name]", "entry");
    const sourceMap = Buffer.from(
      JSON.stringify({
        file: preliminaryFileName,
        mappings: "",
        names: [],
        sources: ["entry.ts"],
        version: 3,
      }),
    ).toString("base64");
    const chunk = outputChunk(
      `globalThis.value = 1;\n//# sourceMappingURL=data:application/json;base64,${sourceMap}`,
    );
    chunk.fileName = preliminaryFileName;
    const bundle = { [preliminaryFileName]: chunk };

    runGenerateBundle(plugin, bundle);

    const encodedMap = chunk.code.match(
      /sourceMappingURL=data:application\/json;base64,([^\n]+)/,
    )?.[1];

    if (encodedMap === undefined) {
      throw new Error("Expected an inline source map");
    }

    const finalizedMap = JSON.parse(
      Buffer.from(encodedMap, "base64").toString("utf8"),
    ) as { file: string };

    expect(chunk.fileName).not.toBe(preliminaryFileName);
    expect(finalizedMap.file).toBe(chunk.fileName);
  });

  test("finalizes a chunk and its default source map with their shared hash", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const resolved = outputOptionsResult(plugin, {
      entryFileNames: "assets/[name]-[hash].js",
    });

    if (typeof resolved.entryFileNames !== "function") {
      throw new Error("Expected an entry filename callback");
    }

    const preliminaryFileName = materializeHashPlaceholders(
      resolved.entryFileNames({ name: "entry" } as Rollup.PreRenderedChunk),
      "native00",
    ).replace("[name]", "entry");
    const preliminaryMapFileName = `${preliminaryFileName}.map`;
    const chunk = outputChunk(
      `globalThis.value = 1;\n//# sourceMappingURL=${posix.basename(preliminaryMapFileName)}`,
    );
    chunk.fileName = preliminaryFileName;
    chunk.sourcemapFileName = preliminaryMapFileName;
    const map = outputAsset(
      preliminaryMapFileName,
      JSON.stringify({
        file: preliminaryFileName,
        mappings: "",
        names: [],
        sources: ["entry.ts"],
        version: 3,
      }),
    );

    runGenerateBundle(plugin, {
      [preliminaryFileName]: chunk,
      [preliminaryMapFileName]: map,
    });

    expect(map.fileName).toBe(`${chunk.fileName}.map`);
    expect(chunk.code).toContain(`sourceMappingURL=${posix.basename(map.fileName)}`);
    expect(JSON.parse(String(map.source))).toMatchObject({ file: chunk.fileName });
  });

  test("fails instead of overwriting outputs when short hashes collide", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const resolved = outputOptionsResult(plugin, {
      chunkFileNames: "chunks/[hash:1].js",
    });

    if (typeof resolved.chunkFileNames !== "function") {
      throw new Error("Expected a chunk filename callback");
    }

    const bundle: Rollup.OutputBundle = {};

    for (let index = 0; index < 65; index += 1) {
      const preliminaryFileName = materializeHashPlaceholders(
        resolved.chunkFileNames({ name: `chunk-${index}` } as Rollup.PreRenderedChunk),
        "a",
      );
      const chunk = outputChunk(`globalThis.value = ${index};`);
      chunk.fileName = preliminaryFileName;
      bundle[preliminaryFileName] = chunk;
    }

    expect(() => runGenerateBundle(plugin, bundle)).toThrow(
      /finalized output filename collision/,
    );
    expect(Object.keys(bundle)).toHaveLength(65);
  });

  test("keeps output hashes stable when unrelated marker allocation changes", () => {
    function targetFileName(includeUnrelated: boolean): string {
      const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
      const resolved = outputOptionsResult(plugin, {
        assetFileNames: "assets/[name]-[hash][extname]",
      });

      if (typeof resolved.assetFileNames !== "function") {
        throw new Error("Expected an asset filename callback");
      }

      const bundle: Rollup.OutputBundle = {};

      if (includeUnrelated) {
        const unrelatedName = materializeHashPlaceholders(
          resolved.assetFileNames({
            name: "unrelated.txt",
            source: "unrelated",
            type: "asset",
          } as Rollup.PreRenderedAsset),
          "native00",
        )
          .replace("[name]", "unrelated")
          .replace("[extname]", ".txt");
        bundle[unrelatedName] = outputAsset(unrelatedName, "unrelated");
      }

      const targetName = materializeHashPlaceholders(
        resolved.assetFileNames({
          name: "target.txt",
          source: "target",
          type: "asset",
        } as Rollup.PreRenderedAsset),
        "native00",
      )
        .replace("[name]", "target")
        .replace("[extname]", ".txt");
      const target = outputAsset(targetName, "target");
      bundle[targetName] = target;

      runGenerateBundle(plugin, bundle);
      return target.fileName;
    }

    expect(targetFileName(true)).toBe(targetFileName(false));
  });

  test("rehashes every chunk in a circular dependency group", () => {
    function finalize(firstSource: string): [string, string] {
      const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
      const resolved = outputOptionsResult(plugin, {
        chunkFileNames: "assets/[name]-[hash].js",
      });

      if (typeof resolved.chunkFileNames !== "function") {
        throw new Error("Expected a chunk filename callback");
      }

      const firstName = materializeHashPlaceholders(
        resolved.chunkFileNames({ name: "first" } as Rollup.PreRenderedChunk),
        "first000",
      ).replace("[name]", "first");
      const secondName = materializeHashPlaceholders(
        resolved.chunkFileNames({ name: "second" } as Rollup.PreRenderedChunk),
        "second00",
      ).replace("[name]", "second");
      const first = outputChunk(`${firstSource};import "./${posix.basename(secondName)}";`);
      first.fileName = firstName;
      first.imports = [secondName];
      const second = outputChunk(`import "./${posix.basename(firstName)}";`);
      second.fileName = secondName;
      second.imports = [firstName];
      const bundle = { [firstName]: first, [secondName]: second };

      runGenerateBundle(plugin, bundle);
      return [first.fileName, second.fileName];
    }

    const before = finalize("globalThis.value = 1");
    const after = finalize("globalThis.value = 2");

    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  test("maps generated classes to a through z, then aa and ab", () => {
    const originals = "123456789abcdefghijklmnopqrs"
      .split("")
      .map((hash) => `${PREFIX}${hash}`);
    const source = [
      ...originals.map((className) => `inject({ ltr: ".${className}{color:red}" });`),
      `globalThis.classes = "${originals.join(" ")}";`,
    ].join("\n");
    const lastLine = rewriteBundle(source).split("\n").at(-1);

    expect(lastLine).toBe(
      'globalThis.classes = "a b c d e f g h i j k l m n o p q r s t u v w x y z aa ab";',
    );
  });

  test("assigns one deterministic mapping across every emitted text file", () => {
    const first = outputChunk(
      [
        `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
        `inject({ ltr: ".${PREFIX}1{color:red}" });`,
        `globalThis.first = "${PREFIX}z ${PREFIX}1";`,
      ].join("\n"),
    );
    const second = outputAsset(
      "styles.css",
      `.${PREFIX}1{color:red}.${PREFIX}z:hover{color:blue}`,
    );
    const third = outputAsset("index.html", `<main class="${PREFIX}z ${PREFIX}1"></main>`);
    const bundle = {
      [first.fileName]: first,
      [second.fileName]: second,
      [third.fileName]: third,
    };

    runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), bundle);

    expect(first.code.split("\n").at(-1)).toBe('globalThis.first = "b a";');
    expect(second.source).toBe(".a{color:red}.b:hover{color:blue}");
    expect(third.source).toBe('<main class="b a"></main>');
  });

  test("builds one mapping from all rendered chunks without renderChunk metadata", () => {
    const first = outputChunk(
      [
        `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
        `globalThis.first = "${PREFIX}z";`,
      ].join("\n"),
    );
    first.fileName = "first.js";
    first.modules = {
      "/first.js": {
        code: first.code,
        renderedExports: [],
        renderedLength: first.code.length,
      },
    };
    const second = outputChunk(
      [
        `inject({ ltr: ".${PREFIX}1{color:red}" });`,
        `globalThis.second = "${PREFIX}1";`,
      ].join("\n"),
    );
    second.fileName = "second.js";
    second.modules = {
      "/second.js": {
        code: second.code,
        renderedExports: [],
        renderedLength: second.code.length,
      },
    };

    runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
      [first.fileName]: first,
      [second.fileName]: second,
    });

    expect(first.code).toContain('globalThis.first = "b";');
    expect(second.code).toContain('globalThis.second = "a";');
  });

  test("discovers extracted StyleX classes from matching selectors and references", () => {
    const javascript = outputChunk(
      [
        `globalThis.style = { color: "${PREFIX}1", $$css: true };`,
        `globalThis.className = "${PREFIX}1";`,
      ].join("\n"),
    );
    const css = outputAsset("styles.css", `.${PREFIX}1{color:red}`);
    const html = outputAsset("index.html", `<main class="${PREFIX}1"></main>`);
    const bundle = {
      [javascript.fileName]: javascript,
      [css.fileName]: css,
      [html.fileName]: html,
    };

    runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), bundle);

    expect(javascript.code).toContain('globalThis.style = { color: "a", $$css: true };');
    expect(javascript.code).toContain('globalThis.className = "a";');
    expect(css.source).toBe(".a{color:red}");
    expect(html.source).toBe('<main class="a"></main>');
  });

  test("discovers classes only from CSS selector preludes", () => {
    const source = [
      `/* .${PREFIX}commented */`,
      `.icon::before{content:".${PREFIX}value"}`,
      `.root{--token:.${PREFIX}declaration{color:red};}`,
      `[data-value=".${PREFIX}attribute"] .${PREFIX}descendant{color:red}`,
      `@supports selector(.${PREFIX}condition){.${PREFIX}nested:hover{color:red}}`,
    ].join("\n");

    expect(findStylexClassNamesInSelectors(source, PREFIX)).toEqual(
      new Set([`${PREFIX}descendant`, `${PREFIX}nested`]),
    );
  });

  test.each(["css", "less", "sass", "scss", "styl", "stylus", "pcss", "postcss", "sss"])(
    "does not parse .%s stylesheets as JavaScript without moduleType metadata",
    async (extension) => {
      const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
      await runConfigResolved(plugin, "serve");

      await expect(
        runTransformForModule(
          plugin,
          `.${PREFIX}1 { color: red; }`,
          `/styles.${extension}?direct`,
        ),
      ).resolves.toBeNull();
    },
  );

  test("does not parse runtime rule objects from CSS assets", () => {
    const css = outputAsset("styles.css", String.raw`:root{--ltr:"\a"}`);

    expect(() =>
      runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
        [css.fileName]: css,
      }),
    ).not.toThrow();
  });

  test("ignores malformed ltr and rtl application strings", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "serve");
    const source = 'globalThis.copy = { ltr: "Welcome {name", rtl: "مرحبا {name" };';

    await expect(runTransform(plugin, source)).resolves.toBeNull();
  });

  test("sorts runtime and extracted generated classes as one set", () => {
    const javascript = outputChunk(
      [
        `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
        `globalThis.style = { color: "${PREFIX}1", $$css: true };`,
        `globalThis.className = "${PREFIX}z ${PREFIX}1";`,
      ].join("\n"),
    );
    const css = outputAsset("styles.css", `.${PREFIX}1{color:red}`);

    runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
      [javascript.fileName]: javascript,
      [css.fileName]: css,
    });

    expect(javascript.code.split("\n").at(-1)).toBe('globalThis.className = "b a";');
    expect(css.source).toBe(".a{color:red}");
  });

  test("rebuilds class discovery from rendered modules across watch rebuilds", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const context = {
      parse: parseAst,
    } as unknown as Rollup.PluginContext;
    const buildStart = plugin.buildStart;
    const renderStart = plugin.renderStart;
    const renderChunk = plugin.renderChunk;

    if (!buildStart || !renderStart || !renderChunk) {
      throw new Error("Expected build and rendering hooks");
    }

    const buildStartHandler = typeof buildStart === "function" ? buildStart : buildStart.handler;
    const runtimeSource = `inject({ ltr: ".${PREFIX}z{color:blue}" });`;
    const extractedSource = `globalThis.style = { color: "${PREFIX}1", $$css: true };`;

    const renderStartHandler =
      typeof renderStart === "function" ? renderStart : renderStart.handler;
    const renderChunkHandler =
      typeof renderChunk === "function" ? renderChunk : renderChunk.handler;

    for (let buildNumber = 0; buildNumber < 2; buildNumber += 1) {
      buildStartHandler.call(context, {} as Rollup.NormalizedInputOptions);

      renderStartHandler.call(
        context,
        {} as Rollup.NormalizedOutputOptions,
        {} as Rollup.NormalizedInputOptions,
      );

      const chunk = outputChunk(`globalThis.className = "${PREFIX}z ${PREFIX}1";`);
      chunk.moduleIds = ["/runtime.js", "/extracted.js"];
      chunk.modules = {
        "/runtime.js": {
          code: runtimeSource,
          renderedExports: [],
          renderedLength: runtimeSource.length,
        },
        "/extracted.js": {
          code: extractedSource,
          renderedExports: [],
          renderedLength: extractedSource.length,
        },
      };
      const result = renderChunkHandler.call(
        context,
        chunk.code,
        chunk,
        {} as Rollup.NormalizedOutputOptions,
        { chunks: { [chunk.fileName]: chunk } } as never,
      ) as { code: string } | null;

      expect(result?.code).toBe('globalThis.className = "b a";');
    }
  });

  test("discovers a complete render chunk graph only once per render", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    let parseCount = 0;
    const context = {
      parse(source: string) {
        parseCount += 1;
        return parseAst(source);
      },
    } as unknown as Rollup.PluginContext;
    const buildStart = plugin.buildStart;
    const renderStart = plugin.renderStart;
    const renderChunk = plugin.renderChunk;

    if (!buildStart || !renderStart || !renderChunk) {
      throw new Error("Expected build and rendering hooks");
    }

    const buildStartHandler = typeof buildStart === "function" ? buildStart : buildStart.handler;
    const renderStartHandler =
      typeof renderStart === "function" ? renderStart : renderStart.handler;
    const renderChunkHandler =
      typeof renderChunk === "function" ? renderChunk : renderChunk.handler;
    const firstSource = `globalThis.style = { color: "${PREFIX}1", $$css: true };`;
    const secondSource = `inject({ ltr: ".${PREFIX}z{color:blue}" });`;
    const first = outputChunk(`globalThis.first = "${PREFIX}1";`);
    first.fileName = "first.js";
    first.modules = {
      "/first.js": {
        code: firstSource,
        renderedExports: [],
        renderedLength: firstSource.length,
      },
    };
    const second = outputChunk(`globalThis.second = "${PREFIX}z";`);
    second.fileName = "second.js";
    second.modules = {
      "/second.js": {
        code: secondSource,
        renderedExports: [],
        renderedLength: secondSource.length,
      },
    };
    const meta = { chunks: { [first.fileName]: first, [second.fileName]: second } };

    buildStartHandler.call(context, {} as Rollup.NormalizedInputOptions);
    renderStartHandler.call(
      context,
      {} as Rollup.NormalizedOutputOptions,
      {} as Rollup.NormalizedInputOptions,
    );

    const firstResult = renderChunkHandler.call(
      context,
      first.code,
      first,
      {} as Rollup.NormalizedOutputOptions,
      meta as never,
    ) as { code: string } | null;
    const secondResult = renderChunkHandler.call(
      context,
      second.code,
      second,
      {} as Rollup.NormalizedOutputOptions,
      meta as never,
    ) as { code: string } | null;

    expect(firstResult?.code).toBe('globalThis.first = "a";');
    expect(secondResult?.code).toBe('globalThis.second = "b";');
    expect(parseCount).toBe(2);
  });

  test("preserves StyleX constants, custom properties, keyframes, and unrelated classes", () => {
    const atomic = `${PREFIX}1dmbf1k`;
    const spacedConstKey = `register({ constKey${" ".repeat(40)}:${" ".repeat(40)}"${atomic}" });`;
    const source = [
      `inject({ ltr: ".${atomic}{color:red}" });`,
      `globalThis.className = "${atomic} product-card";`,
      `register({ constKey: "${atomic}", constVal: "red" });`,
      spacedConstKey,
      `globalThis.variable = "--${atomic}";`,
      `globalThis.keyframes = "${atomic}-B";`,
    ].join("\n");

    expect(rewriteBundle(source)).toBe(
      [
        'inject({ ltr: ".a{color:red}" });',
        'globalThis.className = "a product-card";',
        `register({ constKey: "${atomic}", constVal: "red" });`,
        spacedConstKey,
        `globalThis.variable = "--${atomic}";`,
        `globalThis.keyframes = "${atomic}-B";`,
      ].join("\n"),
    );
  });

  test("preserves prefix-shaped application data that is not a generated StyleX class", () => {
    const atomic = `${PREFIX}1`;
    const productId = `${PREFIX}123`;
    const source = [
      `inject({ ltr: ".${atomic}{color:red}" });`,
      `globalThis.className = "${atomic}";`,
      `globalThis.productId = "${productId}";`,
    ].join("\n");

    expect(rewriteBundle(source)).toBe(
      [
        'inject({ ltr: ".a{color:red}" });',
        'globalThis.className = "a";',
        `globalThis.productId = "${productId}";`,
      ].join("\n"),
    );
  });

  test("preserves prefix-shaped authored CSS without a matching StyleX rule", () => {
    const css = outputAsset("styles.css", `.${PREFIX}123{color:red}`);

    runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
      [css.fileName]: css,
    });

    expect(css.source).toBe(`.${PREFIX}123{color:red}`);
  });

  test("preserves prefix-shaped application data without a matching CSS selector", () => {
    const javascript = outputChunk(`globalThis.productId = "${PREFIX}123";`);

    runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
      [javascript.fileName]: javascript,
    });

    expect(javascript.code).toBe(`globalThis.productId = "${PREFIX}123";`);
  });

  test("fails when a generated short name collides with authored CSS", () => {
    const javascript = outputChunk(`inject({ ltr: ".${PREFIX}1{color:red}" });`);
    const css = outputAsset("styles.css", `.${PREFIX}1{color:red}.a{color:blue}`);

    expect(() =>
      runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
        [javascript.fileName]: javascript,
        [css.fileName]: css,
      }),
    ).toThrow('generated class ".a" would collide with authored CSS');
  });

  test("does not treat an escaped authored class prefix as a collision", () => {
    const javascript = outputChunk(`inject({ ltr: ".${PREFIX}1{color:red}" });`);
    const css = outputAsset(
      "styles.css",
      `.${PREFIX}1{color:red}.a\\:hover{color:blue}`,
    );

    expect(() =>
      runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
        [javascript.fileName]: javascript,
        [css.fileName]: css,
      }),
    ).not.toThrow();
    expect(css.source).toBe(".a{color:red}.a\\:hover{color:blue}");
  });

  test("detects a collision with an escaped authored class", () => {
    const javascript = outputChunk(`inject({ ltr: ".${PREFIX}1{color:red}" });`);
    const css = outputAsset("styles.css", `.${PREFIX}1{color:red}.\\61{color:blue}`);

    expect(() =>
      runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
        [javascript.fileName]: javascript,
        [css.fileName]: css,
      }),
    ).toThrow('generated class ".a" would collide with authored CSS');
  });

  test("fails when an extracted generated short name collides with authored CSS", () => {
    const javascript = outputChunk(
      `globalThis.style = { color: "${PREFIX}1", $$css: true };`,
    );
    const css = outputAsset("styles.css", `.${PREFIX}1{color:red}.a{color:blue}`);

    expect(() =>
      runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
        [javascript.fileName]: javascript,
        [css.fileName]: css,
      }),
    ).toThrow('generated class ".a" would collide with authored CSS');
  });

  test.each(["", "1sx", "sx-"])("rejects the invalid StyleX prefix %j", (classNamePrefix) => {
    expect(() => stylexMangleClassNames({ classNamePrefix })).toThrow(
      "classNamePrefix must start with a letter and contain only ASCII letters and numbers",
    );
  });

  test("rewrites generated class names during Vite development transforms", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "serve");
    const source = [
      `inject({ ltr: ".${PREFIX}1{color:red}" });`,
      `globalThis.className = "${PREFIX}1";`,
    ].join("\n");

    await expect(runTransform(plugin, source)).resolves.toEqual({
      code: ['inject({ ltr: ".a{color:red}" });', 'globalThis.className = "a";'].join("\n"),
      map: null,
    });
  });

  test("does not parse compiled objects during Vite development transforms", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "serve");
    const hook = plugin.transform;

    if (!hook) {
      throw new Error("Expected the plugin to define transform");
    }

    const handler = typeof hook === "function" ? hook : hook.handler;
    const source = [
      `inject({ ltr: ".${PREFIX}1{color:red}" });`,
      `globalThis.className = "${PREFIX}1";`,
    ].join("\n");
    const result = await handler.call(
      {
        parse(): never {
          throw new Error("development transforms must not parse compiled objects");
        },
      } as unknown as Rollup.TransformPluginContext,
      source,
      "/virtual-entry.js",
      { moduleType: "js" },
    );

    expect(result).toEqual({
      code: ['inject({ ltr: ".a{color:red}" });', 'globalThis.className = "a";'].join("\n"),
      map: null,
    });
  });

  test("leaves extracted class names unchanged during Vite development transforms", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "serve");
    const source = [
      `globalThis.style = { color: "${PREFIX}1", $$css: true };`,
      `globalThis.className = "${PREFIX}1";`,
    ].join("\n");

    await expect(runTransform(plugin, source)).resolves.toBeNull();
  });

  test("does not rewrite individual transforms during production builds", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "build");

    await expect(runTransform(plugin, `globalThis.className = "${PREFIX}1";`)).resolves.toBeNull();
  });

  test("accepts production source maps", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });

    await expect(runConfigResolved(plugin, "build", true)).resolves.toBeUndefined();
  });
});

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from "source-map-js";
import { afterEach, describe, expect, test } from "vitest";
import { build, type Plugin, type Rollup } from "vite";
import stylexMangleClassNames from "../src/index.js";

const PREFIX = "sx";
const temporaryDirectories: string[] = [];
type SourceMapMode = true | "hidden" | "inline";

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

function virtualEntry(includeInlineMapText = false): Plugin {
  return {
    name: "virtual-entry",
    resolveId(id) {
      return id === "virtual:entry" ? "/virtual-entry.js" : null;
    },
    load(id) {
      return id === "/virtual-entry.js"
        ? [
            ...(includeInlineMapText
              ? [
                  'globalThis.fakeMap = "sourceMappingURL=data:application/json;charset=utf-8;base64,e30=";',
                ]
              : []),
            `inject({ ltr: ".${PREFIX}1{color:red}" });`,
            `globalThis.className = "${PREFIX}1";`,
            `globalThis.values = ["${PREFIX}1", globalThis.afterValue];`,
          ].join("\n")
        : null;
    },
  };
}

function virtualExtractedEntry(): Plugin {
  return {
    name: "virtual-extracted-entry",
    resolveId(id) {
      return id === "virtual:entry" ? "/virtual-entry.js" : null;
    },
    load(id) {
      return id === "/virtual-entry.js"
        ? [
            `globalThis.className = "${PREFIX}1";`,
            `globalThis.values = ["${PREFIX}1", globalThis.afterValue];`,
            `globalThis.style = { color: "${PREFIX}1", $$css: true };`,
          ].join("\n")
        : null;
    },
  };
}

function inputMapWithoutSourceContent(): Plugin {
  return {
    name: "input-map-without-source-content",
    enforce: "pre",
    transform(code, id) {
      if (id !== "/virtual-entry.js") {
        return null;
      }

      return {
        code,
        map: {
          file: id,
          mappings: "AAAA;AACA;AACA",
          names: [],
          sources: ["original-entry.js"],
          sourcesContent: [null],
          version: 3,
        },
      };
    },
  };
}

function bundledCss(source: string, name = "stylex.css"): Plugin {
  return {
    name: "bundled-stylex-css",
    generateBundle() {
      this.emitFile({ name, source, type: "asset" });
    },
  };
}

function bundledCssWithLateAppend(source: string): Plugin {
  let referenceId: string;

  return {
    name: "bundled-stylex-css-with-late-append",
    buildStart() {
      referenceId = this.emitFile({
        name: "stylex.css",
        source: ".base{display:block}",
        type: "asset",
      });
    },
    generateBundle(_outputOptions, bundle) {
      const output = bundle[this.getFileName(referenceId)];

      if (output?.type !== "asset") {
        throw new Error("Expected the emitted CSS asset in generateBundle");
      }

      output.source = `${output.source}${source}`;
    },
  };
}

async function buildWithCss(css: string): Promise<{ css: string; javascript: string }> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualEntry(),
      bundledCss(css),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const javascriptFile = files.find((file) => file.endsWith(".js"));
  const cssFile = files.find((file) => file.endsWith(".css"));

  if (!javascriptFile || !cssFile) {
    throw new Error("Expected Vite to emit JavaScript and CSS assets");
  }

  return {
    css: await readFile(join(assetsDirectory, cssFile), "utf8"),
    javascript: await readFile(join(assetsDirectory, javascriptFile), "utf8"),
  };
}

async function buildWithSourceMap(
  sourcemap: SourceMapMode,
  includeInlineMapText = false,
  omitInputSourceContent = false,
): Promise<{
  files: string[];
  javascript: string;
  sourceMap: Record<string, unknown>;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
      sourcemap,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualEntry(includeInlineMapText),
      ...(omitInputSourceContent ? [inputMapWithoutSourceContent()] : []),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const javascriptFile = files.find((file) => file.endsWith(".js"));

  if (!javascriptFile) {
    throw new Error("Expected Vite to emit a JavaScript asset");
  }

  const javascript = await readFile(join(assetsDirectory, javascriptFile), "utf8");
  const inlineMaps = [
    ...javascript.matchAll(
      /\/\/[#@]\s*sourceMappingURL=data:application\/json;charset=utf-8;base64,([^\n]+)/g,
    ),
  ];
  const inlineMap = inlineMaps.at(-1)?.[1];
  const mapFile = files.find((file) => file.endsWith(".js.map"));

  if (inlineMap) {
    return {
      files,
      javascript,
      sourceMap: JSON.parse(Buffer.from(inlineMap, "base64").toString("utf8")),
    };
  }

  if (!mapFile) {
    throw new Error("Expected Vite to emit a JavaScript source map");
  }

  return {
    files,
    javascript,
    sourceMap: JSON.parse(await readFile(join(assetsDirectory, mapFile), "utf8")),
  };
}

async function buildWithExtractedCss(): Promise<{
  css: string;
  javascript: string;
  sourceMap: Record<string, unknown>;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
      sourcemap: true,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualExtractedEntry(),
      bundledCss(`.${PREFIX}1{color:red}`),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const javascriptFile = files.find((file) => file.endsWith(".js"));
  const mapFile = files.find((file) => file.endsWith(".js.map"));
  const cssFile = files.find((file) => file.endsWith(".css"));

  if (!javascriptFile || !mapFile || !cssFile) {
    throw new Error("Expected Vite to emit JavaScript, CSS, and a source map");
  }

  return {
    css: await readFile(join(assetsDirectory, cssFile), "utf8"),
    javascript: await readFile(join(assetsDirectory, javascriptFile), "utf8"),
    sourceMap: JSON.parse(await readFile(join(assetsDirectory, mapFile), "utf8")),
  };
}

async function buildWithExtractedCssSourceMap(
  sourceMapSuffix = "",
): Promise<{
  css: string;
  sourceMap: Record<string, unknown>;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);
  const css = [
    ".lead{color:black}",
    `.${PREFIX}1{color:red}`,
    ".tail{color:blue}",
  ].join("");
  const map = new SourceMapGenerator({ file: "stylex.css" });
  const stylexOffset = css.indexOf(`.${PREFIX}1`);
  const tailOffset = css.indexOf(".tail");

  for (const column of [0, stylexOffset, tailOffset]) {
    map.addMapping({
      generated: { column, line: 1 },
      original: { column, line: 1 },
      source: "style.css",
    });
  }

  map.setSourceContent("style.css", css);

  await build({
    build: {
      cssMinify: false,
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
      sourcemap: true,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualExtractedEntry(),
      {
        name: "bundled-css-source-map",
        generateBundle() {
          this.emitFile({
            name: "stylex.css",
            source: `${css}\n/*# sourceMappingURL=stylex.css.map${sourceMapSuffix} */`,
            type: "asset",
          });
          this.emitFile({
            fileName: "assets/stylex.css.map",
            source: map.toString(),
            type: "asset",
          });
        },
      },
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const cssFile = files.find((file) => file.endsWith(".css"));
  const mapFile = files.find((file) => file.endsWith(".css.map"));

  if (!cssFile || !mapFile) {
    throw new Error("Expected Vite to emit CSS and its source map");
  }

  return {
    css: await readFile(join(assetsDirectory, cssFile), "utf8"),
    sourceMap: JSON.parse(await readFile(join(assetsDirectory, mapFile), "utf8")),
  };
}

async function buildWithCssReference(rule: string, sourcemap = false): Promise<{
  cssFileName: string;
  javascript: string;
  javascriptFileName: string;
  sourceMapFileName?: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);
  let cssReferenceId: string;

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      sourcemap,
      rollupOptions: {
        input: "virtual:entry",
        output: {
          entryFileNames: "assets/[name]-[hash].js",
          sourcemapFileNames: "assets/[name]-[hash].map",
        },
      },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "virtual-css-reference",
        buildStart() {
          cssReferenceId = this.emitFile({
            name: "stylex.css",
            source: ".base{display:block}",
            type: "asset",
          });
        },
        resolveId(id) {
          return id === "virtual:entry" ? "/virtual-entry.js" : null;
        },
        load(id) {
          return id === "/virtual-entry.js"
            ? [
                `globalThis.cssUrl = import.meta.ROLLUP_FILE_URL_${cssReferenceId};`,
                `globalThis.style = { color: "${PREFIX}1", $$css: true };`,
              ].join("\n")
            : null;
        },
        generateBundle(_outputOptions, bundle) {
          const output = bundle[this.getFileName(cssReferenceId)];

          if (output?.type !== "asset") {
            throw new Error("Expected the emitted CSS asset in generateBundle");
          }

          output.source = `${output.source}${rule}`;
        },
      },
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const cssFileName = files.find((file) => file.endsWith(".css"));
  const javascriptFileName = files.find((file) => file.endsWith(".js"));
  const sourceMapFileName = files.find((file) => file.endsWith(".map"));

  if (!cssFileName || !javascriptFileName) {
    throw new Error("Expected Vite to emit referenced CSS and JavaScript assets");
  }

  return {
    cssFileName,
    javascript: await readFile(join(assetsDirectory, javascriptFileName), "utf8"),
    javascriptFileName,
    sourceMapFileName,
  };
}

async function buildCssEmittedAfterMangler(): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualEntry(),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
      {
        name: "late-post-css",
        enforce: "post",
        generateBundle() {
          this.emitFile({ name: "late.css", source: ".late{color:red}", type: "asset" });
        },
      },
    ],
  });

  return readdir(join(outDir, "assets"));
}

async function buildWithAuthoredPreliminaryFileNameText(): Promise<{
  cssFileName: string;
  javascript: string;
  preliminaryCssFileName: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);
  let cssReferenceId: string;
  let preliminaryCssFileName = "";

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualExtractedEntry(),
      {
        name: "authored-preliminary-filename-text",
        buildStart() {
          cssReferenceId = this.emitFile({
            name: "stylex.css",
            source: `.${PREFIX}1{color:red}`,
            type: "asset",
          });
        },
        generateBundle(_outputOptions, bundle) {
          preliminaryCssFileName = this.getFileName(cssReferenceId);
          const javascript = Object.values(bundle).find(
            (output): output is Rollup.OutputChunk => output.type === "chunk",
          );

          if (javascript === undefined) {
            throw new Error("Expected a JavaScript chunk");
          }

          javascript.code += `\nglobalThis.copy = ${JSON.stringify(
            `application-copy: ${preliminaryCssFileName}`,
          )};`;
        },
      },
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const cssFileName = files.find((file) => file.endsWith(".css"));
  const javascriptFileName = files.find((file) => file.endsWith(".js"));

  if (!cssFileName || !javascriptFileName) {
    throw new Error("Expected JavaScript and CSS output");
  }

  return {
    cssFileName: `assets/${cssFileName}`,
    javascript: await readFile(join(assetsDirectory, javascriptFileName), "utf8"),
    preliminaryCssFileName,
  };
}

async function buildTreeShakenRuntimeRule(): Promise<{ css: string; javascript: string }> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "virtual-tree-shaken-rule",
        resolveId(id) {
          return id === "virtual:entry" ? "/virtual-entry.js" : null;
        },
        load(id) {
          return id === "/virtual-entry.js"
            ? [
                `if (false) inject({ ltr: ".${PREFIX}1{color:red}" });`,
                `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
                `globalThis.className = "${PREFIX}z";`,
              ].join("\n")
            : null;
        },
      },
      bundledCss(".base{color:black}"),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const cssFile = files.find((file) => file.endsWith(".css"));
  const javascriptFile = files.find((file) => file.endsWith(".js"));

  if (!cssFile || !javascriptFile) {
    throw new Error("Expected Vite to emit CSS and JavaScript assets");
  }

  return {
    css: await readFile(join(assetsDirectory, cssFile), "utf8"),
    javascript: await readFile(join(assetsDirectory, javascriptFile), "utf8"),
  };
}

async function buildExtractedWithoutCssAsset(ssr = false): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
      ssr,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualExtractedEntry(),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });
}

async function buildHashedCss(
  includeExtraEntry: boolean,
  output?: Rollup.OutputOptions,
  assetName?: string,
): Promise<{
  contents: string;
  fileName: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: {
        input: includeExtraEntry
          ? { extra: "virtual:extra", main: "virtual:main" }
          : { main: "virtual:main" },
        output,
      },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "virtual-hashed-css-entries",
        resolveId(id) {
          return id === "virtual:main" || id === "virtual:extra" ? `/${id}.js` : null;
        },
        load(id) {
          if (id === "/virtual:main.js") {
            return [
              `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
              `globalThis.mainClassName = "${PREFIX}z";`,
            ].join("\n");
          }

          return id === "/virtual:extra.js"
            ? `inject({ ltr: ".${PREFIX}1{color:red}" });`
            : null;
        },
      },
      bundledCss(`.${PREFIX}z{color:blue}`, assetName),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const fileName = (await readdir(assetsDirectory)).find((file) => file.endsWith(".css"));

  if (!fileName) {
    throw new Error("Expected Vite to emit a hashed CSS asset");
  }

  return {
    contents: await readFile(join(assetsDirectory, fileName), "utf8"),
    fileName,
  };
}

async function buildLateAppendedCss(rule: string): Promise<{
  contents: string;
  fileName: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualExtractedEntry(),
      bundledCssWithLateAppend(rule),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const fileName = (await readdir(assetsDirectory)).find((file) => file.endsWith(".css"));

  if (!fileName) {
    throw new Error("Expected Vite to emit a CSS asset");
  }

  return {
    contents: await readFile(join(assetsDirectory, fileName), "utf8"),
    fileName,
  };
}

async function buildWithPrefixClasses(): Promise<string> {
  const prefix = "a";
  const hashes = ["0", ..."123456789abcdefghijklmnopq".split("")];
  const originals = hashes.map((hash) => `${prefix}${hash}`);
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input: "virtual:entry" },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "virtual-prefix-entry",
        resolveId(id) {
          return id === "virtual:entry" ? "/virtual-prefix-entry.js" : null;
        },
        load(id) {
          if (id !== "/virtual-prefix-entry.js") {
            return null;
          }

          return [
            ...originals.map((className) =>
              `inject({ ltr: ".${className}{color:red}" });`,
            ),
            `globalThis.className = "${originals.join(" ")}";`,
          ].join("\n");
        },
      },
      stylexMangleClassNames({ classNamePrefix: prefix }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const javascriptFile = (await readdir(assetsDirectory)).find((file) => file.endsWith(".js"));

  if (!javascriptFile) {
    throw new Error("Expected Vite to emit a JavaScript asset");
  }

  return readFile(join(assetsDirectory, javascriptFile), "utf8");
}

async function buildHashedMain(includeExtraEntry: boolean): Promise<{
  contents: string;
  fileName: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: {
        input: includeExtraEntry
          ? { extra: "virtual:extra", main: "virtual:main" }
          : { main: "virtual:main" },
        output: { entryFileNames: "assets/[name]-[hash].js" },
      },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "virtual-hashed-entries",
        resolveId(id) {
          return id === "virtual:main" || id === "virtual:extra" ? `/${id}.js` : null;
        },
        load(id) {
          if (id === "/virtual:main.js") {
            return [
              `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
              `globalThis.mainClassName = "${PREFIX}z";`,
            ].join("\n");
          }

          return id === "/virtual:extra.js"
            ? [
                `inject({ ltr: ".${PREFIX}1{color:red}" });`,
                `globalThis.extraClassName = "${PREFIX}1";`,
              ].join("\n")
            : null;
        },
      },
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const fileName = (await readdir(assetsDirectory)).find(
    (file) => file.startsWith("main-") && file.endsWith(".js"),
  );

  if (!fileName) {
    throw new Error("Expected Vite to emit the main JavaScript entry");
  }

  return {
    contents: await readFile(join(assetsDirectory, fileName), "utf8"),
    fileName,
  };
}

async function buildAugmentedMain(augmentation: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: {
        input: "virtual:entry",
        output: { entryFileNames: "assets/[name]-[hash].js" },
      },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualEntry(),
      {
        name: "vary-chunk-hash-augmentation",
        augmentChunkHash() {
          return augmentation;
        },
      },
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const fileName = (await readdir(join(outDir, "assets"))).find((file) =>
    file.endsWith(".js"),
  );

  if (!fileName) {
    throw new Error("Expected Vite to emit a JavaScript asset");
  }

  return fileName;
}

async function buildReferencedAssets(rule: string): Promise<{
  binary: Uint8Array;
  manifest: string;
  manifestFileName: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);
  let cssReferenceId: string;

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: {
        input: "virtual:entry",
        output: { assetFileNames: "assets/[name]-[hash][extname]" },
      },
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualExtractedEntry(),
      {
        name: "referenced-text-and-binary-assets",
        buildStart() {
          cssReferenceId = this.emitFile({
            name: "stylex.css",
            source: ".base{display:block}",
            type: "asset",
          });
        },
        generateBundle(_outputOptions, bundle) {
          const cssFileName = this.getFileName(cssReferenceId);
          const css = bundle[cssFileName];

          if (css?.type !== "asset") {
            throw new Error("Expected the emitted CSS asset");
          }

          css.source = `${css.source}${rule}`;
          this.emitFile({
            name: "precache.json",
            source: JSON.stringify({ css: cssFileName }),
            type: "asset",
          });
          this.emitFile({
            name: "archive.bin",
            source: new Uint8Array([
              0xff,
              ...Buffer.from(cssFileName),
              0x80,
            ]),
            type: "asset",
          });
        },
      },
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const manifestFileName = files.find((file) => file.endsWith(".json"));
  const binaryFileName = files.find((file) => file.endsWith(".bin"));

  if (!manifestFileName || !binaryFileName) {
    throw new Error("Expected manifest and binary assets");
  }

  return {
    binary: await readFile(join(assetsDirectory, binaryFileName)),
    manifest: await readFile(join(assetsDirectory, manifestFileName), "utf8"),
    manifestFileName,
  };
}

describe("production output", () => {
  function lastLineLength(lines: readonly string[]): number {
    const line = lines.at(-1);

    if (line === undefined) {
      throw new Error("Expected at least one generated source line");
    }

    return line.length;
  }

  test("does not remangle short names during output writing", async () => {
    const javascript = await buildWithPrefixClasses();
    const expected = [
      ..."abcdefghijklmnopqrstuvwxyz".split(""),
      "aa",
    ].join(" ");

    expect(javascript).toContain(`globalThis.className = "${expected}";`);
  });

  test("includes cross-chunk mapping changes in hashed JavaScript filenames", async () => {
    const withoutExtra = await buildHashedMain(false);
    const withExtra = await buildHashedMain(true);

    expect(withoutExtra.contents).toContain('globalThis.mainClassName = "a";');
    expect(withExtra.contents).toContain('globalThis.mainClassName = "b";');
    expect(withExtra.fileName).not.toBe(withoutExtra.fileName);
  });

  test("preserves other plugins' augmentChunkHash invalidation", async () => {
    const first = await buildAugmentedMain("first");
    const second = await buildAugmentedMain("second");

    expect(second).not.toBe(first);
  });

  test("includes cross-entry mapping changes in hashed CSS filenames", async () => {
    const withoutExtra = await buildHashedCss(false);
    const withExtra = await buildHashedCss(true);

    expect(withoutExtra.contents).toBe(".a{color:blue}");
    expect(withExtra.contents).toBe(".b{color:blue}");
    expect(withExtra.fileName).not.toBe(withoutExtra.fileName);
  });

  test("hashes CSS after extracted StyleX rules are appended", async () => {
    const red = await buildLateAppendedCss(`.${PREFIX}1{color:red}`);
    const blue = await buildLateAppendedCss(`.${PREFIX}1{color:blue}`);

    expect(red.contents).toBe(".base{display:block}.a{color:red}");
    expect(blue.contents).toBe(".base{display:block}.a{color:blue}");
    expect(blue.fileName).not.toBe(red.fileName);
  });

  test("rehashes JavaScript after finalizing a referenced CSS filename", async () => {
    const red = await buildWithCssReference(`.${PREFIX}1{color:red}`);
    const blue = await buildWithCssReference(`.${PREFIX}1{color:blue}`);

    expect(red.cssFileName).not.toBe(blue.cssFileName);
    expect(red.javascript).not.toBe(blue.javascript);
    expect(red.javascriptFileName).not.toBe(blue.javascriptFileName);
  });

  test("rehashes source-map assets after finalizing referenced output filenames", async () => {
    const red = await buildWithCssReference(`.${PREFIX}1{color:red}`, true);
    const blue = await buildWithCssReference(`.${PREFIX}1{color:blue}`, true);

    expect(red.sourceMapFileName).toBeDefined();
    expect(blue.sourceMapFileName).not.toBe(red.sourceMapFileName);
  });

  test("rehashes text assets after finalizing referenced output filenames", async () => {
    const red = await buildReferencedAssets(`.${PREFIX}1{color:red}`);
    const blue = await buildReferencedAssets(`.${PREFIX}1{color:blue}`);

    expect(red.manifest).not.toBe(blue.manifest);
    expect(red.manifestFileName).not.toBe(blue.manifestFileName);
  });

  test("does not decode binary assets while finalizing output filenames", async () => {
    const output = await buildReferencedAssets(`.${PREFIX}1{color:red}`);

    expect(output.binary[0]).toBe(0xff);
    expect(output.binary.at(-1)).toBe(0x80);
  });

  test("preserves authored text that resembles an internal hash marker", async () => {
    const marker = "_S0_____";
    const output = await buildWithCss(`.${PREFIX}1{color:red};root{--label:"${marker}"}`);

    expect(output.css).toContain(`--label:"${marker}"`);
  });

  test("leaves CSS emitted after the mangler with a real content hash", async () => {
    const files = await buildCssEmittedAfterMangler();
    const cssFile = files.find((file) => file.endsWith(".css"));

    expect(cssFile).toBeDefined();
    expect(cssFile).not.toContain("_S");
  });

  test("preserves authored text containing a preliminary output filename", async () => {
    const output = await buildWithAuthoredPreliminaryFileNameText();

    expect(output.preliminaryCssFileName).toContain("__STYLEX_HASH_");
    expect(output.cssFileName).not.toBe(output.preliminaryCssFileName);
    expect(output.javascript).toContain(
      `application-copy: ${output.preliminaryCssFileName}`,
    );
    expect(output.javascript).not.toContain(`application-copy: ${output.cssFileName}`);
  });

  test("does not reserve class names from tree-shaken runtime rules", async () => {
    const output = await buildTreeShakenRuntimeRule();

    expect(output.css).toBe(".base{color:black}");
    expect(output.javascript).toContain('globalThis.className = "a";');
  });

  test("hashes CSS identified by a function-based asset filename pattern", async () => {
    const output: Rollup.OutputOptions = {
      assetFileNames: () => "assets/[name]-[hash].css",
    };
    const withoutExtra = await buildHashedCss(false, output, "stylex");
    const withExtra = await buildHashedCss(true, output, "stylex");

    expect(withoutExtra.contents).toBe(".a{color:blue}");
    expect(withExtra.contents).toBe(".b{color:blue}");
    expect(withExtra.fileName).not.toBe(withoutExtra.fileName);
  });

  test.each([
    { alphabet: /^[0-9a-f]+$/, hashCharacters: "hex" as const },
    { alphabet: /^[0-9a-z]+$/, hashCharacters: "base36" as const },
  ])(
    "uses the configured $hashCharacters alphabet for rewritten CSS hashes",
    async ({ alphabet, hashCharacters }) => {
      const output = await buildHashedCss(false, {
        assetFileNames: "assets/[name]-[hash:12][extname]",
        hashCharacters,
      });
      const hash = output.fileName.match(/-([^.]+)\.css$/)?.[1];

      expect(hash).toMatch(alphabet);
    },
  );

  test("rewrites StyleX CSS emitted in the output bundle", async () => {
    const output = await buildWithCss(`.${PREFIX}1{color:red}`);

    expect(output.javascript).toContain('globalThis.className = "a";');
    expect(output.css).toBe(".a{color:red}");
  });

  test("fails before rewriting bundled CSS that collides with an authored class", async () => {
    await expect(buildWithCss(`.${PREFIX}1{color:red}.a{color:blue}`)).rejects.toThrow(
      'generated class ".a" would collide with authored CSS',
    );
  });

  test.each([
    { mode: true as const, hasComment: true, hasExternalMap: true },
    { mode: "hidden" as const, hasComment: false, hasExternalMap: true },
    { mode: "inline" as const, hasComment: true, hasExternalMap: false },
  ])(
    "preserves $mode production source maps",
    async ({ mode, hasComment, hasExternalMap }) => {
      const output = await buildWithSourceMap(mode);

      expect(output.javascript).toContain('globalThis.className = "a";');
      expect(output.javascript.includes("sourceMappingURL=")).toBe(hasComment);
      expect(output.files.some((file) => file.endsWith(".js.map"))).toBe(hasExternalMap);
      expect(output.sourceMap.mappings).not.toBe("");
      expect(output.sourceMap.sourcesContent).toContain(
        [
          `inject({ ltr: ".${PREFIX}1{color:red}" });`,
          `globalThis.className = "${PREFIX}1";`,
          `globalThis.values = ["${PREFIX}1", globalThis.afterValue];`,
        ].join("\n"),
      );

      const generatedIndex = output.javascript.indexOf("globalThis.afterValue");
      const generatedPrefix = output.javascript.slice(0, generatedIndex).split("\n");
      const originalPosition = new SourceMapConsumer(output.sourceMap as unknown as RawSourceMap)
        .originalPositionFor({
          column: lastLineLength(generatedPrefix),
          line: generatedPrefix.length,
        });

      expect(originalPosition).toMatchObject({
        column: 28,
        line: 3,
      });
      expect(originalPosition.source).toContain("virtual-entry.js");
    },
  );

  test("updates only the trailing inline source-map directive", async () => {
    const output = await buildWithSourceMap("inline", true);

    expect(output.javascript).toContain(
      'globalThis.fakeMap = "sourceMappingURL=data:application/json;charset=utf-8;base64,e30=";',
    );

    const generatedIndex = output.javascript.indexOf("globalThis.afterValue");
    const generatedPrefix = output.javascript.slice(0, generatedIndex).split("\n");
    const originalPosition = new SourceMapConsumer(output.sourceMap as unknown as RawSourceMap)
      .originalPositionFor({
        column: lastLineLength(generatedPrefix),
        line: generatedPrefix.length,
      });

    expect(originalPosition).toMatchObject({ column: 28, line: 4 });
  });

  test("preserves missing source content in composed maps", async () => {
    const output = await buildWithSourceMap("hidden", false, true);

    expect(output.sourceMap.sourcesContent).not.toContain("");
  });

  test("rewrites extracted JavaScript, CSS, and its source map", async () => {
    const output = await buildWithExtractedCss();

    expect(output.css).toBe(".a{color:red}");
    expect(output.javascript).toContain('globalThis.className = "a";');
    expect(output.javascript).toContain('["a", globalThis.afterValue]');

    const generatedIndex = output.javascript.indexOf("globalThis.afterValue");
    const generatedPrefix = output.javascript.slice(0, generatedIndex).split("\n");
    const originalPosition = new SourceMapConsumer(output.sourceMap as unknown as RawSourceMap)
      .originalPositionFor({
        column: lastLineLength(generatedPrefix),
        line: generatedPrefix.length,
      });

    expect(originalPosition).toMatchObject({ column: 28, line: 2 });
    expect(originalPosition.source).toContain("virtual-entry.js");
  });

  test("updates extracted CSS source maps after shortening selectors", async () => {
    const output = await buildWithExtractedCssSourceMap();
    const generatedIndex = output.css.indexOf(".tail");
    const generatedPrefix = output.css.slice(0, generatedIndex).split("\n");
    const originalPosition = new SourceMapConsumer(
      output.sourceMap as unknown as RawSourceMap,
    ).originalPositionFor({
      column: lastLineLength(generatedPrefix),
      line: generatedPrefix.length,
    });

    expect(output.css).toContain(".a{color:red}");
    expect(originalPosition).toMatchObject({ column: 33, line: 1 });
    expect(originalPosition.source).toContain("style.css");
  });

  test.each(["?v=42", "#styles"])(
    "locates extracted CSS source maps with a %s URL suffix",
    async (suffix) => {
      const output = await buildWithExtractedCssSourceMap(suffix);
      const generatedIndex = output.css.indexOf(".tail");
      const generatedPrefix = output.css.slice(0, generatedIndex).split("\n");
      const originalPosition = new SourceMapConsumer(
        output.sourceMap as unknown as RawSourceMap,
      ).originalPositionFor({
        column: lastLineLength(generatedPrefix),
        line: generatedPrefix.length,
      });

      expect(originalPosition).toMatchObject({ column: 33, line: 1 });
    },
  );

  test("rejects extracted output without a bundled CSS asset", async () => {
    await expect(buildExtractedWithoutCssAsset()).rejects.toThrow(
      "extracted StyleX output requires a bundled CSS asset",
    );
  });

  test("allows extracted output without a bundled CSS asset in SSR builds", async () => {
    await expect(buildExtractedWithoutCssAsset(true)).resolves.toBeUndefined();
  });
});

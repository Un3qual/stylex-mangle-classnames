import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map-js";
import { afterEach, describe, expect, test } from "vitest";
import { build, type Plugin } from "vite";
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

function bundledCss(source: string): Plugin {
  return {
    name: "bundled-stylex-css",
    generateBundle() {
      this.emitFile({ name: "stylex.css", source, type: "asset" });
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

describe("production output", () => {
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
          column: generatedPrefix.at(-1)!.length,
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
        column: generatedPrefix.at(-1)!.length,
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
        column: generatedPrefix.at(-1)!.length,
        line: generatedPrefix.length,
      });

    expect(originalPosition).toMatchObject({ column: 28, line: 2 });
    expect(originalPosition.source).toContain("virtual-entry.js");
  });
});

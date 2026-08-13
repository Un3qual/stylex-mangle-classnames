import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

function virtualEntry(): Plugin {
  return {
    name: "virtual-entry",
    resolveId(id) {
      return id === "virtual:entry" ? "/virtual-entry.js" : null;
    },
    load(id) {
      return id === "/virtual-entry.js"
        ? [
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
          ].join("\n")
        : null;
    },
  };
}

function lateCss(source: string): Plugin {
  return {
    name: "late-stylex-css",
    async writeBundle(options) {
      if (!options.dir) {
        throw new Error("Expected Vite to configure an output directory");
      }

      const assetsDirectory = join(options.dir, "assets");
      await mkdir(assetsDirectory, { recursive: true });
      await writeFile(join(assetsDirectory, "stylex.css"), source, "utf8");
    },
  };
}

async function buildWithLateCss(css: string): Promise<{ css: string; javascript: string }> {
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
      lateCss(css),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const javascriptFile = (await readdir(assetsDirectory)).find((file) => file.endsWith(".js"));

  if (!javascriptFile) {
    throw new Error("Expected Vite to emit a JavaScript asset");
  }

  return {
    css: await readFile(join(assetsDirectory, "stylex.css"), "utf8"),
    javascript: await readFile(join(assetsDirectory, javascriptFile), "utf8"),
  };
}

async function buildWithSourceMap(sourcemap: SourceMapMode): Promise<{
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
    plugins: [virtualEntry(), stylexMangleClassNames({ classNamePrefix: PREFIX })],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const javascriptFile = files.find((file) => file.endsWith(".js"));

  if (!javascriptFile) {
    throw new Error("Expected Vite to emit a JavaScript asset");
  }

  const javascript = await readFile(join(assetsDirectory, javascriptFile), "utf8");
  const inlineMap = javascript.match(
    /sourceMappingURL=data:application\/json;charset=utf-8;base64,([^\n]+)/,
  )?.[1];
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

async function buildWithLateExtractedCss(): Promise<{
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
      lateCss(`.${PREFIX}1{color:red}`),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = await readdir(assetsDirectory);
  const javascriptFile = files.find((file) => file.endsWith(".js"));
  const mapFile = files.find((file) => file.endsWith(".js.map"));

  if (!javascriptFile || !mapFile) {
    throw new Error("Expected Vite to emit JavaScript and its source map");
  }

  return {
    css: await readFile(join(assetsDirectory, "stylex.css"), "utf8"),
    javascript: await readFile(join(assetsDirectory, javascriptFile), "utf8"),
    sourceMap: JSON.parse(await readFile(join(assetsDirectory, mapFile), "utf8")),
  };
}

describe("production output", () => {
  test("rewrites StyleX CSS emitted by an earlier writeBundle hook", async () => {
    const output = await buildWithLateCss(`.${PREFIX}1{color:red}`);

    expect(output.javascript).toContain('globalThis.className = "a";');
    expect(output.css).toBe(".a{color:red}");
  });

  test("fails before rewriting late CSS that collides with an authored class", async () => {
    await expect(buildWithLateCss(`.${PREFIX}1{color:red}.a{color:blue}`)).rejects.toThrow(
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

  test("rewrites JavaScript and its source map when StyleX CSS is emitted late", async () => {
    const output = await buildWithLateExtractedCss();

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

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map-js";
import { afterEach, describe, expect, test } from "vitest";
import { build, type Plugin } from "vite";
import stylexMangleClassNames from "../src/index.js";

const PREFIX = "sx";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

function virtualModules(modules: ReadonlyMap<string, string>): Plugin {
  const resolved = new Map(
    [...modules].map(([id, source]) => [
      `/${id.replace(/[^A-Za-z0-9_-]/g, "-")}.js`,
      source,
    ]),
  );

  return {
    name: "virtual-modules",
    resolveId(id) {
      return modules.has(id)
        ? `/${id.replace(/[^A-Za-z0-9_-]/g, "-")}.js`
        : null;
    },
    load(id) {
      return resolved.get(id) ?? null;
    },
  };
}

async function buildModules(
  modules: ReadonlyMap<string, string>,
  input: string | Record<string, string>,
  sourcemap: boolean | "hidden" | "inline" = false,
): Promise<{ files: Map<string, string>; outDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "stylex-mangle-classnames-"));
  const outDir = join(root, "dist");
  temporaryDirectories.push(root);

  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: { input },
      sourcemap,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      virtualModules(modules),
      stylexMangleClassNames({ classNamePrefix: PREFIX }),
    ],
  });

  const assetsDirectory = join(outDir, "assets");
  const files = new Map<string, string>();

  for (const fileName of await readdir(assetsDirectory)) {
    files.set(fileName, await readFile(join(assetsDirectory, fileName), "utf8"));
  }

  return { files, outDir };
}

function generatedPosition(source: string, token: string): {
  column: number;
  line: number;
} {
  const offset = source.indexOf(token);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    column: lines.at(-1)?.length ?? 0,
    line: lines.length,
  };
}

describe("production output", () => {
  test.each([true, "hidden", "inline"] as const)(
    "preserves original positions with the %s source-map mode",
    async (sourcemap) => {
      const original = [
        `inject({ ltr: ".${PREFIX}1{color:red}" });`,
        `globalThis.className = "${PREFIX}1"; globalThis.marker = 123;`,
      ].join("\n");
      const { files } = await buildModules(
        new Map([["virtual:entry", original]]),
        "virtual:entry",
        sourcemap,
      );
      const [javascriptName, javascript] =
        [...files].find(([fileName]) => fileName.endsWith(".js")) ?? [];

      expect(javascriptName).toBeDefined();
      expect(javascript).toContain('globalThis.className = "a";');
      expect(javascript).toContain("globalThis.marker = 123;");

      const inlineMap = javascript?.match(
        /sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/,
      )?.[1];
      const externalMapName =
        sourcemap === "hidden"
          ? [...files.keys()].find((fileName) => fileName.endsWith(".js.map"))
          : javascript?.match(/sourceMappingURL=([^\s]+)/)?.[1];
      const serializedMap =
        sourcemap === "inline"
          ? Buffer.from(inlineMap ?? "", "base64").toString("utf8")
          : files.get(externalMapName ?? "");

      expect(serializedMap).toBeDefined();
      expect(javascript?.includes("sourceMappingURL=")).toBe(sourcemap !== "hidden");

      const consumer = new SourceMapConsumer(
        JSON.parse(serializedMap ?? "") as RawSourceMap,
      );
      const position = consumer.originalPositionFor(
        generatedPosition(javascript ?? "", "globalThis.marker"),
      );
      const markerLine = original.split("\n").at(1) ?? "";

      expect(position).toMatchObject({
        column: markerLine.indexOf("globalThis.marker"),
        line: 2,
      });
      expect(position.source).toContain("virtual-entry.js");
    },
  );

  test("includes the bundle-wide mapping in entry hashes", async () => {
    const main = [
      `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
      `globalThis.className = "${PREFIX}z";`,
    ].join("\n");
    const onlyMain = await buildModules(
      new Map([["virtual:main", main]]),
      { main: "virtual:main" },
    );
    const withIndependentEntry = await buildModules(
      new Map([
        ["virtual:main", main],
        ["virtual:other", `inject({ ltr: ".${PREFIX}1{color:red}" });`],
      ]),
      { main: "virtual:main", other: "virtual:other" },
    );
    const firstMain = [...onlyMain.files.keys()].find(
      (fileName) => fileName.startsWith("main-") && fileName.endsWith(".js"),
    );
    const secondMain = [...withIndependentEntry.files.keys()].find(
      (fileName) => fileName.startsWith("main-") && fileName.endsWith(".js"),
    );

    expect(firstMain).toBeDefined();
    expect(secondMain).toBeDefined();
    expect(firstMain).not.toBe(secondMain);
    expect(onlyMain.files.get(firstMain ?? "")).toContain(
      'globalThis.className = "a";',
    );
    expect(withIndependentEntry.files.get(secondMain ?? "")).toContain(
      'globalThis.className = "b";',
    );
  });
});

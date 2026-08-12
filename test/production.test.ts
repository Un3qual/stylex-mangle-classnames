import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function virtualEntry(): Plugin {
  return {
    name: "virtual-entry",
    resolveId(id) {
      return id === "virtual:entry" ? "/virtual-entry.js" : null;
    },
    load(id) {
      return id === "/virtual-entry.js"
        ? `globalThis.className = "${PREFIX}1";`
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
});

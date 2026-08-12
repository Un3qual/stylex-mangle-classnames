import { describe, expect, test } from "vitest";
import type { Plugin, ResolvedConfig, Rollup } from "vite";
import stylexMangleClassNames from "../src/index.js";

const PREFIX = "sx";

function outputChunk(code: string): Rollup.OutputChunk {
  return {
    code,
    fileName: "entry.js",
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

function runGenerateBundle(plugin: Plugin, bundle: Rollup.OutputBundle): void {
  const hook = plugin.generateBundle;

  if (!hook) {
    throw new Error("Expected the plugin to define generateBundle");
  }

  const handler = typeof hook === "function" ? hook : hook.handler;

  handler.call(
    {
      error(error: Rollup.RollupError | string): never {
        throw new Error(typeof error === "string" ? error : error.message);
      },
    } as Rollup.PluginContext,
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

async function runTransform(plugin: Plugin, code: string) {
  const hook = plugin.transform;

  if (!hook) {
    throw new Error("Expected the plugin to define transform");
  }

  const handler = typeof hook === "function" ? hook : hook.handler;
  return handler.call({} as never, code, "/virtual-entry.js", { moduleType: "js" });
}

describe("stylexMangleClassNames", () => {
  test("maps generated classes to a through z, then aa and ab", () => {
    const originals = "123456789abcdefghijklmnopqrs"
      .split("")
      .map((hash) => `${PREFIX}${hash}`)
      .join(" ");

    expect(rewriteBundle(`globalThis.classes = "${originals}";`)).toBe(
      'globalThis.classes = "a b c d e f g h i j k l m n o p q r s t u v w x y z aa ab";',
    );
  });

  test("assigns one deterministic mapping across every emitted text file", () => {
    const first = outputChunk(`globalThis.first = "${PREFIX}z ${PREFIX}1";`);
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

    expect(first.code).toBe('globalThis.first = "b a";');
    expect(second.source).toBe(".a{color:red}.b:hover{color:blue}");
    expect(third.source).toBe('<main class="b a"></main>');
  });

  test("preserves StyleX constants, custom properties, keyframes, and unrelated classes", () => {
    const atomic = `${PREFIX}1dmbf1k`;
    const spacedConstKey = `register({ constKey${" ".repeat(40)}:${" ".repeat(40)}"${atomic}" });`;
    const source = [
      `globalThis.className = "${atomic} product-card";`,
      `register({ constKey: "${atomic}", constVal: "red" });`,
      spacedConstKey,
      `globalThis.variable = "--${atomic}";`,
      `globalThis.keyframes = "${atomic}-B";`,
    ].join("\n");

    expect(rewriteBundle(source)).toBe(
      [
        'globalThis.className = "a product-card";',
        `register({ constKey: "${atomic}", constVal: "red" });`,
        spacedConstKey,
        `globalThis.variable = "--${atomic}";`,
        `globalThis.keyframes = "${atomic}-B";`,
      ].join("\n"),
    );
  });

  test("fails when a generated short name collides with authored CSS", () => {
    const css = outputAsset("styles.css", `.${PREFIX}1{color:red}.a{color:blue}`);

    expect(() =>
      runGenerateBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
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

    await expect(runTransform(plugin, `globalThis.className = "${PREFIX}1";`)).resolves.toEqual({
      code: 'globalThis.className = "a";',
      map: null,
    });
  });

  test("does not rewrite individual transforms during production builds", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "build");

    await expect(runTransform(plugin, `globalThis.className = "${PREFIX}1";`)).resolves.toBeNull();
  });

  test("fails closed when production source maps would become stale", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });

    await expect(runConfigResolved(plugin, "build", true)).rejects.toThrow(
      "production source maps are not supported",
    );
  });
});

import { describe, expect, test } from "vitest";
import type { Plugin, ResolvedConfig, Rollup } from "vite";
import stylexMangleClassNames from "../src/index.js";

const PREFIX = "sx";

function outputChunk(code: string, fileName = "entry.js"): Rollup.OutputChunk {
  return {
    code,
    fileName,
    moduleIds: [fileName],
    modules: {},
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

function pluginContext(): Rollup.PluginContext {
  return {
    error(error: Rollup.RollupError | string): never {
      throw new Error(typeof error === "string" ? error : error.message);
    },
  } as Rollup.PluginContext;
}

function runProductionBundle(
  plugin: Plugin,
  bundle: Rollup.OutputBundle,
  moduleSources?: readonly string[],
): void {
  const context = pluginContext();

  if (plugin.buildStart) {
    const handler =
      typeof plugin.buildStart === "function"
        ? plugin.buildStart
        : plugin.buildStart.handler;
    handler.call(context, {} as Rollup.NormalizedInputOptions);
  }

  if (!plugin.moduleParsed) {
    throw new Error("Expected the plugin to define moduleParsed");
  }

  const moduleParsed =
    typeof plugin.moduleParsed === "function"
      ? plugin.moduleParsed
      : plugin.moduleParsed.handler;

  const sources =
    moduleSources ??
    Object.values(bundle)
      .filter((output) => output.type === "chunk")
      .map((output) => output.code);

  for (const [index, code] of sources.entries()) {
    moduleParsed.call(context, {
      code,
      id: `module-${index}.js`,
    } as Rollup.ModuleInfo);
  }

  if (plugin.renderStart) {
    const handler =
      typeof plugin.renderStart === "function"
        ? plugin.renderStart
        : plugin.renderStart.handler;
    handler.call(
      context,
      {} as Rollup.NormalizedOutputOptions,
      {} as Rollup.NormalizedInputOptions,
    );
  }

  if (!plugin.renderChunk) {
    throw new Error("Expected the plugin to define renderChunk");
  }

  const renderChunk =
    typeof plugin.renderChunk === "function"
      ? plugin.renderChunk
      : plugin.renderChunk.handler;

  for (const output of Object.values(bundle)) {
    if (output.type !== "chunk") {
      continue;
    }

    const result = renderChunk.call(
      context,
      output.code,
      output,
      {} as Rollup.NormalizedOutputOptions,
      {} as never,
    );

    if (result instanceof Promise) {
      throw new Error("Expected synchronous renderChunk output");
    }

    if (typeof result === "string") {
      output.code = result;
    } else if (
      result !== null &&
      typeof result === "object" &&
      "code" in result
    ) {
      output.code = String(result.code);
    }
  }

  const generateBundle = plugin.generateBundle;

  if (generateBundle) {
    const handler =
      typeof generateBundle === "function"
        ? generateBundle
        : generateBundle.handler;
    handler.call(
      context,
      {} as Rollup.NormalizedOutputOptions,
      bundle,
      false,
    );
  }
}

function rewriteProduction(code: string): string {
  const chunk = outputChunk(code);
  runProductionBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
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
  await handler.call({} as never, {
    build: { sourcemap },
    command,
  } as ResolvedConfig);
}

async function runTransform(
  plugin: Plugin,
  code: string,
  id = "/virtual-entry.js",
) {
  const hook = plugin.transform;

  if (!hook) {
    throw new Error("Expected the plugin to define transform");
  }

  const handler = typeof hook === "function" ? hook : hook.handler;
  return handler.call({} as never, code, id, {
    moduleType: "js",
  });
}

describe("stylexMangleClassNames", () => {
  test("maps generated classes to a through z, then aa and ab", () => {
    const originals = "123456789abcdefghijklmnopqrs"
      .split("")
      .map((hash) => `${PREFIX}${hash}`);
    const source = [
      ...originals.map(
        (className) => `inject({ ltr: ".${className}{color:red}" });`,
      ),
      `globalThis.classes = "${originals.join(" ")}";`,
    ].join("\n");
    const lastLine = rewriteProduction(source).split("\n").at(-1);

    expect(lastLine).toBe(
      'globalThis.classes = "a b c d e f g h i j k l m n o p q r s t u v w x y z aa ab";',
    );
  });

  test("assigns one deterministic mapping across production chunks", () => {
    const first = outputChunk(
      [
        `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
        `globalThis.first = "${PREFIX}z ${PREFIX}1";`,
      ].join("\n"),
      "first.js",
    );
    const second = outputChunk(
      [
        `inject({ ltr: ".${PREFIX}1{color:red}" });`,
        `globalThis.second = "${PREFIX}1 ${PREFIX}z";`,
      ].join("\n"),
      "second.js",
    );

    runProductionBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
      [first.fileName]: first,
      [second.fileName]: second,
    });

    expect(first.code.split("\n").at(-1)).toBe('globalThis.first = "b a";');
    expect(second.code.split("\n").at(-1)).toBe('globalThis.second = "a b";');
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

    expect(rewriteProduction(source)).toBe(
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

  test("preserves prefix-shaped application data without a generated rule", () => {
    const source = [
      `inject({ ltr: ".${PREFIX}1{color:red}" });`,
      `globalThis.className = "${PREFIX}1";`,
      `globalThis.productId = "${PREFIX}123";`,
    ].join("\n");

    expect(rewriteProduction(source)).toContain(
      `globalThis.productId = "${PREFIX}123";`,
    );
  });

  test("does not rewrite emitted CSS or HTML assets", () => {
    const javascript = outputChunk(
      `inject({ ltr: ".${PREFIX}1{color:red}" });`,
    );
    const css = outputAsset("styles.css", `.${PREFIX}1{color:red}`);
    const html = outputAsset(
      "index.html",
      `<main class="${PREFIX}1"></main>`,
    );

    runProductionBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
      [css.fileName]: css,
      [html.fileName]: html,
      [javascript.fileName]: javascript,
    });

    expect(css.source).toBe(`.${PREFIX}1{color:red}`);
    expect(html.source).toBe(`<main class="${PREFIX}1"></main>`);
  });

  test("fails when a generated short name collides with an authored selector", () => {
    const javascript = outputChunk(
      `inject({ ltr: ".${PREFIX}1{color:red}" });`,
    );
    const css = outputAsset(
      "styles.css",
      `.${PREFIX}1{color:red}.a{color:blue}`,
    );

    expect(() =>
      runProductionBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
        [css.fileName]: css,
        [javascript.fileName]: javascript,
      }),
    ).toThrow('generated class ".a" would collide with authored CSS');
  });

  test("ignores short names reserved only by tree-shaken modules", () => {
    const javascript = outputChunk("globalThis.loaded = true;");
    const css = outputAsset("styles.css", ".a{color:blue}");

    expect(() =>
      runProductionBundle(
        stylexMangleClassNames({ classNamePrefix: PREFIX }),
        {
          [css.fileName]: css,
          [javascript.fileName]: javascript,
        },
        [`inject({ ltr: ".${PREFIX}1{color:red}" });`],
      ),
    ).not.toThrow();
  });

  test("ignores class-like text outside CSS selectors", () => {
    const javascript = outputChunk(
      `inject({ ltr: ".${PREFIX}1{color:red}" });`,
    );
    const css = outputAsset(
      "styles.css",
      '.theme{content:".a";--example:.a}/* .a */',
    );

    expect(() =>
      runProductionBundle(stylexMangleClassNames({ classNamePrefix: PREFIX }), {
        [css.fileName]: css,
        [javascript.fileName]: javascript,
      }),
    ).not.toThrow();
  });

  test.each(["", "1sx", "sx-"])(
    "rejects the invalid StyleX prefix %j",
    (classNamePrefix) => {
      expect(() => stylexMangleClassNames({ classNamePrefix })).toThrow(
        "classNamePrefix must start with a letter and contain only ASCII letters and numbers",
      );
    },
  );

  test("rewrites generated class names during Vite development transforms", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "serve");
    const source = [
      `inject({ ltr: ".${PREFIX}1{color:red}" });`,
      `globalThis.className = "${PREFIX}1";`,
    ].join("\n");

    await expect(runTransform(plugin, source)).resolves.toEqual({
      code: [
        'inject({ ltr: ".a{color:red}" });',
        'globalThis.className = "a";',
      ].join("\n"),
      map: null,
    });
  });

  test("rewrites Vite JavaScript proxies for inline HTML modules", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "serve");
    const source = [
      `inject({ ltr: ".${PREFIX}1{color:red}" });`,
      `globalThis.className = "${PREFIX}1";`,
    ].join("\n");

    await expect(
      runTransform(plugin, source, "/index.html?html-proxy&index=0.js"),
    ).resolves.toEqual({
      code: [
        'inject({ ltr: ".a{color:red}" });',
        'globalThis.className = "a";',
      ].join("\n"),
      map: null,
    });
  });

  test("does not rewrite individual transforms during production builds", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await runConfigResolved(plugin, "build");

    await expect(
      runTransform(plugin, `globalThis.className = "${PREFIX}1";`),
    ).resolves.toBeNull();
  });

  test("accepts production source maps", async () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    await expect(runConfigResolved(plugin, "build", true)).resolves.toBeUndefined();
  });
});

import { describe, expect, test } from "vitest";
import { parseAst, type Plugin, type ResolvedConfig, type Rollup } from "vite";
import { findStylexClassNamesInSelectors } from "../src/class-names.js";
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

    expect(fileName).toMatch(/^assets\/\[name\]-.{8}\[extname\]$/);
    expect(fileName).not.toContain("[hash]");
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

  test("preserves cached module discovery across watch rebuilds", () => {
    const plugin = stylexMangleClassNames({ classNamePrefix: PREFIX });
    const moduleIds = ["/cached-runtime.js", "/changed-extracted.js"];
    const context = {
      getModuleIds: () => moduleIds.values(),
      parse: parseAst,
    } as unknown as Rollup.PluginContext;
    const buildStart = plugin.buildStart;
    const moduleParsed = plugin.moduleParsed;
    const renderStart = plugin.renderStart;
    const renderChunk = plugin.renderChunk;

    if (!buildStart || !moduleParsed || !renderStart || !renderChunk) {
      throw new Error("Expected build discovery and rendering hooks");
    }

    const buildStartHandler = typeof buildStart === "function" ? buildStart : buildStart.handler;
    const moduleParsedHandler =
      typeof moduleParsed === "function" ? moduleParsed : moduleParsed.handler;
    const sources = [
      `inject({ ltr: ".${PREFIX}z{color:blue}" });`,
      `globalThis.style = { color: "${PREFIX}1", $$css: true };`,
    ];

    const renderStartHandler =
      typeof renderStart === "function" ? renderStart : renderStart.handler;
    const renderChunkHandler =
      typeof renderChunk === "function" ? renderChunk : renderChunk.handler;

    for (let buildNumber = 0; buildNumber < 2; buildNumber += 1) {
      buildStartHandler.call(context, {} as Rollup.NormalizedInputOptions);

      const parsedModuleIndexes = buildNumber === 0 ? [0, 1] : [1];

      for (const index of parsedModuleIndexes) {
        moduleParsedHandler.call(context, {
          code: sources[index],
          id: moduleIds[index],
        } as Rollup.ModuleInfo);
      }

      renderStartHandler.call(
        context,
        {} as Rollup.NormalizedOutputOptions,
        {} as Rollup.NormalizedInputOptions,
      );

      const chunk = outputChunk(`globalThis.className = "${PREFIX}z ${PREFIX}1";`);
      const result = renderChunkHandler.call(
        context,
        chunk.code,
        chunk,
        {} as Rollup.NormalizedOutputOptions,
        {} as never,
      ) as { code: string } | null;

      expect(result?.code).toBe('globalThis.className = "b a";');
    }
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

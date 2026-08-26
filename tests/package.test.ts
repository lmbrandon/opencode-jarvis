import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type PackageJson = {
  exports: Record<string, { types: string; import: string }>;
};

async function packageJson(): Promise<PackageJson> {
  return JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageJson;
}

describe("package entrypoints", () => {
  it("exposes direct, server, and TUI modules", async () => {
    const manifest = await packageJson();

    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./server": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./tui": {
        types: "./dist/tui.d.ts",
        import: "./dist/tui.js",
      },
    });
  });
});

type PluginConfig = {
  $schema?: string;
  plugin?: unknown[];
};

function jsonExamples(markdown: string): PluginConfig[] {
  return [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
    (match) => JSON.parse(match[1]!) as PluginConfig,
  );
}

describe("installation documentation", () => {
  it("documents separate server and TUI plugin configs", async () => {
    const readme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const examples = jsonExamples(readme);
    const packageSpec = "file:///home/lmbrandon/videoDemos/opencode-jarvis";

    expect(examples).toContainEqual({
      $schema: "https://opencode.ai/config.json",
      plugin: expect.arrayContaining([packageSpec]),
    });
    expect(examples).toContainEqual({
      $schema: "https://opencode.ai/tui.json",
      plugin: expect.arrayContaining([packageSpec]),
    });
  });
});

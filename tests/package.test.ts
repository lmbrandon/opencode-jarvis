import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

  it("maps every export to an existing build artifact once dist/ exists", async () => {
    const distDir = fileURLToPath(new URL("../dist", import.meta.url));

    // `npm run check` runs `tsc --noEmit && npm test && npm run build`, so on
    // a clean checkout with no prior build, dist/ does not exist yet when
    // this test runs. Skip the existence assertion in that case; it still
    // runs for real whenever dist/ is already present (a prior local build,
    // or a CI order that builds before testing).
    if (!existsSync(distDir)) {
      return;
    }

    const manifest = await packageJson();
    const artifactPaths = new Set(
      Object.values(manifest.exports).flatMap((target) => [
        target.types,
        target.import,
      ]),
    );

    for (const relativePath of artifactPaths) {
      const absolutePath = fileURLToPath(
        new URL(`../${relativePath}`, import.meta.url),
      );
      expect(existsSync(absolutePath), `expected ${relativePath} to exist`).toBe(
        true,
      );
    }
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
  it("documents separate server and TUI plugin configs for local installation", async () => {
    const readme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const examples = jsonExamples(readme);
    const localPackageSpec = "file:///home/lmbrandon/videoDemos/opencode-jarvis";

    expect(examples).toContainEqual({
      $schema: "https://opencode.ai/config.json",
      plugin: expect.arrayContaining([localPackageSpec]),
    });
    expect(examples).toContainEqual({
      $schema: "https://opencode.ai/tui.json",
      plugin: expect.arrayContaining([localPackageSpec]),
    });
  });

  it("documents separate server and TUI plugin configs for npm installation", async () => {
    const readme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const examples = jsonExamples(readme);
    const npmPackageSpec = "opencode-jarvis";

    expect(examples).toContainEqual({
      $schema: "https://opencode.ai/config.json",
      plugin: expect.arrayContaining([npmPackageSpec]),
    });
    expect(examples).toContainEqual({
      $schema: "https://opencode.ai/tui.json",
      plugin: expect.arrayContaining([npmPackageSpec]),
    });
  });
});

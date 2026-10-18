import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageJson = {
  exports: Record<string, { types: string; import: string }>;
  engines: { opencode: string };
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

async function packageJson(): Promise<PackageJson> {
  return JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageJson;
}

describe("package manifest", () => {
  it("exposes direct, RPC, and TUI modules", async () => {
    const manifest = await packageJson();

    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./rpc": {
        types: "./dist/rpc.d.ts",
        import: "./dist/rpc.js",
      },
      "./tui": {
        types: "./dist/tui.d.ts",
        import: "./dist/tui.js",
      },
    });
  });

  it("requires OpenCode 2", async () => {
    const manifest = await packageJson();

    expect(manifest.engines.opencode).toBe(">=2.0.0 <3");
  });

  it("depends only on the OpenCode 2 plugin package", async () => {
    const manifest = await packageJson();

    expect(manifest.dependencies).toEqual({ "@opencode/plugin": "2.0.29" });
  });

  it("provides the installed OpenCode 2 smoke test", async () => {
    const manifest = await packageJson();

    expect(manifest.scripts["smoke:v2"]).toBe("node testing/smoke-v2.mjs");
    expect(
      existsSync(
        fileURLToPath(new URL("../testing/smoke-v2.mjs", import.meta.url)),
      ),
    ).toBe(true);
  });
});

type PluginConfig = {
  $schema?: string;
  plugins?: unknown[];
};

function jsonExamples(markdown: string): PluginConfig[] {
  return [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
    (match) => JSON.parse(match[1]!) as PluginConfig,
  );
}

describe("installation documentation", () => {
  it("documents one native v2 config for local installation", async () => {
    const readme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const examples = jsonExamples(readme);
    const localPackageSpec = "file:///absolute/path/to/opencode-jarvis";

    expect(examples).toContainEqual({
      $schema: "https://opencode.ai/config.json",
      plugins: expect.arrayContaining([localPackageSpec]),
    });
  });

  it("documents one native v2 config for npm installation", async () => {
    const readme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const examples = jsonExamples(readme);
    const npmPackageSpec = "opencode-jarvis";

    expect(examples).toContainEqual({
      $schema: "https://opencode.ai/config.json",
      plugins: expect.arrayContaining([npmPackageSpec]),
    });
  });

  it("contains no OpenCode 1 installation contract", async () => {
    const readme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8",
    );

    expect(readme).toContain("OpenCode 2");
    expect(readme).not.toMatch(/OpenCode 1\.18\.22|OpenCode 1 or newer/);
    expect(readme).not.toContain("tui.json");
    expect(readme).not.toContain("@opencode-ai/plugin");
    expect(readme).not.toContain("@opencode-ai/sdk");
    for (const example of jsonExamples(readme)) {
      expect(example).not.toHaveProperty("plugin");
    }
  });
});

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageJson = {
  exports: Record<string, { types: string; import: string }>;
};

describe("package artifacts", () => {
  it("maps every export to an existing build artifact", async () => {
    const distDir = fileURLToPath(new URL("../dist", import.meta.url));
    expect(existsSync(distDir), "expected dist/ to exist").toBe(true);

    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as PackageJson;
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

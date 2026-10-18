import { describe, expect, test } from "vitest";

import { resolveCacheDirectory } from "../src/cache-path.js";

describe("resolveCacheDirectory", () => {
  test("prefers XDG_CACHE_HOME", () => {
    expect(
      resolveCacheDirectory({
        env: { XDG_CACHE_HOME: "/cache", LOCALAPPDATA: "C:\\Ignored" },
        platform: "linux",
        home: "/home/user",
      }),
    ).toBe("/cache/opencode-jarvis");
  });

  test("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveCacheDirectory({
        env: { LOCALAPPDATA: "C:\\Cache" },
        platform: "win32",
        home: "C:\\Users\\user",
      }),
    ).toBe("C:\\Cache\\opencode-jarvis");
  });

  test("uses the home cache directory otherwise", () => {
    expect(
      resolveCacheDirectory({
        env: {},
        platform: "linux",
        home: "/home/user",
      }),
    ).toBe("/home/user/.cache/opencode-jarvis");
  });
});

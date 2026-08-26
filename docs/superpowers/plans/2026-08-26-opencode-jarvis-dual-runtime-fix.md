# OpenCode Jarvis Dual-Runtime Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenCode load Jarvis in both its server and TUI runtimes so the conditional prompt hook and native `/jarvis-*` commands are available.

**Architecture:** Keep the existing target-exclusive server and TUI modules, but expose them through OpenCode's canonical `./server` and `./tui` package entrypoints. Document and configure each runtime separately: `opencode.json` for the server package and `tui.json` for the TUI package.

**Tech Stack:** TypeScript, Vitest, npm package exports, OpenCode 1.18.22+ server/TUI plugin configuration.

---

## File Structure

- Modify `package.json`: add the canonical `./server` export without removing direct `.` or `./tui` exports.
- Create `tests/package.test.ts`: regression-test target-specific exports and parse the README's JSON configuration examples.
- Modify `README.md`: document the separate server and TUI config files for local and npm installation.
- Create user-owned `tui.json`: local TUI runtime configuration; keep it untracked and out of npm contents.

### Task 1: Expose The Canonical Server Entrypoint

**Files:**
- Create: `tests/package.test.ts`
- Modify: `package.json:17-26`

- [ ] **Step 1: Write the failing package-entrypoint test**

Create `tests/package.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm test -- tests/package.test.ts`

Expected: FAIL because `manifest.exports` does not contain `./server`.

- [ ] **Step 3: Add the minimal canonical export**

Replace the `exports` object in `package.json` with:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./server": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./tui": {
    "types": "./dist/tui.d.ts",
    "import": "./dist/tui.js"
  }
},
```

- [ ] **Step 4: Verify GREEN and build entrypoints**

Run: `npm test -- tests/package.test.ts && npm run build`

Expected: the package test passes and both `dist/index.*` and `dist/tui.*` build.

Run:

```bash
node -e "Promise.all([import('opencode-jarvis/server'), import('opencode-jarvis/tui')]).then(([server,tui]) => console.log(Object.keys(server), Object.keys(tui)))"
```

Expected: server output includes `default`; TUI output includes `JarvisTui`, `default`, and `jarvisCommands`.

- [ ] **Step 5: Commit the manifest regression fix**

```bash
git add package.json tests/package.test.ts
git commit -m "fix: expose canonical jarvis server entrypoint"
```

### Task 2: Document Separate Server And TUI Configuration

**Files:**
- Modify: `tests/package.test.ts`
- Modify: `README.md:19-55`

- [ ] **Step 1: Add a failing documentation-config test**

Append to `tests/package.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm test -- tests/package.test.ts`

Expected: FAIL because README contains no `https://opencode.ai/tui.json` example.

- [ ] **Step 3: Replace the local installation section**

Replace README lines from `## Local Installation` through the paragraph before `## npm Installation` with:

````md
## Local Installation

Build the package:

```sh
npm run build
```

OpenCode loads server and TUI plugins from separate configuration files. Add the package directory to both files without removing unrelated plugins.

Register the server module in the project `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "file:///home/lmbrandon/videoDemos/opencode-jarvis"
  ]
}
```

Register the native commands and speech integration in the project `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///home/lmbrandon/videoDemos/opencode-jarvis"]
}
```

This example uses the approved checkout path. On another machine or in another checkout, replace it with the absolute `file://` URI for that clone in both files. Installing or running `opencode-jarvis` does not rewrite OpenCode configuration. Quit and restart OpenCode after changing either config file.
````

- [ ] **Step 4: Replace the npm installation section**

Replace the existing npm installation section through the paragraph before `## Fish Audio Key` with:

````md
## npm Installation

After the package is published, preserve existing plugins and add `opencode-jarvis` to both runtime configurations.

`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "opencode-jarvis"
  ]
}
```

`tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-jarvis"]
}
```

Quit and restart OpenCode after changing either config file.
````

- [ ] **Step 5: Verify documentation GREEN and full package health**

Run: `npm test -- tests/package.test.ts && npm run check`

Expected: package/documentation tests pass, all existing tests pass, typecheck passes, and build passes.

Run: `npm pack --dry-run --json`

Expected: package includes README, LICENSE, package metadata, `dist/index.*`, `dist/tui.*`, and the shared build chunk. It excludes `src`, `tests`, `opencode.json`, `tui.json`, `.claude`, and `HANDOFF.md`.

- [ ] **Step 6: Commit documentation and regression coverage**

```bash
git add README.md tests/package.test.ts
git commit -m "docs: configure both jarvis plugin runtimes"
```

### Task 3: Configure And Smoke-Test The Local TUI Runtime

**Files:**
- Create, user-owned and untracked: `tui.json`
- Do not modify: `opencode.json`

- [ ] **Step 1: Create the local TUI configuration**

Create root `tui.json` with:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///home/lmbrandon/videoDemos/opencode-jarvis"]
}
```

Do not stage or commit `tui.json`.

- [ ] **Step 2: Validate local configs and Git scope**

Run:

```bash
node -e "const fs=require('node:fs'); for (const file of ['opencode.json','tui.json']) JSON.parse(fs.readFileSync(file,'utf8')); console.log('server and TUI configs parse')"
```

Expected: `server and TUI configs parse`.

Run: `git status --short --branch`

Expected: tracked implementation is clean; user-owned `.claude/`, `HANDOFF.md`, `opencode.json`, and `tui.json` are untracked.

- [ ] **Step 3: Run final automated verification**

Run: `npm run check && npm pack --dry-run`

Expected: all tests, typecheck, and build pass; package contents exclude both local config files.

- [ ] **Step 4: Restart and verify TUI activation**

Fully quit OpenCode, preserve the current shell's exported `FISH_API_KEY`, and run from the project root:

```bash
opencode
```

Open the command palette and run `Plugins`. Confirm `opencode-jarvis` is listed as `active` with the local file URI.

- [ ] **Step 5: Run the live command smoke test**

In a new session:

1. Run `/jarvis-status` and confirm Jarvis reports off.
2. Run `/jarvis-on` and confirm the success toast and spoken greeting.
3. Send a typed prompt and confirm the completed assistant reply is spoken.
4. Run `/jarvis-off`, send another prompt, and confirm the response is silent.
5. Open another new session and confirm `/jarvis-status` reports off.

If the plugin is listed but inactive, capture the TUI console/log error before making another change. If it is absent, verify OpenCode reports loading the root `tui.json` before changing package code.

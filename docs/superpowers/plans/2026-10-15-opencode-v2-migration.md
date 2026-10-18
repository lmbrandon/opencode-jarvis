# OpenCode 2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `opencode-jarvis` to the native OpenCode 2 server, RPC, and terminal plugin APIs while preserving session-scoped Jarvis speech behavior.

**Architecture:** The server plugin owns durable per-session mode in OpenCode plugin storage and exposes it through a shared typed RPC contract. The terminal plugin owns commands, event subscriptions, Fish Audio credentials, caching, and playback; runtime-neutral controller logic receives normalized session references and completed reply or skill events.

**Tech Stack:** TypeScript, OpenCode 2.0.29 (`@opencode/plugin`, `@opencode/client` transitively), Vitest, tsup, Node.js, Fish Audio HTTP, ffplay.

---

## File Structure

- `src/rpc.ts`: shared `Rpc.define` contract for status, set, and toggle.
- `src/state.ts`: storage-backed, per-session serialized state operations.
- `src/engine.ts`: server setup, RPC implementation, and context hook.
- `src/index.ts`: native server `Plugin.define` entrypoint.
- `src/controller.ts`: runtime-neutral commands, deduplication, mode epochs, and speech decisions.
- `src/tui.ts`: native terminal `Plugin.define` entrypoint and OpenCode 2 adapters.
- `src/cache-path.ts`: deterministic terminal-local cache path selection.
- `src/voice.ts`: existing voice pipeline updated to accept the cache directory.
- `tests/state.test.ts`: storage state and concurrency contract.
- `tests/engine.test.ts`: RPC and context-hook contract.
- `tests/controller.test.ts`: controller and OpenCode 2 terminal behavior.
- `tests/cache-path.test.ts`: XDG, Windows, and home cache paths.
- `tests/package.test.ts`: v2 exports and installation documentation.
- `testing/smoke-v2.mjs`: packed-package plugin load and RPC smoke test.
- `package.json`, `package-lock.json`, `opencode.json`, `.gitignore`: v2 package and local setup.
- `README.md`, `HANDOFF.md`: v2-only usage and maintenance documentation.

The existing uncommitted `src/prompt.ts` change is out of scope and must remain untouched.

### Task 1: Pin The OpenCode 2 Package Contract

**Files:**
- Modify: `tests/package.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Replace the package export test with the v2 contract**

Assert the exact export map:

```ts
expect(manifest.exports).toEqual({
  ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  "./rpc": { types: "./dist/rpc.d.ts", import: "./dist/rpc.js" },
  "./tui": { types: "./dist/tui.d.ts", import: "./dist/tui.js" },
});
expect(manifest.engines.opencode).toBe(">=2.0.0 <3");
expect(manifest.dependencies).toEqual({ "@opencode/plugin": "2.0.29" });
```

Change the artifact test to fail when `dist/` is absent rather than returning early.

- [ ] **Step 2: Run the package test and verify the old manifest fails**

Run: `npm test -- tests/package.test.ts`

Expected: FAIL because `./server` exists, `./rpc` is missing, and v1 dependencies remain.

- [ ] **Step 3: Update dependencies, scripts, and exports**

Set `engines.opencode` to `>=2.0.0 <3`, replace the two `@opencode-ai/*` dependencies with `@opencode/plugin@2.0.29`, remove direct OpenTUI dependencies because the plugin renders no JSX, and build all three entrypoints:

```json
{
  "scripts": {
    "build": "tsup src/index.ts src/rpc.ts src/tui.ts --format esm --dts --clean --out-dir dist",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:package": "npm run build && vitest run tests/package.test.ts && npm pack --dry-run --json",
    "check": "npm run typecheck && npm run build && npm test && npm pack --dry-run --json"
  },
  "dependencies": {
    "@opencode/plugin": "2.0.29"
  }
}
```

Run `npm install` to regenerate `package-lock.json`.

- [ ] **Step 4: Run the dependency-level verification**

Run: `npm install && npm ls @opencode/plugin @opencode-ai/plugin @opencode-ai/sdk`

Expected: `@opencode/plugin@2.0.29` is present and neither v1 package is installed as a direct dependency.

### Task 2: Replace File State With Plugin Storage And RPC

**Files:**
- Create: `src/rpc.ts`
- Modify: `src/state.ts`
- Modify: `tests/state.test.ts`

- [ ] **Step 1: Write failing storage and concurrency tests**

Use an in-memory storage double with `get`, `set`, and `remove`. Cover default disabled state, persisted enable/disable, two serial toggles returning `true` then `false`, isolation by session ID, malformed non-boolean values failing closed, and concurrent toggles on one session producing ordered results.

The concurrency assertion must be:

```ts
const results = await Promise.all([
  state.toggle("session-a"),
  state.toggle("session-a"),
]);
expect(results).toEqual([true, false]);
expect(await state.isEnabled("session-a")).toBe(false);
```

- [ ] **Step 2: Run state tests and verify the v1 implementation fails**

Run: `npm test -- tests/state.test.ts`

Expected: FAIL because `SessionStateStore` still requires a filesystem path.

- [ ] **Step 3: Implement storage-backed serialized state**

Replace filesystem locking with this public contract:

```ts
export interface JarvisStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: boolean): Promise<void>;
  remove(key: string): Promise<void>;
}

export class SessionStateStore {
  private readonly pending = new Map<string, Promise<void>>();
  constructor(private readonly storage: JarvisStorage) {}
  isEnabled(sessionID: string): Promise<boolean>;
  setEnabled(sessionID: string, enabled: boolean): Promise<boolean>;
  toggle(sessionID: string): Promise<boolean>;
}
```

Use keys `session/${sessionID}/enabled`. Persist `true`; remove the key for disabled state. Chain each mutation behind the prior promise for that session and clear completed queue entries without allowing a rejection to poison later operations.

- [ ] **Step 4: Define the shared RPC contract**

Create `JarvisRpc` with ID `opencode-jarvis`. Define `status`, `set`, and `toggle`, using JSON Schema inputs and outputs:

```ts
const sessionInput = {
  type: "object",
  properties: { sessionID: { type: "string", minLength: 1 } },
  required: ["sessionID"],
  additionalProperties: false,
} as const;

const enabledOutput = {
  type: "object",
  properties: { enabled: { type: "boolean" } },
  required: ["enabled"],
  additionalProperties: false,
} as const;
```

`set` adds a required `enabled` boolean. Every method declares `storage_error` with an empty object payload.

- [ ] **Step 5: Run state tests**

Run: `npm test -- tests/state.test.ts`

Expected: PASS.

### Task 3: Port The Server Plugin

**Files:**
- Modify: `tests/engine.test.ts`
- Modify: `src/engine.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing OpenCode 2 engine tests**

Build a context double containing `storage`, `rpc.register`, and `session.hook`. Capture the registered RPC handlers and `context` hook. Cover:

- disabled state leaves structured system parts unchanged;
- enabled state appends `{ type: "text", text: JARVIS_SYSTEM_INSTRUCTION }`;
- storage read failure fails closed;
- RPC status, set, and toggle return `{ enabled }`;
- storage failures return `context.error("storage_error", ...)`;
- setup registers exactly one RPC and one `context` hook.

- [ ] **Step 2: Run engine tests and verify they fail against v1 hooks**

Run: `npm test -- tests/engine.test.ts`

Expected: FAIL because `JarvisEngine` expects `client.path.get()` and returns a v1 hook map.

- [ ] **Step 3: Implement native server setup**

Export `setupJarvisServer(ctx)` from `src/engine.ts`. Construct `SessionStateStore` from `ctx.storage`, register `JarvisRpc`, and register the context hook:

```ts
await ctx.session.hook("context", async (event) => {
  try {
    if (await state.isEnabled(event.sessionID)) {
      event.system.push({ type: "text", text: JARVIS_SYSTEM_INSTRUCTION });
    }
  } catch {
    // Fail closed: prompt construction must continue without Jarvis.
  }
});
```

Wrap each RPC handler in one helper that maps storage failures to the declared `storage_error`.

- [ ] **Step 4: Replace the root entrypoint**

```ts
import { Plugin } from "@opencode/plugin";
import { setupJarvisServer } from "./engine.js";

export default Plugin.define({
  id: "opencode-jarvis",
  setup: setupJarvisServer,
});
```

- [ ] **Step 5: Run server tests and typecheck**

Run: `npm test -- tests/engine.test.ts tests/state.test.ts && npm run typecheck`

Expected: PASS.

### Task 4: Normalize OpenCode 2 Reply And Skill Events

**Files:**
- Modify: `tests/controller.test.ts`
- Modify: `src/controller.ts`

- [ ] **Step 1: Rewrite controller fixtures around v2 session references**

Define the controller boundary:

```ts
export interface SessionRef {
  id: string;
  location: { directory: string; workspaceID?: string };
}

interface ControllerInput {
  state: {
    isEnabled(session: SessionRef): Promise<boolean>;
    setEnabled(session: SessionRef, enabled: boolean): Promise<boolean>;
    toggle(session: SessionRef): Promise<boolean>;
  };
  getSession(): SessionRef | undefined;
  // existing voice and toast ports
}
```

Replace `sessionIdle` and `partUpdated` tests with:

```ts
await controller.replyCompleted(session, "message-1", "Hello **sir**");
await controller.skillActivated(session, "event-1", "brainstorming");
```

Cover duplicate message IDs, duplicate event IDs, two distinct activations of the same skill, disabled state, stale mode epochs, empty sanitized replies, and cancellation on disable.

- [ ] **Step 2: Run controller tests and verify failure**

Run: `npm test -- tests/controller.test.ts`

Expected: FAIL because the controller still imports v1 SDK types and exposes old event methods.

- [ ] **Step 3: Implement normalized controller methods**

Remove all `@opencode-ai/sdk/v2` imports. Commands resolve one `SessionRef`. `replyCompleted` sanitizes the supplied text, checks state with the same session reference, deduplicates by message ID, and queues one reply. `skillActivated` checks state, deduplicates by event-envelope ID, and queues `skillLoadingCue(name)`.

- [ ] **Step 4: Run focused controller tests**

Run: `npm test -- tests/controller.test.ts`

Expected: controller-only tests PASS; old TUI tests may remain failing until Task 6.

### Task 5: Move Audio Cache To A Terminal-Local Directory

**Files:**
- Create: `src/cache-path.ts`
- Create: `tests/cache-path.test.ts`
- Modify: `src/voice.ts`
- Modify: `tests/voice.test.ts`

- [ ] **Step 1: Write cache path tests**

Test this pure function:

```ts
resolveCacheDirectory({
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  home: string,
}): string
```

Expected paths:

- `XDG_CACHE_HOME=/cache` -> `/cache/opencode-jarvis`
- Windows with `LOCALAPPDATA=C:\Cache` -> `C:\Cache\opencode-jarvis`
- Linux home `/home/user` -> `/home/user/.cache/opencode-jarvis`

- [ ] **Step 2: Run cache-path and voice tests to verify failure**

Run: `npm test -- tests/cache-path.test.ts tests/voice.test.ts`

Expected: FAIL because the resolver does not exist and `VoiceService` expects `stateRoot`.

- [ ] **Step 3: Implement the resolver and update `VoiceServiceOptions`**

Rename `stateRoot` to `cacheDirectory`. Construct `AudioCache` directly from that directory. Keep cache keys, cue reuse, reply streaming, queueing, cancellation, and ffplay behavior unchanged.

- [ ] **Step 4: Run voice and cache tests**

Run: `npm test -- tests/cache-path.test.ts tests/cache.test.ts tests/voice.test.ts`

Expected: PASS.

### Task 6: Port The Terminal Plugin

**Files:**
- Modify: `src/tui.ts`
- Modify: `tests/controller.test.ts`

- [ ] **Step 1: Replace v1 TUI mocks with the v2 context shape**

The test harness must provide:

```ts
{
  location,
  client: { rpc: vi.fn(() => rpcClient) },
  data: {
    on: vi.fn((type, handler) => register(type, handler)),
    location: { default: () => location },
    session: {
      get: vi.fn(),
      message: { sync: vi.fn(), list: vi.fn() },
    },
  },
  keymap: { layer: vi.fn() },
  ui: {
    router: { current: vi.fn() },
    dialog: { prompt: vi.fn(), clear: vi.fn() },
    toast: { show: vi.fn() },
  },
}
```

Assert command fields `id`, `title`, `description`, `group`, `palette`, and `slash`. Assert RPC methods receive `{ sessionID }` or `{ sessionID, enabled }` and `{ location }` request options.

- [ ] **Step 2: Add exact OpenCode 2 event tests**

For `session.execution.succeeded`, use `event.data.sessionID`, prefer `event.location`, synchronize messages, select the latest completed assistant message, concatenate only `content` entries with `type === "text"`, and call `replyCompleted` with its ID and text.

For `session.skill.activated`, call `skillActivated` with `event.id`, `event.data.sessionID`, `event.data.name`, and the resolved location. Test event-location fallback to the cached session location.

- [ ] **Step 3: Run TUI tests and verify failure**

Run: `npm test -- tests/controller.test.ts`

Expected: FAIL because `src/tui.ts` still imports `@opencode-ai/plugin/tui` and uses v1 APIs.

- [ ] **Step 4: Implement native commands and location-aware RPC state**

Import `Plugin` from `@opencode/plugin/tui`, `JarvisRpc`, `resolveCacheDirectory`, and the existing services. Create the RPC subclient with `context.client.rpc(JarvisRpc)`. Adapt RPC responses into the controller state port and pass `{ location: session.location }` as request options.

Register commands with:

```ts
context.keymap.layer(() => ({
  mode: "global",
  commands: jarvisCommands(actions),
}));
```

Resolve active sessions from `context.ui.router.current()` and `context.data.session.get(sessionID)?.location`.

- [ ] **Step 5: Implement v2 prompt, events, errors, and cleanup**

Start missing-key prompting without awaiting it from setup. Use `context.ui.dialog.prompt` and `context.ui.toast.show`. Subscribe with `context.data.on("session.execution.succeeded", ...)` and `context.data.on("session.skill.activated", ...)`.

Return an async cleanup that marks the plugin disposed, aborts key validation, clears its prompt, unsubscribes both events, and awaits startup plus `voice.dispose()`. Sanitize and redact errors before toasting and writing one prefixed `console.error` line; do not include Fish response bodies or keys.

- [ ] **Step 6: Export the native TUI plugin**

```ts
export default Plugin.define({
  id: "opencode-jarvis.tui",
  setup: setupJarvisTui,
});
```

- [ ] **Step 7: Run TUI, controller, voice, and type checks**

Run: `npm test -- tests/controller.test.ts tests/voice.test.ts && npm run typecheck`

Expected: PASS.

### Task 7: Convert Configuration And Documentation

**Files:**
- Modify: `opencode.json`
- Delete: `tui.json`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `tests/package.test.ts`

- [ ] **Step 1: Write failing documentation assertions**

Require a JSON example containing `$schema` and `plugins: ["opencode-jarvis"]`. Reject singular `plugin`, `tui.json`, `@opencode-ai/plugin`, `@opencode-ai/sdk`, and claims of OpenCode 1 support.

- [ ] **Step 2: Run package documentation tests and verify failure**

Run: `npm run build && npm test -- tests/package.test.ts`

Expected: FAIL on v1 README and config examples.

- [ ] **Step 3: Convert local config and README**

Use plural `plugins` in `opencode.json`, remove `tui.json`, and remove its `.gitignore` exception/comment. Document:

- OpenCode 2 requirement;
- npm installation with `"plugins": ["opencode-jarvis"]`;
- same-machine development with a `file://` package path;
- remote use requiring the package on both hosts rather than a shared local path;
- `FISH_API_KEY`, ffplay, commands, v2 state reset, cache paths, smoke test, and uninstall steps.

- [ ] **Step 4: Update handoff guidance**

Replace v1 server/TUI loading notes with root, `./rpc`, and `./tui` v2 contracts. Keep historical design files unchanged and identify the 2026-10-15 design as authoritative.

- [ ] **Step 5: Run documentation/package tests**

Run: `npm run build && npm test -- tests/package.test.ts`

Expected: PASS.

### Task 8: Add Installed-Package Smoke Verification

**Files:**
- Create: `testing/smoke-v2.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add a failing smoke script contract test**

Add `smoke:v2` to `package.json` and make `tests/package.test.ts` require it. The script must accept a packed tarball path, install it into an isolated temporary project, import `.`, `./rpc`, and `./tui`, assert plugin IDs, and execute server setup against a context double to verify RPC registration and the context hook.

- [ ] **Step 2: Run the contract test and verify failure**

Run: `npm test -- tests/package.test.ts`

Expected: FAIL because `smoke:v2` and `testing/smoke-v2.mjs` do not exist.

- [ ] **Step 3: Implement the smoke script**

Use `mkdtemp`, `npm init --yes`, and `npm install <tarball>` in the temporary directory. Import through the installed package name, not repository-relative paths. Use separate temporary `server` and `client` directories in location fixtures. Always remove the temporary root in `finally`.

Add:

```json
"smoke:v2": "node testing/smoke-v2.mjs"
```

- [ ] **Step 4: Run complete verification from fresh artifacts**

Run in order:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm test -- tests/package.test.ts
npm pack --dry-run --json
npm pack --json
npm run smoke:v2 -- ./opencode-jarvis-0.1.0.tgz
```

Expected: every command exits 0; the tarball contains `dist/index`, `dist/rpc`, `dist/tui`, README, and LICENSE; smoke output confirms all three exports and server registrations.

Remove the generated tarball after verification.

### Task 9: Final Review And Approval

**Files:**
- Review all changed files; do not alter unrelated `.claude/`, `skills-lock.json`, `graphify-out/`, or the pre-existing `src/prompt.ts` worktree change except where explicitly required by this migration.

- [ ] **Step 1: Inspect the final diff**

Run: `git status --short && git diff --check && git diff --stat && git diff`

Confirm no v1 imports, singular plugin configuration, `tui.json` requirement, shared state-root dependency, or secret logging remains.

- [ ] **Step 2: Run a dedicated code-review subagent**

Ask the reviewer to prioritize runtime bugs, remote-location routing, lifecycle leaks, races, packaging regressions, and missing tests. Fix every confirmed issue and rerun the focused tests for each fix.

- [ ] **Step 3: Run the final clean verification again**

Run: `npm run check && npm run smoke:v2 -- ./opencode-jarvis-0.1.0.tgz`

Expected: both commands exit 0 with current output captured after all review fixes.

- [ ] **Step 4: Self-approve against the design success criteria**

Record evidence for native plugin loading, location-aware RPC, conditional prompt injection, reply and skill speech deduplication, mode cancellation, secret handling, package contents, and installed-artifact smoke behavior. Do not create a commit unless the user explicitly requests one.

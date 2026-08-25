# OpenCode Jarvis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a publishable OpenCode 1.18.22 plugin that toggles session-specific Jarvis behavior, conditionally injects a system instruction, and speaks typed-session responses through Fish Audio with reusable greeting and skill-announcement caching.

**Architecture:** Publish one npm package with a server module at `.` and a TUI module at `./tui`. The TUI controller owns commands, API-key acquisition, event observation, caching, and serialized playback; the server module reads atomic session state and conditionally appends the Jarvis instruction. The two runtimes share only a JSON state file under OpenCode's state directory.

**Tech Stack:** TypeScript ESM, OpenCode plugin/SDK 1.18.22, Node built-ins, raw Fish Audio REST calls, `ffplay`, Vitest, tsup, npm.

---

## File Map

- `src/index.ts`: npm root server-plugin module export.
- `src/tui.ts`: npm `./tui` TUI-plugin module export.
- `src/controller.ts`: testable Jarvis actions and OpenCode event behavior.
- `src/engine.ts`: conditional system-transform hook.
- `src/state.ts`: atomic session-state persistence shared by both runtimes.
- `src/prompt.ts`: editable Jarvis system instruction.
- `src/cues.ts`: reusable greeting and skill-announcement text.
- `src/fish.ts`: Fish key validation and TTS REST client.
- `src/cache.ts`: deterministic reusable MP3 cache.
- `src/voice.ts`: FIFO synthesis/playback queue and cancellation.
- `tests/*.test.ts`: focused behavior tests with no real Fish or audio calls.
- `package.json`: npm exports, OpenCode engine constraint, scripts, publication allowlist.
- `tsconfig.json`: strict TypeScript configuration.
- `README.md`: development, installation, behavior, security, smoke test, and uninstall instructions.
- `.gitignore`: dependencies, build output, test output, and local secrets.
- `LICENSE`: MIT license.

### Task 1: Scaffold The Publishable Package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `src/index.ts`
- Create: `src/tui.ts`

- [ ] **Step 1: Create package metadata and scripts**

Create `package.json`:

```json
{
  "name": "opencode-jarvis",
  "version": "0.1.0",
  "description": "Session-specific Jarvis mode and Fish Audio speech for OpenCode",
  "type": "module",
  "license": "MIT",
  "keywords": ["opencode", "plugin", "fish-audio", "tts", "jarvis"],
  "engines": {
    "opencode": ">=1.18.22"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./tui": {
      "types": "./dist/tui.d.ts",
      "import": "./dist/tui.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "dependencies": {
    "@opencode-ai/plugin": "1.18.22",
    "@opencode-ai/sdk": "1.18.22"
  },
  "scripts": {
    "build": "tsup src/index.ts src/tui.ts --format esm --dts --clean --out-dir dist",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "check": "npm run typecheck && npm test && npm run build"
  },
  "devDependencies": {
    "@opentui/core": "0.4.5",
    "@opentui/keymap": "0.4.5",
    "@opentui/solid": "0.4.5",
    "@types/node": "^24.0.0",
    "tsup": "^8.5.0",
    "typescript": "^5.8.2",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create strict TypeScript configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": false,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create initial typed entry points**

Create `src/index.ts`:

```ts
import type { PluginModule } from "@opencode-ai/plugin"

export default {
  id: "opencode-jarvis",
  server: async () => ({}),
} satisfies PluginModule
```

Create `src/tui.ts`:

```ts
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

export default {
  id: "opencode-jarvis",
  tui: async () => {},
} satisfies TuiPluginModule
```

- [ ] **Step 4: Add repository hygiene files**

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
*.mp3
*.tmp
```

Create `LICENSE`:

```text
MIT License

Copyright (c) 2026 opencode-jarvis contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Install and verify the scaffold**

Run: `npm install`

Expected: dependencies install and `package-lock.json` is created without resolution errors.

Run: `npm run check`

Expected: typecheck, empty test suite, and two-entry build pass; `dist/index.js`, `dist/index.d.ts`, `dist/tui.js`, and `dist/tui.d.ts` exist.

- [ ] **Step 6: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.json .gitignore LICENSE src/index.ts src/tui.ts
git commit -m "chore: scaffold opencode jarvis plugin"
```

### Task 2: Add Atomic Session State

**Files:**
- Create: `src/state.ts`
- Create: `tests/state.test.ts`

- [ ] **Step 1: Write failing state tests**

Create `tests/state.test.ts`:

```ts
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SessionStateStore } from "../src/state.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function store() {
  const root = await mkdtemp(join(tmpdir(), "jarvis-state-"))
  roots.push(root)
  return { root, state: new SessionStateStore(root) }
}

describe("SessionStateStore", () => {
  it("defaults every session to off", async () => {
    const { state } = await store()
    await expect(state.isEnabled("session-a")).resolves.toBe(false)
  })

  it("isolates session state and toggles atomically", async () => {
    const { state } = await store()
    await expect(state.toggle("session-a")).resolves.toBe(true)
    await expect(state.isEnabled("session-a")).resolves.toBe(true)
    await expect(state.isEnabled("session-b")).resolves.toBe(false)
    await expect(state.toggle("session-a")).resolves.toBe(false)
  })

  it("fails closed when state is corrupt", async () => {
    const { root, state } = await store()
    const dir = join(root, "opencode-jarvis")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "state.json"), "not json")
    await expect(state.isEnabled("session-a")).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/state.test.ts`

Expected: FAIL because `src/state.ts` does not exist.

- [ ] **Step 3: Implement the minimal atomic store**

Create `src/state.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

type JarvisState = { sessions: Record<string, true> }

const EMPTY_STATE: JarvisState = { sessions: {} }

export class SessionStateStore {
  readonly file: string
  private mutation = Promise.resolve()

  constructor(stateRoot: string) {
    this.file = join(stateRoot, "opencode-jarvis", "state.json")
  }

  async isEnabled(sessionID: string): Promise<boolean> {
    await this.mutation
    return (await this.read()).sessions[sessionID] === true
  }

  setEnabled(sessionID: string, enabled: boolean): Promise<boolean> {
    return this.mutate((state) => {
      if (enabled) state.sessions[sessionID] = true
      else delete state.sessions[sessionID]
      return enabled
    })
  }

  toggle(sessionID: string): Promise<boolean> {
    return this.mutate((state) => {
      const enabled = state.sessions[sessionID] !== true
      if (enabled) state.sessions[sessionID] = true
      else delete state.sessions[sessionID]
      return enabled
    })
  }

  private mutate(operation: (state: JarvisState) => boolean): Promise<boolean> {
    const result = this.mutation.then(async () => {
      const state = await this.read()
      const value = operation(state)
      await this.write(state)
      return value
    })
    this.mutation = result.then(() => undefined, () => undefined)
    return result
  }

  private async read(): Promise<JarvisState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as unknown
      if (!parsed || typeof parsed !== "object" || !("sessions" in parsed)) return structuredClone(EMPTY_STATE)
      const sessions = (parsed as { sessions?: unknown }).sessions
      if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) return structuredClone(EMPTY_STATE)
      return {
        sessions: Object.fromEntries(
          Object.entries(sessions).filter((entry): entry is [string, true] => entry[1] === true),
        ),
      }
    } catch {
      return structuredClone(EMPTY_STATE)
    }
  }

  private async write(state: JarvisState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.file)
  }
}
```

- [ ] **Step 4: Run the state tests**

Run: `npm test -- tests/state.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit state support**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat: add session-specific jarvis state"
```

### Task 3: Add Conditional Prompt Injection

**Files:**
- Create: `src/prompt.ts`
- Create: `src/engine.ts`
- Modify: `src/index.ts`
- Create: `tests/engine.test.ts`

- [ ] **Step 1: Write failing engine tests**

Create `tests/engine.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createSystemTransform } from "../src/engine.js"
import { JARVIS_SYSTEM_INSTRUCTION } from "../src/prompt.js"

describe("Jarvis system transform", () => {
  it("does not modify system instructions while disabled", async () => {
    const isEnabled = vi.fn().mockResolvedValue(false)
    const transform = createSystemTransform({ isEnabled })
    const output = { system: ["existing"] }
    await transform({ sessionID: "session-a" }, output)
    expect(output.system).toEqual(["existing"])
  })

  it("appends the Jarvis instruction while enabled", async () => {
    const transform = createSystemTransform({ isEnabled: vi.fn().mockResolvedValue(true) })
    const output = { system: ["existing"] }
    await transform({ sessionID: "session-a" }, output)
    expect(output.system).toEqual(["existing", JARVIS_SYSTEM_INSTRUCTION])
  })

  it("does nothing when OpenCode supplies no session ID", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true)
    const transform = createSystemTransform({ isEnabled })
    const output = { system: [] as string[] }
    await transform({}, output)
    expect(isEnabled).not.toHaveBeenCalled()
    expect(output.system).toEqual([])
  })
})
```

- [ ] **Step 2: Verify the engine test fails**

Run: `npm test -- tests/engine.test.ts`

Expected: FAIL because the prompt and engine modules do not exist.

- [ ] **Step 3: Add the editable instruction and pure hook**

Create `src/prompt.ts`:

```ts
export const JARVIS_SYSTEM_INSTRUCTION =
  "Jarvis mode is enabled. Be concise, composed, and helpful, with responses that sound natural when spoken aloud. Preserve all existing OpenCode permission and tool behavior."
```

Create `src/engine.ts`:

```ts
import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { JARVIS_SYSTEM_INSTRUCTION } from "./prompt.js"
import { SessionStateStore } from "./state.js"

type StateReader = Pick<SessionStateStore, "isEnabled">
type SystemInput = { sessionID?: string }
type SystemOutput = { system: string[] }

export function createSystemTransform(state: StateReader) {
  return async (input: SystemInput, output: SystemOutput): Promise<void> => {
    if (!input.sessionID) return
    if (!(await state.isEnabled(input.sessionID))) return
    output.system.push(JARVIS_SYSTEM_INSTRUCTION)
  }
}

export const JarvisEngine: Plugin = async ({ client }) => {
  const paths = await client.path.get()
  const stateRoot = paths.data?.state
  if (!stateRoot) return {}
  const state = new SessionStateStore(stateRoot)
  return {
    "experimental.chat.system.transform": createSystemTransform(state),
  } satisfies Hooks
}
```

Replace `src/index.ts`:

```ts
import type { PluginModule } from "@opencode-ai/plugin"
import { JarvisEngine } from "./engine.js"

export default {
  id: "opencode-jarvis",
  server: JarvisEngine,
} satisfies PluginModule
```

- [ ] **Step 4: Run engine tests and typecheck**

Run: `npm test -- tests/engine.test.ts && npm run typecheck`

Expected: 3 tests PASS and typecheck PASS with the installed 1.18.22 `paths.data?.state` response shape.

- [ ] **Step 5: Commit prompt injection**

```bash
git add src/index.ts src/engine.ts src/prompt.ts tests/engine.test.ts
git commit -m "feat: inject jarvis prompt for enabled sessions"
```

### Task 4: Add Fish Audio, Cues, And Reusable Cache

**Files:**
- Create: `src/fish.ts`
- Create: `src/cues.ts`
- Create: `src/cache.ts`
- Create: `tests/fish.test.ts`
- Create: `tests/cache.test.ts`

- [ ] **Step 1: Write failing Fish, cue, and cache tests**

Create `tests/fish.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { GENERAL_GREETING, skillLoadingCue } from "../src/cues.js"
import { FishAudioClient } from "../src/fish.js"

describe("FishAudioClient", () => {
  it("validates without requesting speech", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    const client = new FishAudioClient(fetcher)
    await expect(client.validateKey("secret")).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.fish.audio/wallet/self/api-credit",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("sends the pinned model and Jarvis voice", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const client = new FishAudioClient(fetcher)
    await expect(client.synthesize("secret", "Hello")).resolves.toEqual(new Uint8Array([1, 2, 3]))
    const init = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({ model: "s2.1-pro-free" })
    expect(JSON.parse(String(init.body))).toMatchObject({
      text: "Hello",
      reference_id: "14129c3e320149449d6bada6862f7338",
      format: "mp3",
    })
  })
})

describe("cue text", () => {
  it("defines the general greeting and normalizes skill names", () => {
    expect(GENERAL_GREETING.length).toBeGreaterThan(0)
    expect(skillLoadingCue("superpowers")).toBe("Just a second, I'm loading the Superpowers skill.")
    expect(skillLoadingCue("test-driven-development")).toBe(
      "Just a second, I'm loading the Test Driven Development skill.",
    )
  })
})
```

Create `tests/cache.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { AudioCache, audioCacheKey } from "../src/cache.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("keys cache entries by text and synthesis settings", () => {
  expect(audioCacheKey("hello")).toBe(audioCacheKey("hello"))
  expect(audioCacheKey("hello")).not.toBe(audioCacheKey("goodbye"))
})

it("renders a reusable cue only once", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-cache-"))
  roots.push(root)
  const render = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
  const cache = new AudioCache(root)
  const first = await cache.getOrCreate("hello", render)
  const second = await cache.getOrCreate("hello", render)
  expect(second).toBe(first)
  expect(render).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- tests/fish.test.ts tests/cache.test.ts`

Expected: FAIL because the three source modules do not exist.

- [ ] **Step 3: Implement cue text and the Fish REST client**

Create `src/cues.ts`:

```ts
export const GENERAL_GREETING = "Good day. Jarvis is online and ready."

export function skillLoadingCue(skill: string): string {
  const display = skill
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
  return `Just a second, I'm loading the ${display} skill.`
}
```

Create `src/fish.ts`:

```ts
export const FISH_MODEL = "s2.1-pro-free"
export const FISH_REFERENCE_ID = "14129c3e320149449d6bada6862f7338"
export const FISH_FORMAT = "mp3"

type Fetcher = typeof fetch

export class FishAudioError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "FishAudioError"
  }
}

export class FishAudioClient {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.fetcher("https://api.fish.audio/wallet/self/api-credit", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      ...(signal ? { signal } : {}),
    })
    return response.ok
  }

  async synthesize(apiKey: string, text: string, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await this.fetcher("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model: FISH_MODEL,
      },
      body: JSON.stringify({ text, reference_id: FISH_REFERENCE_ID, format: FISH_FORMAT }),
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) {
      const message = await response.text().catch(() => "Fish Audio request failed")
      throw new FishAudioError(response.status, message.slice(0, 300))
    }
    return new Uint8Array(await response.arrayBuffer())
  }
}
```

- [ ] **Step 4: Implement the deterministic reusable cache**

Create `src/cache.ts`:

```ts
import { createHash } from "node:crypto"
import { access, mkdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { FISH_FORMAT, FISH_MODEL, FISH_REFERENCE_ID } from "./fish.js"

export function audioCacheKey(text: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ text, model: FISH_MODEL, reference: FISH_REFERENCE_ID, format: FISH_FORMAT }))
    .digest("hex")
}

export class AudioCache {
  private readonly pending = new Map<string, Promise<string>>()

  constructor(private readonly directory: string) {}

  async getOrCreate(text: string, render: () => Promise<Uint8Array>): Promise<string> {
    const key = audioCacheKey(text)
    const file = join(this.directory, `${key}.mp3`)
    try {
      await access(file)
      return file
    } catch {
      const existing = this.pending.get(key)
      if (existing) return existing
      const created = this.create(file, render).finally(() => this.pending.delete(key))
      this.pending.set(key, created)
      return created
    }
  }

  private async create(file: string, render: () => Promise<Uint8Array>): Promise<string> {
    const audio = await render()
    await mkdir(this.directory, { recursive: true })
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, audio, { mode: 0o600 })
    await rename(temporary, file)
    return file
  }
}
```

- [ ] **Step 5: Run Fish and cache tests**

Run: `npm test -- tests/fish.test.ts tests/cache.test.ts && npm run typecheck`

Expected: all Fish, cue, and cache tests PASS; typecheck PASS.

- [ ] **Step 6: Commit Fish and cache support**

```bash
git add src/fish.ts src/cues.ts src/cache.ts tests/fish.test.ts tests/cache.test.ts
git commit -m "feat: add fish audio and reusable cue cache"
```

### Task 5: Add Serialized Voice Playback

**Files:**
- Create: `src/voice.ts`
- Create: `tests/voice.test.ts`

- [ ] **Step 1: Write failing queue tests**

Create `tests/voice.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { VoiceQueue, VoiceService } from "../src/voice.js"

describe("VoiceQueue", () => {
  it("plays jobs in FIFO order", async () => {
    const order: string[] = []
    const queue = new VoiceQueue(async (job) => { order.push(job.text) }, vi.fn())
    queue.enqueue({ sessionID: "a", text: "first", reusable: false })
    queue.enqueue({ sessionID: "a", text: "second", reusable: false })
    await queue.whenIdle()
    expect(order).toEqual(["first", "second"])
  })

  it("removes queued work and aborts active work for one session", async () => {
    const started: string[] = []
    const queue = new VoiceQueue(
      (job, signal) =>
        new Promise<void>((resolve) => {
          started.push(job.text)
          signal.addEventListener("abort", () => resolve(), { once: true })
          if (job.sessionID === "b") resolve()
        }),
      vi.fn(),
    )
    queue.enqueue({ sessionID: "a", text: "active", reusable: false })
    queue.enqueue({ sessionID: "a", text: "queued", reusable: false })
    queue.enqueue({ sessionID: "b", text: "other", reusable: false })
    await Promise.resolve()
    queue.cancelSession("a")
    await queue.whenIdle()
    expect(started).toEqual(["active", "other"])
  })

  it("reports failures without rejecting the queue", async () => {
    const report = vi.fn()
    const queue = new VoiceQueue(async () => { throw new Error("player failed") }, report)
    queue.enqueue({ sessionID: "a", text: "hello", reusable: false })
    await queue.whenIdle()
    expect(report).toHaveBeenCalledWith(expect.any(Error))
  })

  it("caches cues but synthesizes repeated replies independently", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const fish = { synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) }
    const voice = new VoiceService({
      stateRoot: root,
      getApiKey: () => "secret",
      fish,
      play: vi.fn().mockResolvedValue(undefined),
      report: vi.fn(),
    })
    voice.speakCue("a", "cached")
    voice.speakCue("a", "cached")
    await voice.whenIdle()
    expect(fish.synthesize).toHaveBeenCalledTimes(1)
    voice.speakReply("a", "uncached")
    voice.speakReply("a", "uncached")
    await voice.whenIdle()
    expect(fish.synthesize).toHaveBeenCalledTimes(3)
    await rm(root, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Verify the queue tests fail**

Run: `npm test -- tests/voice.test.ts`

Expected: FAIL because `src/voice.ts` does not exist.

- [ ] **Step 3: Implement the FIFO queue and production voice worker**

Create `src/voice.ts` with these public contracts and behavior:

```ts
import { spawn } from "node:child_process"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { AudioCache } from "./cache.js"
import { FishAudioClient } from "./fish.js"

export type VoiceJob = { sessionID: string; text: string; reusable: boolean }
type Worker = (job: VoiceJob, signal: AbortSignal) => Promise<void>

export class VoiceQueue {
  private jobs: VoiceJob[] = []
  private active?: { job: VoiceJob; controller: AbortController }
  private draining = false
  private idleWaiters: Array<() => void> = []

  constructor(private readonly worker: Worker, private readonly report: (error: Error) => void) {}

  enqueue(job: VoiceJob): void {
    this.jobs.push(job)
    void this.drain()
  }

  cancelSession(sessionID: string): void {
    this.jobs = this.jobs.filter((job) => job.sessionID !== sessionID)
    if (this.active?.job.sessionID === sessionID) this.active.controller.abort()
  }

  async dispose(): Promise<void> {
    this.jobs = []
    this.active?.controller.abort()
    await this.whenIdle()
  }

  whenIdle(): Promise<void> {
    if (!this.draining && !this.active && this.jobs.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()
      if (!job) continue
      const controller = new AbortController()
      this.active = { job, controller }
      try {
        await this.worker(job, controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) this.report(error instanceof Error ? error : new Error(String(error)))
      } finally {
        this.active = undefined
      }
    }
    this.draining = false
    for (const resolve of this.idleWaiters.splice(0)) resolve()
  }
}

export type VoiceServiceOptions = {
  stateRoot: string
  getApiKey: () => string | undefined
  fish?: Pick<FishAudioClient, "synthesize">
  play?: (file: string, signal: AbortSignal) => Promise<void>
  report: (error: Error) => void
}

export class VoiceService {
  private readonly fish: Pick<FishAudioClient, "synthesize">
  private readonly cache: AudioCache
  private readonly temporaryDirectory: string
  private readonly queue: VoiceQueue

  constructor(private readonly options: VoiceServiceOptions) {
    this.fish = options.fish ?? new FishAudioClient()
    this.cache = new AudioCache(join(options.stateRoot, "opencode-jarvis", "cache"))
    this.temporaryDirectory = join(options.stateRoot, "opencode-jarvis", "tmp")
    this.queue = new VoiceQueue((job, signal) => this.run(job, signal), options.report)
  }

  speakReply(sessionID: string, text: string): void {
    this.queue.enqueue({ sessionID, text, reusable: false })
  }

  speakCue(sessionID: string, text: string): void {
    this.queue.enqueue({ sessionID, text, reusable: true })
  }

  cancelSession(sessionID: string): void {
    this.queue.cancelSession(sessionID)
  }

  whenIdle(): Promise<void> {
    return this.queue.whenIdle()
  }

  dispose(): Promise<void> {
    return this.queue.dispose()
  }

  private async run(job: VoiceJob, signal: AbortSignal): Promise<void> {
    const apiKey = this.options.getApiKey()
    if (!apiKey) throw new Error("Fish Audio API key is unavailable")
    const render = () => this.fish.synthesize(apiKey, job.text, signal)
    if (job.reusable) {
      await this.playAudio(await this.cache.getOrCreate(job.text, render), signal)
      return
    }
    await mkdir(this.temporaryDirectory, { recursive: true })
    const file = join(this.temporaryDirectory, `${crypto.randomUUID()}.mp3`)
    try {
      await writeFile(file, await render(), { mode: 0o600 })
      await this.playAudio(file, signal)
    } finally {
      await rm(file, { force: true })
    }
  }

  private playAudio(file: string, signal: AbortSignal): Promise<void> {
    if (this.options.play) return this.options.play(file, signal)
    return new Promise((resolve, reject) => {
      const child = spawn("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file], { stdio: "ignore" })
      const abort = () => child.kill("SIGTERM")
      signal.addEventListener("abort", abort, { once: true })
      child.once("error", reject)
      child.once("exit", (code, killedBySignal) => {
        signal.removeEventListener("abort", abort)
        if (signal.aborted || killedBySignal === "SIGTERM" || code === 0) resolve()
        else reject(new Error(`ffplay exited with code ${code ?? "unknown"}`))
      })
    })
  }
}
```

- [ ] **Step 4: Run queue tests and typecheck**

Run: `npm test -- tests/voice.test.ts && npm run typecheck`

Expected: 4 tests PASS and typecheck PASS.

- [ ] **Step 5: Commit voice playback**

```bash
git add src/voice.ts tests/voice.test.ts
git commit -m "feat: add serialized jarvis voice playback"
```

### Task 6: Add Testable Controller Behavior

**Files:**
- Create: `src/controller.ts`
- Create: `tests/controller.test.ts`

- [ ] **Step 1: Write failing controller tests**

Create `tests/controller.test.ts` with in-memory state and voice fakes:

```ts
import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import { describe, expect, it, vi } from "vitest"
import { createJarvisController } from "../src/controller.js"
import { GENERAL_GREETING } from "../src/cues.js"

function setup() {
  const enabled = new Map<string, boolean>()
  const state = {
    isEnabled: vi.fn(async (id: string) => enabled.get(id) === true),
    setEnabled: vi.fn(async (id: string, value: boolean) => (enabled.set(id, value), value)),
    toggle: vi.fn(async (id: string) => {
      const value = enabled.get(id) !== true
      enabled.set(id, value)
      return value
    }),
  }
  const voice = { speakCue: vi.fn(), speakReply: vi.fn(), cancelSession: vi.fn() }
  const toast = vi.fn()
  const controller = createJarvisController({ state, voice, toast, getSessionID: () => "session-a" })
  return { enabled, state, voice, toast, controller }
}

describe("Jarvis controller", () => {
  it("toggles, greets, reports, and disables the active session", async () => {
    const { controller, voice, toast } = setup()
    await controller.toggle()
    expect(voice.speakCue).toHaveBeenCalledWith("session-a", GENERAL_GREETING)
    await controller.status()
    expect(toast).toHaveBeenCalledWith("Jarvis is on", "info")
    await controller.disable()
    expect(voice.cancelSession).toHaveBeenCalledWith("session-a")
  })

  it("does nothing except warn when there is no active session", async () => {
    const toast = vi.fn()
    const controller = createJarvisController({
      state: { isEnabled: vi.fn(), setEnabled: vi.fn(), toggle: vi.fn() },
      voice: { speakCue: vi.fn(), speakReply: vi.fn(), cancelSession: vi.fn() },
      toast,
      getSessionID: () => undefined,
    })
    await controller.toggle()
    expect(toast).toHaveBeenCalledWith("Open a session before changing Jarvis mode", "warning")
  })

  it("speaks each completed assistant message once only while enabled", async () => {
    const { controller, enabled, voice } = setup()
    enabled.set("session-a", true)
    const message = { id: "assistant-1", role: "assistant", time: { created: 1, completed: 2 } } as Message
    const parts = [{ type: "text", text: "Ready, sir.", ignored: false }] as Part[]
    await controller.sessionIdle("session-a", [message], () => parts)
    await controller.sessionIdle("session-a", [message], () => parts)
    expect(voice.speakReply).toHaveBeenCalledTimes(1)
    expect(voice.speakReply).toHaveBeenCalledWith("session-a", "Ready, sir.")
  })

  it("announces each running skill call once only while enabled", async () => {
    const { controller, enabled, voice } = setup()
    enabled.set("session-a", true)
    const part = {
      type: "tool",
      tool: "skill",
      callID: "call-1",
      sessionID: "session-a",
      state: { status: "running", input: { name: "superpowers" } },
    } as ToolPart
    await controller.partUpdated(part)
    await controller.partUpdated(part)
    expect(voice.speakCue).toHaveBeenCalledWith(
      "session-a",
      "Just a second, I'm loading the Superpowers skill.",
    )
  })

  it("keeps completion and skill events inert while disabled", async () => {
    const { controller, voice } = setup()
    const message = { id: "assistant-1", role: "assistant", time: { created: 1, completed: 2 } } as Message
    await controller.sessionIdle("session-a", [message], () => [{ type: "text", text: "Silent" }] as Part[])
    await controller.partUpdated({
      id: "part-1",
      type: "tool",
      tool: "skill",
      callID: "call-1",
      sessionID: "session-a",
      messageID: "message-1",
      state: { status: "running", input: { name: "superpowers" }, time: { start: 1 } },
    })
    expect(voice.speakReply).not.toHaveBeenCalled()
    expect(voice.speakCue).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Verify controller tests fail**

Run: `npm test -- tests/controller.test.ts`

Expected: FAIL because `src/controller.ts` does not exist.

- [ ] **Step 3: Implement controller actions and event filtering**

Create `src/controller.ts`:

```ts
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { GENERAL_GREETING, skillLoadingCue } from "./cues.js"

type State = {
  isEnabled(sessionID: string): Promise<boolean>
  setEnabled(sessionID: string, enabled: boolean): Promise<boolean>
  toggle(sessionID: string): Promise<boolean>
}
type Voice = {
  speakCue(sessionID: string, text: string): void
  speakReply(sessionID: string, text: string): void
  cancelSession(sessionID: string): void
}
type ToastVariant = "info" | "success" | "warning" | "error"

export function createJarvisController(input: {
  state: State
  voice: Voice
  toast: (message: string, variant: ToastVariant) => void
  getSessionID: () => string | undefined
}) {
  const spokenMessages = new Set<string>()
  const announcedCalls = new Set<string>()

  async function set(enabled: boolean) {
    const sessionID = input.getSessionID()
    if (!sessionID) {
      input.toast("Open a session before changing Jarvis mode", "warning")
      return
    }
    await input.state.setEnabled(sessionID, enabled)
    if (enabled) input.voice.speakCue(sessionID, GENERAL_GREETING)
    else input.voice.cancelSession(sessionID)
    input.toast(`Jarvis is ${enabled ? "on" : "off"}`, "success")
  }

  return {
    async toggle() {
      const sessionID = input.getSessionID()
      if (!sessionID) {
        input.toast("Open a session before changing Jarvis mode", "warning")
        return
      }
      const enabled = await input.state.toggle(sessionID)
      if (enabled) input.voice.speakCue(sessionID, GENERAL_GREETING)
      else input.voice.cancelSession(sessionID)
      input.toast(`Jarvis is ${enabled ? "on" : "off"}`, "success")
    },
    enable: () => set(true),
    disable: () => set(false),
    async status() {
      const sessionID = input.getSessionID()
      if (!sessionID) {
        input.toast("Open a session before checking Jarvis mode", "warning")
        return
      }
      input.toast(`Jarvis is ${(await input.state.isEnabled(sessionID)) ? "on" : "off"}`, "info")
    },
    async sessionIdle(sessionID: string, messages: readonly Message[], partsFor: (messageID: string) => readonly Part[]) {
      if (!(await input.state.isEnabled(sessionID))) return
      const message = [...messages].reverse().find(
        (item) => item.role === "assistant" && item.time.completed !== undefined && !item.error,
      )
      if (!message || spokenMessages.has(message.id)) return
      const text = partsFor(message.id)
        .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.ignored)
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n")
      if (!text) return
      spokenMessages.add(message.id)
      input.voice.speakReply(sessionID, text)
    },
    async partUpdated(part: Part) {
      if (part.type !== "tool" || part.tool !== "skill" || part.state.status !== "running") return
      if (announcedCalls.has(part.callID) || !(await input.state.isEnabled(part.sessionID))) return
      const name = part.state.input.name
      if (typeof name !== "string" || !name.trim()) return
      announcedCalls.add(part.callID)
      input.voice.speakCue(part.sessionID, skillLoadingCue(name))
    },
  }
}
```

- [ ] **Step 4: Run controller tests and the full suite**

Run: `npm test -- tests/controller.test.ts && npm test`

Expected: controller tests and all prior tests PASS.

- [ ] **Step 5: Commit controller behavior**

```bash
git add src/controller.ts tests/controller.test.ts
git commit -m "feat: add jarvis controller behavior"
```

### Task 7: Wire The Native TUI Plugin

**Files:**
- Modify: `src/tui.ts`
- Modify: `tests/controller.test.ts`

- [ ] **Step 1: Add a failing command-definition test**

Add `import { jarvisCommands } from "../src/tui.js"` alongside the existing imports in `tests/controller.test.ts`, then append:

```ts
it("registers the four native slash commands", () => {
  const actions = { toggle: vi.fn(), enable: vi.fn(), disable: vi.fn(), status: vi.fn() }
  expect(jarvisCommands(actions).map((command) => command.slashName)).toEqual([
    "jarvis",
    "jarvis-on",
    "jarvis-off",
    "jarvis-status",
  ])
})
```

- [ ] **Step 2: Verify the command test fails**

Run: `npm test -- tests/controller.test.ts`

Expected: FAIL because `jarvisCommands` is not exported.

- [ ] **Step 3: Replace the TUI entry point with native integration**

Replace `src/tui.ts` with an implementation containing these exact responsibilities:

```ts
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createJarvisController } from "./controller.js"
import { FishAudioClient } from "./fish.js"
import { SessionStateStore } from "./state.js"
import { VoiceService } from "./voice.js"

type Actions = Pick<ReturnType<typeof createJarvisController>, "toggle" | "enable" | "disable" | "status">

export function jarvisCommands(actions: Actions) {
  return [
    { name: "jarvis.toggle", title: "Toggle Jarvis", desc: "Toggle Jarvis for this session", slashName: "jarvis", run: actions.toggle },
    { name: "jarvis.enable", title: "Enable Jarvis", desc: "Enable Jarvis for this session", slashName: "jarvis-on", run: actions.enable },
    { name: "jarvis.disable", title: "Disable Jarvis", desc: "Disable Jarvis for this session", slashName: "jarvis-off", run: actions.disable },
    { name: "jarvis.status", title: "Jarvis status", desc: "Show Jarvis state for this session", slashName: "jarvis-status", run: actions.status },
  ].map((command) => ({ namespace: "palette", category: "Jarvis", ...command }))
}

function activeSessionID(api: TuiPluginApi): string | undefined {
  return api.route.current.name === "session" ? api.route.current.params.sessionID : undefined
}

function promptForKey(api: TuiPluginApi): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value?: string) => {
      if (settled) return
      settled = true
      api.ui.dialog.clear()
      resolve(value?.trim() || undefined)
    }
    api.ui.dialog.replace(
      () => api.ui.DialogPrompt({
        title: "Fish Audio API key",
        placeholder: "Enter FISH_API_KEY",
        onConfirm: finish,
        onCancel: () => finish(),
      }),
      () => finish(),
    )
  })
}

export const JarvisTui: TuiPlugin = async (api) => {
  let apiKey = process.env.FISH_API_KEY?.trim() || undefined
  const fish = new FishAudioClient()
  const state = new SessionStateStore(api.state.path.state)
  const toast = (message: string, variant: "info" | "success" | "warning" | "error") =>
    api.ui.toast({ title: "Jarvis", message, variant })
  const report = (error: Error) => {
    toast(error.message, "error")
    void api.client.app.log({ service: "opencode-jarvis", level: "error", message: error.message })
  }
  const voice = new VoiceService({ stateRoot: api.state.path.state, getApiKey: () => apiKey, fish, report })
  const controller = createJarvisController({ state, voice, toast, getSessionID: () => activeSessionID(api) })
  const offCommands = api.keymap.registerLayer({ commands: jarvisCommands(controller) })
  const offIdle = api.event.on("session.idle", (event) => {
    const sessionID = event.properties.sessionID
    void controller
      .sessionIdle(sessionID, api.state.session.messages(sessionID), (messageID) => api.state.part(messageID))
      .catch(report)
  })
  const offPart = api.event.on("message.part.updated", (event) => {
    void controller.partUpdated(event.properties.part).catch(report)
  })

  if (!apiKey) {
    void promptForKey(api).then(async (candidate) => {
      if (!candidate) {
        toast("Speech is unavailable until FISH_API_KEY is configured", "warning")
        return
      }
      if (!(await fish.validateKey(candidate))) {
        toast("Fish Audio rejected that API key", "error")
        return
      }
      apiKey = candidate
      toast("Fish Audio is ready", "success")
    }).catch(report)
  }

  api.lifecycle.onDispose(async () => {
    offCommands()
    offIdle()
    offPart()
    await voice.dispose()
  })
}

export default {
  id: "opencode-jarvis",
  tui: JarvisTui,
} satisfies TuiPluginModule
```

Do not import or call `api.plugins.activate`, `api.plugins.deactivate`, permission APIs, prompt submission APIs, or custom server-command APIs.

- [ ] **Step 4: Run tests, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests PASS, typecheck PASS against 1.18.22, and both package entry points build.

- [ ] **Step 5: Inspect npm publication contents**

Run: `npm pack --dry-run`

Expected: package contains `dist/index.js`, `dist/index.d.ts`, `dist/tui.js`, `dist/tui.d.ts`, `README.md` once added, `LICENSE`, and package metadata; it excludes tests, source, `.claude`, `opencode.json`, and secrets.

- [ ] **Step 6: Commit TUI integration**

```bash
git add src/tui.ts tests/controller.test.ts
git commit -m "feat: wire native jarvis tui controls"
```

### Task 8: Document Installation, Security, And Removal

**Files:**
- Create: `README.md`
- Modify: `package.json` only if `npm pack --dry-run` exposes a metadata issue

- [ ] **Step 1: Write the README**

Create `README.md` with these sections and exact operational details:

```md
# opencode-jarvis

Session-specific Jarvis mode for OpenCode 1.18.22 with Fish Audio speech.

## Requirements

- OpenCode 1.18.22 or newer
- Node/npm for development
- `ffplay` on `PATH`
- Fish Audio API key

## Development

Run `npm install`, then `npm run check`.

## Local Installation

Build with `npm run build`, then add the package directory to the project `opencode.json` without removing existing plugins:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "file:///home/lmbrandon/videoDemos/opencode-jarvis"
  ]
}
```

The example is documentation only; installation does not rewrite local or global OpenCode configuration.

## npm Installation

After publication:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-jarvis"]
}
```

## Fish Audio Key

Prefer launching OpenCode with `FISH_API_KEY` set. If absent, Jarvis prompts at startup and retains a validated key in memory only. OpenCode 1.18.22 does not expose password masking for this prompt, so typed input can be visible.

## Commands

- `/jarvis` toggles the active session.
- `/jarvis-on` enables the active session.
- `/jarvis-off` disables the active session.
- `/jarvis-status` reports the active session state.

OpenCode 1.18.22 native TUI command callbacks do not receive argument text. The hyphenated commands replace `/jarvis on`, `/jarvis off`, and `/jarvis status` so control remains local and does not cause an LLM request.

## Behavior

Jarvis defaults off per session. While enabled, it appends the editable instruction from `src/prompt.ts`, speaks completed assistant replies, plays a cached greeting on enable, and announces skill loading. While disabled, it does not change prompts, tools, permissions, Fish usage, or audio behavior.

Reusable cues are cached under OpenCode state. Ordinary assistant replies use temporary MP3 files that are deleted after playback.

## Manual Smoke Test

1. Start OpenCode in this directory after building.
2. Run `/jarvis-status` and confirm off.
3. Run `/jarvis` and confirm the toast and spoken greeting.
4. Submit a typed prompt and hear the response.
5. Load the same skill twice and confirm the repeated announcement is immediate.
6. Run `/jarvis-off` and confirm later responses are silent.
7. Open another session and confirm it defaults off.

## Uninstall

Remove `file:///home/lmbrandon/videoDemos/opencode-jarvis` or `opencode-jarvis` from the relevant `plugin` array. Optionally remove the `opencode-jarvis` directory under the OpenCode state path to clear mode state and cached cues. Do not remove unrelated OpenCode state.

## Scope

Version 0.1 accepts typed input and produces spoken output. It does not include microphone input, speech-to-text, long-term memory, home automation, or permission automation.
```

- [ ] **Step 2: Verify documentation and package contents**

Run: `npm run check && npm pack --dry-run`

Expected: all checks PASS and the dry-run package includes README and LICENSE with only intended distributable files.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md package.json
git commit -m "docs: add jarvis installation guide"
```

If `package.json` did not change, stage and commit only `README.md`.

### Task 9: Final Verification And Live Smoke Test

**Files:**
- Modify only files required by verified failures

- [ ] **Step 1: Run the complete automated verification from a clean build**

Run: `npm run check`

Expected: typecheck PASS, every test PASS, and both ESM entry points build.

- [ ] **Step 2: Confirm package exports and compatibility metadata**

Run: `node -e "const p=require('./package.json'); console.log(p.exports, p.engines)"`

Expected output includes `.` mapped to `dist/index.*`, `./tui` mapped to `dist/tui.*`, and `opencode: >=1.18.22`.

- [ ] **Step 3: Confirm no secret or permission automation entered the repository**

Run: `rg -n "FISH_API_KEY=|permission\.ask|status: ['\"]allow|auto-approve" src tests README.md package.json`

Expected: only descriptive `FISH_API_KEY` references; no stored key, permission hook, allow override, or auto-approval implementation.

- [ ] **Step 4: Check repository state before live testing**

Run: `git status --short --branch`

Expected: implementation files are committed. Existing user-owned `.claude/` and `opencode.json` may remain untracked and must not be staged, overwritten, or removed.

- [ ] **Step 5: Perform the documented local smoke test with user configuration consent**

Do not edit `opencode.json` automatically. Ask the user to add the documented `file:///home/lmbrandon/videoDemos/opencode-jarvis` entry or obtain explicit permission before editing it. Launch OpenCode with `FISH_API_KEY` available and execute the README smoke-test sequence.

Expected: native commands show toasts without LLM calls, session state is isolated, enabled responses speak, greeting and skill cue cache, disabled responses are unchanged, and no permission behavior changes.

- [ ] **Step 6: Fix only reproduced failures and rerun all verification**

For each failure, write or strengthen a focused automated test first, verify it fails, make the smallest implementation change, and rerun `npm run check` plus the affected smoke-test step.

- [ ] **Step 7: Commit verified fixes if any**

```bash
git add src tests README.md package.json package-lock.json tsconfig.json
git commit -m "fix: resolve jarvis integration failures"
```

Skip this commit when no fixes were required. Never amend earlier commits.

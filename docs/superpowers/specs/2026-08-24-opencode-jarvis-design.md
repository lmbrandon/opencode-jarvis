# OpenCode Jarvis: First Working Version

## Status

Approved design for implementation on 2026-08-24.

## Goal

Build a small TypeScript OpenCode plugin that proves three behaviors on OpenCode 1.18.22:

1. Jarvis mode can be controlled per session through native TUI commands without an LLM request.
2. The server adds a short Jarvis system instruction only while that session has Jarvis enabled.
3. Completed assistant responses are synthesized with Fish Audio and played locally while Jarvis is enabled.

The first version accepts typed prompts and produces spoken output. It does not capture microphone input or perform speech-to-text.

## Environment And Compatibility

- Installed OpenCode version: `1.18.22`.
- SDK types used for development: `@opencode-ai/plugin@1.18.22`.
- Minimum supported OpenCode version: `1.18.22`.
- Runtime module format: TypeScript compiled to ESM.
- Local audio player: `ffplay`, currently available at `/usr/bin/ffplay`.
- Fish model header: `s2.1-pro-free`.
- Fish voice reference: `14129c3e320149449d6bada6862f7338`.
- Fish output format: MP3.

Compatibility with older OpenCode releases will not be claimed or implemented. The package will avoid APIs absent from the installed 1.18.22 type definitions.

## Supported OpenCode APIs

The design relies on the following APIs present in OpenCode 1.18.22:

- TUI plugin `api.keymap.registerLayer` for native command registration.
- TUI plugin `api.route.current` for the active session ID.
- TUI plugin `api.ui.toast` for confirmations and recoverable errors.
- TUI plugin `api.ui.DialogPrompt` and `api.ui.dialog` for optional API-key entry.
- TUI plugin `api.event.on` for session and message/tool events.
- TUI plugin `api.state.session` and `api.state.part` for completed response text.
- TUI plugin `api.lifecycle.onDispose` for cleanup.
- Server plugin `experimental.chat.system.transform` for conditional system instruction injection.
- SDK `client.path.get` and the TUI state path for locating shared runtime state.

OpenCode 1.18.22 defines TUI and server plugins as mutually exclusive module types. It does not expose a direct shared state channel between those plugin runtimes, so the implementation uses two publishable entry points and a small state file.

## Native Command Limitation

The 1.18.22 native TUI command callback does not receive slash-command arguments. Exact commands such as `/jarvis on` cannot be handled locally through the supported callback, and submitting them through OpenCode's server custom-command path may invoke an LLM.

The first version therefore uses these native commands:

- `/jarvis`: toggle the active session.
- `/jarvis-on`: enable the active session.
- `/jarvis-off`: disable the active session.
- `/jarvis-status`: report the active session's state.

All four execute locally and do not initiate an LLM request. The README will document why the hyphenated forms replace the originally requested spaced arguments.

## Architecture

The repository contains two npm packages because OpenCode requires distinct TUI and server plugin modules.

### TUI Controller Package

The root package, `opencode-jarvis`, remains active for the lifetime of the TUI. It owns:

- Native commands and status toasts.
- Fish API-key acquisition and validation.
- Session-mode writes.
- Assistant-response and skill-tool observation.
- Fish TTS requests.
- Reusable cue caching.
- A serialized audio queue and `ffplay` lifecycle.
- Runtime cleanup when the plugin is disposed.

The controller remains loaded when Jarvis is off so users can enable it again.

### Server Engine Package

The companion package, `opencode-jarvis-engine`, owns only conditional prompt injection. On every `experimental.chat.system.transform` call, it reads the current session's state. If enabled, it appends the Jarvis instruction from the dedicated prompt module. If disabled or if no session ID is available, it returns without changing the system array.

The engine does not alter user prompts, tools, tool arguments, permissions, provider parameters, or any other OpenCode behavior.

### Runtime State Bridge

State is stored in an atomic JSON file under OpenCode's state directory, outside the repository and outside `~/.opencode` source directories. The file maps session IDs to enabled booleans. A missing file or missing session entry means disabled.

The TUI controller is the only writer. It writes a temporary file and renames it atomically. The server engine reads fresh state for every prompt transformation so changes become visible without plugin reloads. Invalid or unreadable state fails closed to disabled.

The Fish API key is never written to this state file.

## State Semantics

- Jarvis defaults to off.
- State is keyed by OpenCode session ID.
- Enabling one session does not enable another.
- A resumed session retains its setting because the state file is persistent.
- `/jarvis-off` cancels queued and active speech for that session but does not delete reusable cached audio.
- No command deactivates the controller plugin itself.

## API-Key Handling

At TUI startup, the controller first checks `FISH_API_KEY`.

If the variable is absent, it opens an OpenCode prompt asking for the key. Submitted keys are validated with Fish Audio's authenticated wallet-credit endpoint, which does not synthesize audio. Valid prompted keys remain only in process memory.

The documented OpenCode prompt type does not expose password masking. The README will identify `FISH_API_KEY` as the safer recommended configuration and will warn that fallback prompt input may be visible on screen.

Canceling the prompt, receiving an invalid key, or encountering a validation outage does not prevent OpenCode from loading. Jarvis mode may still supply the conditional system instruction, while speech attempts produce a concise warning toast until a valid key is available.

Keys must never appear in logs, state, cache metadata, errors, README examples, test fixtures, or source control.

## Jarvis Instruction

The short system instruction lives in `src/prompt.ts` so it can be edited independently. It tells the assistant to use a concise, capable Jarvis-like speaking style suitable for audio playback. It must not direct OpenCode to bypass permissions or change tool policy.

The instruction is appended only by `experimental.chat.system.transform` for enabled session IDs.

## Voice Flow

For an enabled session:

1. The user enters a normal typed OpenCode prompt.
2. OpenCode performs its normal model and tool workflow.
3. The TUI controller observes session completion.
4. It finds the newest completed assistant message and gathers its text parts.
5. It skips message IDs already spoken by the current controller process.
6. It sends the text to `POST https://api.fish.audio/v1/tts`.
7. The request uses `Authorization: Bearer <key>`, `Content-Type: application/json`, and model header `s2.1-pro-free`.
8. The JSON body contains the text, Jarvis `reference_id`, and `format: "mp3"`.
9. The returned audio is written to a temporary file, queued, played with `ffplay`, and deleted.

Ordinary assistant replies are not retained in the reusable cache because they are generally unique and may contain conversation content.

## Reusable Audio Cues

Reusable cues are defined separately from runtime logic. Version one includes:

- `general_greeting`, played automatically when a session changes from off to on.
- `skill_loading:<skill-name>`, played when an enabled session starts the existing OpenCode `skill` tool.

A skill announcement uses a short template such as, "Just a second, I'm loading the Superpowers skill." Skill execution never waits for speech generation or playback.

The first use of a cue requests Fish TTS. Later uses play the cached MP3. The deterministic cache key includes:

- Exact rendered cue text.
- Fish model ID.
- Voice reference ID.
- Output format.

Cached files live under an `opencode-jarvis` cache directory within OpenCode's state location. They contain no API key. The first version does not cache arbitrary assistant output and therefore does not need an eviction policy for unbounded conversation text.

The model-callable `jarvis_cue` tool is explicitly excluded from version one. OpenCode 1.18.22 cannot hide a plugin tool per session, so registering it would change the model's tool list while Jarvis was off and violate inert disabled behavior.

## Audio Queue

All generated and cached audio passes through one FIFO playback queue to prevent overlap. Queue items include their session ID.

Disabling a session removes that session's pending items, aborts its in-flight Fish request where possible, and terminates its active `ffplay` process. Other sessions' queue items are unaffected.

Plugin disposal aborts all network activity, stops playback, removes temporary files, and unregisters TUI listeners and commands.

## Disabled Behavior

When Jarvis is off for a session:

- No Jarvis system instruction is appended.
- No Fish API request is made for that session.
- No audio is generated, cached, queued, or played for that session.
- Skill and completion events return without side effects.
- No prompt, tool, tool call, provider setting, or permission is changed.
- Only the always-active controller commands remain available.

## Error Handling

Fish authentication, rate-limit, billing, malformed response, network, filesystem, and player failures are recoverable plugin errors. They produce a concise toast and a structured OpenCode log entry without secrets.

These failures must never reject or cancel the user's OpenCode response, delay or fail a skill, modify a permission result, or crash plugin initialization. State corruption and unknown session IDs fail closed to Jarvis off.

## Proposed Repository Layout

```text
src/
  controller.ts
  state.ts
  prompt.ts
  cues.ts
  fish.ts
  cache.ts
  voice.ts
packages/
  engine/
    src/index.ts
    package.json
tests/
  controller.test.ts
  state.test.ts
  engine.test.ts
  cache.test.ts
  voice.test.ts
docs/superpowers/specs/
  2026-08-24-opencode-jarvis-design.md
README.md
LICENSE
.gitignore
package.json
tsconfig.json
```

The build may add a minimal bundler configuration if needed to produce two standalone ESM package outputs.

## Packaging And Installation

The root is an npm workspace containing two publishable packages:

- `opencode-jarvis` for the TUI plugin.
- `opencode-jarvis-engine` for the server plugin.

Both packages use explicit `exports`, declaration files, and npm `files` allowlists. Package metadata will make the repository suitable for GitHub and npm publication.

Local development configuration will use two absolute `file://` entries pointing to the built controller and engine modules. Production configuration will use both npm package names. The implementation and README will not overwrite or silently modify the existing project or global OpenCode configuration.

## Verification Strategy

The project exposes:

- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run check`, which runs all required verification

Focused automated tests cover:

- Default-off state.
- Session isolation.
- Toggle, explicit on, explicit off, and status controller actions.
- Conditional system instruction injection.
- No output mutation while disabled.
- Atomic state behavior and corrupt-state fail-closed behavior.
- Deterministic cue cache keys.
- Cache hits avoiding Fish requests.
- Ordinary responses bypassing the reusable cache.
- General greeting and normalized skill-announcement text.
- Assistant-message deduplication.
- FIFO playback ordering and per-session cancellation.
- Fish and player failures resolving without breaking OpenCode operations.

Fish network calls and audio-player processes are mocked in tests. No test uses a real API key or incurs Fish usage.

A README smoke-test checklist covers behavior that requires a live OpenCode TUI:

1. Start OpenCode with both local plugin entries.
2. Supply `FISH_API_KEY` or complete the startup prompt.
3. Run `/jarvis-status` and confirm off.
4. Run `/jarvis` and confirm the toast and greeting.
5. Send a typed prompt and hear the assistant response.
6. Trigger a skill twice and confirm the second announcement uses cached audio.
7. Run `/jarvis-off`, send another prompt, and confirm no prompt injection or audio behavior.
8. Open another session and confirm it defaults to off.

## Out Of Scope

- Microphone capture or speech-to-text.
- Long-term conversational memory.
- Voice cloning or voice selection UI.
- Arbitrary model-callable speech or cue tools.
- External services other than Fish Audio.
- Home automation.
- Permission bypasses or automatic approvals.
- Compatibility shims for OpenCode versions older than 1.18.22.

## Acceptance Criteria

The first version is complete when:

- Both plugin packages build and load on OpenCode 1.18.22.
- Native Jarvis commands work without an LLM request.
- State is session-specific and defaults off.
- Disabled sessions experience no prompt, tool, permission, Fish, or audio changes.
- Enabled sessions receive the short Jarvis instruction and spoken assistant output.
- General greeting and skill announcements are cached and replayed.
- API keys are never persisted by the plugin.
- Build, typecheck, and focused tests pass.
- README installation and uninstall steps are sufficient to reproduce and remove the integration without editing OpenCode's executable or placing plugin source in `~/.opencode`.

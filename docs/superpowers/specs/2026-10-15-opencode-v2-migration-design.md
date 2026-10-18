# OpenCode 2 Migration Design

## Summary

Migrate `opencode-jarvis` from the OpenCode 1 plugin ABI to a native OpenCode 2 plugin. The migrated package will support OpenCode 2 only. It will not retain OpenCode 1 entrypoints, dependencies, configuration, state handling, or tests.

The migration preserves the user-visible Jarvis behavior: session-scoped enablement, conditional system instructions, native commands, spoken assistant replies, skill activation cues, Fish Audio validation, sanitized errors, queued playback, and reusable cue caching.

## Goals

- Load the server and terminal plugins through the native OpenCode 2 plugin ABI.
- Keep Jarvis mode scoped to a session and visible to both server and terminal runtimes.
- Work when the terminal client connects to a remote OpenCode server.
- Preserve the existing speech, queueing, cancellation, sanitization, and Fish Audio behavior.
- Package and document one clear OpenCode 2 installation path.
- Verify source behavior, built artifacts, packed-package contents, and an installed OpenCode 2 integration.

## Non-Goals

- Supporting OpenCode 1 after this migration.
- Migrating OpenCode 1 session enablement into OpenCode 2 storage. Upgrading intentionally resets existing sessions to disabled once; subsequent OpenCode 2 mode changes persist normally.
- Migrating previously cached MP3 files into the new terminal-local cache.
- Changing the Jarvis persona or the existing `src/prompt.ts` worktree change.
- Replacing Fish Audio or the local `ffplay` playback strategy.

## Current Incompatibilities

The current package cannot run under OpenCode 2 because it uses the OpenCode 1 implementation contracts:

- `src/index.ts` exports a `{ server }` plugin module instead of `Plugin.define({ id, setup })`.
- `src/engine.ts` uses `client.path.get()` and returns `experimental.chat.system.transform`.
- `src/tui.ts` uses the OpenCode 1 TUI module, route, toast, dialog, keymap, event, state, and lifecycle APIs.
- `src/controller.ts` consumes OpenCode 1 SDK `Message` and `Part` types and reconstructs skill activation from tool parts.
- `SessionStateStore` assumes both runtimes share the same local filesystem.
- `package.json` depends on `@opencode-ai/plugin` and `@opencode-ai/sdk` and advertises OpenCode 1 compatibility.
- `opencode.json`, `tui.json`, README examples, and package tests encode the OpenCode 1 configuration model.

## Architecture

The package will expose native OpenCode 2 server and terminal entrypoints:

- The root export is a server plugin created with `Plugin.define` from `@opencode/plugin`.
- The `./tui` export is a terminal plugin created with `Plugin.define` from `@opencode/plugin/tui`.
- The `./rpc` export contains a shared `Rpc.define` contract imported by both entrypoints.
- The obsolete `./server` compatibility export is removed.

The stable IDs are `opencode-jarvis` for the server plugin and RPC contract, and `opencode-jarvis.tui` for the terminal plugin.

Runtime-specific OpenCode integration remains at the package edges. Speech sanitization, Fish Audio calls, voice queueing, cue caching, cancellation rules, and controller policies remain ordinary TypeScript modules without OpenCode host dependencies where practical.

## Server Plugin

The server plugin owns session mode state because it is authoritative for prompt construction and is available when the terminal connects to a remote server.

During setup, it will:

1. Register a `context` session hook.
2. Register `status`, `set`, and `toggle` RPC operations from the shared `./rpc` contract.
3. Store mode values in plugin-scoped OpenCode 2 storage.

The context hook reads the session's stored mode. When enabled, it appends the Jarvis instruction as a structured system text part. Missing session IDs, missing state, and storage failures all fail closed without modifying the model request.

Each RPC accepts a session ID, `set` also accepts the requested boolean value, and every RPC returns the confirmed enabled state. Calls include the session's OpenCode location so they reach the plugin instance that owns that session. Storage failures use a declared RPC error. The contract does not expose Fish credentials, audio, or terminal-local data.

The server serializes state mutations per session. This preserves deterministic ordering for concurrent `set` and `toggle` calls even though plugin storage does not provide an atomic read-modify-write operation.

## Terminal Plugin

The terminal plugin owns user interaction, Fish credentials, audio generation, caching, and playback.

During setup, it will:

1. Read `FISH_API_KEY`, or request and validate a key through the OpenCode 2 prompt API.
2. Register Jarvis commands through the OpenCode 2 keymap layer API.
3. Resolve the active session and its location through the OpenCode 2 router and session data APIs.
4. Invoke server RPC for mode status, set, and toggle operations with that location.
5. Subscribe to successful session execution and skill activation events.
6. Return cleanup that aborts startup work, stops subscriptions, cancels playback, and disposes child processes.

Command feedback is based on the server-confirmed state. The terminal must not optimistically report a mode change before RPC succeeds.

## Event And Speech Flow

For completed assistant replies:

1. The terminal receives a successful session execution event and uses its location for subsequent data access and RPC calls.
2. It resolves the corresponding OpenCode 2 session message data.
3. It selects the latest successful assistant message and gathers its text content entries.
4. It strips Markdown and code through the existing speech sanitizer.
5. It checks the server-owned mode and queues the reply once per assistant message ID.

For skill cues:

1. The terminal consumes `session.skill.activated` directly and uses the event location for its state RPC call.
2. It checks the server-owned mode.
3. It queues one cue per unique event-envelope ID.

The adapter preserves the existing mode-epoch behavior so an asynchronous state check cannot speak stale audio after a user disables Jarvis. Message IDs and event-envelope IDs suppress duplicate delivery while allowing separate activations of the same skill to produce separate cues.

## State And Cache Locations

Session mode is stored by the server plugin through OpenCode 2 plugin storage. This replaces `SessionStateStore`, its lock file, and the shared filesystem bridge.

Audio remains terminal-local. Reusable cue files use an XDG-style cache location:

- `$XDG_CACHE_HOME/opencode-jarvis` when `XDG_CACHE_HOME` is set.
- `%LOCALAPPDATA%/opencode-jarvis` on Windows when `XDG_CACHE_HOME` is not set.
- `~/.cache/opencode-jarvis` on other platforms when `XDG_CACHE_HOME` is not set.

Uncached assistant replies continue streaming directly to playback. Fish API keys remain in terminal process memory and are never written to plugin storage or the audio cache.

## Error Handling And Security

- Server storage failures fail closed and omit the Jarvis system instruction.
- RPC failures show a sanitized terminal error and leave reported state unchanged.
- Fish validation, synthesis, and playback failures remain recoverable and do not interrupt OpenCode.
- Error text removes control characters and redacts known secrets before display or logging.
- Cleanup is idempotent and awaits owned startup and playback work.
- Event loops and async subscriptions use cancellation signals so plugin unload does not leave background work running.
- No API key, generated audio, or sensitive response body is sent through server RPC.

## Configuration And Packaging

Installed usage configures the published package name, which can be resolved independently by local or remote server and terminal hosts:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-jarvis"]
}
```

The terminal discovers the package's `./tui` export. Project `tui.json` configuration is removed from the supported setup. A `file://` entry remains acceptable for same-machine development only; remote verification installs the packed package on distinct server and terminal filesystems and uses the package target rather than a shared absolute path.

`package.json` will:

- Target OpenCode 2 in `engines.opencode`.
- Depend on `@opencode/plugin`; use its `/tui` and `/rpc` exports for the terminal plugin and shared RPC contract.
- Remove direct OpenTUI dependencies unless migrated source code imports OpenTUI APIs directly.
- Export the root plugin, `./tui`, and typed `./rpc`.
- Build all published entrypoints and declarations into `dist`.
- Verify package contents with `npm pack --dry-run --json`.

## Source Changes

The migration will:

- Replace `src/index.ts` with the OpenCode 2 server entrypoint.
- Replace the OpenCode 1 engine hook with OpenCode 2 context-hook and storage/RPC code.
- Port `src/tui.ts` to OpenCode 2 terminal APIs.
- Adapt `src/controller.ts` to normalized OpenCode 2 assistant and skill events.
- Add a shared RPC contract module using `Rpc.define`.
- Replace the state-file module and tests with server-storage behavior.
- Update cache path resolution without changing cache-key semantics.
- Update package metadata, lockfile, local configuration, README, and handoff documentation.
- Rebuild `dist` from the migrated sources.

Historical design and plan files remain historical records. The new migration spec supersedes their OpenCode 1 integration guidance without rewriting their original decisions.

## Testing Strategy

Implementation follows test-driven development. Tests will be updated or added before each production change.

Unit and contract coverage will include:

- Server setup and `context` hook registration.
- Disabled, enabled, missing-session, and storage-failure prompt behavior.
- RPC status, set, and toggle behavior with persisted server state.
- Deterministic results for concurrent state mutations on one session.
- OpenCode 2 command definitions, route handling, dialogs, toasts, and cleanup.
- OpenCode 2 assistant message extraction and successful-execution handling.
- Direct skill activation handling, including duplicate delivery of one event and distinct activations of the same skill.
- Message, activation, and mode-epoch deduplication.
- Remote-safe state behavior with no shared filesystem assumption.
- XDG cache path resolution and existing cache concurrency behavior.
- Secret redaction and recoverable error paths.
- Published export and declaration shapes.

Repository verification will run, in order:

1. Clean dependency installation.
2. Type checking.
3. Unit and contract tests.
4. Production build.
5. Built-entrypoint import tests.
6. Package-content inspection with `npm pack --dry-run --json`.
7. An isolated OpenCode 2 smoke test that installs the packed artifact on distinct server and terminal filesystems and verifies plugin loading, terminal discovery, location-routed RPC state changes, command registration, prompt injection, event handling, and cleanup.

CI will pin the supported Node and OpenCode 2 versions so dependency drift cannot silently change the plugin ABI.

## Success Criteria

- OpenCode 2 loads both package entrypoints without compatibility warnings or runtime errors.
- Jarvis mode changes are session-scoped and observed by the server context hook.
- The mode flow works with a remote server and does not depend on a shared filesystem.
- Upgrading from OpenCode 1 resets prior session modes to disabled once, and OpenCode 2 mode changes persist afterward.
- Enabled sessions receive the Jarvis system instruction; disabled sessions do not.
- Successful assistant replies produce one spoken reply and skill activations produce one matching cue while enabled.
- Disabling Jarvis cancels pending session audio and prevents stale asynchronous speech.
- Fish credentials remain local and redacted from failures.
- Typecheck, tests, build, package verification, and the OpenCode 2 smoke test pass from a clean checkout.
- README installation and removal instructions describe only the native OpenCode 2 workflow.

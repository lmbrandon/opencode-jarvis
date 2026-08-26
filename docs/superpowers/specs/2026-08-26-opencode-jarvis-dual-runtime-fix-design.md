# OpenCode Jarvis Dual-Runtime Loading Fix

## Problem

The local package is listed only in the project `opencode.json`, and its
manifest exports the server module at `.` rather than `./server`. OpenCode
1.18.23 reads server plugin declarations from `opencode.json` and TUI plugin
declarations from a separate `tui.json`. Its package loader resolves only the
target-specific `./server` or `./tui` export when an `exports` map exists.

Consequently, the configured package appears in resolved server configuration,
but the TUI runtime never receives a plugin declaration and the Jarvis commands
are absent. The missing `./server` export also means the server prompt transform
is not reliably loaded through the v1 package entrypoint contract.

## Evidence

- `opencode debug config` resolves the local package from `opencode.json`.
- No project or global `tui.json` currently declares the package.
- OpenCode 1.18.23's `tui-plugins.md` states that TUI plugin config lives in
  `tui.json` and package entrypoints are `./server` and `./tui`.
- OpenCode's `plugin-loader-entrypoint.test.ts` explicitly verifies that the TUI
  loader does not fall back to `exports["."]`.
- The installed `@opencode-ai/plugin` types define target-exclusive server and
  TUI modules.

## Chosen Approach

Use the canonical dual-runtime package shape and configure the same package URI
in each runtime's own config.

The package manifest will expose:

- `.` for direct package consumers, mapped to the existing server build.
- `./server` for OpenCode's server plugin runtime, mapped to the existing
  `dist/index.js` and `dist/index.d.ts`.
- `./tui` for OpenCode's TUI plugin runtime, mapped to `dist/tui.js` and
  `dist/tui.d.ts`.

The user's existing `opencode.json` remains unchanged. A root `tui.json` will
declare the same local package URI:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///home/lmbrandon/videoDemos/opencode-jarvis"]
}
```

Like the existing root `opencode.json`, the root `tui.json` is user-owned local
runtime configuration. It will remain untracked and outside npm package
contents.

## Compatibility

The implementation continues to target OpenCode 1.18.22 or newer. The corrected
entrypoint and configuration shape follows the v1 dual-runtime contract in both
OpenCode 1.18.22 and the installed 1.18.23. Keeping `.` avoids breaking direct
imports while adding the canonical `./server` entrypoint required by OpenCode.

The server and TUI modules remain separate and target-exclusive. No module will
export both a server and TUI plugin object.

## Documentation

The README will describe both required manual configuration files:

- `opencode.json` registers the package for server hooks.
- `tui.json` registers the package for native commands, events, dialogs, and
  playback integration.

The npm installation example will likewise show the package in both files. The
documentation will continue to preserve unrelated plugin entries and warn that
configuration is loaded only at process startup.

## Testing

Automated regression coverage will verify:

- `package.json` exposes `.` plus canonical `./server` and `./tui` targets.
- Every export maps to an existing build artifact after `npm run build`.
- The local server and TUI config examples use their correct schemas and contain
  the same package URI.
- `npm run check` remains green.
- `npm pack --dry-run` includes only the intended README, license, metadata, and
  build artifacts, excluding local config files.

The live smoke test will restart OpenCode, confirm `opencode-jarvis` is active in
the Plugins view, and then verify `/jarvis-status`, `/jarvis-on`, spoken output,
and `/jarvis-off`.

## Non-Goals

- Do not combine the server and TUI modules into one export object.
- Do not use direct `dist/*.js` paths as the documented installation method.
- Do not replace or remove the existing Superpowers server plugin entry.
- Do not persist the Fish Audio key in either configuration file.

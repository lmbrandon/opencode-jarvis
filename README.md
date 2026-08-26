# opencode-jarvis

Session-specific Jarvis mode for OpenCode 1.18.22 with Fish Audio speech.

## Requirements

- OpenCode 1.18.22 or newer
- Node.js and npm for development
- `ffplay` available on `PATH`
- A Fish Audio API key

## Development

```sh
npm install
npm run check
```

## Local Installation

Build the package:

```sh
npm run build
```

Then add the package directory to the project's `opencode.json` plugin array without removing any existing plugins:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "file:///home/lmbrandon/videoDemos/opencode-jarvis"
  ]
}
```

This example is documentation only. Installing or running `opencode-jarvis` does not rewrite OpenCode configuration.

## npm Installation

After the package is published, preserve existing plugins and add `opencode-jarvis` to the relevant `opencode.json` plugin array:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "opencode-jarvis"
  ]
}
```

## Fish Audio Key

Set `FISH_API_KEY` in the environment when possible. If it is absent, the plugin prompts at startup, validates the entered key, and retains a valid key in memory only for the running OpenCode process.

OpenCode 1.18.22 does not password-mask this prompt, so typed input can be visible. Prefer the environment variable, especially when screen sharing or working in a public space. Never store a key in `opencode.json`.

## Commands

- `/jarvis`: toggle Jarvis mode for the current session.
- `/jarvis-on`: enable Jarvis mode for the current session.
- `/jarvis-off`: disable Jarvis mode for the current session.
- `/jarvis-status`: show whether Jarvis mode is enabled for the current session.

OpenCode 1.18.22 native command callbacks do not receive arguments. The hyphenated commands therefore replace `/jarvis on`, `/jarvis off`, and `/jarvis status`. These commands remain local and do not cause an LLM request.

## Behavior

Jarvis mode defaults to off for each session. While enabled, it:

- Appends the editable instruction from `src/prompt.ts` to the session system prompt.
- Speaks completed assistant replies.
- Speaks a cached greeting when enabled.
- Announces skill loading, with repeated cues served from the audio cache.

While disabled, it does not change prompt, tool, permission, Fish Audio, or audio behavior. The controller stays loaded so Jarvis mode can be re-enabled.

Reusable cues are cached under the OpenCode state directory. Assistant replies use unique temporary MP3 files that are removed after playback. Version 0.1 accepts typed input and produces spoken output only.

## Security and Permissions

- The plugin has no microphone or speech-to-text access.
- It does not install a permission hook, bypass permissions, or automatically approve actions.
- A key entered at the startup prompt is retained in memory only after validation.
- Because OpenCode 1.18.22 can display prompt input, using `FISH_API_KEY` is recommended.

## Manual Smoke Test

1. Build the package with `npm run build`, configure the local plugin URI, and start OpenCode with `FISH_API_KEY` set.
2. Run `/jarvis-status` in a session and confirm it reports off.
3. Run `/jarvis-on` and confirm the enabled toast and greeting.
4. Send a typed prompt and confirm the completed assistant reply is spoken.
5. Trigger the same skill-loading cue more than once and confirm the repeated cue starts immediately from the cache.
6. Run `/jarvis-off`, send another prompt, and confirm the later response is silent.
7. Open a second session and confirm Jarvis defaults to off there.
8. Confirm mode commands cause no LLM request and permission behavior remains unchanged.

## Uninstall

Remove only `file:///home/lmbrandon/videoDemos/opencode-jarvis` or `opencode-jarvis` from the relevant `opencode.json` plugin array. Preserve every unrelated plugin entry.

Optionally remove only the `opencode-jarvis` subdirectory from the OpenCode state directory to delete mode state and cached audio. Do not remove unrelated OpenCode state.

## Scope

Version 0.1 provides typed input and spoken output. It excludes microphone input, speech-to-text, long-term memory, home automation, and permission automation.

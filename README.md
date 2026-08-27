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

OpenCode loads server and TUI plugins from separate configuration files. Add the package directory to both files without removing unrelated plugins.

Use the absolute `file://` URI of your clone. Substitute your own checkout path for `/absolute/path/to/opencode-jarvis` below.

Register the server module in the project `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "file:///absolute/path/to/opencode-jarvis"
  ]
}
```

Register the native commands and speech integration in the project `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///absolute/path/to/opencode-jarvis"]
}
```

OpenCode plugin entries require an absolute `file://` URI, so this value is specific to each checkout and machine. `opencode.json` and `tui.json` are git-ignored for that reason; create them locally from the snippets above. Installing or running `opencode-jarvis` does not rewrite OpenCode configuration. Quit and restart OpenCode after changing either config file.

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

## Fish Audio Key

Set `FISH_API_KEY` in the environment when possible. If it is absent, the plugin prompts at startup, validates the entered key, and retains a valid key in memory only for the running OpenCode process.

OpenCode 1.18.22 does not password-mask this prompt, so typed input can be visible. Prefer the environment variable, especially when screen sharing or working in a public space. Never store a key in either `opencode.json` or `tui.json`.

Fish Audio is a remote service. While Jarvis is enabled, the plugin sends the complete text of assistant replies and reusable cue text to Fish Audio for speech synthesis. Skill-loading cue text includes the skill name. Fish Audio's privacy and retention terms apply to this content. The plugin also sends the API key to Fish Audio when validating a prompted key and authenticating synthesis requests.

## Commands

- `/jarvis`: toggle Jarvis mode for the current session.
- `/jarvis-on`: enable Jarvis mode for the current session.
- `/jarvis-off`: disable Jarvis mode for the current session.
- `/jarvis-status`: show whether Jarvis mode is enabled for the current session.

OpenCode 1.18.22 native command callbacks do not receive arguments. The hyphenated commands therefore replace `/jarvis on`, `/jarvis off`, and `/jarvis status`. These commands remain local and do not cause an LLM request.

## Behavior

New sessions default to off. Jarvis mode is persisted by OpenCode session ID, so reopening or resuming an enabled session leaves it enabled until it is turned off. A resumed enabled session can therefore send reply and skill-loading cue text to Fish Audio and play the resulting speech.

While enabled, Jarvis:

- Appends the instruction from `src/prompt.ts` to the session system prompt.
- Speaks completed assistant replies, stripping fenced code blocks, inline code spans, and markdown formatting (bold, italic, headings, list bullets) first, so replies read as plain prose rather than raw markdown.
- Speaks a cached greeting when enabled.
- Announces skill loading, with repeated cues served from the audio cache.

`src/prompt.ts` is editable in a source checkout for development builds. The npm package does not include source files, so npm consumers who want to customize this instruction must use a source checkout and rebuild.

`src/prompt.ts` also invites the model to add Fish Audio emotion tags (e.g. `[excited]`, `[chuckle]`) in square brackets for more expressive delivery. This is experimental: the tags are sent to Fish Audio as part of the reply text, unstripped, and only their effect on delivery is being evaluated.

Disabled sessions do not inject prompts, synthesize, play, or cache speech, or alter tool and permission behavior. However, if `FISH_API_KEY` is absent, the TUI performs startup key acquisition and validation independently of per-session mode so Jarvis can later be enabled. The controller remains loaded so Jarvis mode can be re-enabled.

Reusable cues are cached under the OpenCode state directory. Assistant replies use unique temporary MP3 files that are removed after playback. Version 0.1 accepts typed input and produces spoken output only.

## Security and Permissions

- The plugin has no microphone or speech-to-text access.
- It does not install a permission hook, bypass permissions, or automatically approve actions.
- A key entered at the startup prompt is retained in memory only after validation.
- Because OpenCode 1.18.22 can display prompt input, using `FISH_API_KEY` is recommended.
- Reply and cue text sent for synthesis is subject to Fish Audio's privacy and retention terms.

## Manual Smoke Test

1. Build the package with `npm run build`, configure your checkout's `file://` plugin URI in both `opencode.json` and `tui.json`, and start OpenCode with `FISH_API_KEY` set.
2. Run `/jarvis-status` in a session and confirm it reports off.
3. Run `/jarvis-on` and confirm the enabled toast and greeting.
4. Send a typed prompt and confirm the completed assistant reply is spoken.
5. Trigger the same skill-loading cue more than once. After earlier queued audio finishes, the repeated cue should reuse the cache and avoid another Fish Audio synthesis request.
6. Run `/jarvis-off`, send another prompt, and confirm the later response is silent.
7. Open a second session and confirm Jarvis defaults to off there.
8. Confirm mode commands cause no LLM request and permission behavior remains unchanged.

## Uninstall

Remove only the exact local `file://` URI or `opencode-jarvis` npm entry that you added to the relevant `opencode.json` and `tui.json` plugin arrays. Preserve every unrelated plugin entry.

Exit all OpenCode processes using the plugin before deleting its state. Then, to delete persisted mode state and cached audio, optionally remove only the `opencode-jarvis` subdirectory from the OpenCode state directory. Do not remove unrelated OpenCode state.

## Scope

Version 0.1 provides typed input and spoken output. It excludes microphone input, speech-to-text, long-term memory, home automation, and permission automation.

# opencode-jarvis

Session-specific Jarvis mode for OpenCode 2 with Fish Audio speech.

## Requirements

- OpenCode 2
- `ffplay` available on the terminal host's `PATH`
- A Fish Audio API key
- Node.js and npm for source development

## Install from npm

Add the published package to the `plugins` array in `opencode.json` without removing unrelated plugins:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-jarvis"]
}
```

The package root provides the server plugin, and its `./tui` export is discovered automatically for commands and speech. Restart OpenCode after changing the configuration.

## Local development installation

Install dependencies and build the package:

```sh
npm install
npm run build
```

Then add the checkout's absolute `file://` URI to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["file:///absolute/path/to/opencode-jarvis"]
}
```

This local-path form is for a same-machine server and terminal. When the terminal connects to a remote OpenCode server, use the published package name and make the package available on both hosts; an absolute path from one host is not shared with the other.

## Fish Audio key

Jarvis looks for your key at startup in this order:

1. `FISH_API_KEY` in the terminal process environment.
2. `FISH_API_KEY` in `.env` in the local folder where you launched OpenCode.
3. The Fish Audio key dialog if neither source provides a nonblank key.

For example, create a local `.env` containing:

```dotenv
FISH_API_KEY=your-fish-api-key
```

Keep that file out of Git. Jarvis reads only this key, does not load unrelated
variables into the process environment, and does not execute shell expressions
or search parent folders. With a remote server, `.env` is read on the terminal
host, not the server. Missing or unreadable files fall back to the dialog.

Keys from the environment or `.env` are used directly; keys pasted into the
dialog are validated with Fish Audio first. Pasted keys stay in memory and are
never saved back to `.env`. Restart or reload the plugin after editing `.env`.

Fish Audio is a remote service. While Jarvis is enabled, complete assistant replies and reusable cue text, including skill names, are sent to Fish Audio for speech synthesis. Fish Audio's privacy and retention terms apply. The API key is sent only to Fish Audio for validation and synthesis; it is not stored in server plugin state or the audio cache.

## Commands

- `/jarvis`: toggle Jarvis mode for the current session.
- `/jarvis-on`: enable Jarvis mode for the current session.
- `/jarvis-off`: disable Jarvis mode for the current session.
- `/jarvis-status`: show whether Jarvis mode is enabled for the current session.

The commands run locally through the terminal plugin and do not cause a model request.

## Behavior

New sessions default to off. OpenCode 2 stores mode per session through server plugin storage, so the state works with remote terminal connections and persists when a session is reopened. State from an earlier OpenCode installation is intentionally not migrated: after upgrading, existing sessions start disabled once and then persist subsequent OpenCode 2 changes normally.

While enabled, Jarvis:

- Appends the instruction from `src/prompt.ts` to model context.
- Speaks each completed assistant reply once after removing code and Markdown formatting.
- Speaks a greeting when enabled.
- Announces each skill activation, with reusable cues served from the audio cache.

Disabling Jarvis cancels queued audio for that session and prevents stale asynchronous work from speaking. Disabled sessions do not inject the Jarvis instruction, synthesize speech, play audio, or cache new cues. The plugin does not change OpenCode permissions or approve actions.

Version 0.1 accepts typed input and produces spoken output only; it has no microphone or speech-to-text access.

## Cache locations

Assistant replies stream directly to playback and are not written to disk. Reusable cue audio is stored on the terminal host under:

- `$XDG_CACHE_HOME/opencode-jarvis` when `XDG_CACHE_HOME` is set;
- `%LOCALAPPDATA%\opencode-jarvis` on Windows otherwise;
- `~/.cache/opencode-jarvis` on other platforms otherwise.

## Development and verification

### Dependency security

Use `npm ci` to install the reviewed lockfile, and run `npm run audit:security`
to fail on high or critical dependency advisories. The OpenTUI integration pins
Solid, so this repository overrides its transitive Seroval dependency to the
patched `^1.6.11` release line. Vitest is on the patched 4.1 release line.

Keep Fish credentials in the environment, never in committed configuration.
`.env` variants and `.npmrc` are ignored; `.env.example` may be committed only
with placeholders.

Run the complete source, build, test, and package checks:

```sh
npm run check
```

To verify an installed packed artifact:

```sh
npm pack --json
npm run smoke:v2 -- ./opencode-jarvis-0.1.0.tgz
```

## Manual smoke test

1. Build and configure the plugin, then start OpenCode with `FISH_API_KEY` set.
2. Run `/jarvis-status` in a session and confirm it reports off.
3. Run `/jarvis-on` and confirm the enabled toast and greeting.
4. Send a prompt and confirm the completed assistant reply is spoken once.
5. Trigger the same skill more than once and confirm each activation is announced.
6. Run `/jarvis-off`, send another prompt, and confirm the later response is silent.
7. Open a second session and confirm Jarvis defaults to off there.

## Uninstall

Remove only the exact `opencode-jarvis` or local `file://` entry from the `plugins` array in `opencode.json`, preserving unrelated entries, and restart OpenCode. OpenCode owns the server-side plugin storage. To remove cached cue audio, delete only the terminal host's `opencode-jarvis` cache directory listed above.

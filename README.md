# opencode-jarvis

**Hear your OpenCode replies with a Jarvis-style voice companion.**

Jarvis adds spoken replies and skill announcements to the OpenCode 2 terminal.
Turn it on for one session and keep your other sessions quiet.

- **Listen to completed replies.** Fish Audio reads the response after code and Markdown formatting are removed.
- **Hear skills activate.** Spoken cues announce which skill OpenCode is using.
- **Stay in control.** Enable or mute Jarvis with a slash command. Your choice is saved per session.

Typed input, spoken output. Jarvis does not use your microphone or accept voice commands.

## Requirements

- [OpenCode 2](https://opencode.ai/v2/docs/)
- `ffplay` from [FFmpeg](https://ffmpeg.org/download.html), available on the terminal host's `PATH`
- A [Fish Audio](https://fish.audio/?fpr=awzeir) API key and network access to Fish Audio

## Quick start

### 1. Install from GitHub

Add the Git URL to the `plugins` array in **your project's `opencode.json`**.
Keep any plugins you already use, including Superpowers:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["git+https://github.com/lmbrandon/opencode-jarvis.git"]
}
```

OpenCode installs Jarvis from [this repository](https://github.com/lmbrandon/opencode-jarvis),
using the same Git-based plugin mechanism as Superpowers. Superpowers is optional.
You do not need to clone this repo, supply a local path, or run a build.

For all your projects, add the same entry to `~/.config/opencode/opencode.json`
(or `$XDG_CONFIG_HOME/opencode/opencode.json`) instead. You can also install globally with:

```sh
opencode plugin add git+https://github.com/lmbrandon/opencode-jarvis.git
```

Restart OpenCode after installation. Jarvis includes both the server plugin and
the terminal plugin; you do not need a separate TUI entry.

### 2. Add your Fish Audio key

Sign up for [Fish Audio through our affiliate link](https://fish.audio/?fpr=awzeir),
then create an API key in your Fish Audio account. We may earn a commission if
you purchase through this link.

Create a `.env` in the folder where you launch OpenCode:

```dotenv
FISH_API_KEY=your-fish-api-key
```

Keep `.env` out of Git. You can also set `FISH_API_KEY` in your terminal environment
or paste it into the Fish Audio dialog when Jarvis starts. See [key handling](#fish-audio-key) below.

### 3. Turn Jarvis on

Run `/jarvis-on` in an OpenCode session, then send a prompt. Jarvis greets you
and speaks the completed reply. Run `/jarvis-off` to stop speech for that session.

New sessions start with Jarvis off. Fish Audio is a separate service; its usage
limits and pricing apply.

## Fish Audio key

Jarvis looks for your key at startup in this order:

1. `FISH_API_KEY` in the terminal process environment.
2. `FISH_API_KEY` in `.env` in the local folder where you launched OpenCode.
3. The Fish Audio key dialog if neither source provides a nonblank key.

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

OpenCode 2 stores Jarvis mode per session, so your choice persists when you reopen
a session and works with remote terminal connections. Audio plays on the terminal
host. When upgrading from the older plugin, existing sessions start disabled once.

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

### Local development installation

For contributors who want to run a checkout instead of the GitHub version:

```sh
git clone https://github.com/lmbrandon/opencode-jarvis.git
cd opencode-jarvis
npm ci
npm run build
```

Then add your checkout's absolute `file://` URI to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["file:///absolute/path/to/opencode-jarvis"]
}
```

Use only one Jarvis entry: the Git URL or the local path. Local paths are for a
same-machine server and terminal; they are not shared with a remote host.

The built `dist/` files are committed because OpenCode installs Git packages with
build scripts disabled. After changing source, run `npm run check` and include
the rebuilt `dist/` files in the same commit. Node.js and npm are needed for development.

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

Remove only the Jarvis Git URL (or your development `file://` entry) from the
`plugins` array in the config where you added it. Preserve unrelated plugins and
restart OpenCode. OpenCode owns the server-side plugin storage. To remove cached
cue audio, delete only the terminal host's `opencode-jarvis` cache directory listed above.

## License

[MIT](LICENSE)

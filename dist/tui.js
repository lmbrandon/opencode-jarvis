import {
  JarvisRpc
} from "./chunk-LOXVGK3I.js";

// src/tui.ts
import { homedir } from "os";
import { Plugin } from "@opencode/plugin/tui";

// src/api-key.ts
import { readFile } from "fs/promises";
import { join } from "path";
import { parseEnv } from "util";
async function resolveFishApiKey(env, directory) {
  const environmentKey = env.FISH_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  try {
    const contents = await readFile(join(directory, ".env"), "utf8");
    return parseEnv(contents).FISH_API_KEY?.trim() || void 0;
  } catch {
    return void 0;
  }
}

// src/cache-path.ts
import { posix, win32 } from "path";
function resolveCacheDirectory({
  env,
  platform,
  home
}) {
  const paths = platform === "win32" ? win32 : posix;
  const root = env.XDG_CACHE_HOME || (platform === "win32" ? env.LOCALAPPDATA : void 0) || paths.join(home, ".cache");
  return paths.join(root, "opencode-jarvis");
}

// src/cues.ts
var GENERAL_GREETING = "Good day. Jarvis is online and ready.";
function skillLoadingCue(skill) {
  const displayName = skill.trim().split(/[-_\s]+/).filter(Boolean).map(
    (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
  ).join(" ");
  return `Just a second, I'm loading the ${displayName} skill.`;
}

// src/speech-text.ts
var FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
var UNTERMINATED_FENCE = /```[\s\S]*$/;
var HEADING_MARKER = /^#{1,6}[ \t]+/gm;
var LIST_BULLET_MARKER = /^[ \t]*[-*+][ \t]+/gm;
var BOLD_MARKDOWN = /\*\*([^\n]+?)\*\*/g;
var ITALIC_MARKDOWN = /\*([^\n*]+?)\*/g;
var INLINE_CODE_SPAN = /`([^`\n]+)`/g;
var EXCESS_BLANK_LINES = /\n{3,}/g;
function stripMarkdownForSpeech(text) {
  return text.replace(FENCED_CODE_BLOCK, "").replace(UNTERMINATED_FENCE, "").replace(HEADING_MARKER, "").replace(LIST_BULLET_MARKER, "").replace(BOLD_MARKDOWN, "$1").replace(ITALIC_MARKDOWN, "$1").replace(INLINE_CODE_SPAN, "$1").replace(EXCESS_BLANK_LINES, "\n\n").trim();
}

// src/controller.ts
function createJarvisController(input) {
  const spokenMessageIDs = /* @__PURE__ */ new Set();
  const announcedEventIDs = /* @__PURE__ */ new Set();
  const modeEpochs = /* @__PURE__ */ new Map();
  function modeEpoch(sessionID) {
    return modeEpochs.get(sessionID) ?? 0;
  }
  function bumpModeEpoch(sessionID) {
    modeEpochs.set(sessionID, modeEpoch(sessionID) + 1);
  }
  async function reportMode(session, enabled) {
    if (enabled) {
      input.voice.speakCue(session.id, GENERAL_GREETING);
      await input.toast("Jarvis is on", "success");
    } else {
      input.voice.cancelSession(session.id);
      await input.toast("Jarvis is off", "success");
    }
  }
  async function activeSession(warning) {
    const session = input.getSession();
    if (!session) await input.toast(warning, "warning");
    return session;
  }
  return {
    async toggle() {
      const session = await activeSession(
        "Open a session before changing Jarvis mode"
      );
      if (!session) return;
      bumpModeEpoch(session.id);
      const enabled = await input.state.toggle(session);
      await reportMode(session, enabled);
    },
    async enable() {
      const session = await activeSession(
        "Open a session before changing Jarvis mode"
      );
      if (!session) return;
      bumpModeEpoch(session.id);
      const enabled = await input.state.setEnabled(session, true);
      await reportMode(session, enabled);
    },
    async disable() {
      const session = await activeSession(
        "Open a session before changing Jarvis mode"
      );
      if (!session) return;
      bumpModeEpoch(session.id);
      const enabled = await input.state.setEnabled(session, false);
      await reportMode(session, enabled);
    },
    async status() {
      const session = await activeSession(
        "Open a session before checking Jarvis mode"
      );
      if (!session) return;
      const enabled = await input.state.isEnabled(session);
      await input.toast(`Jarvis is ${enabled ? "on" : "off"}`, "info");
    },
    async replyCompleted(session, messageID, reply) {
      const epoch = modeEpoch(session.id);
      const enabled = await input.state.isEnabled(session);
      if (!enabled || epoch !== modeEpoch(session.id)) return;
      if (spokenMessageIDs.has(messageID)) return;
      const text = stripMarkdownForSpeech(reply);
      if (!text) return;
      input.voice.speakReply(session.id, text);
      spokenMessageIDs.add(messageID);
    },
    async skillActivated(session, eventID, name) {
      if (!name.trim()) return;
      const epoch = modeEpoch(session.id);
      const enabled = await input.state.isEnabled(session);
      if (!enabled || epoch !== modeEpoch(session.id)) return;
      if (announcedEventIDs.has(eventID)) return;
      input.voice.speakCue(session.id, skillLoadingCue(name));
      announcedEventIDs.add(eventID);
    }
  };
}

// src/fish.ts
var FISH_MODEL = "s2.1-pro-free";
var FISH_REFERENCE_ID = "14129c3e320149449d6bada6862f7338";
var FISH_FORMAT = "mp3";
var CREDIT_URL = "https://api.fish.audio/wallet/self/api-credit";
var TTS_URL = "https://api.fish.audio/v1/tts";
var MAX_ERROR_MESSAGE_LENGTH = 300;
var MAX_ERROR_BODY_BYTES = 1200;
var FishAudioError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "FishAudioError";
  }
  status;
};
var FishAudioClient = class {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
  }
  fetcher;
  async validateKey(apiKey, signal) {
    const response = await this.fetcher(CREDIT_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      ...signal ? { signal } : {}
    });
    if (response.ok) return true;
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => void 0);
      return false;
    }
    throw await fishAudioError(response, apiKey);
  }
  async synthesize(apiKey, text, signal) {
    const response = await this.requestTts(apiKey, text, signal);
    return new Uint8Array(await response.arrayBuffer());
  }
  async synthesizeStream(apiKey, text, signal) {
    const response = await this.requestTts(apiKey, text, signal);
    if (!response.body) {
      throw new Error("Fish Audio response had no body to stream");
    }
    return response.body;
  }
  async requestTts(apiKey, text, signal) {
    const response = await this.fetcher(TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model: FISH_MODEL
      },
      body: JSON.stringify({
        text,
        reference_id: FISH_REFERENCE_ID,
        format: FISH_FORMAT
      }),
      ...signal ? { signal } : {}
    });
    if (!response.ok) {
      throw await fishAudioError(response, apiKey);
    }
    return response;
  }
};
async function fishAudioError(response, apiKey) {
  const detail = await readBoundedErrorBody(response, apiKey);
  const safeDetail = detail.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  const message = `Fish Audio request failed (${response.status})${safeDetail ? `: ${safeDetail}` : ""}`.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return new FishAudioError(response.status, message);
}
async function readBoundedErrorBody(response, apiKey) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (byteLength < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_ERROR_BODY_BYTES - byteLength;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    }
  } catch {
    return "Fish Audio returned an unreadable error response";
  } finally {
    await reader.cancel().catch(() => void 0);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const detail = new TextDecoder().decode(bytes);
  return apiKey ? detail.split(apiKey).join("[redacted]") : detail;
}

// src/voice.ts
import { spawn } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

// src/cache.ts
import { createHash, randomUUID } from "crypto";
import { access, mkdir, rename, rm, writeFile } from "fs/promises";
import { join as join2 } from "path";
function audioCacheKey(text) {
  return createHash("sha256").update(
    JSON.stringify({
      text,
      model: FISH_MODEL,
      reference: FISH_REFERENCE_ID,
      format: FISH_FORMAT
    })
  ).digest("hex");
}
var AudioCache = class {
  constructor(directory) {
    this.directory = directory;
  }
  directory;
  pending = /* @__PURE__ */ new Map();
  async getOrCreate(text, render) {
    const key = audioCacheKey(text);
    const file = join2(this.directory, `${key}.mp3`);
    try {
      await access(file);
      return file;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const created = this.create(file, render).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, created);
    return created;
  }
  async create(file, render) {
    const audio = await render();
    await mkdir(this.directory, { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, audio, { mode: 384 });
      await rename(temporary, file);
      return file;
    } finally {
      await rm(temporary, { force: true });
    }
  }
};
function isMissingFile(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// src/voice.ts
var FFPLAY_TERMINATE_GRACE_MS = 250;
var VoiceQueue = class {
  constructor(worker, report) {
    this.worker = worker;
    this.report = report;
  }
  worker;
  report;
  jobs = [];
  idleWaiters = /* @__PURE__ */ new Set();
  draining = false;
  disposed = false;
  active;
  enqueue(job) {
    if (this.disposed) return;
    this.jobs.push(job);
    if (!this.draining) void this.drain();
  }
  whenIdle() {
    if (!this.draining && this.jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }
  cancelSession(sessionID) {
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      if (this.jobs[index]?.sessionID === sessionID) this.jobs.splice(index, 1);
    }
    if (this.active?.job.sessionID === sessionID) {
      this.active.controller.abort();
    }
  }
  async dispose() {
    this.disposed = true;
    this.jobs.length = 0;
    this.active?.controller.abort();
    await this.whenIdle();
  }
  async drain() {
    this.draining = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      const controller = new AbortController();
      this.active = { job, controller };
      try {
        await this.worker(job, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          try {
            void Promise.resolve(this.report(error)).catch(() => void 0);
          } catch {
          }
        }
      } finally {
        this.active = void 0;
      }
    }
    this.draining = false;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
};
var VoiceService = class {
  cache;
  fish;
  play;
  playStream;
  queue;
  constructor(options) {
    this.cache = new AudioCache(options.cacheDirectory);
    this.fish = options.fish ?? new FishAudioClient();
    this.play = options.play ?? playWithFfplay;
    this.playStream = options.playStream ?? playStreamWithFfplay;
    this.queue = new VoiceQueue(
      (job, signal) => this.process(job, signal, options.getApiKey),
      options.report
    );
  }
  speakReply(sessionID, text) {
    this.queue.enqueue({ sessionID, text, reusable: false });
  }
  speakCue(sessionID, text) {
    this.queue.enqueue({ sessionID, text, reusable: true });
  }
  cancelSession(sessionID) {
    this.queue.cancelSession(sessionID);
  }
  whenIdle() {
    return this.queue.whenIdle();
  }
  dispose() {
    return this.queue.dispose();
  }
  async process(job, signal, getApiKey) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("Fish Audio API key is required for voice playback");
    if (job.reusable) {
      const file = await this.cache.getOrCreate(
        job.text,
        () => this.fish.synthesize(apiKey, job.text, signal)
      );
      signal.throwIfAborted();
      await this.play(file, signal);
      return;
    }
    const stream = await this.fish.synthesizeStream(apiKey, job.text, signal);
    signal.throwIfAborted();
    await this.playStream(stream, signal);
  }
};
async function playWithFfplay(file, signal) {
  await runFfplay(
    ["-nodisp", "-autoexit", "-loglevel", "quiet", file],
    "ignore",
    signal
  );
}
async function playStreamWithFfplay(stream, signal) {
  await runFfplay(
    ["-nodisp", "-autoexit", "-loglevel", "quiet", "-f", "mp3", "-i", "pipe:0"],
    ["pipe", "ignore", "ignore"],
    signal,
    (stdin) => {
      const webStream = stream;
      pipeline(Readable.fromWeb(webStream), stdin).catch(() => {
      });
    }
  );
}
function runFfplay(args, stdio, signal, feedStdin) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn("ffplay", args, { stdio });
    let settled = false;
    let aborted = false;
    let failure;
    let forceKillTimer;
    const cleanupChild = () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      aborted = true;
      signal.removeEventListener("abort", onAbort);
      try {
        child.kill();
      } catch {
      }
      if (settled) return;
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }, FFPLAY_TERMINATE_GRACE_MS);
      forceKillTimer.unref();
    };
    const onError = (error) => {
      if (!aborted) failure ??= error;
    };
    const onExit = (code) => {
      if (!aborted && code !== 0) {
        failure ??= new Error(`ffplay exited with code ${String(code)}`);
      }
    };
    const onClose = (code) => {
      onExit(code);
      finish(aborted ? void 0 : failure);
      cleanupChild();
    };
    child.on("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    if (child.stdin) feedStdin?.(child.stdin);
  });
}

// src/tui.ts
function jarvisCommands(actions) {
  return [
    {
      id: "jarvis.toggle",
      title: "Toggle Jarvis",
      description: "Toggle Jarvis for this session",
      group: "Jarvis",
      palette: true,
      slash: { name: "jarvis" },
      run: actions.toggle
    },
    {
      id: "jarvis.enable",
      title: "Enable Jarvis",
      description: "Enable Jarvis for this session",
      group: "Jarvis",
      palette: true,
      slash: { name: "jarvis-on" },
      run: actions.enable
    },
    {
      id: "jarvis.disable",
      title: "Disable Jarvis",
      description: "Disable Jarvis for this session",
      group: "Jarvis",
      palette: true,
      slash: { name: "jarvis-off" },
      run: actions.disable
    },
    {
      id: "jarvis.status",
      title: "Jarvis status",
      description: "Show Jarvis state for this session",
      group: "Jarvis",
      palette: true,
      slash: { name: "jarvis-status" },
      run: actions.status
    }
  ];
}
function sessionRef(context, sessionID, eventLocation, allowContextFallback = false) {
  const cached = context.data.session.get(sessionID);
  const location = eventLocation ?? cached?.location ?? (allowContextFallback ? context.location ?? context.data.location.default() : void 0);
  if (!location) return void 0;
  const workspaceID = "workspaceID" in location && typeof location.workspaceID === "string" ? location.workspaceID : void 0;
  return {
    id: sessionID,
    location: {
      directory: location.directory,
      ...workspaceID ? { workspaceID } : {}
    }
  };
}
function enabledResult(value) {
  if (typeof value !== "object" || value === null || !("enabled" in value) || typeof value.enabled !== "boolean") {
    throw new Error("Jarvis RPC returned an invalid response");
  }
  return value.enabled;
}
async function setupJarvisTui(context) {
  const rpc = context.client.rpc(JarvisRpc);
  let apiKey = await resolveFishApiKey(process.env, process.cwd());
  let disposed = false;
  let ownsKeyPrompt = false;
  const startupController = new AbortController();
  const lifetimeController = new AbortController();
  const eventTasks = /* @__PURE__ */ new Set();
  const fish = new FishAudioClient();
  const toast = (message, variant) => context.ui.toast.show({ title: "Jarvis", message, variant });
  const report = (error, sensitive) => {
    if (disposed) return;
    let message = error instanceof Error && error.name === "FishAudioError" && "status" in error && typeof error.status === "number" ? `Fish Audio request failed (${error.status})` : error instanceof Error ? error.message : "Unexpected Jarvis error";
    for (const secret of [apiKey, sensitive]) {
      if (secret) message = message.split(secret).join("[redacted]");
    }
    message = message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    if (!message) message = "Unexpected Jarvis error";
    toast(message, "error");
    console.error(`[opencode-jarvis] ${message}`);
  };
  const voice = new VoiceService({
    cacheDirectory: resolveCacheDirectory({
      env: process.env,
      platform: process.platform,
      home: homedir()
    }),
    getApiKey: () => apiKey,
    fish,
    report
  });
  const ensureActive = () => {
    if (!disposed) return;
    const error = new Error("Jarvis terminal plugin is disposed");
    error.name = "AbortError";
    throw error;
  };
  const state = {
    async isEnabled(session) {
      ensureActive();
      const result = enabledResult(
        await rpc.status(
          { sessionID: session.id },
          {
            location: session.location,
            signal: lifetimeController.signal
          }
        )
      );
      ensureActive();
      return result;
    },
    async setEnabled(session, enabled) {
      ensureActive();
      const result = enabledResult(
        await rpc.set(
          { sessionID: session.id, enabled },
          {
            location: session.location,
            signal: lifetimeController.signal
          }
        )
      );
      ensureActive();
      return result;
    },
    async toggle(session) {
      ensureActive();
      const result = enabledResult(
        await rpc.toggle(
          { sessionID: session.id },
          {
            location: session.location,
            signal: lifetimeController.signal
          }
        )
      );
      ensureActive();
      return result;
    }
  };
  const controller = createJarvisController({
    state,
    voice,
    toast,
    getSession: () => {
      const route = context.ui.router.current();
      return route.type === "session" ? sessionRef(context, route.sessionID, void 0, true) : void 0;
    }
  });
  const guard = (action) => async () => {
    try {
      await action();
    } catch (error) {
      report(error);
    }
  };
  const trackEvent = (task) => {
    const handled = task.catch(report);
    eventTasks.add(handled);
    void handled.finally(() => eventTasks.delete(handled));
  };
  context.keymap.layer(() => ({
    mode: "global",
    commands: jarvisCommands({
      toggle: guard(controller.toggle),
      enable: guard(controller.enable),
      disable: guard(controller.disable),
      status: guard(controller.status)
    })
  }));
  const stopExecution = context.data.on(
    "session.execution.succeeded",
    (event) => {
      if (disposed) return;
      trackEvent((async () => {
        const session = sessionRef(
          context,
          event.data.sessionID,
          event.location
        );
        if (!session) return;
        await context.data.session.message.sync(session.id);
        ensureActive();
        const messages = context.data.session.message.list(session.id);
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          if (!message || message.type !== "assistant" || !message.time.completed || message.error) {
            continue;
          }
          const text = message.content.flatMap(
            (part) => part.type === "text" && part.text.trim() ? [part.text.trim()] : []
          ).join("\n");
          await controller.replyCompleted(session, message.id, text);
          return;
        }
      })());
    }
  );
  const stopSkill = context.data.on("session.skill.activated", (event) => {
    if (disposed) return;
    const session = sessionRef(
      context,
      event.data.sessionID,
      event.location
    );
    if (!session) return;
    trackEvent(controller.skillActivated(session, event.id, event.data.name));
  });
  let startupTask = Promise.resolve();
  if (!apiKey) {
    startupTask = (async () => {
      ownsKeyPrompt = true;
      const candidate = (await context.ui.dialog.prompt({
        title: "Fish Audio API key",
        placeholder: "Enter FISH_API_KEY"
      }))?.trim();
      ownsKeyPrompt = false;
      if (disposed) return;
      if (!candidate) {
        toast(
          "Speech is unavailable until FISH_API_KEY is configured",
          "warning"
        );
        return;
      }
      try {
        const valid = await fish.validateKey(
          candidate,
          startupController.signal
        );
        if (disposed) return;
        if (valid) {
          apiKey = candidate;
          toast("Fish Audio is ready", "success");
        } else {
          toast("Fish Audio rejected that API key", "error");
        }
      } catch (error) {
        if (!startupController.signal.aborted) report(error, candidate);
      }
    })().catch(report);
  }
  let cleanupTask;
  return () => {
    if (cleanupTask) return cleanupTask;
    disposed = true;
    startupController.abort();
    lifetimeController.abort();
    if (ownsKeyPrompt) context.ui.dialog.clear();
    stopExecution();
    stopSkill();
    cleanupTask = Promise.all([
      startupTask,
      ...eventTasks,
      voice.dispose()
    ]).then(() => void 0);
    return cleanupTask;
  };
}
var tui_default = Plugin.define({
  id: "opencode-jarvis.tui",
  setup: setupJarvisTui
});
export {
  tui_default as default,
  jarvisCommands,
  setupJarvisTui
};

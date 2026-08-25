import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AudioCache } from "./cache.js";
import { FishAudioClient } from "./fish.js";

const FFPLAY_TERMINATE_GRACE_MS = 250;

export interface VoiceJob {
  sessionID: string;
  text: string;
  reusable: boolean;
}

type VoiceWorker = (job: VoiceJob, signal: AbortSignal) => Promise<void>;
type ErrorReporter = (error: unknown) => void | Promise<void>;

export class VoiceQueue {
  private readonly jobs: VoiceJob[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private draining = false;
  private disposed = false;
  private active: { job: VoiceJob; controller: AbortController } | undefined;

  constructor(
    private readonly worker: VoiceWorker,
    private readonly report: ErrorReporter,
  ) {}

  enqueue(job: VoiceJob): void {
    if (this.disposed) return;
    this.jobs.push(job);
    if (!this.draining) void this.drain();
  }

  whenIdle(): Promise<void> {
    if (!this.draining && this.jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  cancelSession(sessionID: string): void {
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      if (this.jobs[index]?.sessionID === sessionID) this.jobs.splice(index, 1);
    }
    if (this.active?.job.sessionID === sessionID) {
      this.active.controller.abort();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.jobs.length = 0;
    this.active?.controller.abort();
    await this.whenIdle();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      const controller = new AbortController();
      this.active = { job, controller };
      try {
        await this.worker(job, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          try {
            void Promise.resolve(this.report(error)).catch(() => undefined);
          } catch {}
        }
      } finally {
        this.active = undefined;
      }
    }
    this.draining = false;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

interface FishSynthesizer {
  synthesize(
    apiKey: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

type AudioPlayer = (file: string, signal: AbortSignal) => Promise<void>;

export interface VoiceServiceOptions {
  stateRoot: string;
  getApiKey: () => string | undefined;
  fish?: FishSynthesizer;
  play?: AudioPlayer;
  report: ErrorReporter;
}

export class VoiceService {
  private readonly cache: AudioCache;
  private readonly fish: FishSynthesizer;
  private readonly play: AudioPlayer;
  private readonly queue: VoiceQueue;
  private readonly temporaryDirectory: string;

  constructor(options: VoiceServiceOptions) {
    this.cache = new AudioCache(
      join(options.stateRoot, "opencode-jarvis", "cache"),
    );
    this.temporaryDirectory = join(
      options.stateRoot,
      "opencode-jarvis",
      "tmp",
    );
    this.fish = options.fish ?? new FishAudioClient();
    this.play = options.play ?? playWithFfplay;
    this.queue = new VoiceQueue(
      (job, signal) => this.process(job, signal, options.getApiKey),
      options.report,
    );
  }

  speakReply(sessionID: string, text: string): void {
    this.queue.enqueue({ sessionID, text, reusable: false });
  }

  speakCue(sessionID: string, text: string): void {
    this.queue.enqueue({ sessionID, text, reusable: true });
  }

  cancelSession(sessionID: string): void {
    this.queue.cancelSession(sessionID);
  }

  whenIdle(): Promise<void> {
    return this.queue.whenIdle();
  }

  dispose(): Promise<void> {
    return this.queue.dispose();
  }

  private async process(
    job: VoiceJob,
    signal: AbortSignal,
    getApiKey: () => string | undefined,
  ): Promise<void> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("Fish Audio API key is required for voice playback");

    if (job.reusable) {
      const file = await this.cache.getOrCreate(job.text, () =>
        this.fish.synthesize(apiKey, job.text, signal),
      );
      signal.throwIfAborted();
      await this.play(file, signal);
      return;
    }

    const file = join(this.temporaryDirectory, `${randomUUID()}.mp3`);
    try {
      const audio = await this.fish.synthesize(apiKey, job.text, signal);
      signal.throwIfAborted();
      await mkdir(this.temporaryDirectory, { recursive: true });
      await writeFile(file, audio, { mode: 0o600 });
      signal.throwIfAborted();
      await this.play(file, signal);
    } finally {
      await rm(file, { force: true });
    }
  }
}

async function playWithFfplay(
  file: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffplay",
      ["-nodisp", "-autoexit", "-loglevel", "quiet", file],
      { stdio: "ignore" },
    );
    let settled = false;
    let aborted = false;
    let failure: Error | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const cleanupChild = (): void => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => {
      aborted = true;
      signal.removeEventListener("abort", onAbort);
      try {
        child.kill();
      } catch {}
      if (settled) return;
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, FFPLAY_TERMINATE_GRACE_MS);
      forceKillTimer.unref();
    };
    const onError = (error: Error): void => {
      if (!aborted) failure ??= error;
    };
    const onExit = (code: number | null): void => {
      if (!aborted && code !== 0) {
        failure ??= new Error(`ffplay exited with code ${String(code)}`);
      }
    };
    const onClose = (code: number | null): void => {
      onExit(code);
      finish(aborted ? undefined : failure);
      cleanupChild();
    };

    child.on("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

import { EventEmitter } from "node:events"
import { access, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: spawnMock }))

import { VoiceQueue, VoiceService } from "../src/voice.js"

describe("VoiceQueue", () => {
  it("plays jobs in FIFO order with exactly one active worker", async () => {
    const order: string[] = []
    let active = 0
    let maximumActive = 0
    const releases: Array<() => void> = []
    const queue = new VoiceQueue(async (job) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      order.push(job.text)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
    }, vi.fn())
    queue.enqueue({ sessionID: "a", text: "first", reusable: false })
    queue.enqueue({ sessionID: "a", text: "second", reusable: false })

    await vi.waitFor(() => expect(order).toEqual(["first"]))
    releases.shift()!()
    await vi.waitFor(() => expect(order).toEqual(["first", "second"]))
    releases.shift()!()
    await queue.whenIdle()
    expect(order).toEqual(["first", "second"])
    expect(maximumActive).toBe(1)
  })

  it("resolves all waiters only after enqueue work racing drain completion", async () => {
    const started: string[] = []
    const releases: Array<() => void> = []
    const queue = new VoiceQueue(async (job) => {
      started.push(job.text)
      await new Promise<void>((resolve) => releases.push(resolve))
    }, vi.fn())
    queue.enqueue({ sessionID: "a", text: "first", reusable: false })
    const firstIdle = queue.whenIdle()
    const secondIdle = queue.whenIdle()
    let idle = false
    void Promise.all([firstIdle, secondIdle]).then(() => { idle = true })

    const firstFinished = new Promise<void>((resolve) => {
      const release = releases.shift()!
      resolve()
      release()
    })
    void firstFinished.then(() => {
      queue.enqueue({ sessionID: "a", text: "racing", reusable: false })
    })

    await vi.waitFor(() => expect(started).toEqual(["first", "racing"]))
    await new Promise<void>((resolve) => setImmediate(resolve))
    const idleBeforeRacingJobFinished = idle
    releases.shift()!()
    await Promise.all([firstIdle, secondIdle])
    expect(idleBeforeRacingJobFinished).toBe(false)
    expect(idle).toBe(true)
  })

  it("removes queued work and aborts active work for one session", async () => {
    const started: string[] = []
    const report = vi.fn()
    const queue = new VoiceQueue(
      (job, signal) =>
        new Promise<void>((resolve, reject) => {
          started.push(job.text)
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          )
          if (job.sessionID === "b") resolve()
        }),
      report,
    )
    queue.enqueue({ sessionID: "a", text: "active", reusable: false })
    queue.enqueue({ sessionID: "a", text: "queued", reusable: false })
    queue.enqueue({ sessionID: "b", text: "other", reusable: false })
    await Promise.resolve()
    queue.cancelSession("a")
    await queue.whenIdle()
    expect(started).toEqual(["active", "other"])
    expect(report).not.toHaveBeenCalled()
  })

  it("reports failures without rejecting callers or preventing later jobs", async () => {
    const report = vi.fn()
    const completed: string[] = []
    const queue = new VoiceQueue(async (job) => {
      if (job.text === "bad") throw new Error("player failed")
      completed.push(job.text)
    }, report)
    expect(() => {
      queue.enqueue({ sessionID: "a", text: "bad", reusable: false })
      queue.enqueue({ sessionID: "a", text: "good", reusable: false })
    }).not.toThrow()
    await expect(queue.whenIdle()).resolves.toBeUndefined()
    expect(report).toHaveBeenCalledWith(expect.any(Error))
    expect(completed).toEqual(["good"])
  })

  it("consumes async reporter rejections and continues processing jobs", async () => {
    const reporterFailure = new Error("reporter failed")
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => { unhandled.push(error) }
    process.on("unhandledRejection", onUnhandled)
    const completed: string[] = []
    const reporterPromise = (async () => { throw reporterFailure })()
    const catchSpy = vi.spyOn(reporterPromise, "catch")
    const report = vi.fn(() => reporterPromise)
    const queue = new VoiceQueue(async (job) => {
      if (job.text === "bad") throw new Error("worker failed")
      completed.push(job.text)
    }, report)

    try {
      queue.enqueue({ sessionID: "a", text: "bad", reusable: false })
      queue.enqueue({ sessionID: "a", text: "good", reusable: false })
      await queue.whenIdle()
      const consumedByQueue = catchSpy.mock.calls.length
      await reporterPromise.catch(() => undefined)
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(report).toHaveBeenCalledOnce()
      expect(consumedByQueue).toBe(1)
      expect(completed).toEqual(["good"])
      expect(unhandled).toEqual([])
    } finally {
      process.removeListener("unhandledRejection", onUnhandled)
    }
  })

  it("dispose clears queued work, aborts active work, and prevents restart", async () => {
    const started: string[] = []
    const report = vi.fn()
    const queue = new VoiceQueue(
      (job, signal) =>
        new Promise<void>((_resolve, reject) => {
          started.push(job.text)
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("disposed", "AbortError")),
            { once: true },
          )
        }),
      report,
    )
    queue.enqueue({ sessionID: "a", text: "active", reusable: false })
    queue.enqueue({ sessionID: "a", text: "queued", reusable: false })
    await Promise.resolve()
    await queue.dispose()
    queue.enqueue({ sessionID: "a", text: "after-dispose", reusable: false })
    await queue.whenIdle()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(started).toEqual(["active"])
    expect(report).not.toHaveBeenCalled()
  })
})

describe("VoiceService", () => {
  it("caches cues but writes repeated replies to distinct private temporary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const fish = { synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) }
    const cueFiles: string[] = []
    const replyFiles: string[] = []
    const modes: number[] = []
    const play = vi.fn().mockImplementation(async (file: string) => {
      if (dirname(file) === join(root, "opencode-jarvis", "cache")) {
        cueFiles.push(file)
      } else {
        replyFiles.push(file)
        modes.push((await stat(file)).mode & 0o777)
      }
    })
    const voice = new VoiceService({
      stateRoot: root,
      getApiKey: () => "secret",
      fish,
      play,
      report: vi.fn(),
    })
    voice.speakCue("a", "cached")
    voice.speakCue("a", "cached")
    await voice.whenIdle()
    expect(fish.synthesize).toHaveBeenCalledTimes(1)
    expect(cueFiles).toHaveLength(2)
    expect(cueFiles[0]).toBe(cueFiles[1])
    expect(dirname(cueFiles[0]!)).toBe(join(root, "opencode-jarvis", "cache"))
    await expect(access(cueFiles[0]!)).resolves.toBeUndefined()
    voice.speakReply("a", "uncached")
    voice.speakReply("a", "uncached")
    await voice.whenIdle()
    expect(fish.synthesize).toHaveBeenCalledTimes(3)
    expect(new Set(replyFiles).size).toBe(2)
    expect(replyFiles.every((file) => dirname(file) === join(root, "opencode-jarvis", "tmp"))).toBe(true)
    expect(modes).toEqual([0o600, 0o600])
    await Promise.all(replyFiles.map((file) => expect(access(file)).rejects.toThrow()))
    expect(await readdir(join(root, "opencode-jarvis", "tmp"))).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it("reports missing API key without throwing into caller", async () => {
    const report = vi.fn()
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    try {
      const voice = new VoiceService({
        stateRoot: root,
        getApiKey: () => undefined,
        play: vi.fn().mockResolvedValue(undefined),
        report,
      })
      voice.speakReply("a", "hello")
      await voice.whenIdle()
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("API key") }),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("removes temporary files after playback", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const fish = { synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) }
    const capturedFiles: string[] = []
    const play = vi.fn().mockImplementation(async (file: string) => {
      capturedFiles.push(file)
    })
    const voice = new VoiceService({
      stateRoot: root,
      getApiKey: () => "secret",
      fish,
      play,
      report: vi.fn(),
    })
    voice.speakReply("a", "temporary")
    await voice.whenIdle()
    expect(capturedFiles).toHaveLength(1)
    const tmpFile = capturedFiles[0]!
    // The temp file should be gone after playback completes
    await expect(access(tmpFile)).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })

  it("removes temporary files when injected playback fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const report = vi.fn()
    let temporaryFile = ""
    const voice = new VoiceService({
      stateRoot: root,
      getApiKey: () => "secret",
      fish: { synthesize: vi.fn().mockResolvedValue(new Uint8Array([1])) },
      play: vi.fn().mockImplementation(async (file: string) => {
        temporaryFile = file
        throw new Error("playback failed")
      }),
      report,
    })
    voice.speakReply("a", "temporary")
    await voice.whenIdle()

    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "playback failed" }))
    await expect(access(temporaryFile)).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })

  it("dispose clears queued jobs, aborts active work, and waits for idle", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const fish = { synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) }
    let finishPlayback!: () => void
    let playbackAborted = false
    const play = vi.fn().mockImplementation(
      (_file: string, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          finishPlayback = resolve
          signal.addEventListener("abort", () => { playbackAborted = true }, { once: true })
        }),
    )
    const voice = new VoiceService({
      stateRoot: root,
      getApiKey: () => "secret",
      fish,
      play,
      report: vi.fn(),
    })
    voice.speakReply("a", "active")
    voice.speakReply("a", "should-be-cancelled")
    await vi.waitFor(() => expect(play).toHaveBeenCalledOnce())
    const disposePromise = voice.dispose()
    let disposed = false
    void disposePromise.then(() => { disposed = true })
    await vi.waitFor(() => expect(playbackAborted).toBe(true))
    await Promise.resolve()
    expect(disposed).toBe(false)

    finishPlayback()
    await disposePromise
    await voice.whenIdle()
    expect(fish.synthesize).toHaveBeenCalledTimes(1)
    await rm(root, { recursive: true, force: true })
  })
})

describe("production ffplay playback", () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it("uses the exact ffplay process contract and resolves a successful exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    spawnMock.mockReturnValue(child)
    const report = vi.fn()
    const voice = defaultPlayerVoice(root, report)
    voice.speakReply("a", "hello")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    const file = spawnMock.mock.calls[0]![1][4] as string

    expect(spawnMock).toHaveBeenCalledWith(
      "ffplay",
      ["-nodisp", "-autoexit", "-loglevel", "quiet", file],
      { stdio: "ignore" },
    )
    child.emit("exit", 0, null)
    child.emit("close", 0, null)
    await voice.whenIdle()

    expect(report).not.toHaveBeenCalled()
    expect(child.listenerCount("error")).toBe(0)
    expect(child.listenerCount("exit")).toBe(0)
    expect(child.listenerCount("close")).toBe(0)
    await expect(access(file)).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })

  it("waits for aborted ffplay to close before starting another job or becoming idle", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    const nextChild = fakeChildProcess()
    spawnMock.mockReturnValueOnce(child).mockReturnValueOnce(nextChild)
    const report = vi.fn()
    const voice = defaultPlayerVoice(root, report)
    voice.speakReply("a", "first")
    voice.speakReply("b", "second")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    const file = spawnMock.mock.calls[0]![1][4] as string

    voice.cancelSession("a")
    const idlePromise = voice.whenIdle()
    let idle = false
    void idlePromise.then(() => { idle = true })
    child.emit("exit", null, "SIGTERM")
    const progressBeforeClose = await Promise.race([
      vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2)).then(() => "advanced" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
    ])
    const callsBeforeClose = spawnMock.mock.calls.length
    const idleBeforeClose = idle
    let temporaryFileExistsBeforeClose = true
    await access(file).catch(() => { temporaryFileExistsBeforeClose = false })

    child.emit("close", null, "SIGTERM")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))
    nextChild.emit("exit", 0, null)
    nextChild.emit("close", 0, null)
    await idlePromise

    expect(child.kill).toHaveBeenCalledOnce()
    expect(progressBeforeClose).toBe("pending")
    expect(callsBeforeClose).toBe(1)
    expect(idleBeforeClose).toBe(false)
    expect(temporaryFileExistsBeforeClose).toBe(true)
    expect(report).not.toHaveBeenCalled()
    expect(child.listenerCount("error")).toBe(0)
    expect(child.listenerCount("exit")).toBe(0)
    expect(child.listenerCount("close")).toBe(0)
    await expect(access(file)).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })

  it("dispose waits for the active ffplay process to close", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    spawnMock.mockReturnValue(child)
    const report = vi.fn()
    const voice = defaultPlayerVoice(root, report)
    voice.speakReply("a", "active")
    voice.speakReply("a", "queued")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    vi.useFakeTimers()

    try {
      const disposePromise = voice.dispose()
      child.emit("exit", null, "SIGTERM")
      await vi.runAllTimersAsync()
      const remainingTimers = vi.getTimerCount()
      vi.useRealTimers()
      const disposeBeforeClose = await Promise.race([
        disposePromise.then(() => "disposed" as const),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
      ])

      child.emit("close", null, "SIGKILL")
      await disposePromise

      expect(disposeBeforeClose).toBe("pending")
      expect(remainingTimers).toBe(0)
      expect(spawnMock).toHaveBeenCalledOnce()
      expect(child.kill.mock.calls.map((call) => call[0])).toEqual([undefined, "SIGKILL"])
      expect(report).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it("escalates an aborted ffplay process from SIGTERM to SIGKILL", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    spawnMock.mockReturnValue(child)
    const report = vi.fn()
    const voice = defaultPlayerVoice(root, report)
    voice.speakReply("a", "hello")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    vi.useFakeTimers()

    try {
      voice.cancelSession("a")
      const idlePromise = voice.whenIdle()
      await vi.runOnlyPendingTimersAsync()
      const killCalls = child.kill.mock.calls.map((call) => call[0])

      child.emit("close", null, "SIGKILL")
      await idlePromise

      expect(killCalls).toEqual([undefined, "SIGKILL"])
      expect(report).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps aborted playback serialized after all timers until ffplay closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    const nextChild = fakeChildProcess()
    spawnMock.mockReturnValueOnce(child).mockReturnValueOnce(nextChild)
    const report = vi.fn()
    const voice = defaultPlayerVoice(root, report)
    voice.speakReply("a", "first")
    voice.speakReply("b", "second")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    const file = spawnMock.mock.calls[0]![1][4] as string
    vi.useFakeTimers()

    try {
      voice.cancelSession("a")
      const idlePromise = voice.whenIdle()
      let idle = false
      void idlePromise.then(() => { idle = true })
      await vi.runAllTimersAsync()
      const remainingTimers = vi.getTimerCount()
      vi.useRealTimers()
      const progressBeforeClose = await Promise.race([
        vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2)).then(() => "advanced" as const),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
      ])
      const idleBeforeClose = idle
      let temporaryFileExistsBeforeClose = true
      await access(file).catch(() => { temporaryFileExistsBeforeClose = false })

      expect(() => child.emit("error", new Error("late kill error"))).not.toThrow()
      child.emit("close", null, "SIGKILL")
      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))
      nextChild.emit("exit", 0, null)
      nextChild.emit("close", 0, null)
      await idlePromise

      expect(progressBeforeClose).toBe("pending")
      expect(idleBeforeClose).toBe(false)
      expect(temporaryFileExistsBeforeClose).toBe(true)
      expect(remainingTimers).toBe(0)
      expect(report).not.toHaveBeenCalled()
      expect(child.listenerCount("error")).toBe(0)
      expect(child.listenerCount("close")).toBe(0)
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it("cleans termination state when SIGKILL synchronously closes ffplay", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    child.kill.mockImplementation((signal?: string) => {
      if (signal === "SIGKILL") child.emit("close", null, "SIGKILL")
      return true
    })
    spawnMock.mockReturnValue(child)
    const voice = defaultPlayerVoice(root, vi.fn())
    voice.speakReply("a", "hello")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    vi.useFakeTimers()

    try {
      voice.cancelSession("a")
      const idlePromise = voice.whenIdle()
      await vi.runOnlyPendingTimersAsync()
      await idlePromise

      expect(vi.getTimerCount()).toBe(0)
      expect(child.listenerCount("error")).toBe(0)
      expect(child.listenerCount("close")).toBe(0)
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it("does not schedule escalation after SIGTERM synchronously closes ffplay", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    child.kill.mockImplementation((signal?: string) => {
      if (signal === undefined) child.emit("close", null, "SIGTERM")
      return true
    })
    spawnMock.mockReturnValue(child)
    const voice = defaultPlayerVoice(root, vi.fn())
    voice.speakReply("a", "hello")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    vi.useFakeTimers()

    try {
      voice.cancelSession("a")
      await voice.whenIdle()

      expect(vi.getTimerCount()).toBe(0)
      expect(child.listenerCount("error")).toBe(0)
      expect(child.listenerCount("close")).toBe(0)
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it("guards child errors emitted after abort until the process exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    spawnMock.mockReturnValue(child)
    const report = vi.fn()
    const voice = defaultPlayerVoice(root, report)
    voice.speakReply("a", "hello")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())

    voice.cancelSession("a")
    expect(() => child.emit("error", new Error("kill failed"))).not.toThrow()
    child.emit("exit", null, "SIGTERM")
    expect(() => child.emit("error", new Error("late kill error"))).not.toThrow()
    child.emit("close", null, "SIGTERM")
    await voice.whenIdle()

    expect(child.kill).toHaveBeenCalledOnce()
    expect(report).not.toHaveBeenCalled()
    expect(child.listenerCount("error")).toBe(0)
    expect(child.listenerCount("exit")).toBe(0)
    expect(child.listenerCount("close")).toBe(0)
    await rm(root, { recursive: true, force: true })
  })

  it("reports a spawn error once and ignores a later exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    spawnMock.mockReturnValue(child)
    const report = vi.fn()
    const voice = defaultPlayerVoice(root, report)
    voice.speakReply("a", "hello")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    const file = spawnMock.mock.calls[0]![1][4] as string
    const error = new Error("spawn failed")

    child.emit("error", error)
    child.emit("exit", 1, null)
    child.emit("close", 1, null)
    await voice.whenIdle()

    expect(report).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith(error)
    expect(child.listenerCount("error")).toBe(0)
    expect(child.listenerCount("exit")).toBe(0)
    expect(child.listenerCount("close")).toBe(0)
    await expect(access(file)).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })

  it("reports a nonzero ffplay exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-voice-"))
    const child = fakeChildProcess()
    spawnMock.mockReturnValue(child)
    const report = vi.fn()
    const voice = defaultPlayerVoice(root, report)
    voice.speakReply("a", "hello")
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    const file = spawnMock.mock.calls[0]![1][4] as string

    child.emit("exit", 7, null)
    child.emit("close", 7, null)
    await voice.whenIdle()

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("7") }),
    )
    await expect(access(file)).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })
})

function fakeChildProcess(): EventEmitter & { kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> }
  child.kill = vi.fn().mockReturnValue(true)
  return child
}

function defaultPlayerVoice(root: string, report: ReturnType<typeof vi.fn>): VoiceService {
  return new VoiceService({
    stateRoot: root,
    getApiKey: () => "secret",
    fish: { synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) },
    report,
  })
}

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_RETRY_INTERVAL_MS = 20;
const LOCK_TIMEOUT_MS = 500;
const LOCK_STALE_MS = 30_000;

interface StateData {
  sessions: Record<string, true>;
}

export class SessionStateStore {
  private readonly stateDirectory: string;
  private readonly stateFile: string;
  private readonly lockFile: string;
  private pendingMutations: Promise<void> = Promise.resolve();

  constructor(stateRoot: string) {
    this.stateDirectory = join(stateRoot, "opencode-jarvis");
    this.stateFile = join(this.stateDirectory, "state.json");
    this.lockFile = join(this.stateDirectory, "state.lock");
  }

  async isEnabled(sessionID: string): Promise<boolean> {
    await this.pendingMutations;
    const state = await this.readState();
    return state.sessions[sessionID] === true;
  }

  setEnabled(sessionID: string, enabled: boolean): Promise<boolean> {
    return this.mutate(async () => {
      const state = await this.readState(true);

      if (enabled) {
        state.sessions[sessionID] = true;
      } else {
        delete state.sessions[sessionID];
      }

      await this.writeState(state);
      return enabled;
    });
  }

  toggle(sessionID: string): Promise<boolean> {
    return this.mutate(async () => {
      const state = await this.readState(true);
      const enabled = state.sessions[sessionID] !== true;

      if (enabled) {
        state.sessions[sessionID] = true;
      } else {
        delete state.sessions[sessionID];
      }

      await this.writeState(state);
      return enabled;
    });
  }

  private mutate<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.pendingMutations.then(async () => {
      const lockOwner = await this.acquireLock();

      try {
        return await mutation();
      } finally {
        await this.releaseLock(lockOwner);
      }
    });
    this.pendingMutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async acquireLock(): Promise<string> {
    await mkdir(this.stateDirectory, { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (true) {
      const lockOwner = randomUUID();

      try {
        const lock = await open(this.lockFile, "wx", 0o600);

        try {
          await lock.writeFile(lockOwner, "utf8");
        } catch (error) {
          await rm(this.lockFile, { force: true });
          throw error;
        } finally {
          await lock.close();
        }

        return lockOwner;
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) {
          throw error;
        }
      }

      await this.removeStaleLock();

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Timed out waiting for state lock");
      }
      await delay(Math.min(LOCK_RETRY_INTERVAL_MS, remaining));
    }
  }

  private async removeStaleLock(): Promise<void> {
    try {
      const lock = await stat(this.lockFile);

      if (Date.now() - lock.mtimeMs > LOCK_STALE_MS) {
        await rm(this.lockFile, { force: true });
      }
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  }

  private async releaseLock(lockOwner: string): Promise<void> {
    try {
      if ((await readFile(this.lockFile, "utf8")) === lockOwner) {
        await rm(this.lockFile, { force: true });
      }
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  }

  private async readState(strict = false): Promise<StateData> {
    try {
      const data: unknown = JSON.parse(await readFile(this.stateFile, "utf8"));

      if (
        typeof data !== "object" ||
        data === null ||
        !("sessions" in data) ||
        typeof data.sessions !== "object" ||
        data.sessions === null ||
        Array.isArray(data.sessions)
      ) {
        return { sessions: {} };
      }

      return {
        sessions: Object.fromEntries(
          Object.entries(data.sessions).filter(([, enabled]) => enabled === true),
        ) as Record<string, true>,
      };
    } catch (error) {
      if (
        !strict ||
        error instanceof SyntaxError ||
        hasErrorCode(error, "ENOENT")
      ) {
        return { sessions: {} };
      }
      throw error;
    }
  }

  private async writeState(state: StateData): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    const temporaryFile = join(
      this.stateDirectory,
      `.state.json.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporaryFile, JSON.stringify(state), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryFile, this.stateFile);
    } finally {
      await rm(temporaryFile, { force: true });
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

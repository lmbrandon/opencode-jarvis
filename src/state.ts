export interface JarvisStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: boolean): Promise<void>;
  remove(key: string): Promise<void>;
}

export class SessionStateStore {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly storage: JarvisStorage) {}

  async isEnabled(sessionID: string): Promise<boolean> {
    await this.pending.get(sessionID);
    return (await this.storage.get(this.key(sessionID))) === true;
  }

  setEnabled(sessionID: string, enabled: boolean): Promise<boolean> {
    return this.mutate(sessionID, async () => {
      if (enabled) {
        await this.storage.set(this.key(sessionID), true);
      } else {
        await this.storage.remove(this.key(sessionID));
      }
      return enabled;
    });
  }

  toggle(sessionID: string): Promise<boolean> {
    return this.mutate(sessionID, async () => {
      const enabled = (await this.storage.get(this.key(sessionID))) !== true;
      if (enabled) {
        await this.storage.set(this.key(sessionID), true);
      } else {
        await this.storage.remove(this.key(sessionID));
      }
      return enabled;
    });
  }

  private key(sessionID: string): string {
    return `session/${sessionID}/enabled`;
  }

  private mutate<T>(sessionID: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(sessionID) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.pending.set(sessionID, tail);
    void tail.then(() => {
      if (this.pending.get(sessionID) === tail) {
        this.pending.delete(sessionID);
      }
    });
    return result;
  }
}

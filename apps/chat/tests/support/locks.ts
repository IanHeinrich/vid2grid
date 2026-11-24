interface Waiting {
  name: string;
  mode: LockMode;
  grant(): void;
}

export const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

// One browser's locks, shared by every tab given the same one: shared holders together, others in turn.
export function sharedLocks(): LockManager {
  const held: Waiting[] = [];
  const pending: Waiting[] = [];
  const grantNext = (name: string): void => {
    for (const next of pending.filter((entry) => entry.name === name)) {
      const holders = held.filter((entry) => entry.name === name);
      const free = holders.every((entry) => entry.mode === "shared" && next.mode === "shared");
      if (!free) return;
      pending.splice(pending.indexOf(next), 1);
      held.push(next);
      next.grant();
    }
  };
  const request = async (
    name: string,
    optionsOrWork: LockOptions | (() => unknown),
    given?: () => unknown,
  ): Promise<unknown> => {
    const work = typeof optionsOrWork === "function" ? optionsOrWork : given;
    const mode = typeof optionsOrWork === "function" ? "exclusive" : optionsOrWork.mode;
    const entry: Waiting = { name, mode: mode ?? "exclusive", grant: () => undefined };
    const granted = new Promise<void>((resolve) => (entry.grant = resolve));
    pending.push(entry);
    grantNext(name);
    await granted;
    try {
      return await work?.();
    } finally {
      held.splice(held.indexOf(entry), 1);
      grantNext(name);
    }
  };
  const info = ({ name, mode }: Waiting): LockInfo => ({ name, mode });
  const query = () => Promise.resolve({ held: held.map(info), pending: pending.map(info) });
  return { request: request as LockManager["request"], query };
}

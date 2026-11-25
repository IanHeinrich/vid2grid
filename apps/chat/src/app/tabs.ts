// Every open tab holds a lock of its own under this prefix for as long as it lives.
export const OPEN_TAB_PREFIX = "vid2grid-chat-open-tab/";
// Held while images are deleted; a tab that is opening waits for it before it reads anything.
export const CLEANUP_LOCK = "vid2grid-chat-cleanup";

const JOIN_WAIT_MS = 3000;
// Less than JOIN_WAIT_MS, so a deletion begins before a tab that gives up waiting reads anything.
const BEGIN_MS = 2000;

export type TabRefusal = "otherTabs" | "unsupported";

export type AloneResult<T> = { done: T } | { refused: TabRefusal };

export interface Tabs {
  // False when this tab cannot say whether other tabs are open, or cannot yet.
  readonly supported: boolean;
  // Runs the work only while no other tab of the app is open. It begins no deletion once out of time.
  whileAlone<T>(work: (inTime: () => boolean) => Promise<T>): Promise<AloneResult<T>>;
}

const UNKNOWN_TABS: Tabs = {
  supported: false,
  whileAlone: () => Promise.resolve({ refused: "unsupported" }),
};

export function browserLocks(): LockManager | undefined {
  return "locks" in navigator ? navigator.locks : undefined;
}

// Locks that fail or never answer leave a tab that deletes nothing, not one that never opens.
export async function joinTabs(
  locks: LockManager | undefined,
  waitMs = JOIN_WAIT_MS,
): Promise<Tabs> {
  if (!locks) return UNKNOWN_TABS;
  let tabs = UNKNOWN_TABS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  const joined = join(locks).then(
    (joinedTabs) => {
      tabs = joinedTabs;
    },
    () => undefined,
  );
  await Promise.race([joined, waited]);
  clearTimeout(timer);
  // A join that takes too long may still go through later.
  return {
    get supported() {
      return tabs.supported;
    },
    whileAlone: (work) => tabs.whileAlone(work),
  };
}

async function join(locks: LockManager): Promise<Tabs> {
  const own = `${OPEN_TAB_PREFIX}${crypto.randomUUID()}`;
  await holdForLife(locks, own);
  await locks.request(CLEANUP_LOCK, { mode: "shared" }, () => undefined);
  return { supported: true, whileAlone: (work) => whileAlone(locks, own, work) };
}

function holdForLife(locks: LockManager, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    locks
      .request(name, () => {
        resolve();
        return new Promise<void>(() => undefined);
      })
      .catch(reject);
  });
}

async function whileAlone<T>(
  locks: LockManager,
  own: string,
  work: (inTime: () => boolean) => Promise<T>,
): Promise<AloneResult<T>> {
  return locks.request(CLEANUP_LOCK, async (): Promise<AloneResult<T>> => {
    const started = Date.now();
    const refused = await refusal(locks, own);
    if (refused) return { refused };
    return { done: await work(() => Date.now() - started < BEGIN_MS) };
  });
}

// A tab still waiting for its lock counts too; this tab must be seen holding its own.
async function refusal(locks: LockManager, own: string): Promise<TabRefusal | undefined> {
  const { held = [], pending = [] } = await locks.query();
  const others = [...held, ...pending].some(
    ({ name }) => name?.startsWith(OPEN_TAB_PREFIX) === true && name !== own,
  );
  if (others) return "otherTabs";
  return held.some(({ name }) => name === own) ? undefined : "unsupported";
}

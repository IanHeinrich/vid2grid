import { afterEach, describe, expect, it, vi } from "vitest";
import { CLEANUP_LOCK, joinTabs, OPEN_TAB_PREFIX } from "../src/app/tabs";
import { settled, sharedLocks } from "./support/locks";

afterEach(() => vi.useRealTimers());

async function openNames(locks: LockManager): Promise<string[]> {
  const { held = [] } = await locks.query();
  return held.flatMap(({ name }) => (name?.startsWith(OPEN_TAB_PREFIX) ? [name] : []));
}

describe("whileAlone", () => {
  it("runs the work when this is the only tab", async () => {
    const tabs = await joinTabs(sharedLocks());
    expect(tabs.supported).toBe(true);
    expect(await tabs.whileAlone(() => Promise.resolve("swept"))).toEqual({ done: "swept" });
  });

  it("refuses while another tab is open, and keeps both tabs' own locks", async () => {
    const locks = sharedLocks();
    const [here, there] = [await joinTabs(locks), await joinTabs(locks)];
    const work = vi.fn(() => Promise.resolve());
    expect(await here.whileAlone(work)).toEqual({ refused: "otherTabs" });
    expect(await there.whileAlone(work)).toEqual({ refused: "otherTabs" });
    expect(work).not.toHaveBeenCalled();
    expect(new Set(await openNames(locks)).size).toBe(2);
  });

  it("refuses both of two tabs that ask at once", async () => {
    const locks = sharedLocks();
    const [here, there] = [await joinTabs(locks), await joinTabs(locks)];
    const work = vi.fn(() => Promise.resolve());
    await Promise.all([here.whileAlone(work), there.whileAlone(work)]);
    expect(work).not.toHaveBeenCalled();
  });

  it("is not alone when its own lock is missing, whatever else is listed", async () => {
    const locks = sharedLocks();
    const here = await joinTabs(locks);
    const [own = ""] = await openNames(locks);
    const listed = (name: string): LockInfo => ({ name, mode: "shared" });
    const work = vi.fn(() => Promise.resolve());
    const ask = (held: LockInfo[], pending: LockInfo[] = []) => {
      locks.query = () => Promise.resolve({ held, pending });
      return here.whileAlone(work);
    };
    expect(await ask([listed(`${OPEN_TAB_PREFIX}other`)])).toEqual({ refused: "otherTabs" });
    expect(await ask([])).toEqual({ refused: "unsupported" });
    expect(await ask([], [listed(own)])).toEqual({ refused: "unsupported" });
    expect(work).not.toHaveBeenCalled();
    await ask([listed(own), listed("some other app")]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("counts a tab still waiting for its own lock", async () => {
    const locks = sharedLocks();
    const here = await joinTabs(locks);
    const query = locks.query.bind(locks);
    const waiting: LockInfo = { name: `${OPEN_TAB_PREFIX}other`, mode: "shared" };
    locks.query = async () => ({ ...(await query()), pending: [waiting] });
    const work = vi.fn(() => Promise.resolve());
    expect(await here.whileAlone(work)).toEqual({ refused: "otherTabs" });
  });

  it("runs the work of one tab in turn", async () => {
    const tabs = await joinTabs(sharedLocks());
    const order: string[] = [];
    const work = (name: string) => async () => {
      order.push(`${name} starts`);
      await settled();
      order.push(`${name} ends`);
    };
    await Promise.all([tabs.whileAlone(work("a")), tabs.whileAlone(work("b"))]);
    expect(order).toEqual(["a starts", "a ends", "b starts", "b ends"]);
  });

  it("tells slow work it is out of time before a waiting tab would stop waiting", async () => {
    const tabs = await joinTabs(sharedLocks());
    const seen: boolean[] = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    await tabs.whileAlone((inTime) => {
      seen.push(inTime());
      vi.setSystemTime(Date.now() + 2500);
      seen.push(inTime());
      return Promise.resolve();
    });
    expect(seen).toEqual([true, false]);
  });

  it("frees the lock when the work fails", async () => {
    const locks = sharedLocks();
    const tabs = await joinTabs(locks);
    await expect(tabs.whileAlone(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
    const { held = [] } = await locks.query();
    expect(held.map((lock) => lock.name)).not.toContain(CLEANUP_LOCK);
  });
});

describe("joinTabs", () => {
  it("makes a tab opened meanwhile wait until the work is done", async () => {
    const locks = sharedLocks();
    const here = await joinTabs(locks);
    let finish: () => void = () => undefined;
    const working = here.whileAlone(() => new Promise<void>((resolve) => (finish = resolve)));
    await settled();
    const joined = vi.fn();
    const joining = joinTabs(locks).then(joined);
    await settled();
    expect(joined).not.toHaveBeenCalled();
    finish();
    await Promise.all([working, joining]);
    expect(joined).toHaveBeenCalledTimes(1);
  });

  it("stops waiting for a cleanup that never ends, but is still counted as open", async () => {
    const locks = sharedLocks();
    const here = await joinTabs(locks);
    void here.whileAlone(() => new Promise<void>(() => undefined));
    await settled();
    const late = await joinTabs(locks, 5);
    const work = vi.fn(() => Promise.resolve());
    expect(late.supported).toBe(false);
    expect(await late.whileAlone(work)).toEqual({ refused: "unsupported" });
    expect(work).not.toHaveBeenCalled();
    expect(await openNames(locks)).toHaveLength(2);
  });

  it("stops waiting for locks that never answer", async () => {
    const locks = sharedLocks();
    locks.request = () => new Promise(() => undefined);
    expect((await joinTabs(locks, 5)).supported).toBe(false);
  });

  it("runs nothing without locks, or when they are refused", async () => {
    const work = vi.fn(() => Promise.resolve());
    const missing = await joinTabs(undefined);
    expect(missing.supported).toBe(false);
    expect(await missing.whileAlone(work)).toEqual({ refused: "unsupported" });
    const locks = sharedLocks();
    locks.request = () => Promise.reject(new Error("SecurityError"));
    expect((await joinTabs(locks)).supported).toBe(false);
    locks.request = () => {
      throw new Error("SecurityError");
    };
    expect((await joinTabs(locks)).supported).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });
});

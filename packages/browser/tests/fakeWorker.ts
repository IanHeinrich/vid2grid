import type { WorkerReply, WorkerRequest } from "../src/shared/workerRequest";

interface FakeWorkerEvent {
  data?: unknown;
  message?: string;
  error?: unknown;
}

type Listener = (event: FakeWorkerEvent) => void;

// jsdom has no Worker; this one records what is posted and replays whatever a test sends back.
export class FakeWorker<TPayload = unknown> {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly received: { request: WorkerRequest<TPayload>; transfer: Transferable[] }[] = [];

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(request: WorkerRequest<TPayload>, transfer: Transferable[]): void {
    this.received.push({ request, transfer });
  }

  emit(type: string, event: FakeWorkerEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  reply<TProgress, TResult>(data: WorkerReply<TProgress, TResult>): void {
    this.emit("message", { data });
  }

  idOf(index: number): number {
    const entry = this.received[index];
    if (!entry) throw new Error(`no request ${index} was posted`);
    return entry.request.id;
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }
}

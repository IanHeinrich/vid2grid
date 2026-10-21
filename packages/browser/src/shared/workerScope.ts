export interface WorkerScope<TIncoming, TOutgoing> {
  onmessage: ((event: MessageEvent<TIncoming>) => void | Promise<void>) | null;
  postMessage(message: TOutgoing, transfer?: Transferable[]): void;
}

// The DOM lib types `self` as a Window; casting avoids pulling in the conflicting WebWorker lib.
export function getWorkerScope<TIncoming, TOutgoing>(): WorkerScope<TIncoming, TOutgoing> {
  return self as unknown as WorkerScope<TIncoming, TOutgoing>;
}

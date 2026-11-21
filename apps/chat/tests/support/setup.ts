import "vitest-canvas-mock";
import { vi } from "vitest";

// vitest-canvas-mock installs from an import it never awaits, so a fast file could finish first.
await vi.waitFor(
  () => {
    if (!Reflect.has(globalThis, "createImageBitmap")) {
      throw new Error("vitest-canvas-mock has not installed yet");
    }
  },
  { interval: 1 },
);

vi.mock("@vid2grid/browser", () => ({}));

// jsdom 25 lacks AbortSignal.any, which every browser the app runs in has.
if (!Reflect.has(AbortSignal, "any")) {
  Object.assign(AbortSignal, {
    any: (signals: readonly AbortSignal[]): AbortSignal => {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort(signal.reason);
          break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    },
  });
}

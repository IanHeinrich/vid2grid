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

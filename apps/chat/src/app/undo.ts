import { errorText } from "../text";
import type { Toast, ToastHandle } from "../ui/shared/toast";

export interface UndoOffer {
  undo(): void | Promise<void>;
  // False once the chat or video the change belongs to is no longer in front, so Undo does nothing.
  stillValid?: () => boolean;
  expired?: () => void;
  failed?: (error: unknown) => void;
}

export function offerUndo(
  toast: Pick<Toast, "show">,
  message: string,
  offer: UndoOffer,
): ToastHandle {
  const failed =
    offer.failed ?? ((error: unknown) => toast.show(`Could not undo: ${errorText(error)}`));
  return toast.show(message, {
    label: "Undo",
    run: () => {
      if (offer.stillValid?.() === false) return;
      try {
        const done = offer.undo();
        if (done instanceof Promise) done.catch(failed);
      } catch (error) {
        failed(error);
      }
    },
    ...(offer.expired ? { expired: offer.expired } : {}),
  });
}

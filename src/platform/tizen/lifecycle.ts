import type { Logger } from "../../logging/logger";
import "./runtime";

// Application visibility and exit, verified against Samsung's Smart TV guides:
// - Multitasking: the app is notified through the document `visibilitychange`
//   event each time it is hidden or resumed, and reads `document.hidden`.
//   JavaScript is paused while hidden. (Supported since Chrome 33, so on
// Tizen 4.0 / Chromium 56.)
// - Terminating applications: exit with
//   tizen.application.getCurrentApplication().exit() (Application API, since
//   Tizen 2.0, no privilege).
// UI code depends on this interface only, never on these APIs directly.

export type AppVisibility = "hidden" | "visible";

export type AppLifecycle = {
  destroy(): void;
  // Terminates the app on the TV. Harmless in the desktop preview.
  exit(): void;
  onVisibilityChange(listener: (visibility: AppVisibility) => void): () => void;
};

type LifecycleOptions = {
  documentRef?: Document;
  logger: Logger;
  windowRef?: Window;
};

export function createAppLifecycle(options: LifecycleOptions): AppLifecycle {
  const documentRef = options.documentRef || document;
  const windowRef = options.windowRef || window;
  const listeners: Array<(visibility: AppVisibility) => void> = [];
  const handleVisibilityChange = () => {
    const visibility: AppVisibility = documentRef.hidden ? "hidden" : "visible";

    listeners.slice().forEach((listener) => listener(visibility));
  };

  documentRef.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    destroy() {
      documentRef.removeEventListener("visibilitychange", handleVisibilityChange);
      listeners.length = 0;
    },
    exit() {
      const application = windowRef.tizen?.application;

      if (!application) {
        options.logger.info("Exit requested outside the Tizen runtime; ignoring.");
        return;
      }

      try {
        application.getCurrentApplication().exit();
      } catch (error) {
        options.logger.error("Tizen application exit failed.", { error });
      }
    },
    onVisibilityChange(listener) {
      listeners.push(listener);

      return () => {
        const index = listeners.indexOf(listener);

        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    }
  };
}

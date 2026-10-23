import { consoleLogger } from "../logging/logger";
import { registerMediaRemoteKeys } from "../platform/tizen/keys";
import { createAppLifecycle } from "../platform/tizen/lifecycle";
import { readBuildAppVersion, readBuildConnectionDefaults } from "../platform/build-config";
import { createLocalAppSettingsStore } from "../storage/app-settings-store";
import { createLocalConnectionSettingsStore } from "../storage/connection-settings-store";
import { createLocalViewingHistoryStore } from "../storage/viewing-history-store";
import { createAlbumService } from "./album-service";
import { composeApplication } from "./application";
import { createConnectionService } from "./connection-service";
import { createViewingHistoryService } from "./viewing-history-service";

// Entry point: creates the real services and platform adapters for the TV
// runtime, then composes and starts the application.

const versionLabel =
  typeof document.getElementById === "function" ? document.getElementById("top-nav-version") : null;
if (versionLabel) {
  versionLabel.textContent = `v${readBuildAppVersion()}`;
}

// Let the TV draw the splash before the app is assembled behind it: building
// every screen and starting Home takes a noticeable moment on the TV, and
// until this script yields nothing on the page can be drawn.
afterNextPaint(() => {
  const store = createLocalConnectionSettingsStore(
    window.localStorage,
    readBuildConnectionDefaults()
  );
  const fetchImpl = window.fetch.bind(window);
  const lifecycle = createAppLifecycle({ logger: consoleLogger });

  registerMediaRemoteKeys(window);

  const application = composeApplication({
    albumService: createAlbumService({ fetchImpl, logger: consoleLogger, store }),
    connectionService: createConnectionService({ fetchImpl, logger: consoleLogger, store }),
    lifecycle,
    logger: consoleLogger,
    settingsStore: createLocalAppSettingsStore(window.localStorage),
    viewingHistory: createViewingHistoryService({
      connections: store,
      fetchImpl,
      history: createLocalViewingHistoryStore(window.localStorage),
      logger: consoleLogger
    })
  });

  application.start();

  window.addEventListener("pagehide", () => {
    lifecycle.destroy();
    application.destroy();
  });
});

// A requestAnimationFrame callback runs just before a frame is drawn; the
// timeout then runs after that frame, once the splash is on screen.
function afterNextPaint(callback: () => void): void {
  window.requestAnimationFrame(() => {
    window.setTimeout(callback, 0);
  });
}

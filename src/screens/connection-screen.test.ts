// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionService } from "../app/connection-service";
import { defaultAppSettings, type AppSettings } from "../domain/app-settings";
import { remoteKeys } from "../platform/tizen/keys";
import { byId, loadAppMarkup, pressKey } from "../test/app-markup";
import { mountConnectionScreen, type ConnectionScreenController } from "./connection-screen";

const savedSettings = { apiKey: "test-key", serverUrl: "https://immich.example" };
let controller: ConnectionScreenController | null = null;
let restoreToggleAttribute: (() => void) | null = null;

// Chromium 63 has no Element.toggleAttribute (Chrome 69+). Remove it so any
// regression throws exactly as it would on the Q950R.
function removeChrome69ToggleAttribute(): void {
  const prototype = Element.prototype as unknown as Record<string, unknown>;
  const original = prototype.toggleAttribute;

  delete prototype.toggleAttribute;
  restoreToggleAttribute = () => {
    prototype.toggleAttribute = original;
  };
}

function mount(
  options: { settings?: typeof savedSettings | null; appSettings?: AppSettings } = {}
) {
  const service: ConnectionService = {
    load: vi.fn(() => (options.settings === undefined ? savedSettings : options.settings)),
    save: vi.fn((settings) => settings),
    test: vi
      .fn()
      .mockResolvedValue({ serverLabel: "Immich v2", userLabel: "Test User", versionWarning: null })
  };
  const settingsStore = {
    load: vi.fn(() => options.appSettings || defaultAppSettings),
    save: vi.fn((settings: AppSettings) => settings)
  };
  const onBack = vi.fn();
  const onSaved = vi.fn();
  const onReturnToShell = vi.fn();

  controller = mountConnectionScreen({ onBack, onReturnToShell, onSaved, service, settingsStore });

  return { onBack, onReturnToShell, onSaved, service, settingsStore };
}

function changeAutoplay(): void {
  const autoplay = byId<HTMLInputElement>("autoplay-videos");

  autoplay.checked = !autoplay.checked;
  autoplay.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  loadAppMarkup();
  // The shell reveals the app after the splash; Settings skips controls inside
  // hidden ancestors.
  byId("app-shell").hidden = false;
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  restoreToggleAttribute?.();
  restoreToggleAttribute = null;
});

describe("Settings dirty state on Chromium 63", () => {
  // happy-dom itself uses toggleAttribute (for example for `hidden`), so it is
  // removed only for these dirty-state checks.
  beforeEach(() => {
    removeChrome69ToggleAttribute();
  });

  it("shows and clears the unsaved indicator without Element.toggleAttribute", () => {
    mount();
    controller!.show({ allowBack: true });
    const save = byId("settings-save");

    expect("toggleAttribute" in Element.prototype).toBe(false);
    expect(save.hasAttribute("data-dirty")).toBe(false);

    changeAutoplay();

    expect(save.hasAttribute("data-dirty")).toBe(true);
    expect(byId("settings-save-label").textContent).toBe("Save *");

    save.focus();
    pressKey(remoteKeys.enter);

    expect(save.hasAttribute("data-dirty")).toBe(false);
    expect(byId("settings-save-label").textContent).toBe("Save");
  });

  it("keeps the periodic dirty-state refresh running without throwing", () => {
    vi.useFakeTimers();
    try {
      mount();
      controller!.show({ allowBack: true });
      changeAutoplay();

      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      expect(byId("settings-save").hasAttribute("data-dirty")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Settings remote navigation and actions", () => {
  it("starts with Connection visible and moves between navigation and controls", () => {
    mount();
    controller!.show({ allowBack: true });

    expect(document.activeElement).toBe(byId("settings-section-connection"));
    expect(byId("settings-panel-connection").hidden).toBe(false);
    expect(byId<HTMLInputElement>("server-url").value).toBe("https://immich.example");

    pressKey(remoteKeys.right);
    expect(byId("settings-panel-connection").hidden).toBe(false);
    expect(document.activeElement).toBe(byId("server-url"));

    pressKey(remoteKeys.left);
    expect(byId("settings-panel-connection").hidden).toBe(false);
    expect(document.activeElement).toBe(byId("settings-section-connection"));

    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("settings-section-display"));
    expect(byId("settings-panel-display").hidden).toBe(false);
    pressKey(remoteKeys.enter);
    expect(byId("settings-panel-display").hidden).toBe(false);
    expect(document.activeElement).toBe(byId("autoplay-videos"));
  });

  it("enables text entry only after OK and keeps the API key masked until shown", () => {
    mount();
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.right);
    const serverUrl = byId<HTMLInputElement>("server-url");

    expect(serverUrl.readOnly).toBe(true);
    pressKey(remoteKeys.enter);
    expect(serverUrl.readOnly).toBe(false);
    expect(serverUrl.getAttribute("data-editing")).toBe("true");

    pressKey(remoteKeys.down);
    expect(serverUrl.readOnly).toBe(true);
    expect(document.activeElement).toBe(byId("api-key"));
    expect(byId<HTMLInputElement>("api-key").type).toBe("password");

    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("api-key-visibility"));
    pressKey(remoteKeys.enter);
    expect(byId<HTMLInputElement>("api-key").type).toBe("text");
    expect(byId("api-key-visibility").textContent).toBe("Hide");
  });

  it("tests the connection without saving and reports the result", async () => {
    const { service } = mount();
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    expect(document.activeElement?.getAttribute("data-action")).toBe("test-connection");

    pressKey(remoteKeys.enter);
    expect(byId("connection-status").getAttribute("data-state")).toBe("pending");
    await vi.waitFor(() =>
      expect(byId("connection-status").textContent).toBe("Immich v2 found. Connected as Test User.")
    );
    expect(service.test).toHaveBeenCalledWith(savedSettings);
    expect(service.save).not.toHaveBeenCalled();
  });

  it("shows an older server's version warning after a successful test", async () => {
    const { service } = mount();
    vi.mocked(service.test).mockResolvedValueOnce({
      serverLabel: "Immich 3.1.0",
      userLabel: "Test User",
      versionWarning: "This server needs updating to Immich 3.2.0 or later."
    });
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    pressKey(remoteKeys.enter);

    await vi.waitFor(() =>
      expect(byId("connection-status").textContent).toBe(
        "Immich 3.1.0 found. Connected as Test User. This server needs updating to Immich 3.2.0 or later."
      )
    );
    expect(byId("connection-status").getAttribute("data-state")).toBe("warning");
  });

  it("explains an invalid server URL and a failed connection test", async () => {
    const { service } = mount();
    vi.mocked(service.test).mockRejectedValueOnce(new Error("offline"));
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    pressKey(remoteKeys.enter);
    await vi.waitFor(() =>
      expect(byId("connection-status").getAttribute("data-state")).toBe("error")
    );
    expect(byId("connection-status").textContent).toBe(
      "Something unexpected happened while checking Immich."
    );

    byId<HTMLInputElement>("server-url").value = "ftp://immich.example";
    pressKey(remoteKeys.enter);
    expect(byId("connection-status").textContent).toBe(
      "Server URL must start with http:// or https://."
    );
    expect(service.test).toHaveBeenCalledTimes(1);
  });

  it("saves connection and display settings together", () => {
    const { onSaved, service, settingsStore } = mount();
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.enter);
    for (let step = 0; step < 4; step += 1) pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("slideshow-interval"));
    pressKey(remoteKeys.right);

    byId("settings-save").focus();
    pressKey(remoteKeys.enter);

    expect(service.save).toHaveBeenCalledWith(savedSettings);
    expect(settingsStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ autoplayVideos: true, slideshowIntervalSeconds: 12 })
    );
    expect(byId("settings-summary").textContent).toBe("Settings saved.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("guards an unsaved exit with Save and exit, Discard and Cancel", () => {
    const { onBack, onSaved } = mount();
    controller!.show({ allowBack: true });
    changeAutoplay();

    expect(controller!.requestExit()).toBe(false);
    expect(byId("settings-panel-unsaved").hidden).toBe(false);
    expect(document.activeElement?.getAttribute("data-action")).toBe("save-and-exit");

    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    expect(document.activeElement?.getAttribute("data-action")).toBe("cancel-exit");
    pressKey(remoteKeys.enter);
    expect(byId("settings-panel-unsaved").hidden).toBe(true);
    expect(byId("settings-summary").textContent).toBe("Exit cancelled.");

    pressKey(remoteKeys.back);
    pressKey(remoteKeys.down);
    expect(document.activeElement?.getAttribute("data-action")).toBe("discard-and-exit");
    pressKey(remoteKeys.enter);
    expect(onBack).toHaveBeenCalledWith({ bypassGuard: true });

    controller!.show({ allowBack: true });
    changeAutoplay();
    pressKey(remoteKeys.back);
    pressKey(remoteKeys.enter);
    expect(onSaved).toHaveBeenCalledWith(savedSettings);
  });

  it("exits immediately when nothing changed", () => {
    const { onBack } = mount();
    controller!.show({ allowBack: true });

    expect(controller!.requestExit()).toBe(true);
    pressKey(remoteKeys.back);
    expect(onBack).toHaveBeenCalledWith();
  });

  it("stays on first-run setup, then saving opens the app", () => {
    const { onBack, onReturnToShell, onSaved } = mount({ settings: null });
    controller!.show({ allowBack: false });

    expect(byId("connection-back").hidden).toBe(true);
    expect(byId<HTMLInputElement>("server-url").value).toBe("");
    pressKey(remoteKeys.back);
    expect(byId("settings-summary").textContent).toBe("Connection setup is the first screen.");
    expect(onBack).not.toHaveBeenCalled();

    pressKey(remoteKeys.left);
    expect(onReturnToShell).toHaveBeenCalledTimes(1);

    byId<HTMLInputElement>("server-url").value = "https://immich.example";
    byId<HTMLInputElement>("api-key").value = "test-key";
    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(onSaved).toHaveBeenCalledWith(savedSettings);
  });

  it("stops the dirty-state timer when hidden", () => {
    vi.useFakeTimers();
    try {
      mount();
      controller!.show({ allowBack: true });
      expect(vi.getTimerCount()).toBe(1);
      controller!.hide();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

import type { ConnectionSettings } from "../domain/connection";
import { toUserMessage } from "../errors/app-error";
import { createFocusNavigator, isInputElement } from "../navigation/focus-navigation";
import { getKeyCode, remoteKeys } from "../platform/tizen/keys";
import { validateConnectionSettings } from "../utils/url";
import type { ConnectionService } from "../app/connection-service";
import type { AppSettingsStore } from "../storage/app-settings-store";

type ConnectionScreenElements = {
  apiKeyInput: HTMLInputElement;
  apiKeyVisibilityButton: HTMLButtonElement;
  autoplayVideosInput: HTMLInputElement;
  backButton: HTMLButtonElement;
  form: HTMLFormElement;
  root: HTMLElement;
  serverUrlInput: HTMLInputElement;
  settingsPanelConnection: HTMLElement;
  settingsPanelDisplay: HTMLElement;
  settingsPanelUnsaved: HTMLElement;
  settingsSaveButton: HTMLButtonElement;
  settingsSaveLabel: HTMLElement;
  settingsSectionConnection: HTMLButtonElement;
  settingsSectionDisplay: HTMLButtonElement;
  showViewerDateInput: HTMLInputElement;
  showViewerExifInput: HTMLInputElement;
  showViewerTimeInput: HTMLInputElement;
  slideshowIntervalInput: HTMLSelectElement;
  status: HTMLElement;
  summary: HTMLElement;
};

type SettingsSection = "connection" | "display";

type SettingsKeydownResult = {
  activeSection: SettingsSection;
  savedSnapshot: string;
};

type SettingsSnapshot = {
  apiKey: string;
  autoplayVideos: boolean;
  serverUrl: string;
  showViewerDate: boolean;
  showViewerExif: boolean;
  showViewerTime: boolean;
  slideshowIntervalSeconds: string;
};

type SettingsBackOptions = {
  bypassGuard?: boolean;
};

type ConnectionScreenOptions = {
  documentRef?: Document;
  onBack?(options?: SettingsBackOptions): void;
  onReturnToShell?(): void;
  onSaved?(settings: ConnectionSettings): void;
  settingsStore: AppSettingsStore;
  service: ConnectionService;
};

export type ConnectionScreenController = {
  destroy(): void;
  focusContent(): void;
  hide(): void;
  requestExit(): boolean;
  show(options?: { allowBack?: boolean }): void;
};

export function mountConnectionScreen(
  options: ConnectionScreenOptions
): ConnectionScreenController {
  const documentRef = options.documentRef || document;
  const elements = readElements(documentRef);
  const navigator = createFocusNavigator(
    () =>
      Array.prototype.slice
        .call(elements.root.querySelectorAll(".focusable:not([hidden])"))
        .filter(isVisibleElement),
    () => documentRef.activeElement
  );
  let activeSection: SettingsSection = "connection";
  let savedSnapshot = "";
  let dirtyStatusTimerId: number | null = null;
  let suppressNextActionClick = false;

  hydrateForm(options.service, options.settingsStore, elements);
  disableTextEntry(elements);
  savedSnapshot = readSettingsSnapshot(elements);
  hideSettingsPanels(elements);

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    testConnection(options.service, elements);
  });
  elements.form.addEventListener("input", () => {
    updateDirtyStatus(elements, savedSnapshot);
  });
  elements.form.addEventListener("change", () => {
    updateDirtyStatus(elements, savedSnapshot);
  });
  elements.form.addEventListener("click", (event) => {
    const actionElement = findActionElement(event.target);

    if (!actionElement) {
      return;
    }

    event.preventDefault();

    if (suppressNextActionClick) {
      suppressNextActionClick = false;
      return;
    }

    const actionResult = handleAction(
      actionElement.getAttribute("data-action"),
      options.service,
      elements,
      options,
      activeSection,
      savedSnapshot
    );
    savedSnapshot = actionResult.savedSnapshot;
    activeSection = actionResult.activeSection;
  });

  // Keys on the left rail belong to the shell: handling them here moved
  // focus into Settings' sections when Down on the Settings rail item should
  // reach Refresh.
  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (elements.root.hidden || !elements.root.contains(event.target as Node | null)) {
      return;
    }

    const keydownResult = handleKeydown(
      event,
      options.service,
      elements,
      navigator,
      documentRef,
      options,
      activeSection,
      savedSnapshot,
      () => {
        suppressNextActionClick = true;
      }
    );
    savedSnapshot = keydownResult.savedSnapshot;
    activeSection = keydownResult.activeSection;
  };

  documentRef.addEventListener("keydown", handleDocumentKeydown);

  return {
    destroy() {
      documentRef.removeEventListener("keydown", handleDocumentKeydown);
      stopDirtyStatusTimer();
    },
    focusContent() {
      elements.settingsSectionConnection.focus();
    },
    hide() {
      stopDirtyStatusTimer();
      disableTextEntry(elements);
      elements.root.hidden = true;
    },
    requestExit() {
      return requestSettingsExit(elements, activeSection, savedSnapshot);
    },
    show(showOptions = {}) {
      elements.root.hidden = false;
      elements.backButton.hidden = !showOptions.allowBack;
      activeSection = "connection";
      hydrateForm(options.service, options.settingsStore, elements);
      savedSnapshot = readSettingsSnapshot(elements);
      showSettingsSection(elements, activeSection);
      disableTextEntry(elements);
      updateDirtyStatus(elements, savedSnapshot);
      startDirtyStatusTimer();
      elements.settingsSectionConnection.focus();
    }
  };

  function startDirtyStatusTimer(): void {
    stopDirtyStatusTimer();
    dirtyStatusTimerId = window.setInterval(() => {
      if (!elements.root.hidden) {
        updateDirtyStatus(elements, savedSnapshot);
      }
    }, 250);
  }

  function stopDirtyStatusTimer(): void {
    if (dirtyStatusTimerId !== null) {
      window.clearInterval(dirtyStatusTimerId);
      dirtyStatusTimerId = null;
    }
  }
}

function readElements(documentRef: Document): ConnectionScreenElements {
  return {
    apiKeyInput: requireElement<HTMLInputElement>(documentRef, "api-key"),
    apiKeyVisibilityButton: requireElement<HTMLButtonElement>(documentRef, "api-key-visibility"),
    autoplayVideosInput: requireElement<HTMLInputElement>(documentRef, "autoplay-videos"),
    backButton: requireElement<HTMLButtonElement>(documentRef, "connection-back"),
    form: requireElement<HTMLFormElement>(documentRef, "connection-form"),
    root: requireElement(documentRef, "connection-screen"),
    serverUrlInput: requireElement<HTMLInputElement>(documentRef, "server-url"),
    settingsPanelConnection: requireElement(documentRef, "settings-panel-connection"),
    settingsPanelDisplay: requireElement(documentRef, "settings-panel-display"),
    settingsPanelUnsaved: requireElement(documentRef, "settings-panel-unsaved"),
    settingsSaveButton: requireElement<HTMLButtonElement>(documentRef, "settings-save"),
    settingsSaveLabel: requireElement(documentRef, "settings-save-label"),
    settingsSectionConnection: requireElement<HTMLButtonElement>(
      documentRef,
      "settings-section-connection"
    ),
    settingsSectionDisplay: requireElement<HTMLButtonElement>(
      documentRef,
      "settings-section-display"
    ),
    showViewerDateInput: requireElement<HTMLInputElement>(documentRef, "show-viewer-date"),
    showViewerExifInput: requireElement<HTMLInputElement>(documentRef, "show-viewer-exif"),
    showViewerTimeInput: requireElement<HTMLInputElement>(documentRef, "show-viewer-time"),
    slideshowIntervalInput: requireElement<HTMLSelectElement>(documentRef, "slideshow-interval"),
    status: requireElement(documentRef, "connection-status"),
    summary: requireElement(documentRef, "settings-summary")
  };
}

function requireElement<T extends HTMLElement>(documentRef: Document, id: string): T {
  const element = documentRef.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as T;
}

function getSettingsFromForm(elements: ConnectionScreenElements): ConnectionSettings {
  return {
    apiKey: elements.apiKeyInput.value,
    serverUrl: elements.serverUrlInput.value
  };
}

// Connection results (testing, the API key, text entry) show in the
// Connection section, the only place they apply.
function setStatus(elements: ConnectionScreenElements, message: string, state = "idle"): void {
  elements.status.textContent = message;
  elements.status.setAttribute("data-state", state);
}

const settingsSummary = "Manage connection and display preferences.";

// Messages about Settings as a whole (saving, unsaved changes, exiting) show
// in the summary line above every section, so they are seen from any section.
function setSettingsStatus(
  elements: ConnectionScreenElements,
  message: string,
  state = "idle"
): void {
  elements.summary.textContent = message;
  elements.summary.setAttribute("data-state", state);
}

function readValidSettings(elements: ConnectionScreenElements): ConnectionSettings | null {
  try {
    const settings = validateConnectionSettings(getSettingsFromForm(elements));

    elements.serverUrlInput.value = settings.serverUrl;

    return settings;
  } catch (error) {
    setStatus(elements, toUserMessage(error), "error");

    return null;
  }
}

async function testConnection(
  service: ConnectionService,
  elements: ConnectionScreenElements
): Promise<void> {
  const settings = readValidSettings(elements);

  if (!settings) {
    return;
  }

  setStatus(elements, "Checking Immich server...", "pending");

  try {
    const result = await service.test(settings);

    const found = `${result.serverLabel} found. Connected as ${result.userLabel}.`;

    if (result.versionWarning) {
      setStatus(elements, `${found} ${result.versionWarning}`, "warning");
    } else {
      setStatus(elements, found, "success");
    }
  } catch (error) {
    setStatus(elements, toUserMessage(error), "error");
  }
}

function saveSettings(
  service: ConnectionService,
  elements: ConnectionScreenElements,
  options: ConnectionScreenOptions,
  exitAfterSave: boolean
): boolean {
  try {
    const settings = service.save(getSettingsFromForm(elements));
    const appSettings = options.settingsStore.save({
      autoplayVideos: elements.autoplayVideosInput.checked,
      showViewerDate: elements.showViewerDateInput.checked,
      showViewerExif: elements.showViewerExifInput.checked,
      showViewerTime: elements.showViewerTimeInput.checked,
      slideshowIntervalSeconds: Number(elements.slideshowIntervalInput.value)
    });

    elements.serverUrlInput.value = settings.serverUrl;
    elements.autoplayVideosInput.checked = appSettings.autoplayVideos;
    elements.showViewerDateInput.checked = appSettings.showViewerDate;
    elements.showViewerExifInput.checked = appSettings.showViewerExif;
    elements.showViewerTimeInput.checked = appSettings.showViewerTime;
    elements.slideshowIntervalInput.value = String(appSettings.slideshowIntervalSeconds);
    setSettingsStatus(elements, "Settings saved.", "success");
    if (exitAfterSave || elements.backButton.hidden) {
      options.onSaved?.(settings);
    }

    return true;
  } catch (error) {
    setSettingsStatus(elements, toUserMessage(error), "error");

    return false;
  }
}

function toggleApiKeyVisibility(elements: ConnectionScreenElements): void {
  const isVisible = elements.apiKeyInput.type === "text";

  elements.apiKeyInput.type = isVisible ? "password" : "text";
  elements.apiKeyVisibilityButton.textContent = isVisible ? "Show" : "Hide";
  elements.apiKeyVisibilityButton.setAttribute("aria-pressed", isVisible ? "false" : "true");
  setStatus(elements, isVisible ? "API key hidden." : "API key visible on screen.");
}

function hydrateForm(
  service: ConnectionService,
  settingsStore: AppSettingsStore,
  elements: ConnectionScreenElements
): void {
  const settings = service.load();
  const appSettings = settingsStore.load();

  elements.serverUrlInput.value = "";
  elements.apiKeyInput.value = "";
  elements.autoplayVideosInput.checked = appSettings.autoplayVideos;
  elements.showViewerDateInput.checked = appSettings.showViewerDate;
  elements.showViewerExifInput.checked = appSettings.showViewerExif;
  elements.showViewerTimeInput.checked = appSettings.showViewerTime;
  elements.slideshowIntervalInput.value = String(appSettings.slideshowIntervalSeconds);
  setSettingsStatus(elements, settingsSummary);
  setStatus(elements, "Enter an Immich server URL and API key.");

  if (!settings) {
    return;
  }

  elements.serverUrlInput.value = settings.serverUrl;
  elements.apiKeyInput.value = settings.apiKey;
  setStatus(elements, "Connection settings loaded.", "success");
}

function handleAction(
  action: string | null,
  service: ConnectionService,
  elements: ConnectionScreenElements,
  options: ConnectionScreenOptions,
  activeSection: SettingsSection,
  savedSnapshot: string
): SettingsKeydownResult {
  const result = {
    activeSection,
    savedSnapshot
  };

  if (action === "test-connection") {
    testConnection(service, elements);
    return result;
  }

  if (action === "save-settings") {
    if (saveSettings(service, elements, options, false)) {
      result.savedSnapshot = readSettingsSnapshot(elements);
      updateDirtyStatus(elements, result.savedSnapshot);
    }

    return result;
  }

  if (action === "back-to-albums") {
    handleSettingsExit(elements, options, activeSection, savedSnapshot);
    return result;
  }

  if (action === "save-and-exit") {
    if (saveSettings(service, elements, options, true)) {
      result.savedSnapshot = readSettingsSnapshot(elements);
    }

    return result;
  }

  if (action === "discard-and-exit") {
    disableTextEntry(elements);
    options.onBack?.({ bypassGuard: true });
    return result;
  }

  if (action === "cancel-exit") {
    showSettingsSection(elements, activeSection);
    focusActiveSettingsSection(elements, activeSection);
    setSettingsStatus(elements, "Exit cancelled.");
    return result;
  }

  if (action === "toggle-api-key") {
    toggleApiKeyVisibility(elements);
  }

  return result;
}

function handleKeydown(
  event: KeyboardEvent,
  service: ConnectionService,
  elements: ConnectionScreenElements,
  navigator: ReturnType<typeof createFocusNavigator>,
  documentRef: Document,
  options: ConnectionScreenOptions,
  activeSection: SettingsSection,
  savedSnapshot: string,
  onActionKeydown: () => void
): SettingsKeydownResult {
  const keyCode = getKeyCode(event);
  const activeElement = documentRef.activeElement;
  const result = {
    activeSection,
    savedSnapshot
  };

  if (keyCode === remoteKeys.back) {
    event.preventDefault();
    if (!elements.settingsPanelUnsaved.hidden) {
      showSettingsSection(elements, activeSection);
      focusActiveSettingsSection(elements, activeSection);
      setSettingsStatus(elements, "Exit cancelled.");
      return result;
    }

    if (options.onBack && !elements.backButton.hidden) {
      handleSettingsExit(elements, options, activeSection, savedSnapshot);
      return result;
    }

    setSettingsStatus(elements, "Connection setup is the first screen.");
    return result;
  }

  if (isSettingsRailButton(activeElement)) {
    return handleSettingsRailKeydown(
      event,
      keyCode,
      service,
      elements,
      activeElement,
      options,
      activeSection,
      savedSnapshot,
      onActionKeydown
    );
  }

  if (isInputElement(activeElement)) {
    if (isTextSettingsInput(activeElement) && keyCode === remoteKeys.enter) {
      event.preventDefault();
      enableTextEntry(activeElement, elements);
    } else if (isCheckboxInput(activeElement) && keyCode === remoteKeys.enter) {
      event.preventDefault();
      activeElement.checked = !activeElement.checked;
    } else if (keyCode === remoteKeys.left) {
      event.preventDefault();
      disableTextEntry(elements);
      focusActiveSettingsSection(elements, activeSection);
    } else if (keyCode === remoteKeys.up) {
      event.preventDefault();
      disableTextEntry(elements);
      focusSettingsPanelByOffset(elements, activeElement, activeSection, -1);
    } else if (keyCode === remoteKeys.down) {
      event.preventDefault();
      disableTextEntry(elements);
      focusSettingsPanelByOffset(elements, activeElement, activeSection, 1);
    }

    updateDirtyStatus(elements, savedSnapshot);
    return result;
  }

  if (activeElement instanceof HTMLSelectElement) {
    if (keyCode === remoteKeys.left || keyCode === remoteKeys.right) {
      event.preventDefault();
      moveSelectOption(activeElement, keyCode === remoteKeys.left ? -1 : 1);
    } else if (keyCode === remoteKeys.up) {
      event.preventDefault();
      focusSettingsPanelByOffset(elements, activeElement, activeSection, -1);
    } else if (keyCode === remoteKeys.down) {
      event.preventDefault();
      focusSettingsPanelByOffset(elements, activeElement, activeSection, 1);
    }

    updateDirtyStatus(elements, savedSnapshot);
    return result;
  }

  switch (keyCode) {
    case remoteKeys.left:
      event.preventDefault();
      focusActiveSettingsSection(elements, activeSection);
      break;
    case remoteKeys.up:
      event.preventDefault();
      if (!focusSettingsPanelByOffset(elements, activeElement, activeSection, -1)) {
        navigator.focusByOffset(-1);
      }
      break;
    case remoteKeys.right:
    case remoteKeys.down:
      event.preventDefault();
      if (!focusSettingsPanelByOffset(elements, activeElement, activeSection, 1)) {
        navigator.focusByOffset(1);
      }
      break;
    case remoteKeys.enter:
      event.preventDefault();
      onActionKeydown();
      return handleAction(
        activeElement ? activeElement.getAttribute("data-action") : null,
        service,
        elements,
        options,
        activeSection,
        savedSnapshot
      );
      break;
    default:
      break;
  }

  return result;
}

function isCheckboxInput(element: Element | null): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === "checkbox";
}

function isTextSettingsInput(element: Element | null): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    (element.type === "text" || element.type === "url" || element.type === "password")
  );
}

function enableTextEntry(input: HTMLInputElement, elements: ConnectionScreenElements): void {
  input.readOnly = false;
  input.setAttribute("inputmode", input === elements.serverUrlInput ? "url" : "text");
  input.setAttribute("data-editing", "true");
  elements.root.ownerDocument.documentElement.classList.add("settings-text-entry-active");
  elements.root.ownerDocument.body.classList.add("settings-text-entry-active");
  setStatus(elements, "Text entry enabled.");
}

function disableTextEntry(elements: ConnectionScreenElements): void {
  const inputs = [elements.serverUrlInput, elements.apiKeyInput];

  inputs.forEach((input) => {
    input.readOnly = true;
    input.setAttribute("inputmode", "none");
    input.removeAttribute("data-editing");
  });
  elements.root.ownerDocument.documentElement.classList.remove("settings-text-entry-active");
  elements.root.ownerDocument.body.classList.remove("settings-text-entry-active");
}

function isVisibleElement(element: HTMLElement): boolean {
  return !element.closest("[hidden]");
}

function isSettingsRailButton(element: Element | null): element is HTMLButtonElement {
  return (
    element instanceof HTMLButtonElement && element.classList.contains("settings-section-button")
  );
}

function findActionElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const actionElement = target.closest("[data-action]");

  return actionElement instanceof HTMLElement ? actionElement : null;
}

function handleSettingsRailKeydown(
  event: KeyboardEvent,
  keyCode: number,
  service: ConnectionService,
  elements: ConnectionScreenElements,
  activeElement: HTMLButtonElement,
  options: ConnectionScreenOptions,
  activeSection: SettingsSection,
  savedSnapshot: string,
  onActionKeydown: () => void
): SettingsKeydownResult {
  const result = {
    activeSection,
    savedSnapshot
  };

  if (keyCode === remoteKeys.up || keyCode === remoteKeys.down) {
    event.preventDefault();
    const nextButton = focusSettingsRailByOffset(
      elements,
      activeElement,
      keyCode === remoteKeys.up ? -1 : 1
    );
    const nextSection = nextButton ? readSettingsSection(nextButton) : null;

    if (nextSection) {
      result.activeSection = nextSection;
      showSettingsSection(elements, nextSection);
    }

    return result;
  }

  if (keyCode === remoteKeys.left && options.onReturnToShell) {
    event.preventDefault();
    options.onReturnToShell();
    return result;
  }

  if (keyCode === remoteKeys.right || keyCode === remoteKeys.enter) {
    event.preventDefault();
    const section = readSettingsSection(activeElement) || activeSection;

    if (readSettingsSection(activeElement)) {
      result.activeSection = section;
      showSettingsSection(elements, section);
      focusFirstPanelControl(elements, section);

      return result;
    }

    if (keyCode === remoteKeys.enter) {
      onActionKeydown();
      return handleAction(
        activeElement.getAttribute("data-action"),
        service,
        elements,
        options,
        activeSection,
        savedSnapshot
      );
    }
  }

  return result;
}

function readSettingsSection(element: HTMLElement): SettingsSection | null {
  const section = element.getAttribute("data-settings-section");

  return section === "connection" || section === "display" ? section : null;
}

function focusSettingsRailByOffset(
  elements: ConnectionScreenElements,
  activeElement: HTMLButtonElement,
  offset: number
): HTMLButtonElement | null {
  const buttons = Array.prototype.slice
    .call(elements.root.querySelectorAll(".settings-nav .focusable:not([hidden])"))
    .filter(isVisibleElement) as HTMLButtonElement[];
  const currentIndex = buttons.indexOf(activeElement);
  const nextIndex = Math.max(0, Math.min(buttons.length - 1, currentIndex + offset));
  const nextButton = buttons[nextIndex];

  if (nextButton) {
    nextButton.focus();
    return nextButton;
  }

  return null;
}

function showSettingsSection(elements: ConnectionScreenElements, section: SettingsSection): void {
  const isConnection = section === "connection";

  elements.settingsPanelConnection.hidden = !isConnection;
  elements.settingsPanelDisplay.hidden = isConnection;
  elements.settingsPanelUnsaved.hidden = true;
  elements.settingsSectionConnection.setAttribute("aria-selected", isConnection ? "true" : "false");
  elements.settingsSectionDisplay.setAttribute("aria-selected", isConnection ? "false" : "true");
}

function hideSettingsPanels(elements: ConnectionScreenElements): void {
  elements.settingsPanelConnection.hidden = true;
  elements.settingsPanelDisplay.hidden = true;
  elements.settingsPanelUnsaved.hidden = true;
  elements.settingsSectionConnection.setAttribute("aria-selected", "false");
  elements.settingsSectionDisplay.setAttribute("aria-selected", "false");
}

function focusActiveSettingsSection(
  elements: ConnectionScreenElements,
  section: SettingsSection
): void {
  if (section === "connection") {
    elements.settingsSectionConnection.focus();
    return;
  }

  elements.settingsSectionDisplay.focus();
}

function focusFirstPanelControl(
  elements: ConnectionScreenElements,
  section: SettingsSection
): void {
  if (section === "connection") {
    elements.serverUrlInput.focus();
    return;
  }

  elements.autoplayVideosInput.focus();
}

function focusSettingsPanelByOffset(
  elements: ConnectionScreenElements,
  activeElement: Element | null,
  activeSection: SettingsSection,
  offset: number
): boolean {
  const panel = readOpenSettingsPanel(elements, activeSection);

  if (!panel || !(activeElement instanceof HTMLElement) || !panel.contains(activeElement)) {
    return false;
  }

  const controls = Array.prototype.slice
    .call(panel.querySelectorAll(".focusable:not([hidden])"))
    .filter(isVisibleElement) as HTMLElement[];

  if (controls.length === 0) {
    return false;
  }

  const currentIndex = controls.indexOf(activeElement);
  const baseIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = (baseIndex + offset + controls.length) % controls.length;
  const nextControl = controls[nextIndex];

  if (nextControl) {
    nextControl.focus();
  }

  return true;
}

function readOpenSettingsPanel(
  elements: ConnectionScreenElements,
  activeSection: SettingsSection
): HTMLElement | null {
  if (!elements.settingsPanelUnsaved.hidden) {
    return elements.settingsPanelUnsaved;
  }

  if (activeSection === "connection" && !elements.settingsPanelConnection.hidden) {
    return elements.settingsPanelConnection;
  }

  if (activeSection === "display" && !elements.settingsPanelDisplay.hidden) {
    return elements.settingsPanelDisplay;
  }

  return null;
}

function handleSettingsExit(
  elements: ConnectionScreenElements,
  options: ConnectionScreenOptions,
  activeSection: SettingsSection,
  savedSnapshot: string
): void {
  if (requestSettingsExit(elements, activeSection, savedSnapshot)) {
    options.onBack?.();
  }
}

function requestSettingsExit(
  elements: ConnectionScreenElements,
  activeSection: SettingsSection,
  savedSnapshot: string
): boolean {
  if (!hasUnsavedSettings(elements, savedSnapshot)) {
    return true;
  }

  elements.settingsPanelConnection.hidden = true;
  elements.settingsPanelDisplay.hidden = true;
  elements.settingsPanelUnsaved.hidden = false;
  elements.settingsSectionConnection.setAttribute("aria-selected", "false");
  elements.settingsSectionDisplay.setAttribute("aria-selected", "false");
  elements.settingsPanelUnsaved.setAttribute("data-return-section", activeSection);
  setSettingsStatus(elements, "Unsaved changes.");
  focusUnsavedAction(elements);

  return false;
}

function focusUnsavedAction(elements: ConnectionScreenElements): void {
  const button = elements.settingsPanelUnsaved.querySelector<HTMLButtonElement>(".focusable");

  if (button) {
    button.focus();
  }
}

function readSettingsSnapshot(elements: ConnectionScreenElements): string {
  const snapshot: SettingsSnapshot = {
    apiKey: elements.apiKeyInput.value,
    autoplayVideos: elements.autoplayVideosInput.checked,
    serverUrl: elements.serverUrlInput.value,
    showViewerDate: elements.showViewerDateInput.checked,
    showViewerExif: elements.showViewerExifInput.checked,
    showViewerTime: elements.showViewerTimeInput.checked,
    slideshowIntervalSeconds: elements.slideshowIntervalInput.value
  };

  return JSON.stringify(snapshot);
}

function hasUnsavedSettings(elements: ConnectionScreenElements, savedSnapshot: string): boolean {
  return readSettingsSnapshot(elements) !== savedSnapshot;
}

function updateDirtyStatus(elements: ConnectionScreenElements, savedSnapshot: string): void {
  const hasChanges = hasUnsavedSettings(elements, savedSnapshot);

  // Element.toggleAttribute needs Chrome 69; Tizen 5.0 runs Chromium 63.
  if (hasChanges) {
    elements.settingsSaveButton.setAttribute("data-dirty", "");
  } else {
    elements.settingsSaveButton.removeAttribute("data-dirty");
  }
  elements.settingsSaveLabel.textContent = hasChanges ? "Save *" : "Save";
}

function moveSelectOption(element: HTMLSelectElement, offset: number): void {
  if (element.options.length === 0) {
    return;
  }

  element.selectedIndex = Math.max(
    0,
    Math.min(element.options.length - 1, element.selectedIndex + offset)
  );
}

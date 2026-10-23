import { describe, expect, it } from "vitest";
import {
  createLocalConnectionSettingsStore,
  type KeyValueStorage
} from "./connection-settings-store";

function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  values: Record<string, string>;
} {
  return {
    values: { ...initial },
    getItem(key) {
      return this.values[key] || null;
    },
    setItem(key, value) {
      this.values[key] = value;
    }
  };
}

describe("connection settings store", () => {
  it("returns null when storage is empty", () => {
    const store = createLocalConnectionSettingsStore(createMemoryStorage());

    expect(store.load()).toBeNull();
  });

  it("uses private build defaults until the user saves an override", () => {
    const storage = createMemoryStorage();
    const defaults = {
      apiKey: "build-key",
      serverUrl: "http://build.immich"
    };
    const store = createLocalConnectionSettingsStore(storage, defaults);

    expect(store.load()).toEqual(defaults);

    store.save({
      apiKey: "user-key",
      serverUrl: "http://user.immich"
    });

    expect(store.load()).toEqual({
      apiKey: "user-key",
      serverUrl: "http://user.immich"
    });
  });

  it("returns null for malformed JSON", () => {
    const store = createLocalConnectionSettingsStore(
      createMemoryStorage({
        "immich-tv.connection": "{bad json"
      })
    );

    expect(store.load()).toBeNull();
  });

  it("normalizes settings on save and load", () => {
    const storage = createMemoryStorage();
    const store = createLocalConnectionSettingsStore(storage);

    store.save({
      apiKey: " key ",
      serverUrl: " http://immich.local:2283/api "
    });

    expect(store.load()).toEqual({
      apiKey: "key",
      serverUrl: "http://immich.local:2283"
    });
  });
});

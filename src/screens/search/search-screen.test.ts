// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineBucket } from "../../domain/album";
import type { SearchPerson } from "../../domain/search";
import { remoteKeys } from "../../platform/tizen/keys";
import { byId, loadAppMarkup, pressKey } from "../../test/app-markup";
import { mountSearchScreen, type SearchScreenController } from "./search-screen";

const person = (index: number): SearchPerson => ({
  id: `person-${index}`,
  name: `Person ${index}`
});
let controller: SearchScreenController | null = null;

function setup(options: { buckets?: TimelineBucket[] | Error } = {}) {
  const onAddPeople = vi.fn();
  const onReturnToShell = vi.fn();
  const onShowPhotos = vi.fn();
  const service = {
    loadPersonThumbnailUrl: vi.fn(async (item: { id: string }) => `blob:${item.id}`),
    loadTimelineBuckets: vi.fn(async () => {
      if (options.buckets instanceof Error) throw options.buckets;
      return (
        options.buckets || [
          { assetCount: 10, timeBucket: "2026-10-01T00:00:00.000Z" },
          { assetCount: 3, timeBucket: "2004-03-01T00:00:00.000Z" }
        ]
      );
    }),
    revokeThumbnailUrl: vi.fn()
  };

  controller = mountSearchScreen({
    onAddPeople,
    onReturnToShell,
    onShowPhotos,
    service,
    today: () => new Date(2026, 9, 16, 12)
  });

  const focused = () => document.activeElement?.getAttribute("data-search-control") ?? null;
  const control = (key: string) =>
    byId("search-panel").querySelector<HTMLElement>(`[data-search-control="${key}"]`);
  const text = (key: string) => control(key)?.textContent ?? null;
  const message = () => byId("search-message").textContent;
  const open = async () => {
    controller!.show();
    controller!.focusContent();
    await vi.waitFor(() => expect(service.loadTimelineBuckets).toHaveBeenCalled());
    await Promise.resolve();
  };

  return {
    control,
    focused,
    message,
    onAddPeople,
    onReturnToShell,
    onShowPhotos,
    open,
    service,
    text
  };
}

beforeEach(() => {
  loadAppMarkup();
});

afterEach(() => {
  controller?.destroy();
  controller = null;
});

describe("Search criteria panel", () => {
  it("starts on Add people with gentle guidance and Show photos unavailable", async () => {
    const f = setup();
    await f.open();

    expect(f.focused()).toBe("add-people");
    expect(f.message()).toContain("Choose people, dates, or both");
    expect(f.control("show")?.getAttribute("aria-disabled")).toBe("true");
    expect(f.control("clear")).toBeNull();
    expect(byId("search-screen").querySelector("h1")?.textContent).toBe("Search");

    pressKey(remoteKeys.enter);
    expect(f.onAddPeople).toHaveBeenCalledWith([]);
  });

  it("moves between rows and within rows, and reaches the rail with Left or Back", async () => {
    const f = setup();
    await f.open();

    pressKey(remoteKeys.down);
    expect(f.focused()).toBe("from");
    pressKey(remoteKeys.right);
    expect(f.focused()).toBe("to");
    pressKey(remoteKeys.down);
    expect(f.focused()).toBe("show");
    pressKey(remoteKeys.up);
    expect(f.focused()).toBe("from");
    pressKey(remoteKeys.left);
    expect(f.onReturnToShell).toHaveBeenCalledTimes(1);
    pressKey(remoteKeys.back);
    expect(f.onReturnToShell).toHaveBeenCalledTimes(2);
  });

  it("shows chosen people as chips with faces, explains the rule, and removes a chip with OK", async () => {
    const f = setup();
    controller!.setPeople([person(1), person(2)]);
    await f.open();

    expect(f.focused()).toBe("show");
    expect(f.text("chip:person-1")).toContain("Person 1");
    expect(byId("search-panel").textContent).toContain("Photos with all of these people");
    await vi.waitFor(() =>
      expect(f.control("chip:person-1")?.querySelector("img")?.getAttribute("src")).toBe(
        "blob:person-1"
      )
    );

    pressKey(remoteKeys.up);
    expect(f.focused()).toBe("from");
    pressKey(remoteKeys.up);
    expect(f.focused()).toBe("add-people");
    pressKey(remoteKeys.right);
    expect(f.focused()).toBe("chip:person-1");
    pressKey(remoteKeys.enter);
    expect(f.control("chip:person-1")).toBeNull();
    expect(f.focused()).toBe("chip:person-2");
    expect(f.service.revokeThumbnailUrl).toHaveBeenCalledWith("blob:person-1");
    expect(byId("search-panel").textContent).not.toContain("all of these people");

    pressKey(remoteKeys.enter);
    expect(f.focused()).toBe("add-people");
  });

  it("shows the first four chips and +N more, which reopens the picker", async () => {
    const f = setup();
    const six = [1, 2, 3, 4, 5, 6].map(person);
    controller!.setPeople(six);
    await f.open();

    expect(byId("search-panel").querySelectorAll(".search-chip")).toHaveLength(4);
    expect(f.text("more")).toBe("+2 more");
    pressKey(remoteKeys.up);
    pressKey(remoteKeys.up);
    for (let step = 0; step < 6; step += 1) pressKey(remoteKeys.right);
    expect(f.focused()).toBe("more");
    pressKey(remoteKeys.enter);
    expect(f.onAddPeople).toHaveBeenCalledWith(six);
  });

  it("edits a date with the stepper: Up/Down change values, OK sets, Back cancels", async () => {
    const f = setup();
    await f.open();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);

    // To starts at today.
    pressKey(remoteKeys.enter);
    expect(f.focused()).toBe("stepper:day");
    expect(f.text("stepper:day")).toBe("16");
    expect(f.text("stepper:month")).toBe("Oct");
    pressKey(remoteKeys.back);
    expect(f.focused()).toBe("to");
    expect(f.text("to")).toContain("Any date");

    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.down);
    expect([f.text("stepper:day"), f.text("stepper:month"), f.text("stepper:year")]).toEqual([
      "15",
      "Sep",
      "2025"
    ]);
    pressKey(remoteKeys.enter);
    expect(f.focused()).toBe("to");
    expect(f.text("to")).toContain("15 Sep 2025");
    expect(f.control("show")?.getAttribute("aria-disabled")).toBeNull();
  });

  it("starts From at the library's oldest month and bounds the years by the library", async () => {
    const f = setup();
    await f.open();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);

    expect([f.text("stepper:day"), f.text("stepper:month"), f.text("stepper:year")]).toEqual([
      "1",
      "Mar",
      "2004"
    ]);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.down);
    expect(f.text("stepper:year")).toBe("2004");
    pressKey(remoteKeys.enter);
    expect(f.text("from")).toContain("1 Mar 2004");
  });

  it("falls back to the last hundred years when the library span is unavailable", async () => {
    const f = setup({ buckets: new Error("offline") });
    await f.open();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);

    expect(f.text("stepper:year")).toBe("2026");
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.right);
    for (let step = 0; step < 120; step += 1) pressKey(remoteKeys.down);
    expect(f.text("stepper:year")).toBe("1926");
  });

  describe("library date bounds", () => {
    const oldest = (year: number): TimelineBucket[] => [
      { assetCount: 4, timeBucket: `${year}-05-01T00:00:00.000Z` }
    ];
    const deferred = () => {
      let resolve: (buckets: TimelineBucket[]) => void = () => undefined;
      let reject: (error: Error) => void = () => undefined;
      const promise = new Promise<TimelineBucket[]>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      return { promise, reject, resolve };
    };
    const fromStepperStart = async (f: ReturnType<typeof setup>) => {
      controller!.show();
      controller!.focusContent();
      await Promise.resolve();
      pressKey(remoteKeys.down);
      pressKey(remoteKeys.enter);
      const shown = [f.text("stepper:month"), f.text("stepper:year")];
      pressKey(remoteKeys.back);
      return shown;
    };

    it("keeps the library span when it arrives after Search was left", async () => {
      const f = setup();
      const request = deferred();
      f.service.loadTimelineBuckets.mockImplementation(() => request.promise);
      controller!.show();
      controller!.hide();

      request.resolve(oldest(2004));
      await request.promise;

      expect(await fromStepperStart(f)).toEqual(["May", "2004"]);
      expect(f.service.loadTimelineBuckets).toHaveBeenCalledTimes(1);
    });

    it("retries the library span on the next visit after a failure", async () => {
      const f = setup();
      const first = deferred();
      f.service.loadTimelineBuckets
        .mockImplementationOnce(() => first.promise)
        .mockImplementation(async () => oldest(2008));
      controller!.show();
      controller!.hide();
      first.reject(new Error("offline"));
      await first.promise.catch(() => undefined);
      await Promise.resolve();

      controller!.show();
      await vi.waitFor(() => expect(f.service.loadTimelineBuckets).toHaveBeenCalledTimes(2));
      await Promise.resolve();
      controller!.hide();

      expect(await fromStepperStart(f)).toEqual(["May", "2008"]);
    });

    it("discards a span that arrives after the connection changed", async () => {
      const f = setup();
      const stale = deferred();
      f.service.loadTimelineBuckets
        .mockImplementationOnce(() => stale.promise)
        .mockImplementation(async () => oldest(2015));
      controller!.show();
      controller!.reset();

      stale.resolve(oldest(1999));
      await stale.promise;

      expect(await fromStepperStart(f)).toEqual(["May", "2015"]);
      expect(f.service.loadTimelineBuckets).toHaveBeenCalledTimes(2);
    });
  });

  it("clears a date back to Any date from the stepper", async () => {
    const f = setup();
    await f.open();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.enter);
    expect(f.text("from")).toContain("1 Mar 2004");

    pressKey(remoteKeys.enter);
    for (let step = 0; step < 3; step += 1) pressKey(remoteKeys.right);
    expect(f.focused()).toBe("stepper:clear");
    pressKey(remoteKeys.enter);
    expect(f.text("from")).toContain("Any date");
  });

  it("explains a From after To and keeps Show photos unavailable without swapping", async () => {
    const f = setup();
    await f.open();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.right);
    for (let step = 0; step < 30; step += 1) pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    expect(f.text("to")).toContain("16 Oct 2004");

    pressKey(remoteKeys.left);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    pressKey(remoteKeys.enter);
    expect(f.text("from")).toContain("1 Apr 2004");
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    expect(f.text("to")).toContain("16 Mar 2004");

    expect(f.message()).toBe("From must be on or before To.");
    expect(f.control("show")?.getAttribute("aria-disabled")).toBe("true");
    pressKey(remoteKeys.down);
    expect(f.focused()).toBe("clear");
    pressKey(remoteKeys.left);
    pressKey(remoteKeys.enter);
    expect(f.onShowPhotos).not.toHaveBeenCalled();
    expect(f.text("from")).toContain("1 Apr 2004");
  });

  it("opens results with the current criteria from Show photos", async () => {
    const f = setup();
    controller!.setPeople([person(1)]);
    await f.open();

    pressKey(remoteKeys.enter);

    expect(f.onShowPhotos).toHaveBeenCalledWith({
      people: [person(1)],
      takenFrom: null,
      takenTo: null
    });
    controller!.focusShowPhotos();
    expect(f.focused()).toBe("show");
  });

  it("clears a single criterion at once and asks before clearing several", async () => {
    const f = setup();
    controller!.setPeople([person(1)]);
    await f.open();
    pressKey(remoteKeys.right);
    expect(f.focused()).toBe("clear");
    pressKey(remoteKeys.enter);
    expect(f.control("chip:person-1")).toBeNull();
    expect(f.focused()).toBe("add-people");

    controller!.setPeople([person(1)]);
    controller!.show();
    controller!.focusContent();
    // Set From as well, then Clear all.
    pressKey(remoteKeys.up);
    expect(f.focused()).toBe("from");
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    expect(f.focused()).toBe("clear");
    pressKey(remoteKeys.enter);
    expect(byId("search-panel").textContent).toContain("Clear all of these choices?");
    expect(f.focused()).toBe("keep");
    pressKey(remoteKeys.back);
    expect(f.focused()).toBe("clear");
    expect(f.control("chip:person-1")).not.toBeNull();

    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.left);
    expect(f.focused()).toBe("confirm-clear");
    pressKey(remoteKeys.enter);
    expect(f.control("chip:person-1")).toBeNull();
    expect(f.text("from")).toContain("Any date");
  });

  it("keeps criteria across leaving and returning, and forgets them on reset", async () => {
    const f = setup();
    controller!.setPeople([person(1)]);
    await f.open();
    controller!.hide();
    expect(f.service.revokeThumbnailUrl).toHaveBeenCalledWith("blob:person-1");

    controller!.show();
    controller!.focusContent();
    expect(f.control("chip:person-1")).not.toBeNull();
    expect(f.focused()).toBe("show");

    controller!.reset();
    controller!.show();
    controller!.focusContent();
    expect(f.control("chip:person-1")).toBeNull();
    expect(f.focused()).toBe("add-people");
  });

  it("revokes a chip face that arrives after Search was left", async () => {
    const f = setup();
    let finish: (url: string) => void = () => undefined;
    f.service.loadPersonThumbnailUrl.mockImplementation(
      () => new Promise<string>((resolve) => (finish = resolve))
    );
    controller!.setPeople([person(1)]);
    controller!.show();
    controller!.hide();

    finish("blob:late");
    await vi.waitFor(() => expect(f.service.revokeThumbnailUrl).toHaveBeenCalledWith("blob:late"));
  });
});

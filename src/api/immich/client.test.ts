import { describe, expect, it, vi } from "vitest";
import { AppError, toUserMessage } from "../../errors/app-error";
import { createImmichClient } from "./client";

const settings = {
  apiKey: "secret-key",
  serverUrl: "http://immich.local:2283"
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });
}

describe("Immich client", () => {
  it("revalidates an individual history asset through the authenticated asset endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "history-id",
        originalFileName: "photo.jpg",
        type: "IMAGE",
        isTrashed: false,
        visibility: "timeline"
      })
    );
    const client = createImmichClient({ fetchImpl, settings });
    await expect(client.getHistoryAsset("history-id")).resolves.toMatchObject({
      id: "history-id",
      name: "photo.jpg",
      type: "image"
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://immich.local:2283/api/assets/history-id", {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": "secret-key" }
    });
  });

  it.each([400, 403, 404, 410])(
    "omits inaccessible history assets with HTTP %s",
    async (status) => {
      // Immich's access check answers a deleted asset with 400 and this message.
      const client = createImmichClient({
        settings,
        fetchImpl: vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ message: "Not found or no asset.read access" }, { status })
          )
      });
      await expect(client.getHistoryAsset("gone")).resolves.toBeNull();
    }
  );

  it.each([
    { isTrashed: true, visibility: "timeline" },
    { isTrashed: false, visibility: "hidden" },
    { isTrashed: false, visibility: "locked" }
  ])("omits history assets that are trashed or hidden: %j", async (flags) => {
    const client = createImmichClient({
      settings,
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          id: "asset",
          type: "IMAGE",
          ...flags
        })
      )
    });
    await expect(client.getHistoryAsset("asset")).resolves.toBeNull();
  });

  it("reports authentication failures instead of treating them as missing history", async () => {
    const client = createImmichClient({
      settings,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }))
    });
    await expect(client.getHistoryAsset("asset")).rejects.toMatchObject({
      kind: "auth",
      status: 401
    });
  });

  it("requests the current server version endpoint without auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        major: 1,
        minor: 120,
        patch: 0
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getServerVersion()).resolves.toEqual({
      major: 1,
      minor: 120,
      patch: 0
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://immich.local:2283/api/server/version", {
      headers: {
        Accept: "application/json"
      },
      method: "GET"
    });
  });

  it("requests the current user endpoint with x-api-key auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        email: "me@example.com",
        id: "user-id",
        name: "Rory"
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getCurrentUser()).resolves.toEqual({
      email: "me@example.com",
      id: "user-id",
      name: "Rory"
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://immich.local:2283/api/users/me", {
      headers: {
        Accept: "application/json",
        "x-api-key": "secret-key"
      },
      method: "GET"
    });
  });

  it("requests albums with x-api-key auth and maps album DTOs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          albumName: "Summer",
          albumThumbnailAssetId: "asset-id",
          assetCount: 12,
          id: "album-id"
        }
      ])
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbums()).resolves.toEqual([
      {
        assetCount: 12,
        id: "album-id",
        name: "Summer",
        thumbnailAssetId: "asset-id"
      }
    ]);

    expect(fetchImpl).toHaveBeenCalledWith("http://immich.local:2283/api/albums", {
      headers: {
        Accept: "application/json",
        "x-api-key": "secret-key"
      },
      method: "GET"
    });
  });

  it("requests album details by ID without fetching every asset", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        albumName: "Summer",
        albumThumbnailAssetId: "cover-id",
        assetCount: 2,
        id: "album-id",
        order: "asc"
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumDetail("album-id")).resolves.toEqual({
      assetCount: 2,
      id: "album-id",
      name: "Summer",
      order: "asc",
      thumbnailAssetId: "cover-id"
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "http://immich.local:2283/api/albums/album-id", {
      headers: {
        Accept: "application/json",
        "x-api-key": "secret-key"
      },
      method: "GET"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("requests a single album asset page from metadata search", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        assets: {
          count: 2,
          items: [
            {
              id: "image-asset",
              livePhotoVideoId: "live-video-asset",
              originalFileName: "IMG_0001.jpg",
              type: "IMAGE"
            },
            {
              duration: "0:01:04.000000",
              id: "video-asset",
              originalFileName: "clip.mp4",
              type: "VIDEO"
            }
          ],
          nextCursor: null,
          total: 2
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumAssetsPage("album-id", "asc", null)).resolves.toEqual({
      assets: [
        {
          capturedAt: null,
          durationMs: null,
          id: "image-asset",
          livePhotoVideoId: "live-video-asset",
          location: null,
          name: "IMG_0001.jpg",
          type: "image"
        },
        {
          capturedAt: null,
          durationMs: 64000,
          id: "video-asset",
          livePhotoVideoId: null,
          location: null,
          name: "clip.mp4",
          type: "video"
        }
      ],
      nextPageToken: null,
      total: null
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://immich.local:2283/api/search/metadata", {
      body: JSON.stringify({
        filter: {
          albumIds: {
            any: ["album-id"]
          },
          trashedAt: {
            eq: null
          }
        },
        orderBy: {
          direction: "asc",
          field: "fileCreatedAt"
        },
        size: 120,
        withExif: true
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": "secret-key"
      },
      method: "POST"
    });
  });

  it("requests Photos timeline buckets for compressed date navigation", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse([
        {
          count: 12,
          timeBucket: "2026-10-01"
        },
        {
          count: 4,
          timeBucket: "2025-08-17"
        }
      ])
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getTimelineBuckets()).resolves.toEqual([
      {
        assetCount: 12,
        timeBucket: "2026-10-01"
      },
      {
        assetCount: 4,
        timeBucket: "2025-08-17"
      }
    ]);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://immich.local:2283/api/timeline/buckets?order=desc&orderBy=takenAt&visibility=timeline&withStacked=true&withPartners=true",
      {
        headers: {
          Accept: "application/json",
          "x-api-key": "secret-key"
        },
        method: "GET"
      }
    );
  });

  it("loads Recently Added by upload date across buckets and stops at the rail limit", async () => {
    const bucketResponse = (ids: string[]) => ({
      id: ids,
      // Capture dates deliberately differ from the upload ordering.
      fileCreatedAt: ids.map(() => "2001-01-01T00:00:00.000Z"),
      isImage: ids.map(() => true),
      duration: ids.map(() => null),
      livePhotoVideoId: ids.map(() => null)
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          { timeBucket: "2026-10-15", count: 1 },
          { timeBucket: "2026-10-14", count: 20 },
          { timeBucket: "2026-10-13", count: 50 }
        ])
      )
      .mockResolvedValueOnce(jsonResponse(bucketResponse(["newly-uploaded-old-photo"])))
      .mockResolvedValueOnce(
        jsonResponse(bucketResponse(Array.from({ length: 20 }, (_, i) => `asset-${i}`)))
      );
    const client = createImmichClient({ fetchImpl, settings });

    const page = await client.getRecentlyAddedAssets(18);

    expect(page.assets).toHaveLength(18);
    expect(page.assets[0]).toMatchObject({ id: "newly-uploaded-old-photo", type: "image" });
    expect(page.assets[17]?.id).toBe("asset-16");
    expect(page.nextPageToken).toBeNull();
    expect(page.total).toBe(71);
    const query =
      "order=desc&orderBy=createdAt&visibility=timeline&isTrashed=false&withStacked=true&withPartners=true";
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `http://immich.local:2283/api/timeline/buckets?${query}`,
      `http://immich.local:2283/api/timeline/bucket?timeBucket=2026-10-15&${query}`,
      `http://immich.local:2283/api/timeline/bucket?timeBucket=2026-10-14&${query}`
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), {
      headers: { Accept: "application/json", "x-api-key": "secret-key" },
      method: "GET"
    });
  });

  it("returns an empty Recently Added rail without requesting asset buckets", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getRecentlyAddedAssets(18)).resolves.toEqual({
      assets: [],
      nextPageToken: null,
      total: 0
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds Recently Added bucket requests even when the buckets become empty", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          Array.from({ length: 30 }, (_, i) => ({
            timeBucket: `bucket-${i}`,
            count: 1
          }))
        )
      )
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse({
            id: [],
            fileCreatedAt: [],
            isImage: [],
            duration: [],
            livePhotoVideoId: []
          })
        )
      );
    const client = createImmichClient({ fetchImpl, settings });

    const page = await client.getRecentlyAddedAssets(1000);

    expect(page.assets).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(25);
  });

  it("requests bounded favorite assets for Home", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        assets: {
          items: [],
          nextCursor: null,
          total: 0
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getFavoriteAssets(18)).resolves.toEqual({
      assets: [],
      nextPageToken: null,
      total: null
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://immich.local:2283/api/search/metadata", {
      body: JSON.stringify({
        filter: {
          isFavorite: {
            eq: true
          },
          trashedAt: {
            eq: null
          },
          visibility: {
            eq: "timeline"
          }
        },
        orderBy: {
          direction: "desc",
          field: "fileCreatedAt"
        },
        size: 18,
        withExif: true
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": "secret-key"
      },
      method: "POST"
    });
  });

  it("pages Favourites with Immich's search cursor and no page-sized total", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ assets: { items: [], nextCursor: null, nextPage: null, total: 120 } })
      );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(
      client.getFavoriteAssetsPage({ cursor: "next-cursor", kind: "cursor" })
    ).resolves.toEqual({ assets: [], nextPageToken: null, total: null });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      cursor: "next-cursor",
      filter: { isFavorite: { eq: true }, trashedAt: { eq: null }, visibility: { eq: "timeline" } },
      orderBy: { direction: "desc", field: "fileCreatedAt" },
      size: 120
    });
  });

  it.each([
    ["first page", { kind: "page", page: 1 } as const],
    ["cursor page", { cursor: "c", kind: "cursor" } as const]
  ])(
    "never mixes the deprecated page field into a structured search (%s)",
    async (_name, token) => {
      const fetchImpl = vi
        .fn()
        .mockImplementation(async () =>
          jsonResponse({ assets: { items: [], nextCursor: null, total: 0 } })
        );
      const client = createImmichClient({ fetchImpl, settings });

      await client.getFavoriteAssetsPage(token);
      await client.getPersonAssetsPage("person", token);

      for (const call of fetchImpl.mock.calls) {
        const body = JSON.parse(String(call[1]?.body));
        expect(body).toHaveProperty("filter");
        expect(body).not.toHaveProperty("page");
      }
    }
  );

  it("starts a Photos search in the structured shape and pages it by cursor", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () =>
      jsonResponse({
        assets: { items: [], nextCursor: "after-first", nextPage: "2", total: 120 }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getTimelineAssetsPage(null)).resolves.toEqual({
      assets: [],
      nextPageToken: { cursor: "after-first", kind: "cursor" },
      total: null
    });
    await client.getTimelineAssetsPage({ cursor: "after-first", kind: "cursor" });

    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0]).toEqual({
      filter: { trashedAt: { eq: null }, visibility: { eq: "timeline" } },
      orderBy: { direction: "desc", field: "fileCreatedAt" },
      size: 120,
      withExif: true
    });
    expect(bodies[1]).toMatchObject({ cursor: "after-first" });
    for (const body of bodies) {
      expect(body).not.toHaveProperty("page");
      expect(body).not.toHaveProperty("order");
      expect(body).not.toHaveProperty("visibility");
    }
  });

  it("leaves trashed assets out of album pages", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ assets: { items: [], nextCursor: null } }));
    const client = createImmichClient({ fetchImpl, settings });

    await client.getAlbumAssetsPage("album-id", "desc", null);
    await client.getAlbumAssetsPage("album-id", "desc", { cursor: "next", kind: "cursor" });

    for (const call of fetchImpl.mock.calls) {
      expect(JSON.parse(String(call[1]?.body)).filter).toEqual({
        albumIds: { any: ["album-id"] },
        trashedAt: { eq: null }
      });
    }
  });

  it("ignores a stray flat nextPage on structured searches, which page only by cursor", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ assets: { items: [], nextCursor: null, nextPage: "2", total: 0 } })
      );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getFavoriteAssetsPage(null)).resolves.toMatchObject({
      nextPageToken: null
    });
    await expect(client.getPersonAssetsPage("person", null)).resolves.toMatchObject({
      nextPageToken: null
    });
    await expect(client.getAlbumAssetsPage("album", "desc", null)).resolves.toMatchObject({
      nextPageToken: null
    });
  });

  describe("Recently Added paging by upload month", () => {
    const query =
      "order=desc&orderBy=createdAt&visibility=timeline&isTrashed=false&withStacked=true&withPartners=true";
    const monthAssets = (ids: string[]) =>
      jsonResponse({
        duration: ids.map(() => null),
        fileCreatedAt: ids.map(() => "2026-10-13T10:00:00.000Z"),
        id: ids,
        isImage: ids.map(() => true),
        livePhotoVideoId: ids.map(() => null)
      });

    it("fetches the month list once, then names each later month by timeBucket", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse([
            { count: 2, timeBucket: "2026-10-01" },
            { count: 0, timeBucket: "2026-09-01" },
            { count: 1, timeBucket: "2026-08-01" },
            { count: 3, timeBucket: "2026-07-01" }
          ])
        )
        .mockResolvedValueOnce(monthAssets(["oct-1", "oct-2"]))
        .mockResolvedValueOnce(monthAssets(["aug-1"]));
      const client = createImmichClient({ fetchImpl, settings });

      const first = await client.getRecentlyAddedAssetsPage({ kind: "page", page: 1 });
      expect(first).toMatchObject({
        assets: [{ id: "oct-1" }, { id: "oct-2" }],
        nextPageToken: { kind: "time-bucket", later: ["2026-07-01"], timeBucket: "2026-08-01" },
        total: null
      });

      const second = await client.getRecentlyAddedAssetsPage(first.nextPageToken);
      expect(second.assets.map((asset) => asset.id)).toEqual(["aug-1"]);
      expect(second.nextPageToken).toEqual({
        kind: "time-bucket",
        later: [],
        timeBucket: "2026-07-01"
      });
      expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
        `http://immich.local:2283/api/timeline/buckets?${query}`,
        `http://immich.local:2283/api/timeline/bucket?timeBucket=2026-10-01&${query}`,
        `http://immich.local:2283/api/timeline/bucket?timeBucket=2026-08-01&${query}`
      ]);
    });

    it("neither repeats nor skips a month when a new month appears between pages", async () => {
      // The server's list gains November after the first page; the session
      // keeps the months it started with.
      const lists = [
        [
          { count: 1, timeBucket: "2026-10-01" },
          { count: 1, timeBucket: "2026-09-01" },
          { count: 1, timeBucket: "2026-08-01" }
        ],
        [
          { count: 4, timeBucket: "2026-11-01" },
          { count: 1, timeBucket: "2026-10-01" },
          { count: 1, timeBucket: "2026-09-01" },
          { count: 1, timeBucket: "2026-08-01" }
        ]
      ];
      let listCalls = 0;
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/timeline/buckets?")) {
          return jsonResponse(lists[Math.min(listCalls++, 1)]);
        }
        const month = /timeBucket=(\d{4}-\d{2})/.exec(url)![1]!;
        return monthAssets([`${month}-a`]);
      });
      const client = createImmichClient({ fetchImpl, settings });
      const seen: string[] = [];
      let token: Parameters<typeof client.getRecentlyAddedAssetsPage>[0] = null;

      do {
        const page = await client.getRecentlyAddedAssetsPage(token);
        seen.push(...page.assets.map((asset) => asset.id));
        token = page.nextPageToken;
      } while (token);

      expect(seen).toEqual(["2026-10-a", "2026-09-a", "2026-08-a"]);
      expect(listCalls).toBe(1);
    });

    it("ends with no next page for an empty library", async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse([]));
      const client = createImmichClient({ fetchImpl, settings });

      await expect(client.getRecentlyAddedAssetsPage(null)).resolves.toEqual({
        assets: [],
        nextPageToken: null,
        total: null
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("names Recently Added in errors and rejects a malformed month", async () => {
      const forbidden = vi
        .fn()
        .mockResolvedValue(jsonResponse({ message: "Forbidden" }, { status: 403 }));
      await expect(
        createImmichClient({ fetchImpl: forbidden, settings }).getRecentlyAddedAssetsPage(null)
      ).rejects.toMatchObject({ feature: "Recently Added", kind: "permission" });

      const malformed = vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: ["a"], isImage: [], fileCreatedAt: [] }));
      await expect(
        createImmichClient({ fetchImpl: malformed, settings }).getRecentlyAddedAssetsPage({
          kind: "time-bucket",
          later: [],
          timeBucket: "2026-10-01"
        })
      ).rejects.toMatchObject({ kind: "invalid-response" });
    });
  });

  describe("Videos", () => {
    const videoFilter = {
      trashedAt: { eq: null },
      type: { eq: "VIDEO" },
      visibility: { eq: "timeline" }
    };

    it("requests the rail's first page and the full view in the structured shape", async () => {
      const fetchImpl = vi.fn().mockImplementation(async () =>
        jsonResponse({
          assets: {
            items: [{ duration: 64000, id: "clip", originalFileName: "clip.mp4", type: "VIDEO" }],
            nextCursor: "18"
          }
        })
      );
      const client = createImmichClient({ fetchImpl, settings });

      await expect(client.getVideoAssets(18)).resolves.toMatchObject({
        assets: [{ durationMs: 64000, id: "clip", type: "video" }],
        nextPageToken: { cursor: "18", kind: "cursor" },
        total: null
      });
      await client.getVideoAssetsPage({ cursor: "120", kind: "cursor" });

      const [rail, view] = fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
      expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://immich.local:2283/api/search/metadata");
      expect(rail).toEqual({
        filter: videoFilter,
        orderBy: { direction: "desc", field: "fileCreatedAt" },
        size: 18,
        withExif: true
      });
      expect(view).toEqual({
        cursor: "120",
        filter: videoFilter,
        orderBy: { direction: "desc", field: "fileCreatedAt" },
        size: 120,
        withExif: true
      });
      for (const body of [rail, view]) {
        for (const field of ["page", "order", "type", "visibility", "isFavorite"]) {
          expect(body).not.toHaveProperty(field);
        }
      }
    });

    it("ends on an empty page and rejects a malformed one", async () => {
      const empty = vi.fn().mockResolvedValue(jsonResponse({ assets: { items: [] } }));
      await expect(
        createImmichClient({ fetchImpl: empty, settings }).getVideoAssetsPage(null)
      ).resolves.toEqual({ assets: [], nextPageToken: null, total: null });

      const malformed = vi.fn().mockResolvedValue(jsonResponse({ assets: { items: [{ id: 7 }] } }));
      await expect(
        createImmichClient({ fetchImpl: malformed, settings }).getVideoAssetsPage(null)
      ).rejects.toMatchObject({ kind: "invalid-response" });
    });
  });

  it("pages a person's non-deleted timeline assets newest first by search cursor", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        assets: {
          items: [],
          nextCursor: "after-first-page",
          total: 0
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(
      client.getPersonAssetsPage("00000000-0000-4000-8000-000000000001", { kind: "page", page: 1 })
    ).resolves.toEqual({
      assets: [],
      nextPageToken: { cursor: "after-first-page", kind: "cursor" },
      total: null
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://immich.local:2283/api/search/metadata", {
      body: JSON.stringify({
        filter: {
          personIds: {
            any: ["00000000-0000-4000-8000-000000000001"]
          },
          trashedAt: {
            eq: null
          },
          visibility: {
            eq: "timeline"
          }
        },
        orderBy: {
          direction: "desc",
          field: "fileCreatedAt"
        },
        size: 120,
        withExif: true
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": "secret-key"
      },
      method: "POST"
    });
  });

  it("requests one People page without hidden people and maps it in Immich's order", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        hasNextPage: true,
        hidden: 4,
        people: [
          { id: "fav", isFavorite: true, isHidden: false, name: "Rory" },
          { id: "named", name: "Alex" },
          { id: "unnamed", isFavorite: false, name: "  " }
        ],
        total: 40
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getPeoplePage(2, 3)).resolves.toEqual({
      hasMore: true,
      page: 2,
      people: [
        { id: "fav", isFavorite: true, name: "Rory" },
        { id: "named", isFavorite: false, name: "Alex" },
        { id: "unnamed", isFavorite: false, name: null }
      ],
      total: 40
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://immich.local:2283/api/people?page=2&size=3&withHidden=false",
      { headers: { Accept: "application/json", "x-api-key": "secret-key" }, method: "GET" }
    );
  });

  it.each([
    ["the server says no next page", { hasNextPage: false, total: 40 }, false],
    ["hasNextPage is absent and the total extends past this page", { total: 7 }, true],
    ["hasNextPage is absent and this page reaches the total", { total: 6 }, false]
  ])("reports more People when %s", async (_name, paging, hasMore) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ hidden: 0, people: [], ...paging }));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getPeoplePage(2, 3)).resolves.toMatchObject({ hasMore });
  });

  it.each([
    ["no total", { people: [] }],
    ["a negative total", { people: [], total: -1 }],
    ["a non-boolean hasNextPage", { hasNextPage: "yes", people: [], total: 1 }],
    ["a person without an id", { people: [{ name: "Alex" }], total: 1 }],
    ["a non-boolean favourite", { people: [{ id: "p", isFavorite: "no" }], total: 1 }],
    ["no people list", { total: 1 }]
  ])("rejects a People response with %s", async (_name, body) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(body));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getPeoplePage(1, 18)).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it.each([
    [0, 18],
    [1.5, 18],
    [1, 0],
    [1, 1001]
  ])("rejects People page %s of size %s without a request", async (page, size) => {
    const fetchImpl = vi.fn();
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getPeoplePage(page, size)).rejects.toMatchObject({
      kind: "invalid-config"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requests bounded memories for Home and maps embedded assets", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse([
        {
          assets: [
            {
              id: "memory-image",
              originalFileName: "IMG_2000.jpg",
              type: "IMAGE"
            }
          ],
          data: {
            personName: "Rory",
            year: 2024
          },
          id: "memory-id",
          memoryAt: "2026-10-14T00:00:00.000Z",
          type: "on_this_day"
        }
      ])
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getMemories(18, 1, "2026-10-15")).resolves.toEqual([
      {
        assetCount: 1,
        assets: [
          {
            capturedAt: null,
            durationMs: null,
            id: "memory-image",
            livePhotoVideoId: null,
            location: null,
            name: "IMG_2000.jpg",
            type: "image"
          }
        ],
        id: "memory-id",
        kind: "on-this-day",
        memoryAt: "2026-10-14T00:00:00.000Z",
        personName: "Rory",
        year: 2024
      }
    ]);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://immich.local:2283/api/memories?size=18&page=1&for=2026-10-15&isTrashed=false&order=desc",
      {
        headers: {
          Accept: "application/json",
          "x-api-key": "secret-key"
        },
        method: "GET"
      }
    );
  });

  it("loads a selected Photos timeline bucket and maps bucket arrays to assets", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            count: 2,
            timeBucket: "2026-10-01"
          },
          {
            count: 1,
            timeBucket: "2025-08-17"
          }
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse({
          city: ["London", null],
          country: ["United Kingdom", null],
          duration: [null, 64000],
          fileCreatedAt: ["2026-10-06T18:42:11.000Z", "2026-10-06T19:12:00.000Z"],
          id: ["timeline-image", "timeline-video"],
          isImage: [true, false],
          livePhotoVideoId: ["live-video-asset", null]
        })
      );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getTimelineAssetsPage({ bucketIndex: 0, kind: "bucket" })).resolves.toEqual(
      {
        assets: [
          {
            capturedAt: "2026-10-06T18:42:11.000Z",
            durationMs: null,
            id: "timeline-image",
            livePhotoVideoId: "live-video-asset",
            location: "London, United Kingdom",
            name: "timeline-image",
            type: "image"
          },
          {
            capturedAt: "2026-10-06T19:12:00.000Z",
            durationMs: 64000,
            id: "timeline-video",
            livePhotoVideoId: null,
            location: null,
            name: "timeline-video",
            type: "video"
          }
        ],
        nextPageToken: {
          bucketIndex: 1,
          kind: "bucket"
        },
        total: 3
      }
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://immich.local:2283/api/timeline/bucket?timeBucket=2026-10-01&order=desc&orderBy=takenAt&visibility=timeline&withStacked=true&withPartners=true",
      {
        headers: {
          Accept: "application/json",
          "x-api-key": "secret-key"
        },
        method: "GET"
      }
    );
  });

  it("maps asset capture datetime and location metadata from metadata search", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        assets: {
          items: [
            {
              exifInfo: {
                city: "London",
                country: "United Kingdom"
              },
              id: "image-asset",
              localDateTime: "2026-10-06T18:42:11.000Z",
              originalFileName: "IMG_0001.jpg",
              type: "IMAGE"
            },
            {
              exifInfo: {
                city: "Paris",
                country: "France"
              },
              fileCreatedAt: "2026-10-07T09:12:00.000Z",
              id: "fallback-asset",
              originalFileName: "IMG_0002.jpg",
              type: "IMAGE"
            }
          ],
          nextCursor: null,
          total: 2
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumAssetsPage("album-id", "asc", null)).resolves.toMatchObject({
      assets: [
        {
          capturedAt: "2026-10-06T18:42:11.000Z",
          id: "image-asset",
          location: "London, United Kingdom"
        },
        {
          capturedAt: "2026-10-07T09:12:00.000Z",
          id: "fallback-asset",
          location: "Paris, France"
        }
      ]
    });
  });

  it.each([
    ["0:01:04.000000", 64000],
    ["1:02:03.5", 3723500],
    ["0:07", 7000],
    ["soon", null],
    ["", null]
  ])("maps a legacy text duration %j to milliseconds", async (duration, durationMs) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        assets: { items: [{ duration, id: "video", type: "VIDEO" }], nextCursor: null }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumAssetsPage("album-id", "desc", null)).resolves.toMatchObject({
      assets: [{ durationMs }]
    });
  });

  it("accepts numeric video durations from metadata search responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        albums: {
          count: 0,
          facets: [],
          items: [],
          total: 0
        },
        assets: {
          count: 1,
          facets: [],
          items: [
            {
              duration: 3232,
              id: "video-asset",
              originalFileName: "clip.mov",
              type: "VIDEO"
            }
          ],
          total: 1
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumAssetsPage("album-id", "desc", null)).resolves.toMatchObject({
      assets: [
        {
          durationMs: 3232,
          id: "video-asset",
          livePhotoVideoId: null,
          name: "clip.mov",
          type: "video"
        }
      ]
    });
  });

  it("accepts album detail responses with direct assets and omitted cover/count fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        albumName: "Direct assets",
        assets: [
          {
            id: "image-asset",
            originalFileName: "IMG_0001.jpg",
            type: "IMAGE"
          },
          {
            duration: "0:01:04.000000",
            id: "video-asset",
            originalFileName: "clip.mp4",
            type: "VIDEO"
          }
        ],
        id: "album-id"
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumDetail("album-id")).resolves.toEqual({
      assetCount: 2,
      id: "album-id",
      name: "Direct assets",
      order: "desc",
      thumbnailAssetId: null
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows album asset search nextCursor values with cursor requests", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          assets: {
            items: [
              {
                id: "first-asset",
                originalFileName: "first.jpg",
                type: "IMAGE"
              }
            ],
            nextCursor: "cursor-2",
            total: 2
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          assets: {
            items: [
              {
                id: "second-asset",
                originalFileName: "second.jpg",
                type: "IMAGE"
              }
            ],
            nextCursor: null,
            total: 2
          }
        })
      );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumAssetsPage("album-id", "desc", null)).resolves.toMatchObject({
      assets: [
        {
          id: "first-asset"
        }
      ],
      nextPageToken: {
        cursor: "cursor-2",
        kind: "cursor"
      }
    });

    await expect(
      client.getAlbumAssetsPage("album-id", "desc", {
        cursor: "cursor-2",
        kind: "cursor"
      })
    ).resolves.toMatchObject({
      assets: [
        {
          id: "second-asset"
        }
      ],
      nextPageToken: null
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://immich.local:2283/api/search/metadata",
      expect.objectContaining({
        body: JSON.stringify({
          filter: {
            albumIds: {
              any: ["album-id"]
            },
            trashedAt: {
              eq: null
            }
          },
          orderBy: {
            direction: "desc",
            field: "fileCreatedAt"
          },
          size: 120,
          withExif: true
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://immich.local:2283/api/search/metadata",
      expect.objectContaining({
        body: JSON.stringify({
          filter: {
            albumIds: {
              any: ["album-id"]
            },
            trashedAt: {
              eq: null
            }
          },
          orderBy: {
            direction: "desc",
            field: "fileCreatedAt"
          },
          size: 120,
          withExif: true,
          cursor: "cursor-2"
        })
      })
    );
  });

  it("returns cursor tokens from album asset search responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        assets: {
          count: 1,
          items: [
            {
              id: "first-asset",
              originalFileName: "first.jpg",
              type: "IMAGE"
            }
          ],
          nextCursor: "cursor-next",
          total: 2
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumAssetsPage("album-id", "desc", null)).resolves.toMatchObject({
      assets: [
        {
          id: "first-asset"
        }
      ],
      nextPageToken: {
        cursor: "cursor-next",
        kind: "cursor"
      }
    });
  });

  it("reads neither page tokens nor a collection total from a page-sized total", async () => {
    const items = Array.from({ length: 120 }, (_, index) => ({
      id: `asset-${index}`,
      originalFileName: `asset-${index}.jpg`,
      type: "IMAGE"
    }));
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        assets: {
          count: 120,
          items,
          total: 200
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumAssetsPage("album-id", "desc", null)).resolves.toMatchObject({
      assets: expect.arrayContaining([
        expect.objectContaining({
          id: "asset-0"
        })
      ]),
      nextPageToken: null,
      total: null
    });
  });

  it("rejects malformed album detail responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        assetCount: 1,
        id: "album-id"
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumDetail("album-id")).rejects.toMatchObject({
      kind: "invalid-response"
    });
  });

  it("rejects malformed album asset search responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        assets: {
          items: [
            {
              originalFileName: "missing-id.jpg",
              type: "IMAGE"
            }
          ],
          nextCursor: null,
          total: 0
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbumAssetsPage("album-id", "desc", null)).rejects.toMatchObject({
      kind: "invalid-response"
    });
  });

  it("rejects malformed album responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          albumName: "Broken",
          id: "album-id"
        }
      ])
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAlbums()).rejects.toMatchObject({
      kind: "invalid-response"
    });
  });

  it("requests album thumbnails with x-api-key auth", async () => {
    const thumbnail = new Blob(["image"], { type: "image/jpeg" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(thumbnail));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAssetThumbnail("asset-id")).resolves.toBeInstanceOf(Blob);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://immich.local:2283/api/assets/asset-id/thumbnail?size=thumbnail",
      {
        headers: {
          Accept: "image/*",
          "x-api-key": "secret-key"
        },
        method: "GET"
      }
    );
  });

  it("requests preview thumbnails when requested", async () => {
    const thumbnail = new Blob(["image"], { type: "image/jpeg" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(thumbnail));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAssetThumbnail("asset-id", "preview")).resolves.toBeInstanceOf(Blob);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://immich.local:2283/api/assets/asset-id/thumbnail?size=preview",
      {
        headers: {
          Accept: "image/*",
          "x-api-key": "secret-key"
        },
        method: "GET"
      }
    );
  });

  it("builds direct video playback URLs with query auth for streaming", () => {
    const fetchImpl = vi.fn();
    const client = createImmichClient({ fetchImpl, settings });

    expect(client.getAssetVideoPlaybackUrl("video-id")).toBe(
      "http://immich.local:2283/api/assets/video-id/video/playback?apiKey=secret-key"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-image thumbnail responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "not an image" }), {
        headers: {
          "Content-Type": "application/json"
        }
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getAssetThumbnail("asset-id")).rejects.toMatchObject({
      kind: "invalid-response"
    });
  });

  it("maps failed fetches to network errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getServerVersion()).rejects.toMatchObject({
      kind: "network"
    });
  });

  it("maps 401 responses to the invalid API key error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "Unauthorized" }, { status: 401 }));
    const client = createImmichClient({ fetchImpl, settings });
    const error = await client.getCurrentUser().catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "auth", status: 401 });
    expect(toUserMessage(error)).toBe(
      "Immich rejected the API key. Check that the key is active and copied correctly."
    );
  });

  it.each([
    ["People", (client: ReturnType<typeof createImmichClient>) => client.getPeoplePage(1, 18)],
    [
      "People",
      (client: ReturnType<typeof createImmichClient>) => client.getPersonThumbnail("person")
    ],
    [
      "People",
      (client: ReturnType<typeof createImmichClient>) =>
        client.getPersonAssetsPage("person", { kind: "page", page: 1 })
    ],
    ["Albums", (client: ReturnType<typeof createImmichClient>) => client.getAlbums()],
    ["Favourites", (client: ReturnType<typeof createImmichClient>) => client.getFavoriteAssets(18)],
    ["Videos", (client: ReturnType<typeof createImmichClient>) => client.getVideoAssets(18)],
    ["Videos", (client: ReturnType<typeof createImmichClient>) => client.getVideoAssetsPage(null)],
    ["Photos", (client: ReturnType<typeof createImmichClient>) => client.getTimelineBuckets()],
    [
      "photos and videos",
      (client: ReturnType<typeof createImmichClient>) => client.getAssetThumbnail("asset")
    ]
  ])(
    "maps 403 responses to a permission error naming %s, not a rejected key",
    async (feature, request) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Missing permission: person.read" }, { status: 403 })
        );
      const error = await request(createImmichClient({ fetchImpl, settings })).catch(
        (reason: unknown) => reason
      );

      expect(error).toMatchObject({ feature, kind: "permission", status: 403 });
      expect(toUserMessage(error)).toBe(
        `This Immich API key is not allowed to show ${feature}. Ask whoever manages Immich to allow ${feature} for this key, then try again.`
      );
      expect(toUserMessage(error)).not.toContain("person.read");
      expect(toUserMessage(error)).not.toContain("rejected");
    }
  );

  it.each([
    [
      "Favourites",
      (client: ReturnType<typeof createImmichClient>) => client.getFavoriteAssetsPage(null)
    ],
    ["Videos", (client: ReturnType<typeof createImmichClient>) => client.getVideoAssetsPage(null)],
    [
      "Recently Added",
      (client: ReturnType<typeof createImmichClient>) => client.getRecentlyAddedAssetsPage(null)
    ]
  ])("times out a stalled %s page", async (_feature, request) => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
      const client = createImmichClient({ fetchImpl, settings, timeouts: { jsonMs: 5000 } });
      const result = request(client).catch((reason: unknown) => reason);

      await vi.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toMatchObject({ kind: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a stalled JSON request with a retryable timeout error", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
      const client = createImmichClient({ fetchImpl, settings, timeouts: { jsonMs: 5000 } });
      const result = client.getAlbums().catch((reason: unknown) => reason);

      await vi.advanceTimersByTimeAsync(4999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);

      const error = await result;
      expect(error).toMatchObject({ kind: "timeout" });
      expect((error as AppError).cause).toContain("/albums");
      expect(toUserMessage(error)).toBe(
        "Immich is taking too long to respond. Check the server is running, then try again."
      );
      expect(toUserMessage(error)).not.toContain("/albums");
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a stalled media body and ignores the late response", async () => {
    vi.useFakeTimers();
    try {
      let finishBody!: (blob: Blob) => void;
      const response = {
        headers: new Headers({ "content-type": "image/jpeg" }),
        ok: true,
        status: 200,
        blob: () =>
          new Promise<Blob>((resolve) => {
            finishBody = resolve;
          })
      } as unknown as Response;
      const client = createImmichClient({
        fetchImpl: vi.fn().mockResolvedValue(response),
        settings,
        timeouts: { mediaMs: 3000 }
      });
      const result = client.getAssetThumbnail("asset").then(
        () => "resolved",
        (reason: unknown) => reason
      );

      await vi.advanceTimersByTimeAsync(3000);
      finishBody(new Blob(["late"]));
      await vi.advanceTimersByTimeAsync(0);

      expect(await result).toMatchObject({ kind: "timeout" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout once a response arrives", async () => {
    vi.useFakeTimers();
    try {
      const client = createImmichClient({
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse([])),
        settings
      });

      await expect(client.getAlbums()).resolves.toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the original network failure as a diagnostic cause", async () => {
    const failure = new TypeError("Failed to fetch");
    const client = createImmichClient({ fetchImpl: vi.fn().mockRejectedValue(failure), settings });
    const error = await client.getAlbums().catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "network" });
    expect((error as AppError).cause).toBe(failure);
    expect(toUserMessage(error)).not.toContain("Failed to fetch");
  });

  it("maps other non-OK responses to API errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "Nope" }, { status: 500 }));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getServerVersion()).rejects.toMatchObject({
      kind: "api",
      message: "Nope",
      status: 500
    });
  });

  it("keeps non-JSON HTTP failures in the API error category", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Server error", { status: 502 }));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getServerVersion()).rejects.toMatchObject({
      kind: "api",
      message: "Immich returned HTTP 502.",
      status: 502
    });
  });

  it("maps malformed success payloads to invalid-response errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ version: "1.120.0" }));
    const client = createImmichClient({ fetchImpl, settings });

    const result = client.getServerVersion();

    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({
      kind: "invalid-response"
    });
  });

  it("rejects an empty current user response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getCurrentUser()).rejects.toMatchObject({
      kind: "invalid-response"
    });
  });

  it("rejects a partially malformed current user response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        email: "me@example.com",
        id: "user-id"
      })
    );
    const client = createImmichClient({ fetchImpl, settings });

    await expect(client.getCurrentUser()).rejects.toMatchObject({
      kind: "invalid-response"
    });
  });
});

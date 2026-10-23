import type {
  Album,
  AlbumAsset,
  AlbumAssetPage,
  AlbumAssetPageToken,
  AlbumDetail,
  AssetOrder,
  TimelineBucket
} from "../../domain/album";
import type { ConnectionSettings, CurrentUser, ServerVersion } from "../../domain/connection";
import { localMemoryDate, type Memory, type PeoplePage } from "../../domain/home";
import type { SearchCriteria } from "../../domain/search";
import { AppError } from "../../errors/app-error";
import type { Logger } from "../../logging/logger";
import { silentLogger } from "../../logging/logger";
import { buildImmichApiUrl } from "../../utils/url";
import {
  createImmichHttp,
  defaultRequestTimeouts,
  type ImmichHttp,
  type RequestTimeouts
} from "./http";
import { buildSearchCriteriaFilter } from "./search-filter";
import type {
  AlbumDetailResponseDto,
  AlbumResponseDto,
  AssetResponseDto,
  MemoryResponseDto,
  PeopleResponseDto,
  SearchAssetResponseDto,
  TimelineBucketAssetsResponseDto,
  TimelineBucketResponseDto
} from "./dto";
import {
  mapAlbum,
  mapAlbumDetail,
  mapAsset,
  mapMemory,
  mapPerson,
  mapTimelineBucket,
  mapTimelineBucketAssets
} from "./mappers";
import {
  isAlbumDetailResponse,
  isAlbumResponseList,
  isAssetResponse,
  isCurrentUser,
  isMemoryResponseList,
  isPeopleResponse,
  isSearchAssetResponse,
  isServerVersion,
  isTimelineBucketAssetsResponse,
  isTimelineBucketResponseList
} from "./validators";

type FetchLike = typeof fetch;

export type ImmichClient = {
  getAlbumAssetsPage(
    albumId: string,
    order: AssetOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  getFavoriteAssets(limit: number): Promise<AlbumAssetPage>;
  // Full, paged Favourites for the Home summary collection.
  getFavoriteAssetsPage(page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  // The Videos rail's first page; its next cursor tells Home whether more exist.
  getVideoAssets(limit: number): Promise<AlbumAssetPage>;
  // Every timeline video, newest first, paged by search cursor.
  getVideoAssetsPage(page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  getMemories(limit: number, page?: number, date?: string): Promise<Memory[]>;
  getMemory(id: string): Promise<Memory>;
  getMemoriesTotal(date: string): Promise<number>;
  // One page of the People list, as Immich orders it. Hidden people are
  // never requested.
  getPeoplePage(page: number, size: number): Promise<PeoplePage>;
  getPersonAssetsPage(personId: string, page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  getPersonThumbnail(personId: string): Promise<Blob>;
  // Assets matching search criteria, newest first, paged by search cursor.
  searchAssetsPage(
    criteria: SearchCriteria,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  getHistoryAsset(assetId: string): Promise<AlbumAsset | null>;
  getRecentlyAddedAssets(limit: number): Promise<AlbumAssetPage>;
  // Recently added assets one upload-date bucket at a time, newest first.
  getRecentlyAddedAssetsPage(page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  getTimelineAssetsPage(page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  getTimelineBuckets(): Promise<TimelineBucket[]>;
  getAlbumDetail(albumId: string): Promise<AlbumDetail>;
  getAlbums(): Promise<Album[]>;
  getAssetThumbnail(assetId: string, size?: AssetThumbnailSize): Promise<Blob>;
  getAssetVideoPlaybackUrl(assetId: string): string;
  getCurrentUser(): Promise<CurrentUser>;
  getServerVersion(): Promise<ServerVersion>;
};

type CreateImmichClientOptions = {
  fetchImpl?: FetchLike;
  logger?: Logger;
  settings: ConnectionSettings;
  timeouts?: Partial<RequestTimeouts>;
};

export function createImmichClient(options: CreateImmichClientOptions): ImmichClient {
  const http = createImmichHttp({
    fetchImpl: options.fetchImpl || fetch.bind(window),
    logger: options.logger || silentLogger,
    settings: options.settings,
    timeouts: { ...defaultRequestTimeouts, ...options.timeouts }
  });

  return {
    async getHistoryAsset(assetId) {
      try {
        const response = await http.json<
          AssetResponseDto & { isTrashed: boolean; visibility: string }
        >({
          auth: true,
          feature: "photos and videos",
          path: `/assets/${encodeURIComponent(assetId)}`,
          validate: (body): body is AssetResponseDto & { isTrashed: boolean; visibility: string } =>
            isAssetResponse(body) &&
            typeof (body as { isTrashed?: unknown }).isTrashed === "boolean" &&
            typeof (body as { visibility?: unknown }).visibility === "string"
        });
        if (
          response.isTrashed ||
          (response.visibility !== "timeline" && response.visibility !== "archive")
        )
          return null;
        const asset = mapAsset(response);
        return asset.type === "image" || asset.type === "video" ? asset : null;
      } catch (error) {
        // Immich answers a deleted asset, or one this key cannot read, with 400
        // "Not found or no asset.read access" (requireAccess), not 404.
        if (
          error instanceof AppError &&
          (error.status === 400 ||
            error.status === 403 ||
            error.status === 404 ||
            error.status === 410)
        )
          return null;
        throw error;
      }
    },
    getAlbumAssetsPage(albumId, order, page) {
      return getAlbumAssetPage({
        http,
        albumId,
        order,
        pageRequest: page
      });
    },
    getFavoriteAssets(limit) {
      // The rail's first page; its next cursor tells Home whether more exist.
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(favoriteAssetFilter(), railSearchSize(limit), null),
        feature: "Favourites"
      });
    },
    getVideoAssets(limit) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(videoAssetFilter(), railSearchSize(limit), null),
        feature: "Videos"
      });
    },
    getVideoAssetsPage(page) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(videoAssetFilter(), filteredSearchPageSize, page),
        feature: "Videos"
      });
    },
    getFavoriteAssetsPage(page) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(favoriteAssetFilter(), filteredSearchPageSize, page),
        feature: "Favourites"
      });
    },
    getMemories(limit, page = 1, date = localMemoryDate()) {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        !Number.isInteger(page) ||
        page < 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date))
      ) {
        return Promise.reject(new AppError("invalid-config", "Invalid Memories page or date."));
      }
      const size = Math.min(18, limit);
      return http
        .json<MemoryResponseDto[]>({
          auth: true,
          feature: "Memories",
          path: `/memories?size=${size}&page=${page}&for=${encodeURIComponent(date)}&isTrashed=false&order=desc`,
          validate: isMemoryResponseList
        })
        .then((memories) => memories.slice(0, size).map((memory) => mapMemory(memory, true)));
    },
    getMemoriesTotal(date) {
      return http
        .json<{ total: number }>({
          auth: true,
          feature: "Memories",
          path: `/memories/statistics?for=${encodeURIComponent(date)}&isTrashed=false`,
          validate: (body): body is { total: number } => {
            if (!body || typeof body !== "object") return false;
            const total = (body as { total?: unknown }).total;
            return typeof total === "number" && Number.isSafeInteger(total) && total >= 0;
          }
        })
        .then((response) => response.total);
    },
    getMemory(id) {
      // Search by ID keeps the same hidden-person and trashed-asset filtering as
      // discovery. The separate detail endpoint does not filter hidden people.
      return http
        .json<MemoryResponseDto[]>({
          auth: true,
          feature: "Memories",
          path: `/memories?id=${encodeURIComponent(id)}&size=1&isTrashed=false&order=desc`,
          validate: isMemoryResponseList
        })
        .then((memories) => {
          const memory = memories.find((item) => item.id === id);
          if (!memory)
            throw new AppError(
              "api",
              "This Memory is no longer available. Go Back to refresh Memories."
            );
          return mapMemory(memory);
        });
    },
    getPeoplePage(page, size) {
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > 1000
      ) {
        return Promise.reject(new AppError("invalid-config", "Invalid People page."));
      }

      return http
        .json<PeopleResponseDto>({
          auth: true,
          feature: "People",
          path: `/people?page=${page}&size=${size}&withHidden=false`,
          validate: isPeopleResponse
        })
        .then((response) => ({
          // Older servers omit hasNextPage; the total then bounds the pages.
          hasMore:
            response.hasNextPage !== undefined
              ? response.hasNextPage
              : page * size < response.total,
          page,
          people: response.people.map(mapPerson),
          total: response.total
        }));
    },
    getPersonAssetsPage(personId, page) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(personAssetFilter(personId), filteredSearchPageSize, page),
        feature: "People"
      });
    },
    getPersonThumbnail(personId) {
      return http.blob({
        accept: "image/*",
        allowOctetStream: true,
        auth: true,
        feature: "People",
        path: `/people/${encodeURIComponent(personId)}/thumbnail`
      });
    },
    searchAssetsPage(criteria, page) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(
          buildSearchCriteriaFilter(criteria),
          filteredSearchPageSize,
          page
        ),
        feature: "Search"
      });
    },
    getRecentlyAddedAssets(limit) {
      return getRecentlyAddedAssetPage({
        http,
        limit
      });
    },
    getRecentlyAddedAssetsPage(page) {
      return getRecentlyAddedBucketPage({ http, page });
    },
    getTimelineAssetsPage(page) {
      return getTimelineAssetPage({
        http,
        pageRequest: page
      });
    },
    getTimelineBuckets() {
      return getTimelineBuckets({ http });
    },
    async getAlbumDetail(albumId) {
      const album = await http.json<AlbumDetailResponseDto>({
        auth: true,
        feature: "Albums",
        path: `/albums/${encodeURIComponent(albumId)}`,
        validate: isAlbumDetailResponse
      });

      return mapAlbumDetail(album);
    },
    async getAlbums() {
      const albums = await http.json<AlbumResponseDto[]>({
        auth: true,
        feature: "Albums",
        path: "/albums",
        validate: isAlbumResponseList
      });

      return albums.map(mapAlbum);
    },
    getAssetThumbnail(assetId, size = "thumbnail") {
      return http.blob({
        accept: "image/*",
        auth: true,
        feature: "photos and videos",
        path: `/assets/${encodeURIComponent(assetId)}/thumbnail?size=${encodeURIComponent(size)}`
      });
    },
    getAssetVideoPlaybackUrl(assetId) {
      return buildImmichApiUrl(
        options.settings.serverUrl,
        `/assets/${encodeURIComponent(assetId)}/video/playback?apiKey=${encodeURIComponent(options.settings.apiKey)}`
      );
    },
    getCurrentUser() {
      return http.json<CurrentUser>({
        auth: true,
        feature: "your account details",
        path: "/users/me",
        validate: isCurrentUser
      });
    },
    getServerVersion() {
      return http.json<ServerVersion>({
        auth: false,
        path: "/server/version",
        validate: isServerVersion
      });
    }
  };
}

type AssetThumbnailSize = "preview" | "thumbnail";

type AlbumAssetSearchOptions = {
  http: ImmichHttp;
  albumId: string;
  order: AssetOrder;
  pageRequest: AlbumAssetPageToken | null;
};

type TimelineAssetSearchOptions = {
  http: ImmichHttp;
  pageRequest: AlbumAssetPageToken | null;
};

type FilteredAssetSearchOptions = {
  http: ImmichHttp;
  body: Record<string, unknown>;
  feature: string;
};

const albumAssetSearchPageSize = 120;
const timelineAssetSearchPageSize = 120;
const filteredSearchPageSize = 120;

async function getAlbumAssetPage(options: AlbumAssetSearchOptions): Promise<AlbumAssetPage> {
  const response: SearchAssetResponseDto = await options.http.json<SearchAssetResponseDto>({
    auth: true,
    feature: "Albums",
    body: buildAlbumAssetSearchBody(options.albumId, options.order, options.pageRequest),
    method: "POST",
    path: "/search/metadata",
    validate: isSearchAssetResponse
  });

  return {
    assets: response.assets.items.map(mapAsset),
    nextPageToken: readNextSearchCursor(response),
    // A search page's `total` is its own size (deprecated since Immich
    // v3.0.0); the album's asset count is the collection total.
    total: null
  };
}

async function getPagedFilteredAssetPage(
  options: FilteredAssetSearchOptions
): Promise<AlbumAssetPage> {
  const response: SearchAssetResponseDto = await options.http.json<SearchAssetResponseDto>({
    auth: true,
    body: options.body,
    feature: options.feature,
    method: "POST",
    path: "/search/metadata",
    validate: isSearchAssetResponse
  });

  // A search page reports its own size, not the collection's, so no total.
  return {
    assets: response.assets.items.map(mapAsset),
    nextPageToken: readNextSearchCursor(response),
    total: null
  };
}

async function getTimelineAssetPage(options: TimelineAssetSearchOptions): Promise<AlbumAssetPage> {
  if (options.pageRequest?.kind === "bucket") {
    const buckets = await getTimelineBuckets(options);

    return getTimelineBucketPage({
      bucketIndex: options.pageRequest.bucketIndex,
      buckets,
      http: options.http
    });
  }

  // Photos pages by timeline bucket; any other request starts a structured
  // search of the timeline, newest first. Bucket counts give the total.
  return getPagedFilteredAssetPage({
    http: options.http,
    body: buildFilteredSearchBody(
      timelineAssetFilter(),
      timelineAssetSearchPageSize,
      options.pageRequest
    ),
    feature: "Photos"
  });
}

async function getTimelineBuckets(
  options: Omit<TimelineAssetSearchOptions, "pageRequest">
): Promise<TimelineBucket[]> {
  const response = await options.http.json<TimelineBucketResponseDto[]>({
    auth: true,
    feature: "Photos",
    path: "/timeline/buckets?order=desc&orderBy=takenAt&visibility=timeline&withStacked=true&withPartners=true",
    validate: isTimelineBucketResponseList
  });

  return response.map(mapTimelineBucket);
}

async function getTimelineBucketPage(options: {
  bucketIndex: number;
  buckets: TimelineBucket[];
  http: ImmichHttp;
}): Promise<AlbumAssetPage> {
  const bucket = options.buckets[options.bucketIndex];

  if (!bucket) {
    return {
      assets: [],
      nextPageToken: null,
      total: readTimelineTotal(options.buckets)
    };
  }

  const response = await options.http.json<TimelineBucketAssetsResponseDto>({
    auth: true,
    feature: "Photos",
    path: `/timeline/bucket?timeBucket=${encodeURIComponent(bucket.timeBucket)}&order=desc&orderBy=takenAt&visibility=timeline&withStacked=true&withPartners=true`,
    validate: isTimelineBucketAssetsResponse
  });

  return {
    assets: mapTimelineBucketAssets(response),
    nextPageToken:
      options.bucketIndex + 1 < options.buckets.length
        ? {
            bucketIndex: options.bucketIndex + 1,
            kind: "bucket"
          }
        : null,
    total: readTimelineTotal(options.buckets)
  };
}

function buildAlbumAssetSearchBody(
  albumId: string,
  order: AssetOrder,
  pageRequest: AlbumAssetPageToken | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // Structured search does not exclude trashed assets by itself.
    filter: {
      albumIds: {
        any: [albumId]
      },
      trashedAt: {
        eq: null
      }
    },
    orderBy: {
      direction: order,
      field: "fileCreatedAt"
    },
    size: albumAssetSearchPageSize,
    withExif: true
  };

  if (pageRequest?.kind === "cursor") {
    body.cursor = pageRequest.cursor;
  }

  return body;
}

const recentlyAddedQuery =
  "order=desc&orderBy=createdAt&visibility=timeline&isTrashed=false&withStacked=true&withPartners=true";

// Recently Added pages one upload month at a time, newest first. The first
// page fetches the month list once; each later token names its month by
// timeBucket and carries the months still to come, so a month created by a
// new upload between pages cannot shift, duplicate or skip a month, and each
// later page costs one request.
async function getRecentlyAddedBucketPage(options: {
  http: ImmichHttp;
  page: AlbumAssetPageToken | null;
}): Promise<AlbumAssetPage> {
  let months: string[];

  if (options.page?.kind === "time-bucket") {
    months = [options.page.timeBucket].concat(options.page.later);
  } else {
    months = (
      await options.http.json<TimelineBucketResponseDto[]>({
        auth: true,
        feature: "Recently Added",
        path: `/timeline/buckets?${recentlyAddedQuery}`,
        validate: isTimelineBucketResponseList
      })
    )
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => bucket.timeBucket);
  }

  const month = months[0];

  if (!month) {
    return { assets: [], nextPageToken: null, total: null };
  }

  const response = await options.http.json<TimelineBucketAssetsResponseDto>({
    auth: true,
    feature: "Recently Added",
    path: `/timeline/bucket?timeBucket=${encodeURIComponent(month)}&${recentlyAddedQuery}`,
    validate: isTimelineBucketAssetsResponse
  });
  const later = months.slice(1);

  return {
    assets: mapTimelineBucketAssets(response),
    nextPageToken: later.length
      ? { kind: "time-bucket", later: later.slice(1), timeBucket: later[0]! }
      : null,
    total: null
  };
}

// Timeline date-added ordering is distinct from metadata search's supported sort fields.
async function getRecentlyAddedAssetPage(options: {
  http: ImmichHttp;
  limit: number;
}): Promise<AlbumAssetPage> {
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(24, Math.floor(options.limit)))
    : 18;
  const query = recentlyAddedQuery;
  const buckets = await options.http.json<TimelineBucketResponseDto[]>({
    auth: true,
    feature: "Recently Added",
    path: `/timeline/buckets?${query}`,
    validate: isTimelineBucketResponseList
  });
  const assets: AlbumAsset[] = [];

  // Stop at the rail limit even if buckets change while requests are in flight.
  for (const bucket of buckets.filter((bucket) => bucket.count > 0).slice(0, limit)) {
    const response = await options.http.json<TimelineBucketAssetsResponseDto>({
      auth: true,
      feature: "Recently Added",
      path: `/timeline/bucket?timeBucket=${encodeURIComponent(bucket.timeBucket)}&${query}`,
      validate: isTimelineBucketAssetsResponse
    });
    assets.push(...mapTimelineBucketAssets(response, limit - assets.length));

    if (assets.length >= limit) {
      break;
    }
  }

  return {
    assets,
    nextPageToken: null,
    total: buckets.reduce((total, bucket) => total + bucket.count, 0)
  };
}

function railSearchSize(limit: number): number {
  return Math.max(1, Math.min(24, Math.floor(limit)));
}

function timelineAssetFilter(): Record<string, unknown> {
  return {
    trashedAt: {
      eq: null
    },
    visibility: {
      eq: "timeline"
    }
  };
}

// Live Photo and motion-photo clips are hidden assets, so timeline
// visibility keeps them out of Videos.
function videoAssetFilter(): Record<string, unknown> {
  return {
    trashedAt: {
      eq: null
    },
    type: {
      eq: "VIDEO"
    },
    visibility: {
      eq: "timeline"
    }
  };
}

function favoriteAssetFilter(): Record<string, unknown> {
  return {
    isFavorite: {
      eq: true
    },
    trashedAt: {
      eq: null
    },
    visibility: {
      eq: "timeline"
    }
  };
}

function personAssetFilter(personId: string): Record<string, unknown> {
  return {
    personIds: {
      any: [personId]
    },
    trashedAt: {
      eq: null
    },
    visibility: {
      eq: "timeline"
    }
  };
}

// Newest first, in Immich's structured search shape (`filter`/`orderBy`/
// `cursor`, Immich 3.2+). That shape rejects the deprecated flat `page`
// field, so it pages only by the response's `nextCursor`; a page token here
// can only mean the first page, which sends no cursor.
function buildFilteredSearchBody(
  filter: Record<string, unknown>,
  size: number,
  pageRequest: AlbumAssetPageToken | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    filter,
    orderBy: {
      direction: "desc",
      field: "fileCreatedAt"
    },
    size,
    withExif: true
  };

  if (pageRequest?.kind === "cursor") {
    body.cursor = pageRequest.cursor;
  }

  return body;
}

// Structured searches page only by `nextCursor`. A flat `nextPage` there
// would read as a first-page request and could refetch the same page forever.
function readNextSearchCursor(response: SearchAssetResponseDto): AlbumAssetPageToken | null {
  const cursor = response.assets.nextCursor;

  if (cursor === undefined || cursor === null) {
    return null;
  }

  const trimmed = String(cursor).trim();

  return trimmed ? { cursor: trimmed, kind: "cursor" } : null;
}

function readTimelineTotal(buckets: TimelineBucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.assetCount, 0);
}

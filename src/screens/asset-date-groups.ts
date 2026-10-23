import type { AlbumAsset, TimelineBucket } from "../domain/album";
import type { GridDirection, GridNavigationResult } from "../navigation/grid-navigation";
import { shortMonthNames, shortWeekdayNames } from "../presentation/date-labels";
import { padTwoDigits } from "../utils/number-format";

export type AssetDateContext = {
  dayKey: string | null;
  label: string | null;
  year: string | null;
};

export function getAssetDateContext(assets: AlbumAsset[], index: number): AssetDateContext {
  const asset = assets[index];

  if (!asset) {
    return emptyContext();
  }

  const current = readAssetDay(asset);

  if (!current) {
    return {
      dayKey: null,
      label: index === 0 ? "Unknown date" : null,
      year: null
    };
  }

  const previous = index > 0 ? readAssetDay(assets[index - 1]) : null;

  return previous?.dayKey === current.dayKey ? { ...current, label: null } : current;
}

export function findFirstAssetIndexForBucket(
  assets: AlbumAsset[],
  bucket: TimelineBucket
): number | null {
  for (let index = 0; index < assets.length; index += 1) {
    if (doesAssetBelongToTimelineBucket(assets[index], bucket)) {
      return index;
    }
  }

  return null;
}

export function findBucketIndexForAsset(
  buckets: TimelineBucket[],
  asset: AlbumAsset | undefined
): number | null {
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];

    if (bucket && doesAssetBelongToTimelineBucket(asset, bucket)) {
      return index;
    }
  }

  return null;
}

export function doesAssetBelongToTimelineBucket(
  asset: AlbumAsset | undefined,
  bucket: TimelineBucket
): boolean {
  const assetMonthKey = readAssetMonthKey(asset);
  const bucketMonthKey = readBucketMonthKey(bucket.timeBucket);

  return Boolean(assetMonthKey && bucketMonthKey && assetMonthKey === bucketMonthKey);
}

export function getAssetSectionColumn(
  assets: AlbumAsset[],
  index: number,
  columnCount: number
): number {
  if (columnCount <= 0 || index < 0 || index >= assets.length) {
    return 0;
  }

  const dayKey = readAssetDay(assets[index])?.dayKey;
  let sectionStart = index;

  while (sectionStart > 0 && readAssetDay(assets[sectionStart - 1])?.dayKey === dayKey) {
    sectionStart -= 1;
  }

  return (index - sectionStart) % columnCount;
}

export function isAssetSectionRowEnd(
  assets: AlbumAsset[],
  index: number,
  columnCount: number
): boolean {
  if (columnCount <= 0 || index < 0 || index >= assets.length) {
    return false;
  }

  const nextAsset = assets[index + 1];

  if (!nextAsset) {
    return true;
  }

  const currentDay = readAssetDay(assets[index])?.dayKey;
  const nextDay = readAssetDay(nextAsset)?.dayKey;

  return (
    currentDay !== nextDay || getAssetSectionColumn(assets, index, columnCount) === columnCount - 1
  );
}

export function getNextAssetSectionIndex(input: {
  assets: AlbumAsset[];
  columnCount: number;
  currentIndex: number;
  direction: GridDirection;
  preferredColumn?: number;
}): GridNavigationResult {
  if (input.assets.length <= 0 || input.columnCount <= 0) {
    return {
      index: -1,
      preferredColumn: 0
    };
  }

  const currentIndex = clamp(input.currentIndex, 0, input.assets.length - 1);
  const rows = getAssetSectionRows(input.assets, input.columnCount);
  const currentRowIndex = findAssetSectionRowIndex(rows, currentIndex);
  const currentRow = rows[currentRowIndex];

  if (!currentRow) {
    return {
      index: currentIndex,
      preferredColumn: 0
    };
  }

  const currentColumn = currentIndex - currentRow.startIndex;
  const preferredColumn =
    input.preferredColumn === undefined ? currentColumn : input.preferredColumn;

  if (input.direction === "left") {
    const index = Math.max(currentIndex - 1, currentRow.startIndex);

    return {
      index,
      preferredColumn: index - currentRow.startIndex
    };
  }

  if (input.direction === "right") {
    const index = Math.min(currentIndex + 1, currentRow.endIndex - 1);

    return {
      index,
      preferredColumn: index - currentRow.startIndex
    };
  }

  const nextRowIndex = input.direction === "up" ? currentRowIndex - 1 : currentRowIndex + 1;
  const nextRow = rows[nextRowIndex];

  if (!nextRow) {
    return {
      index: currentIndex,
      preferredColumn
    };
  }

  return {
    index: Math.min(nextRow.startIndex + preferredColumn, nextRow.endIndex - 1),
    preferredColumn
  };
}

type AssetSectionRow = {
  endIndex: number;
  startIndex: number;
};

function getAssetSectionRows(assets: AlbumAsset[], columnCount: number): AssetSectionRow[] {
  const rows: AssetSectionRow[] = [];
  let sectionStart = 0;

  while (sectionStart < assets.length) {
    const dayKey = readAssetDay(assets[sectionStart])?.dayKey || "";
    let sectionEnd = sectionStart + 1;

    while (
      sectionEnd < assets.length &&
      (readAssetDay(assets[sectionEnd])?.dayKey || "") === dayKey
    ) {
      sectionEnd += 1;
    }

    for (let rowStart = sectionStart; rowStart < sectionEnd; rowStart += columnCount) {
      rows.push({
        endIndex: Math.min(rowStart + columnCount, sectionEnd),
        startIndex: rowStart
      });
    }

    sectionStart = sectionEnd;
  }

  return rows;
}

function findAssetSectionRowIndex(rows: AssetSectionRow[], index: number): number {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];

    if (row && index >= row.startIndex && index < row.endIndex) {
      return rowIndex;
    }
  }

  return 0;
}

function readAssetDay(asset: AlbumAsset | undefined): AssetDateContext | null {
  return readDateContext(asset?.capturedAt || null);
}

function readAssetMonthKey(asset: AlbumAsset | undefined): string | null {
  return readMonthKey(asset?.capturedAt || null);
}

function readDateContext(value: string | null): AssetDateContext | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  if (!match) {
    return null;
  }

  const year = match[1];
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthName = shortMonthNames[month - 1];

  if (!year || !monthName || !Number.isFinite(day)) {
    return null;
  }

  return {
    dayKey: `${year}-${padTwoDigits(month)}-${padTwoDigits(day)}`,
    label: `${readWeekday(value)} ${day} ${monthName} ${year}`,
    year
  };
}

function readBucketMonthKey(value: string | undefined): string | null {
  return readMonthKey(value || null);
}

function readMonthKey(value: string | null): string | null {
  const match = value ? /^(\d{4})-(\d{2})/.exec(value) : null;

  return match ? `${match[1]}-${match[2]}` : null;
}

function readWeekday(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return shortWeekdayNames[date.getUTCDay()] || "";
}

function emptyContext(): AssetDateContext {
  return {
    dayKey: null,
    label: null,
    year: null
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

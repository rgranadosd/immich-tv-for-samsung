import type { ConnectionSettings } from "../domain/connection";
import { normalizeConnectionSettings } from "../utils/url";

declare const __IMMICH_TV_APP_VERSION__: string;
declare const __IMMICH_TV_DEFAULT_API_KEY__: string;
declare const __IMMICH_TV_DEFAULT_SERVER_URL__: string;

export function readBuildAppVersion(): string {
  return typeof __IMMICH_TV_APP_VERSION__ === "string" ? __IMMICH_TV_APP_VERSION__ : "";
}

export function readBuildConnectionDefaults(): ConnectionSettings | null {
  const serverUrl =
    typeof __IMMICH_TV_DEFAULT_SERVER_URL__ === "string" ? __IMMICH_TV_DEFAULT_SERVER_URL__ : "";
  const apiKey =
    typeof __IMMICH_TV_DEFAULT_API_KEY__ === "string" ? __IMMICH_TV_DEFAULT_API_KEY__ : "";

  if (!serverUrl || !apiKey) {
    return null;
  }

  return normalizeConnectionSettings({
    apiKey,
    serverUrl
  });
}

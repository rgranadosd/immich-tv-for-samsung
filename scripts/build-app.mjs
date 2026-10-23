import { readFileSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as esbuild from "esbuild";
import { loadTizenEnv } from "./tizen-env.mjs";

const root = process.cwd();
loadTizenEnv(root);
const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const distDir = resolve(root, "dist");
// Production builds are minified. An unminified debug build keeps readable
// names and line structure for diagnosis in the TV's Web Inspector:
//   npm run build:debug
//   IMMICH_TV_DEBUG_BUILD=1 npm run tizen:deploy
const debugBuild = process.argv.includes("--debug") || process.env.IMMICH_TV_DEBUG_BUILD === "1";
const copiedRuntimeFiles = [
  "config.xml",
  "assets/immich-tv-logo.png",
  "index.html",
  "icon.png",
  "styles/main.css",
  "scripts/dev-preview.js"
];

async function copyRuntimeFile(file) {
  const source = resolve(root, file);
  const destination = resolve(distDir, file);

  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function main() {
  await rm(distDir, { force: true, recursive: true });
  await mkdir(resolve(distDir, "scripts"), { recursive: true });

  await esbuild.build({
    bundle: true,
    define: {
      __IMMICH_TV_APP_VERSION__: JSON.stringify(packageVersion),
      __IMMICH_TV_DEFAULT_API_KEY__: JSON.stringify(process.env.IMMICH_TV_DEFAULT_API_KEY || ""),
      __IMMICH_TV_DEFAULT_SERVER_URL__: JSON.stringify(
        process.env.IMMICH_TV_DEFAULT_SERVER_URL || ""
      )
    },
    entryPoints: [resolve(root, "src", "app", "main.ts")],
    format: "iife",
    legalComments: "none",
    minify: !debugBuild,
    outfile: resolve(distDir, "scripts", "main.js"),
    platform: "browser",
    sourcemap: false,
    target: ["chrome56"]
  });

  await Promise.all(copiedRuntimeFiles.map(copyRuntimeFile));

  console.log(
    `Built Samsung TV runtime (${debugBuild ? "debug, unminified" : "minified"}) in ${distDir}`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

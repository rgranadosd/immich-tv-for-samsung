import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { loadTizenEnv, requireTizenEnv } from "./tizen-env.mjs";

const runtimeFiles = [
  "config.xml",
  "assets/immich-tv-logo.png",
  "index.html",
  "icon.png",
  "styles/main.css",
  "scripts/main.js"
];

const root = process.cwd();
const runtimeRoot = resolve(root, "dist");
const stageDir = resolve(root, ".tizen", "package-src");
const buildResultDir = resolve(stageDir, ".buildResult");
const packagePath = resolve(buildResultDir, "ImmichTV.wgt");
const unsignedPackagePath = resolve(root, ".tizen", "ImmichTV-unsigned.wgt");
const stageOnly = process.argv.includes("--stage-only");
const tizenCli =
  process.env.TIZEN_CLI || resolve(homedir(), "tizen-studio", "tools", "ide", "bin", "tizen");

async function stageRuntimeFiles() {
  await rm(stageDir, { force: true, recursive: true });

  for (const file of runtimeFiles) {
    const source = resolve(runtimeRoot, file);
    const destination = resolve(stageDir, file);

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  console.log(`Staged ${runtimeFiles.length} runtime files in ${stageDir}`);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${basename(command)} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function normalizePackageFilename() {
  const files = await readdir(buildResultDir);
  const generatedPackage = files.find((file) => file.endsWith(".wgt"));

  if (!generatedPackage) {
    throw new Error(`No .wgt package found in ${buildResultDir}`);
  }

  const generatedPackagePath = resolve(buildResultDir, generatedPackage);

  if (generatedPackagePath !== packagePath) {
    await rm(packagePath, { force: true, recursive: true });
    await rename(generatedPackagePath, packagePath);
  }

  await access(packagePath);
}

async function main() {
  await stageRuntimeFiles();

  if (stageOnly) {
    return;
  }

  loadTizenEnv(root);
  const { TIZEN_CERT_PROFILE: profile } = requireTizenEnv(["TIZEN_CERT_PROFILE"]);

  await rm(unsignedPackagePath, { force: true });
  await rm(buildResultDir, { force: true, recursive: true });
  await mkdir(buildResultDir, { recursive: true });
  await run("zip", ["-q", "-9", unsignedPackagePath, ...runtimeFiles], { cwd: stageDir });
  await run(tizenCli, [
    "package",
    "-t",
    "wgt",
    "-s",
    profile,
    "-o",
    buildResultDir,
    "--",
    unsignedPackagePath
  ]);
  await normalizePackageFilename();
  await rm(unsignedPackagePath, { force: true });

  console.log(`Package ready: ${packagePath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

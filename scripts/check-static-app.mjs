import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const requiredFiles = [
  "config.xml",
  "index.html",
  "icon.png",
  "styles/main.css",
  "scripts/main.js"
];

const failures = [];
const runtimeRoot = resolve(process.cwd(), "dist");

for (const file of requiredFiles) {
  try {
    await access(resolve(runtimeRoot, file));
  } catch {
    failures.push(`Missing required runtime file: dist/${file}`);
  }
}

const configXml = await readFile(resolve(runtimeRoot, "config.xml"), "utf8");
const indexHtml = await readFile(resolve(runtimeRoot, "index.html"), "utf8");

if (!configXml.includes('required_version="4.0"')) {
  failures.push('config.xml should target Tizen required_version="4.0".');
}

if (!configXml.includes('<content src="index.html"')) {
  failures.push("config.xml should launch index.html.");
}

if (!configXml.includes('<access origin="*" subdomains="true"')) {
  failures.push("config.xml should allow outbound Immich API requests.");
}

if (!configXml.includes("http://tizen.org/privilege/internet")) {
  failures.push("config.xml should declare the Tizen internet privilege.");
}

for (const asset of ["styles/main.css", "scripts/main.js"]) {
  if (!indexHtml.includes(asset)) {
    failures.push(`index.html should reference ${asset}.`);
  }
}

if (indexHtml.includes("scripts/dev-preview.js")) {
  failures.push("index.html must not load the desktop-only preview script.");
}

try {
  await access(resolve(runtimeRoot, "src"));
  failures.push("dist must not include TypeScript source files.");
} catch {
  // Expected: source files are not part of the packaged runtime.
}

try {
  await access(resolve(runtimeRoot, "node_modules"));
  failures.push("dist must not include node_modules.");
} catch {
  // Expected: dependencies are bundled or excluded.
}

try {
  const scriptFiles = await readdir(resolve(runtimeRoot, "scripts"));

  if (scriptFiles.some((file) => file.endsWith(".map"))) {
    failures.push("dist must not include sourcemaps.");
  }
} catch {
  failures.push("Unable to inspect dist/scripts.");
}

// An explicit file allowlist rejects capture output, Playwright, credentials,
// source files and any future tooling accidentally copied into dist. The
// desktop preview script is the sole permitted development file; packaging
// separately stages its existing six-file production allowlist.
const allowedFiles = new Set([
  ...requiredFiles,
  "assets/immich-tv-logo.png",
  "scripts/dev-preview.js"
]);
async function inspectFiles(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      await inspectFiles(resolve(directory, entry.name), relative + "/");
    } else if (!entry.isFile() || !allowedFiles.has(relative)) {
      failures.push(`Unexpected runtime file: ${relative}`);
    }
  }
}
await inspectFiles(runtimeRoot);
const bundle = await readFile(resolve(runtimeRoot, "scripts/main.js"), "utf8");
if (/playwright|CAPTURE_IMMICH_|scripts\/capture|captures\//i.test(bundle)) {
  failures.push("Capture tooling must not be bundled into the Tizen application.");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }

  process.exit(1);
}

console.log("Static Tizen app checks passed.");

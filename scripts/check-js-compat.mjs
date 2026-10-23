// Fails when shipped JavaScript uses DOM members that Tizen 4.0 / Chromium 56
// does not provide. eslint-plugin-compat checks globals and ES built-ins, but it
// cannot see methods called on element instances (for example
// `button.toggleAttribute(...)`), and TypeScript's DOM library is not
// version-limited. DOM member names survive bundling and minification, so the
// same denylist is checked against the sources (npm run lint) and the built
// bundle (npm run check).
//
// Versions come from MDN browser-compat-data. Add entries when a newer DOM API
// becomes tempting; remove one only after confirming Chromium 56 support.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const deniedMembers = [
  { name: "toggleAttribute", since: "Chrome 69" },
  { name: "replaceChildren", since: "Chrome 86" },
  { name: "requestSubmit", since: "Chrome 76" },
  { name: "computedStyleMap", since: "Chrome 66" },
  { name: "attributeStyleMap", since: "Chrome 66" },
  { name: "getAnimations", since: "Chrome 84" },
  { name: "checkVisibility", since: "Chrome 105" },
  { name: "showPicker", since: "Chrome 99" },
  { name: "adoptedStyleSheets", since: "Chrome 73" },
  { name: "attachInternals", since: "Chrome 77" },
  { name: "scrollMargin", since: "Chrome 69" },
  { name: "trimStart", since: "Chrome 66" },
  { name: "trimEnd", since: "Chrome 66" },
  { name: "matchAll", since: "Chrome 73" },
  { name: "replaceAll", since: "Chrome 85" },
  { name: "flatMap", since: "Chrome 69" },
  { name: "allSettled", since: "Chrome 76" },
  { name: "queueMicrotask", since: "Chrome 71" },
  { name: "globalThis", since: "Chrome 71" },
  { name: "AbortController", since: "Chrome 66" },
  { name: "ResizeObserver", since: "Chrome 64" },
  { name: "structuredClone", since: "Chrome 98" }
];
const pattern = new RegExp(
  `(?:\\.|\\b)(${deniedMembers.map((member) => member.name).join("|")})\\b`,
  "g"
);

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "test") {
        files.push(...(await listSourceFiles(path)));
      }
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }

  return files;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

async function main() {
  const checkBundle = process.argv.includes("--bundle");
  const files = checkBundle
    ? [resolve(root, "dist", "scripts", "main.js")]
    : await listSourceFiles(resolve(root, "src"));
  const failures = [];

  for (const file of files) {
    const source = stripComments(await readFile(file, "utf8"));

    for (const match of source.matchAll(pattern)) {
      const member = deniedMembers.find((candidate) => candidate.name === match[1]);
      const line = source.slice(0, match.index).split("\n").length;

      failures.push(
        `${relative(root, file)}:${line} uses ${member.name} (${member.since}; target is Chrome 56).`
      );
    }
  }

  if (failures.length > 0) {
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }

  console.log(
    `JavaScript compatibility check passed (${checkBundle ? "bundle" : `${files.length} source files`}).`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

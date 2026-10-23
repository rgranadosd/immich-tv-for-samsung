// Fails on CSS that Tizen 4.0 / Chromium 56 ignores or misreads. This is a
// deliberately small rule-level scanner, not a full CSS parser: it reads each
// `selector { declarations }` block (including those inside @media) and
// resolves a rule's display from any rule with the same selector.
// Versions come from MDN browser-compat-data.
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = process.cwd();
const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["styles/main.css"];

const forbiddenProperties = [
  {
    pattern: /^inset(-block|-inline)?(-start|-end)?$/,
    reason: "inset needs Chrome 87; use top/right/bottom/left"
  },
  { pattern: /^aspect-ratio$/, reason: "aspect-ratio needs Chrome 88" },
  {
    pattern: /^(row-gap|column-gap)$/,
    reason: "unprefixed row-gap/column-gap need Chrome 66; use grid-row-gap/grid-column-gap"
  }
];
const forbiddenSelectors = [
  { pattern: /:focus-visible/, reason: ":focus-visible needs Chrome 86" },
  { pattern: /:is\(/, reason: ":is() needs Chrome 88" },
  { pattern: /:where\(/, reason: ":where() needs Chrome 88" },
  { pattern: /:has\(/, reason: ":has() needs Chrome 105" }
];
const forbiddenValues = [
  { pattern: /(^|[^a-z-])(clamp|min|max)\(/i, reason: "CSS clamp()/min()/max() need Chrome 79" }
];

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function readRules(source) {
  const rules = [];
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " ")
  );
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = pattern.exec(withoutComments))) {
    const selector = match[1].trim().replace(/\s+/g, " ");

    if (selector.startsWith("@") || /^(from|to|\d+%)$/.test(selector)) {
      continue;
    }

    const declarations = new Map();

    for (const declaration of match[2].split(";")) {
      const separator = declaration.indexOf(":");

      if (separator > 0) {
        declarations.set(
          declaration.slice(0, separator).trim().toLowerCase(),
          declaration.slice(separator + 1).trim()
        );
      }
    }

    rules.push({
      declarations,
      line: lineOf(withoutComments, match.index + match[0].length - match[2].length - 1),
      selector
    });
  }

  return rules;
}

function checkFile(file, source) {
  const rules = readRules(source);
  const displayBySelector = new Map();
  const failures = [];
  const fail = (rule, reason) =>
    failures.push(`${relative(root, file)}:${rule.line} ${rule.selector}: ${reason}`);

  for (const rule of rules) {
    const display = rule.declarations.get("display");

    if (display) {
      displayBySelector.set(rule.selector, display);
    }
  }

  for (const rule of rules) {
    for (const { pattern, reason } of forbiddenSelectors) {
      if (pattern.test(rule.selector)) fail(rule, reason);
    }

    for (const [property, value] of rule.declarations) {
      for (const { pattern, reason } of forbiddenProperties) {
        if (pattern.test(property)) fail(rule, reason);
      }

      if (
        rule.declarations.get("display") === "grid" &&
        !new RegExp(
          `${rule.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*display\\s*:\\s*flex\\s*;[^}]*display\\s*:\\s*grid`,
          "s"
        ).test(source)
      ) {
        fail(
          rule,
          "CSS Grid needs Chrome 57; put display:flex before display:grid as a Chrome 56 fallback"
        );
      }

      for (const { pattern, reason } of forbiddenValues) {
        if (!property.startsWith("--") && pattern.test(value.replace(/minmax\(/gi, "")))
          fail(rule, `${property}: ${reason}`);
      }
    }

    if (
      rule.declarations.has("backdrop-filter") &&
      !rule.declarations.has("background") &&
      !rule.declarations.has("background-color")
    ) {
      fail(
        rule,
        "backdrop-filter needs Chrome 76; add a solid background fallback in the same rule"
      );
    }

    if (rule.declarations.has("gap")) {
      const display =
        rule.declarations.get("display") || displayBySelector.get(rule.selector) || "";

      if (/flex/.test(display)) {
        fail(rule, "flex gap needs Chrome 84; use adjacent-sibling margins");
      } else if (!rule.declarations.has("grid-gap")) {
        fail(
          rule,
          "unprefixed grid gap needs Chrome 66; add an equal grid-gap fallback in the same rule"
        );
      }
    }
  }

  return failures;
}

async function main() {
  const failures = [];

  for (const file of files) {
    const path = resolve(root, file);

    failures.push(...checkFile(path, await readFile(path, "utf8")));
  }

  if (failures.length > 0) {
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }

  console.log(`CSS compatibility check passed (${files.join(", ")}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

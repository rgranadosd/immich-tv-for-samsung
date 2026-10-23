import compat from "eslint-plugin-compat";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".buildResult/**",
      ".tizen/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "captures/**",
      ".capture-tools/**",
      "playwright-report/**",
      "test-results/**",
      "scripts/main.js"
    ]
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        KeyboardEvent: "readonly",
        localStorage: "readonly",
        Response: "readonly",
        URL: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-empty-function": "off"
    }
  },
  {
    // Shipped runtime code must run on Tizen 4.0 / Chromium 56 (the
    // package.json browserslist target). esbuild only transpiles syntax, so
    // this rule catches unsupported globals and ES built-ins. DOM members
    // called on element instances are covered by scripts/check-js-compat.mjs.
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/test/**"],
    ...compat.configs["flat/recommended"],
    settings: {
      lintAllEsApis: true,
      polyfills: []
    }
  }
);

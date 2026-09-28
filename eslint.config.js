import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";

const padding = [
  "error",
  { blankLine: "always", prev: "*", next: "return" },
  { blankLine: "always", prev: "block-like", next: "*" },
  { blankLine: "always", prev: "*", next: "block-like" },
  {
    blankLine: "any",
    prev: ["const", "let", "var"],
    next: ["const", "let", "var"],
  },
  {
    blankLine: "any",
    prev: ["const", "let", "var"],
    next: "block-like",
  },
  { blankLine: "always", prev: "import", next: "*" },
  { blankLine: "any", prev: "import", next: "import" },
  { blankLine: "always", prev: "*", next: "function" },
  { blankLine: "always", prev: "function", next: "*" },
  { blankLine: "any", prev: "export", next: "export" },
];

export default tseslint.config({
  files: ["src/**/*.ts"],
  plugins: {
    "@stylistic": stylistic,
  },
  languageOptions: {
    parser: tseslint.parser,
  },
  rules: {
    curly: ["error", "all"],
    "@stylistic/max-len": [
      "error",
      { code: 80, tabWidth: 2, ignoreUrls: true },
    ],
    "@stylistic/no-multiple-empty-lines": [
      "error",
      { max: 1, maxBOF: 0, maxEOF: 0 },
    ],
    "@stylistic/lines-between-class-members": [
      "error",
      "always",
      { exceptAfterSingleLine: true },
    ],
    "@stylistic/padding-line-between-statements": padding,
  },
});

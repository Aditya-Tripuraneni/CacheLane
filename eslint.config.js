import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

export default [
  {
    files: ["src/**/*.ts"],
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // Enforce strict downward-only module layering.
      // config / storage / tokenizer MUST NOT import each other.
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            { target: "./src/config", from: "./src/storage" },
            { target: "./src/config", from: "./src/tokenizer" },
            { target: "./src/storage", from: "./src/config" },
            { target: "./src/storage", from: "./src/tokenizer" },
            { target: "./src/tokenizer", from: "./src/config" },
            { target: "./src/tokenizer", from: "./src/storage" },
          ],
        },
      ],
    },
  },
];

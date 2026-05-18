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
      // (1) Foundations (config, storage, tokenizer) MUST NOT import each
      //     other (sideways).
      // (2) Foundations MUST NOT import from higher layers (M2+ modules).
      //     Listed pre-emptively so the rule fires the moment those dirs
      //     are created.
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // sideways (M1)
            { target: "./src/config", from: "./src/storage" },
            { target: "./src/config", from: "./src/tokenizer" },
            { target: "./src/storage", from: "./src/config" },
            { target: "./src/storage", from: "./src/tokenizer" },
            { target: "./src/tokenizer", from: "./src/config" },
            { target: "./src/tokenizer", from: "./src/storage" },
            // upward (M2+) — pre-empt drift
            { target: "./src/config", from: "./src/classifier" },
            { target: "./src/config", from: "./src/orchestrator" },
            { target: "./src/config", from: "./src/keepalive" },
            { target: "./src/config", from: "./src/server" },
            { target: "./src/config", from: "./src/cli" },
            { target: "./src/storage", from: "./src/classifier" },
            { target: "./src/storage", from: "./src/orchestrator" },
            { target: "./src/storage", from: "./src/keepalive" },
            { target: "./src/storage", from: "./src/server" },
            { target: "./src/storage", from: "./src/cli" },
            { target: "./src/tokenizer", from: "./src/classifier" },
            { target: "./src/tokenizer", from: "./src/orchestrator" },
            { target: "./src/tokenizer", from: "./src/keepalive" },
            { target: "./src/tokenizer", from: "./src/server" },
            { target: "./src/tokenizer", from: "./src/cli" },
          ],
        },
      ],
    },
  },
];

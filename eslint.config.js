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
            { target: "./src/config", from: "./src/references" },
            { target: "./src/config", from: "./src/pruner" },
            { target: "./src/config", from: "./src/orchestrator" },
            { target: "./src/config", from: "./src/hooks" },
            { target: "./src/config", from: "./src/keepalive" },
            { target: "./src/config", from: "./src/server" },
            { target: "./src/config", from: "./src/cli" },
            { target: "./src/storage", from: "./src/classifier" },
            { target: "./src/storage", from: "./src/references" },
            { target: "./src/storage", from: "./src/pruner" },
            { target: "./src/storage", from: "./src/orchestrator" },
            { target: "./src/storage", from: "./src/hooks" },
            { target: "./src/storage", from: "./src/keepalive" },
            { target: "./src/storage", from: "./src/server" },
            { target: "./src/storage", from: "./src/cli" },
            { target: "./src/tokenizer", from: "./src/classifier" },
            { target: "./src/tokenizer", from: "./src/references" },
            { target: "./src/tokenizer", from: "./src/pruner" },
            { target: "./src/tokenizer", from: "./src/orchestrator" },
            { target: "./src/tokenizer", from: "./src/hooks" },
            { target: "./src/tokenizer", from: "./src/keepalive" },
            { target: "./src/tokenizer", from: "./src/server" },
            { target: "./src/tokenizer", from: "./src/cli" },
            { target: "./src/classifier", from: "./src/references" },
            { target: "./src/classifier", from: "./src/pruner" },
            { target: "./src/classifier", from: "./src/orchestrator" },
            { target: "./src/classifier", from: "./src/hooks" },
            { target: "./src/classifier", from: "./src/keepalive" },
            { target: "./src/classifier", from: "./src/server" },
            { target: "./src/classifier", from: "./src/cli" },
            { target: "./src/references", from: "./src/pruner" },
            { target: "./src/references", from: "./src/orchestrator" },
            { target: "./src/references", from: "./src/hooks" },
            { target: "./src/references", from: "./src/keepalive" },
            { target: "./src/references", from: "./src/server" },
            { target: "./src/references", from: "./src/cli" },
            { target: "./src/pruner", from: "./src/orchestrator" },
            { target: "./src/pruner", from: "./src/hooks" },
            { target: "./src/pruner", from: "./src/keepalive" },
            { target: "./src/pruner", from: "./src/server" },
            { target: "./src/pruner", from: "./src/cli" },
            { target: "./src/keepalive", from: "./src/references" },
            { target: "./src/keepalive", from: "./src/pruner" },
            { target: "./src/server", from: "./src/references" },
            { target: "./src/server", from: "./src/pruner" },
            { target: "./src/cli", from: "./src/references" },
            { target: "./src/cli", from: "./src/pruner" },
          ],
        },
      ],
    },
  },
];

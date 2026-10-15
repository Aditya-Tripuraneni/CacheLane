import { fileURLToPath } from "node:url";

export const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}.jsonl`, import.meta.url));

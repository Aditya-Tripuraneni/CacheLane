import { get_encoding, type Tiktoken } from "tiktoken";
import type { Tokenizer } from "../providers/types.js";

type EncodingName = "o200k_base" | "cl100k_base";

const O200K_MODELS = /^(gpt-4o|gpt-4\.1|o[13])/;

const encodings = new Map<EncodingName, Tiktoken>();

function getEncoding(name: EncodingName): Tiktoken {
  let enc = encodings.get(name);
  if (enc === undefined) {
    enc = get_encoding(name);
    encodings.set(name, enc);
  }
  return enc;
}

function encodingForModel(model: string): EncodingName {
  return O200K_MODELS.test(model) ? "o200k_base" : "cl100k_base";
}

export const openaiTokenizer: Tokenizer = {
  name: "openai",
  count(text: string, model: string): number {
    return getEncoding(encodingForModel(model)).encode(text).length;
  },
};

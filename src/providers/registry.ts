import type { ProviderAdapter } from "./types.js";
import { anthropicMessagesAdapter } from "./anthropic-messages.js";
import { openaiChatAdapter } from "./openai-chat.js";

const ADAPTERS: ProviderAdapter[] = [anthropicMessagesAdapter, openaiChatAdapter];

export function selectAdapter(method: string, path: string): ProviderAdapter | null {
  return ADAPTERS.find((a) => a.matchRoute(method, path)) ?? null;
}

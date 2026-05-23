import type {
  MaterializableRequest,
  MaterializePrunedBlocksParams,
  PromptBlockPlacement,
} from "./types.js";
import { formatStubText } from "./stubs.js";

function cloneMaterializableRequest<TRequest extends MaterializableRequest>(
  request: TRequest,
): TRequest {
  // ...request spreads all TRequest properties beyond MaterializableRequest,
  // so the shape is preserved even though TS can't prove it structurally.
  return {
    ...request,
    messages: request.messages.map((message) => ({
      ...message,
      content: message.content.map((content) => ({ ...content })),
    })),
  } as TRequest;
}

function placementKey(placement: PromptBlockPlacement): string {
  return `${placement.message_index}:${placement.content_index}`;
}

export function materializePrunedBlocks<
  TRequest extends MaterializableRequest,
>(params: MaterializePrunedBlocksParams<TRequest>): TRequest {
  const out = cloneMaterializableRequest(params.request); // returns TRequest
  const placementsByBlockId = new Map<string, PromptBlockPlacement>();
  const seenLocations = new Set<string>();

  for (const placement of params.block_placements) {
    if (placementsByBlockId.has(placement.block_id)) {
      throw new Error(`Duplicate placement for block: ${placement.block_id}`);
    }
    const key = placementKey(placement);
    if (seenLocations.has(key)) {
      throw new Error(`Duplicate placement location: ${key}`);
    }
    placementsByBlockId.set(placement.block_id, placement);
    seenLocations.add(key);
  }

  for (const decision of params.decisions) {
    const placement = placementsByBlockId.get(decision.block_id);
    if (!placement) {
      throw new Error(
        `Pruned block has no placement metadata: ${decision.block_id}`,
      );
    }

    const message = out.messages[placement.message_index];
    if (!message) {
      throw new Error(
        `Invalid message_index for block ${decision.block_id}: ${placement.message_index}`,
      );
    }

    if (!message.content[placement.content_index]) {
      throw new Error(
        `Invalid content_index for block ${decision.block_id}: ${placement.content_index}`,
      );
    }

    message.content[placement.content_index] = {
      type: "text",
      text: formatStubText(decision),
    };
  }

  return out;
}

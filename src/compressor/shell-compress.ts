import { matchProfile } from "./shell-profiles.js";
import type { CompressorInput, CompressorOutput } from "./types.js";

export function compressShell(
  input: CompressorInput,
): { output: CompressorOutput; profile_id: string } | null {
  if (input.command === undefined) return null;
  const profile = matchProfile(input.command);
  if (profile === null) return null;

  const content = profile.run(input.content, input.exit_code);
  return {
    profile_id: profile.id,
    output: {
      content,
      content_type: "shell",
      compressor_id: "shell",
      lossiness: "lossy",
    },
  };
}

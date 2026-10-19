import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

export async function resolveFishApiKey(
  env: Record<string, string | undefined>,
  directory: string,
): Promise<string | undefined> {
  const environmentKey = env.FISH_API_KEY?.trim();
  if (environmentKey) return environmentKey;

  try {
    const contents = await readFile(join(directory, ".env"), "utf8");
    return parseEnv(contents).FISH_API_KEY?.trim() || undefined;
  } catch {
    // Missing, unreadable, or invalid files fall back to the key dialog.
    // Never include file contents or credentials in diagnostics.
    return undefined;
  }
}

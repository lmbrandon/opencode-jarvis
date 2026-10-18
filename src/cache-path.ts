import { posix, win32 } from "node:path";

interface CacheDirectoryInput {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  home: string;
}

export function resolveCacheDirectory({
  env,
  platform,
  home,
}: CacheDirectoryInput): string {
  const paths = platform === "win32" ? win32 : posix;
  const root =
    env.XDG_CACHE_HOME ||
    (platform === "win32" ? env.LOCALAPPDATA : undefined) ||
    paths.join(home, ".cache");
  return paths.join(root, "opencode-jarvis");
}

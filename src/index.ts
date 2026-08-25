import type { PluginModule } from "@opencode-ai/plugin";

import { JarvisEngine } from "./engine.js";

export default {
  id: "opencode-jarvis",
  server: JarvisEngine,
} satisfies PluginModule;

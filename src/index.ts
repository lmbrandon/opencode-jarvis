import { Plugin } from "@opencode/plugin";

import { setupJarvisServer } from "./engine.js";

export default Plugin.define({
  id: "opencode-jarvis",
  setup: setupJarvisServer,
});

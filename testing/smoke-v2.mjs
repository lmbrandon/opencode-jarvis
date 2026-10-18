import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const tarballArgument = process.argv[2];
if (!tarballArgument) {
  throw new Error("Usage: npm run smoke:v2 -- <packed-tarball>");
}

const tarball = resolve(process.cwd(), tarballArgument);
await access(tarball);

const temporaryBase = join(tmpdir(), "opencode");
await mkdir(temporaryBase, { recursive: true });
const root = await mkdtemp(join(temporaryBase, "opencode-jarvis-v2-"));
const serverDirectory = join(root, "server");
const clientDirectory = join(root, "client");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

try {
  await Promise.all([
    mkdir(serverDirectory, { recursive: true }),
    mkdir(clientDirectory, { recursive: true }),
  ]);
  run("npm", ["init", "--yes"], clientDirectory);

  // OpenCode supplies these optional @opencode/plugin TUI peers. Installing
  // them here makes the isolated project equivalent to the terminal host.
  run(
    "npm",
    [
      "install",
      tarball,
      "@opencode/theme@2.0.29",
      "@opentui/core@0.5.17",
      "@opentui/solid@0.5.17",
      "solid-js@1.9.12",
    ],
    clientDirectory,
  );

  const runner = `
import assert from "node:assert/strict";
import serverPlugin from "opencode-jarvis";
import { JarvisRpc } from "opencode-jarvis/rpc";
import tuiPlugin from "opencode-jarvis/tui";

assert.equal(serverPlugin.id, "opencode-jarvis");
assert.equal(JarvisRpc.id, "opencode-jarvis");
assert.equal(tuiPlugin.id, "opencode-jarvis.tui");

const serverDirectory = ${JSON.stringify(serverDirectory)};
const clientDirectory = ${JSON.stringify(clientDirectory)};
const location = { directory: serverDirectory, workspaceID: "smoke-workspace" };
const values = new Map();
let handlers;
let contextHook;
const serverContext = {
  location,
  storage: {
    get: async (key) => values.get(key),
    set: async (key, value) => values.set(key, value),
    remove: async (key) => values.delete(key),
  },
  rpc: {
    register: async (definition, implementation) => {
      assert.equal(definition.id, JarvisRpc.id);
      handlers = implementation;
      return { dispose: async () => undefined };
    },
  },
  session: {
    hook: async (name, hook) => {
      assert.equal(name, "context");
      contextHook = hook;
      return { dispose: async () => undefined };
    },
  },
};

await serverPlugin.setup(serverContext);
assert.ok(handlers, "server registered Jarvis RPC");
assert.equal(typeof contextHook, "function", "server registered context hook");

const rpcContext = {
  signal: new AbortController().signal,
  error: (type, message, data) => ({ type, message, data }),
};
assert.deepEqual(await handlers.status({ sessionID: "session-a" }, rpcContext), { enabled: false });
assert.deepEqual(await handlers.set({ sessionID: "session-a", enabled: true }, rpcContext), { enabled: true });
assert.deepEqual(await handlers.status({ sessionID: "session-b" }, rpcContext), { enabled: false });

const contextEvent = { sessionID: "session-a", system: [] };
await contextHook(contextEvent);
assert.equal(contextEvent.system.length, 1, "enabled session receives Jarvis context");

const rpcLocations = [];
const rpcClient = Object.fromEntries(
  ["status", "set", "toggle"].map((name) => [
    name,
    async (input, options) => {
      rpcLocations.push(options?.location);
      return handlers[name](input, rpcContext);
    },
  ]),
);
const eventHandlers = new Map();
const unsubscribed = [];
let keymap;
const toasts = [];
process.env.FISH_API_KEY = "smoke-key";
const tuiContext = {
  location,
  client: {
    rpc: (definition) => {
      assert.equal(definition.id, JarvisRpc.id);
      return rpcClient;
    },
  },
  data: {
    on: (type, handler) => {
      eventHandlers.set(type, handler);
      return () => unsubscribed.push(type);
    },
    location: { default: () => location },
    session: {
      get: (sessionID) => ({ id: sessionID, location }),
      message: { sync: async () => undefined, list: () => [] },
    },
  },
  keymap: { layer: (factory) => { keymap = factory(); } },
  ui: {
    router: { current: () => ({ type: "session", sessionID: "session-a" }) },
    dialog: { prompt: async () => undefined, clear: () => undefined },
    toast: { show: (toast) => toasts.push(toast) },
  },
};

const cleanup = await tuiPlugin.setup(tuiContext);
assert.deepEqual(
  keymap.commands.map((command) => command.id),
  ["jarvis.toggle", "jarvis.enable", "jarvis.disable", "jarvis.status"],
);
await keymap.commands.find((command) => command.id === "jarvis.status").run();
assert.deepEqual(rpcLocations.at(-1), location, "terminal routes RPC through the session location");
assert.equal(toasts.at(-1).variant, "info");
assert.deepEqual(
  [...eventHandlers.keys()].sort(),
  ["session.execution.succeeded", "session.skill.activated"],
);
await cleanup();
assert.deepEqual(
  unsubscribed.sort(),
  ["session.execution.succeeded", "session.skill.activated"],
);

console.log(JSON.stringify({
  package: "${basename(tarball)}",
  exports: [".", "./rpc", "./tui"],
  server: ["rpc", "context-hook"],
  terminal: ["commands", "location-routed-rpc", "cleanup"],
}));
`;
  const runnerPath = join(clientDirectory, "smoke-runner.mjs");
  await writeFile(runnerPath, runner, "utf8");
  run("node", [runnerPath], clientDirectory);
} finally {
  await rm(root, { recursive: true, force: true });
}

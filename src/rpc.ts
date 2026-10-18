import { Rpc } from "@opencode/plugin/rpc";

const sessionInput = {
  type: "object",
  properties: { sessionID: { type: "string", minLength: 1 } },
  required: ["sessionID"],
  additionalProperties: false,
} as const;

const setInput = {
  type: "object",
  properties: {
    sessionID: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
  },
  required: ["sessionID", "enabled"],
  additionalProperties: false,
} as const;

const enabledOutput = {
  type: "object",
  properties: { enabled: { type: "boolean" } },
  required: ["enabled"],
  additionalProperties: false,
} as const;

const storageErrors = {
  storage_error: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
} as const;

export const JarvisRpc = Rpc.define({
  id: "opencode-jarvis",
  methods: {
    status: {
      input: sessionInput,
      output: enabledOutput,
      errors: storageErrors,
    },
    set: {
      input: setInput,
      output: enabledOutput,
      errors: storageErrors,
    },
    toggle: {
      input: sessionInput,
      output: enabledOutput,
      errors: storageErrors,
    },
  },
  events: {},
});

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var sessionInput = {
  type: "object",
  properties: { sessionID: { type: "string", minLength: 1 } },
  required: ["sessionID"],
  additionalProperties: false
};
var setInput = {
  type: "object",
  properties: {
    sessionID: { type: "string", minLength: 1 },
    enabled: { type: "boolean" }
  },
  required: ["sessionID", "enabled"],
  additionalProperties: false
};
var enabledOutput = {
  type: "object",
  properties: { enabled: { type: "boolean" } },
  required: ["enabled"],
  additionalProperties: false
};
var storageErrors = {
  storage_error: {
    type: "object",
    properties: {},
    additionalProperties: false
  }
};
var JarvisRpc = Rpc.define({
  id: "opencode-jarvis",
  methods: {
    status: {
      input: sessionInput,
      output: enabledOutput,
      errors: storageErrors
    },
    set: {
      input: setInput,
      output: enabledOutput,
      errors: storageErrors
    },
    toggle: {
      input: sessionInput,
      output: enabledOutput,
      errors: storageErrors
    }
  },
  events: {}
});

export {
  JarvisRpc
};

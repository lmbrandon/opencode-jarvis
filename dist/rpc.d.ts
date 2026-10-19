declare const JarvisRpc: {
    readonly id: "opencode-jarvis";
    readonly methods: {
        readonly status: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly sessionID: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                };
                readonly required: readonly ["sessionID"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly enabled: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["enabled"];
                readonly additionalProperties: false;
            };
            readonly errors: {
                readonly storage_error: {
                    readonly type: "object";
                    readonly properties: {};
                    readonly additionalProperties: false;
                };
            };
        };
        readonly set: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly sessionID: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    readonly enabled: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["sessionID", "enabled"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly enabled: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["enabled"];
                readonly additionalProperties: false;
            };
            readonly errors: {
                readonly storage_error: {
                    readonly type: "object";
                    readonly properties: {};
                    readonly additionalProperties: false;
                };
            };
        };
        readonly toggle: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly sessionID: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                };
                readonly required: readonly ["sessionID"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly enabled: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["enabled"];
                readonly additionalProperties: false;
            };
            readonly errors: {
                readonly storage_error: {
                    readonly type: "object";
                    readonly properties: {};
                    readonly additionalProperties: false;
                };
            };
        };
    };
    readonly events: {};
};

export { JarvisRpc };

import { describe, expect, it } from "vitest";

import { stripCodeForSpeech } from "../src/speech-text.js";

describe("stripCodeForSpeech", () => {
  it("leaves plain prose unchanged", () => {
    expect(stripCodeForSpeech("Done. Anything else?")).toBe(
      "Done. Anything else?",
    );
  });

  it("removes a fenced code block but keeps the surrounding prose", () => {
    const text = "Here's the fix:\n```ts\nconst x = 1;\n```\nDone.";

    expect(stripCodeForSpeech(text)).toBe("Here's the fix:\n\nDone.");
  });

  it("removes multiple fenced code blocks", () => {
    const text = "First:\n```\na\n```\nSecond:\n```\nb\n```\nDone.";

    expect(stripCodeForSpeech(text)).toBe("First:\n\nSecond:\n\nDone.");
  });

  it("removes an unterminated trailing fenced block", () => {
    const text = "Streaming a fix:\n```ts\nconst x = 1;";

    expect(stripCodeForSpeech(text)).toBe("Streaming a fix:");
  });

  it("unwraps inline code spans to their bare text", () => {
    expect(stripCodeForSpeech("Run `npm test` to verify.")).toBe(
      "Run npm test to verify.",
    );
  });

  it("unwraps multiple inline code spans in one sentence", () => {
    expect(stripCodeForSpeech("Rename `foo` to `bar`.")).toBe(
      "Rename foo to bar.",
    );
  });

  it("collapses blank lines left behind after removing a block", () => {
    const text = "Before.\n\n```\ncode\n```\n\nAfter.";

    expect(stripCodeForSpeech(text)).toBe("Before.\n\nAfter.");
  });

  it("returns an empty string when the reply is only a code block", () => {
    const text = "```ts\nconst x = 1;\n```";

    expect(stripCodeForSpeech(text)).toBe("");
  });
});

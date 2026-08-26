import { describe, expect, it } from "vitest";

import { stripMarkdownForSpeech } from "../src/speech-text.js";

describe("stripMarkdownForSpeech", () => {
  it("leaves plain prose unchanged", () => {
    expect(stripMarkdownForSpeech("Done. Anything else?")).toBe(
      "Done. Anything else?",
    );
  });

  it("removes a fenced code block but keeps the surrounding prose", () => {
    const text = "Here's the fix:\n```ts\nconst x = 1;\n```\nDone.";

    expect(stripMarkdownForSpeech(text)).toBe("Here's the fix:\n\nDone.");
  });

  it("removes multiple fenced code blocks", () => {
    const text = "First:\n```\na\n```\nSecond:\n```\nb\n```\nDone.";

    expect(stripMarkdownForSpeech(text)).toBe("First:\n\nSecond:\n\nDone.");
  });

  it("removes an unterminated trailing fenced block", () => {
    const text = "Streaming a fix:\n```ts\nconst x = 1;";

    expect(stripMarkdownForSpeech(text)).toBe("Streaming a fix:");
  });

  it("unwraps inline code spans to their bare text", () => {
    expect(stripMarkdownForSpeech("Run `npm test` to verify.")).toBe(
      "Run npm test to verify.",
    );
  });

  it("unwraps multiple inline code spans in one sentence", () => {
    expect(stripMarkdownForSpeech("Rename `foo` to `bar`.")).toBe(
      "Rename foo to bar.",
    );
  });

  it("collapses blank lines left behind after removing a block", () => {
    const text = "Before.\n\n```\ncode\n```\n\nAfter.";

    expect(stripMarkdownForSpeech(text)).toBe("Before.\n\nAfter.");
  });

  it("returns an empty string when the reply is only a code block", () => {
    const text = "```ts\nconst x = 1;\n```";

    expect(stripMarkdownForSpeech(text)).toBe("");
  });

  it("unwraps a bold label to its bare text", () => {
    expect(
      stripMarkdownForSpeech(
        "**Recommendation:** Start with one Django project.",
      ),
    ).toBe("Recommendation: Start with one Django project.");
  });

  it("unwraps italic emphasis to its bare text", () => {
    expect(stripMarkdownForSpeech("This is *really* important.")).toBe(
      "This is really important.",
    );
  });

  it("does not treat mid-word underscores or asterisked math as emphasis", () => {
    expect(stripMarkdownForSpeech("3 * 4 is twelve.")).toBe(
      "3 * 4 is twelve.",
    );
  });

  it("strips a markdown heading marker but keeps the heading text", () => {
    expect(stripMarkdownForSpeech("## Next steps\nDo this first.")).toBe(
      "Next steps\nDo this first.",
    );
  });

  it("strips unordered list bullet markers but keeps the item text", () => {
    const text = "- First step\n- Second step";

    expect(stripMarkdownForSpeech(text)).toBe("First step\nSecond step");
  });

  it("passes Fish Audio bracket emotion tags through untouched", () => {
    expect(
      stripMarkdownForSpeech("[excited] The build passed on the first try."),
    ).toBe("[excited] The build passed on the first try.");
  });
});

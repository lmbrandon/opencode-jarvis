const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
const UNTERMINATED_FENCE = /```[\s\S]*$/;
const INLINE_CODE_SPAN = /`([^`\n]+)`/g;
const EXCESS_BLANK_LINES = /\n{3,}/g;

export function stripCodeForSpeech(text: string): string {
  return text
    .replace(FENCED_CODE_BLOCK, "")
    .replace(UNTERMINATED_FENCE, "")
    .replace(INLINE_CODE_SPAN, "$1")
    .replace(EXCESS_BLANK_LINES, "\n\n")
    .trim();
}

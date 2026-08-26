const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
const UNTERMINATED_FENCE = /```[\s\S]*$/;
const HEADING_MARKER = /^#{1,6}[ \t]+/gm;
const LIST_BULLET_MARKER = /^[ \t]*[-*+][ \t]+/gm;
const BOLD_MARKDOWN = /\*\*([^\n]+?)\*\*/g;
const ITALIC_MARKDOWN = /\*([^\n*]+?)\*/g;
const INLINE_CODE_SPAN = /`([^`\n]+)`/g;
const EXCESS_BLANK_LINES = /\n{3,}/g;

export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(FENCED_CODE_BLOCK, "")
    .replace(UNTERMINATED_FENCE, "")
    .replace(HEADING_MARKER, "")
    .replace(LIST_BULLET_MARKER, "")
    .replace(BOLD_MARKDOWN, "$1")
    .replace(ITALIC_MARKDOWN, "$1")
    .replace(INLINE_CODE_SPAN, "$1")
    .replace(EXCESS_BLANK_LINES, "\n\n")
    .trim();
}

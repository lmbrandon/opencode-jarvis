export const GENERAL_GREETING = "Good day. Jarvis is online and ready.";

export function skillLoadingCue(skill: string): string {
  const displayName = skill
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(
      (word) =>
        `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`,
    )
    .join(" ");

  return `Just a second, I'm loading the ${displayName} skill.`;
}

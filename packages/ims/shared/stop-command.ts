export function isStopCommand(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 4 && trimmed.toLowerCase() === "stop";
}

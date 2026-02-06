export type RunMode = "local";

let cachedMode: RunMode | null = null;

function parseModeFromArgs(): RunMode {
  return "local";
}

export function getRunMode(): RunMode {
  if (cachedMode) return cachedMode;
  cachedMode = parseModeFromArgs();
  return cachedMode;
}

export function isLocalMode(): boolean {
  return true;
}

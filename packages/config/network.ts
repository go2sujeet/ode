const DEFAULT_WEB_HOST = "127.0.0.1";
const DEFAULT_WEB_PORT = 9293;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getWebHost(): string {
  return process.env.ODE_WEB_HOST?.trim() || DEFAULT_WEB_HOST;
}

export function getWebPort(): number {
  return parsePort(process.env.ODE_WEB_PORT?.trim(), DEFAULT_WEB_PORT);
}

const DEFAULT_SLACK_API_HOST = "127.0.0.1";
const DEFAULT_SLACK_API_PORT = 9292;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getSlackActionApiUrl(): string {
  const host = process.env.ODE_SLACK_API_HOST?.trim() || DEFAULT_SLACK_API_HOST;
  const port = parsePort(process.env.ODE_SLACK_API_PORT?.trim(), DEFAULT_SLACK_API_PORT);
  return `http://${host}:${port}`;
}

export type JsonResponse = {
  ok: boolean;
  error?: string;
  version?: string;
  config?: unknown;
  dev?: unknown;
  workspace?: unknown;
  result?: unknown;
};

export function parsePositiveInt(value: string | null, fallback: number, max?: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const intValue = Math.floor(parsed);
  if (typeof max === "number") return Math.min(intValue, max);
  return intValue;
}

export function jsonResponse(status: number, payload: JsonResponse): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const payload = await request.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid JSON payload");
  }
  return payload as Record<string, unknown>;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function runRoute<T>(
  execute: () => Promise<T>,
  ok: (value: T) => Response,
  onError: {
    fallbackMessage: string;
    status?: number;
    resolveStatus?: (message: string) => number;
  }
): Promise<Response> {
  try {
    const value = await execute();
    return ok(value);
  } catch (error) {
    const message = getErrorMessage(error, onError.fallbackMessage);
    const status = onError.resolveStatus ? onError.resolveStatus(message) : (onError.status ?? 500);
    return jsonResponse(status, { ok: false, error: message });
  }
}

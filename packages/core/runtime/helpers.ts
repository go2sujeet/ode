import { getDefaultOpenCodeServerUrl } from "@/config";
import type { NormalizedQuestion } from "@/core/types";

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export function buildFinalResponseText(responses: Array<{ text?: string }>): string | null {
  const texts = responses
    .map((response) => response.text?.trim())
    .filter((text): text is string => Boolean(text));
  if (texts.length === 0) return null;
  return texts.join("\n\n");
}

export function categorizeRuntimeError(
  err: unknown,
  serverUrlOverride?: string
): { message: string; suggestion: string } {
  const errorStr = err instanceof Error ? err.message : String(err);

  if (errorStr.includes("timeout") || errorStr.includes("ETIMEDOUT")) {
    return {
      message: "Request timed out",
      suggestion: "The operation took too long. Try a simpler request or break it into smaller steps.",
    };
  }

  if (errorStr.includes("rate limit") || errorStr.includes("429")) {
    return {
      message: "Rate limited",
      suggestion: "Too many requests. Please wait a moment and try again.",
    };
  }

  if (errorStr.includes("authentication") || errorStr.includes("401") || errorStr.includes("403")) {
    return {
      message: "Authentication error",
      suggestion: "There may be an issue with API credentials. Contact your administrator.",
    };
  }

  if (
    errorStr.includes("ConnectionRefused") ||
    errorStr.includes("ECONNREFUSED") ||
    errorStr.includes("ENOTFOUND") ||
    errorStr.includes("network")
  ) {
    let defaultUrl: string | undefined;
    try {
      defaultUrl = getDefaultOpenCodeServerUrl();
    } catch {
      defaultUrl = undefined;
    }
    const serverUrl = serverUrlOverride || defaultUrl;
    const message = serverUrl
      ? `OpenCode server not accessible on ${serverUrl}`
      : "OpenCode server not accessible";
    return {
      message,
      suggestion: "Check that the OpenCode server is running and reachable.",
    };
  }

  if (errorStr.includes("empty response")) {
    return {
      message: "No response received",
      suggestion: "The model didn't generate a response. Try rephrasing your request.",
    };
  }

  return {
    message: errorStr.length > 100 ? `${errorStr.slice(0, 100)}...` : errorStr,
    suggestion: "If this persists, try starting a new thread or contact support.",
  };
}

export function formatQuestionPrompt(questions: NormalizedQuestion[]): string {
  const lines = questions.map((question, index) => {
    const prefix = questions.length > 1 ? `${index + 1}. ` : "";
    const optionText = question.options?.length
      ? `\nOptions: ${question.options.join(" / ")}`
      : "";
    return `${prefix}${question.question}${optionText}`;
  });

  return lines.join("\n\n");
}

export function buildQuestionAnswers(
  questions: NormalizedQuestion[],
  responseText: string
): Array<Array<string>> {
  const trimmed = responseText.trim();
  if (questions.length <= 1) {
    return [[trimmed]];
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return questions.map((_, index) => {
    const line = lines[index] ?? "";
    return [line];
  });
}

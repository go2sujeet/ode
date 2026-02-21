import type { SessionMessageState } from "@/utils";
import { log } from "@/utils";

const SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
const SILICONFLOW_MODEL = "Qwen/Qwen2.5-7B-Instruct";
const SILICONFLOW_API_KEY = "sk-avkivvbgozinofsnrfuazmsfhiuxlyimewadbfmvghilfkax";
const REQUEST_TIMEOUT_MS = 6000;
const MAX_TITLE_LENGTH = 64;

const inFlight = new Set<string>();

type SiliconFlowResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function normalizeTitle(value: string): string | null {
  const title = value
    .replace(/^[`"'\s]+|[`"'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return title.slice(0, MAX_TITLE_LENGTH).trim();
}

export async function generateTitleFromPrompt(prompt: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(SILICONFLOW_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
      },
      body: JSON.stringify({
        model: SILICONFLOW_MODEL,
        temperature: 0.2,
        max_tokens: 24,
        messages: [
          {
            role: "system",
            content: [
              "You generate concise chat session titles.",
              "Rules:",
              "- Return title text only.",
              "- No quotes.",
              "- Keep it under 12 words.",
            ].join("\n"),
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.debug("SiliconFlow title generation failed", { status: response.status });
      return null;
    }

    const data = await response.json() as SiliconFlowResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return normalizeTitle(content);
  } catch (error) {
    log.debug("SiliconFlow title generation error", { error: String(error) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function createTitleOnlyState(title: string, startedAt: number): SessionMessageState {
  return {
    sessionTitle: title,
    currentText: "",
    tools: [],
    todos: [],
    startedAt,
  };
}

export async function maybeGenerateSessionTitle(params: {
  prompt: string;
  stateKey: string;
  liveParsedState: Map<string, SessionMessageState>;
  startedAt: number;
}): Promise<void> {
  const { prompt, stateKey, liveParsedState, startedAt } = params;
  if (!prompt.trim()) return;
  if (inFlight.has(stateKey)) return;

  const existingState = liveParsedState.get(stateKey);
  if (existingState?.sessionTitle) return;

  inFlight.add(stateKey);
  try {
    const title = await generateTitleFromPrompt(prompt);
    if (!title) return;

    const nextState = liveParsedState.get(stateKey);
    if (nextState) {
      if (!nextState.sessionTitle) {
        nextState.sessionTitle = title;
      }
      return;
    }

    liveParsedState.set(stateKey, createTitleOnlyState(title, startedAt));
  } finally {
    inFlight.delete(stateKey);
  }
}

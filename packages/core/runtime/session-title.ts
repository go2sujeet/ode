import type { SessionMessageState } from "@/utils";
import { log } from "@/utils";

const SILICONFLOW_API_URL = "https://api.siliconflow.com/v1/chat/completions";
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
  /**
   * Resolves to the live-state key to use when reading/writing the
   * parsed state for the current request. Accepting a getter (rather
   * than a snapshot string) means we pick up a fresh key if the status
   * message is rotated mid-flight — otherwise title generation would
   * race with rotation and write the title to an orphan map entry.
   */
  getStateKey: () => string;
  liveParsedState: Map<string, SessionMessageState>;
  startedAt: number;
  onTitleGenerated?: (title: string) => Promise<void> | void;
}): Promise<void> {
  const { prompt, getStateKey, liveParsedState, startedAt, onTitleGenerated } = params;
  if (!prompt.trim()) return;

  const entryKey = getStateKey();
  if (inFlight.has(entryKey)) return;

  const existingState = liveParsedState.get(entryKey);
  if (existingState?.sessionTitle) return;

  inFlight.add(entryKey);
  try {
    const title = await generateTitleFromPrompt(prompt);
    if (!title) return;

    // Re-read the key after the async call. Status message rotation (for
    // example when the user just answered a question) may have re-keyed
    // `liveParsedState` in the interim; writing to the key we captured
    // at function entry would leave the title stranded under an orphan
    // key while the real state lives under the new one.
    const writeKey = getStateKey();
    const nextState = liveParsedState.get(writeKey);
    if (nextState) {
      if (!nextState.sessionTitle) {
        nextState.sessionTitle = title;
      }
      if (onTitleGenerated) {
        try {
          await onTitleGenerated(title);
        } catch (error) {
          log.debug("Session title hook failed", {
            stateKey: writeKey,
            error: String(error),
          });
        }
      }
      return;
    }

    liveParsedState.set(writeKey, createTitleOnlyState(title, startedAt));
    if (onTitleGenerated) {
      try {
        await onTitleGenerated(title);
      } catch (error) {
        log.debug("Session title hook failed", {
          stateKey: writeKey,
          error: String(error),
        });
      }
    }
  } finally {
    inFlight.delete(entryKey);
  }
}

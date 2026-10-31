// Live check accepted claude-haiku-5-5. Fallbacks are used only if that id is rejected.
export const PREFERRED_MODEL = "claude-haiku-5-5";

export const MODEL_FALLBACKS = [
  "claude-haiku-4-5",
  "claude-3-5-haiku-latest",
  "claude-3-5-haiku-20241022",
];

export type ClaudeResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type ClaudeRequest = {
  label: string;
  system: string;
  user: string;
  maxTokens: number;
};

export type ClaudeClient = (request: ClaudeRequest) => Promise<ClaudeResult>;

type MessageResponse = {
  content?: { type?: string; text?: string }[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
};

export function modelChain(preferred = PREFERRED_MODEL): string[] {
  return [...new Set([preferred, PREFERRED_MODEL, ...MODEL_FALLBACKS])];
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Claude did not return JSON. The run stopped and nothing was sent.");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

export function createClaude(apiKey: string, preferred: string, fetchImpl: typeof fetch = fetch): ClaudeClient {
  return async (request) => {
    if (!apiKey) {
      throw new Error("Claude is unavailable. The run stopped and nothing was sent.");
    }
    let lastStatus = 0;
    for (const model of modelChain(preferred)) {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      const payload = (await response.json().catch(() => ({}))) as MessageResponse;
      if (response.ok) {
        const text = (payload.content ?? [])
          .filter((block) => block.type === "text" && block.text)
          .map((block) => block.text)
          .join("\n");
        if (!text.trim()) {
          throw new Error("Claude is unavailable. The run stopped and nothing was sent.");
        }
        return {
          text,
          model: payload.model || model,
          inputTokens: payload.usage?.input_tokens ?? 0,
          outputTokens: payload.usage?.output_tokens ?? 0,
        };
      }
      lastStatus = response.status;
      const message = payload.error?.message ?? "";
      const missingModel =
        payload.error?.type === "not_found_error" ||
        ((response.status === 400 || response.status === 404) && /model/i.test(message));
      if (missingModel) continue;
      throw new Error(`Claude is unavailable (${response.status}). The run stopped and nothing was sent.`);
    }
    throw new Error(`Claude is unavailable (${lastStatus || "model"}). The run stopped and nothing was sent.`);
  };
}

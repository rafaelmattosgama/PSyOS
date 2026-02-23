type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractTextContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const maybeText = (item as { text?: unknown }).text;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .filter(Boolean);
  return parts.join("\n").trim();
}

async function requestChatCompletion(params: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  includeResponseFormat: boolean;
}) {
  const useMaxCompletionTokens =
    params.model.startsWith("gpt-5") || params.model.startsWith("o1");
  const gpt5MinCompletionTokens = Number(
    process.env.OPENAI_GPT5_MIN_COMPLETION_TOKENS ?? "1000",
  );
  const minCompletionTokens = Number.isFinite(gpt5MinCompletionTokens)
    ? gpt5MinCompletionTokens
    : 1000;
  const effectiveMax =
    useMaxCompletionTokens && params.model.startsWith("gpt-5")
      ? Math.max(params.maxTokens, minCompletionTokens)
      : params.maxTokens;
  if (effectiveMax !== params.maxTokens) {
    console.log("[openai] adjusted token budget", {
      model: params.model,
      requested: params.maxTokens,
      effective: effectiveMax,
      minCompletionTokens,
    });
  }

  const payload: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    ...(useMaxCompletionTokens
      ? { max_completion_tokens: effectiveMax }
      : { max_tokens: effectiveMax }),
    temperature: params.temperature,
  };
  if (params.includeResponseFormat) {
    payload.response_format = { type: "text" };
  }

  const timeoutMs = Number(process.env.OPENAI_HTTP_TIMEOUT_MS ?? "45000");
  let response: Response;
  try {
    response = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      Number.isFinite(timeoutMs) ? timeoutMs : 45000,
    );
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `OpenAI request timeout after ${timeoutMs}ms`
        : (error as Error).message;
    console.error(`[openai] ${params.model} network error: ${message}`);
    throw new Error(message);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(
      `[openai] ${params.model} ${response.status} ${response.statusText} ${errorText || "no body"}`,
    );
    throw new Error(
      `OpenAI request failed (${response.status}): ${errorText || "no body"}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: unknown };
      finish_reason?: string;
    }>;
    usage?: Record<string, unknown>;
  };
  const content = extractTextContent(data.choices?.[0]?.message?.content);
  if (!content) {
    console.error("[openai] empty content response", {
      model: params.model,
      finishReason: data.choices?.[0]?.finish_reason,
      usage: data.usage,
    });
    throw new Error("OpenAI returned empty content");
  }
  return content;
}

export async function callOpenAi(params: {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const requestedMax = params.maxTokens ?? 300;
  const temperature = params.temperature ?? 0.4;

  try {
    return await requestChatCompletion({
      apiKey,
      model,
      messages: params.messages,
      maxTokens: requestedMax,
      temperature,
      includeResponseFormat: true,
    });
  } catch (primaryError) {
    let lastError: unknown = primaryError;

    if (model.startsWith("gpt-5")) {
      try {
        console.warn(
          "[openai] primary model returned no content/error; retrying gpt-5 with larger token budget",
        );
        return await requestChatCompletion({
          apiKey,
          model,
          messages: params.messages,
          maxTokens: Math.max(requestedMax, 1400),
          temperature,
          includeResponseFormat: false,
        });
      } catch (retryError) {
        lastError = retryError;
      }
    }

    const fallbackModel = process.env.OPENAI_FALLBACK_MODEL?.trim();
    if (fallbackModel && fallbackModel !== model) {
      try {
        console.warn(
          `[openai] retrying with fallback model ${fallbackModel} after ${model} failure`,
        );
        return await requestChatCompletion({
          apiKey,
          model: fallbackModel,
          messages: params.messages,
          maxTokens: requestedMax,
          temperature,
          includeResponseFormat: true,
        });
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("OpenAI request failed");
  }
}

export async function transcribeAudio(params: {
  file: File;
  language?: "pt" | "es" | "en";
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
  const formData = new FormData();
  formData.append("model", model);
  formData.append("response_format", "json");
  if (params.language) {
    formData.append("language", params.language);
  }
  formData.append("file", params.file);

  const timeoutMs = Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS ?? "60000");
  let response: Response;
  try {
    response = await fetchWithTimeout(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      },
      Number.isFinite(timeoutMs) ? timeoutMs : 60000,
    );
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `OpenAI transcription timeout after ${timeoutMs}ms`
        : (error as Error).message;
    console.error(`[openai-transcribe] network error: ${message}`);
    throw new Error(message);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(
      `[openai-transcribe] ${response.status} ${response.statusText} ${errorText || "no body"}`,
    );
    throw new Error(
      `OpenAI transcription failed (${response.status}): ${errorText || "no body"}`,
    );
  }

  const data = (await response.json()) as { text?: string };
  const text = data.text?.trim() ?? "";
  if (!text) {
    throw new Error("OpenAI transcription returned empty text");
  }
  return text;
}

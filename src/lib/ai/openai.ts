type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function callOpenAi(params: {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const useMaxCompletionTokens =
    model.startsWith("gpt-5") || model.startsWith("o1");
  const requestedMax = params.maxTokens ?? 300;
  const effectiveMax =
    useMaxCompletionTokens && model.startsWith("gpt-5")
      ? Math.max(requestedMax, 600)
      : requestedMax;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: params.messages,
      response_format: { type: "text" },
      ...(useMaxCompletionTokens
        ? { max_completion_tokens: effectiveMax }
        : { max_tokens: effectiveMax }),
      temperature: params.temperature ?? 0.4,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(
      `[openai] ${response.status} ${response.statusText} ${errorText || "no body"}`,
    );
    throw new Error(
      `OpenAI request failed (${response.status}): ${errorText || "no body"}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: Record<string, unknown>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    console.error("[openai] empty content response", {
      finishReason: data.choices?.[0]?.finish_reason,
      usage: data.usage,
    });
    throw new Error("OpenAI returned empty content");
  }
  return content;
}

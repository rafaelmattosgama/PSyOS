type EvolutionMessagePayload = {
  instance: string;
  to: string;
  message: string;
};

export async function sendEvolutionMessage(payload: EvolutionMessagePayload) {
  const url = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!url || !apiKey) {
    throw new Error("Evolution API configuration missing");
  }

  const response = await fetch(`${url}/message/sendText/${payload.instance}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      number: payload.to,
      text: payload.message,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to send Evolution message");
  }

  return response.json().catch(() => null);
}

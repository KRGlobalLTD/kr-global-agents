export interface OpenRouterMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: {
    prompt_tokens:     number;
    completion_tokens: number;
    total_tokens:      number;
  };
}

const DEFAULT_MODEL = 'google/gemini-2.0-flash';

export async function callOpenRouter(
  messages: OpenRouterMessage[],
  model  = DEFAULT_MODEL,
  jsonMode = false,
): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'KR Global Agents',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens:  2000,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = (await res.json()) as OpenRouterResponse;
  return data.choices?.[0]?.message?.content ?? '';
}

export function systemPrompt(agentName: string, role: string): OpenRouterMessage {
  return {
    role:    'system',
    content: `Tu es ${agentName}, ${role} de KR Global Solutions Ltd (agence IA, Londres). Réponds toujours en JSON valide.`,
  };
}

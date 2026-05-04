import { ChatOpenAI } from '@langchain/openai';

let _llm: ChatOpenAI | null = null;
let _llmJson: ChatOpenAI | null = null;

export function getLLM(jsonMode = false): ChatOpenAI {
  if (jsonMode) {
    if (!_llmJson) {
      _llmJson = new ChatOpenAI({
        model:       'google/gemini-2.0-flash-001',
        temperature: 0.3,
        maxTokens:   2000,
        openAIApiKey: process.env.OPENROUTER_API_KEY ?? 'no-key',
        configuration: {
          baseURL:        'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'HTTP-Referer': 'https://kr-global.com',
            'X-Title':      'KR Global Agents',
          },
        },
        modelKwargs: {
          response_format: { type: 'json_object' },
        },
      });
    }
    return _llmJson;
  }

  if (!_llm) {
    _llm = new ChatOpenAI({
      model:       'google/gemini-2.0-flash-001',
      temperature: 0.7,
      maxTokens:   2000,
      openAIApiKey: process.env.OPENROUTER_API_KEY ?? 'no-key',
      configuration: {
        baseURL:        'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://kr-global.com',
          'X-Title':      'KR Global Agents',
        },
      },
    });
  }
  return _llm;
}

import Groq from 'groq-sdk';
import { config } from '../config.js';

/** Lazy: Groq's constructor throws without a key, and this module is imported
 * at boot. See core/extract.ts for the full reasoning. */
let groqClient: Groq | null = null;
function groq(): Groq {
  if (!groqClient) {
    if (!config.groqKey) throw new Error('GROQ_API_KEY is not set');
    groqClient = new Groq({ apiKey: config.groqKey });
  }
  return groqClient;
}

const NOT_FOUND_PATTERNS = [
  'no information', 'could not find', "couldn't find", "don't have", 'do not have',
  'no data', 'unable to find', 'no results', 'not aware of', "i'm not able to find",
];

const URL_PATTERN = /https?:\/\/[^\s)"'\]]+/g;

export interface AreaAnswer {
  answer: string | null;
  sources: string[];
  found: boolean;
}

interface CompoundExecutedTool {
  type?: string;
  search_results?: { results?: { url?: string }[] };
}

export async function askAboutArea(question: string, locality: string, city: string): Promise<AreaAnswer> {
  if (!config.groqKey) {
    return { answer: null, sources: [], found: false };
  }

  const res = await groq().chat.completions.create({
    model: config.areaAgentModel,
    messages: [
      {
        role: 'system',
        content:
          'You answer a house-hunter\'s question about a specific neighbourhood in ' +
          'India by searching the web, including forums like Reddit and Quora. Give a ' +
          'short, direct answer grounded in what you actually find, then list the exact ' +
          'URLs of the pages you used under a line that says "Sources:", one per line. ' +
          'If you find nothing relevant, say plainly that you found no information and ' +
          'list no sources — do not guess.',
      },
      {
        role: 'user',
        content: `Neighbourhood: ${locality}, ${city}.\nQuestion: ${question}`,
      },
    ],
  });

  const message = res.choices[0]?.message;
  const rawAnswer = message?.content?.trim() ?? '';

  const toolUrls = new Set<string>();
  const executedTools = (message as unknown as { executed_tools?: CompoundExecutedTool[] })
    ?.executed_tools ?? [];
  for (const tool of executedTools) {
    for (const result of tool.search_results?.results ?? []) {
      if (result.url) toolUrls.add(result.url);
    }
  }
  for (const match of rawAnswer.match(URL_PATTERN) ?? []) toolUrls.add(match.replace(/[.,]$/, ''));

  const answer = rawAnswer.split(/\n?sources:/i)[0]?.trim() ?? rawAnswer;
  const lower = answer.toLowerCase();
  const notFound = !answer || NOT_FOUND_PATTERNS.some((p) => lower.includes(p));

  return {
    answer: notFound ? null : answer,
    sources: notFound ? [] : Array.from(toolUrls),
    found: !notFound,
  };
}

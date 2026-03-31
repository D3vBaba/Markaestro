const SERPER_API_URL = 'https://google.serper.dev';

type SerperSearchType = 'search' | 'news';

interface SerperOrganicResult {
  title: string;
  snippet: string;
  link: string;
  position: number;
}

interface SerperNewsResult {
  title: string;
  snippet: string;
  link: string;
  source: string;
  date?: string;
}

interface SerperSearchResponse {
  organic?: SerperOrganicResult[];
  news?: SerperNewsResult[];
  answerBox?: { answer?: string; snippet?: string };
}

export interface SerperResult {
  title: string;
  snippet: string;
  link: string;
  source?: string;
  date?: string;
}

export interface SerperSearchResults {
  results: SerperResult[];
  answerBox?: string;
}

function getClient() {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY not configured');
  return apiKey;
}

async function search(
  query: string,
  type: SerperSearchType = 'search',
  maxResults = 5,
): Promise<SerperSearchResults> {
  const apiKey = getClient();

  const response = await fetch(`${SERPER_API_URL}/${type}`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num: maxResults,
      hl: 'en',
      gl: 'us',
    }),
  });

  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
  }

  const data: SerperSearchResponse = await response.json();

  const results: SerperResult[] = [];

  if (type === 'news' && data.news) {
    for (const item of data.news.slice(0, maxResults)) {
      results.push({
        title: item.title,
        snippet: item.snippet,
        link: item.link,
        source: item.source,
        date: item.date,
      });
    }
  } else if (data.organic) {
    for (const item of data.organic.slice(0, maxResults)) {
      results.push({
        title: item.title,
        snippet: item.snippet,
        link: item.link,
      });
    }
  }

  const answerBox = data.answerBox?.answer ?? data.answerBox?.snippet;

  return { results, answerBox };
}

// Format results as a compact text block for LLM consumption
export function formatResultsForLLM(
  results: SerperResult[],
  answerBox?: string,
): string {
  const lines: string[] = [];

  if (answerBox) {
    lines.push(`FEATURED ANSWER: ${answerBox}`);
    lines.push('');
  }

  results.forEach((r, i) => {
    lines.push(`[${i + 1}] ${r.title}`);
    lines.push(`    ${r.snippet}`);
    if (r.source) lines.push(`    Source: ${r.source}${r.date ? ` (${r.date})` : ''}`);
  });

  return lines.join('\n');
}

export const serper = { search };

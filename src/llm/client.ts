// OpenAI-compatible chat client with JSON-schema structured outputs.
// Config lives in localStorage so the player pastes their key in Settings.

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;       // SMART tier: nightly world-load (Director), bundle authoring, the eval judge
  fastModel: string;   // FAST tier: real-time NPC dialogue (empty -> reuses `model`)
}

export type ModelTier = 'smart' | 'fast';

const CFG_KEY = 'living-kanto-llm-cfg';
const DEFAULTS: LLMConfig = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'openai/gpt-5.5', fastModel: '' };

export function getConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };   // backfill new fields on older saves
  } catch { /* fall through */ }
  return { ...DEFAULTS };
}

export function setConfig(cfg: LLMConfig) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

export function hasKey(): boolean { return getConfig().apiKey.trim().length > 0; }

// Reasoning effort per tier: the smart tier (nightly Director, bundle authoring,
// the eval judge) thinks HARD; the fast tier (real-time dialogue) thinks little
// so replies stay snappy. Sent as OpenRouter's `reasoning.effort` — silently
// ignored by models that don't support reasoning.
const TIER_EFFORT: Record<ModelTier, 'low' | 'medium' | 'high'> = { smart: 'high', fast: 'low' };

export async function chatJSON<T>(
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
  maxTokens = 900,
  tier: ModelTier = 'smart',
): Promise<T> {
  const cfg = getConfig();
  if (!cfg.apiKey) throw new Error('no-key');
  const model = tier === 'fast' ? (cfg.fastModel.trim() || cfg.model) : cfg.model;
  const effort = TIER_EFFORT[tier];
  // reasoning tokens count toward the completion budget — give high-effort calls
  // headroom so the JSON answer doesn't get truncated by the thinking.
  const budget = effort === 'high' ? Math.max(maxTokens, 2500) : maxTokens;
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: budget,
      reasoning: { effort },
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Some OpenAI-compatible servers don't support json_schema; retry with json_object
    if (res.status === 400 && /json_schema|response_format/i.test(body)) {
      return chatJSONFallbackMode<T>(system, user, budget, model, effort);
    }
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return JSON.parse(text) as T;
}

async function chatJSONFallbackMode<T>(system: string, user: string, maxTokens: number, model: string, effort: 'low' | 'medium' | 'high'): Promise<T> {
  const cfg = getConfig();
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system + '\nRespond ONLY with valid JSON matching the requested shape.' },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
      reasoning: { effort },
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as T;
}

export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  try {
    const out = await chatJSON<{ pong: string }>(
      'You are a connection test. Reply with JSON.',
      'Say pong.',
      'ping',
      { type: 'object', properties: { pong: { type: 'string' } }, required: ['pong'], additionalProperties: false },
      50,
    );
    return { ok: true, detail: `Connected — model replied: ${out.pong}` };
  } catch (e) {
    return { ok: false, detail: String((e as Error).message ?? e) };
  }
}

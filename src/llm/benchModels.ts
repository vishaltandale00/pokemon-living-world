// Dev tool: benchmark real-time-dialogue latency across candidate fast-tier
// models, through the game's OWN OpenRouter config. The key is read from
// getConfig() inside this module (the game handles it, exactly like chatJSON) —
// it never leaves here and is never returned, so the caller only sees timings.
//
// Console usage:
//   await window.__listModels('flash')   // discover valid OpenRouter ids
//   await window.__benchModels(['google/gemini-2.5-flash','openai/gpt-4o-mini'], 2)
import { getConfig } from './client';

// A representative real-time NPC-dialogue turn (short in/out, the actual workload).
const SYSTEM = `You ARE Giovanni — Viridian Gym Leader, secretly the boss of Team Rocket. Stay fully in character. This is the POKÉMON world; never reference the real world. Reply in 1-2 terse sentences, then give 2 short things the player could say back. Reply ONLY as compact JSON: {"npcLine":"...","choices":["...","..."]}`;
const USER = `The player looks you in the eye: "I know what you really are."`;

export interface BenchRow { model: string; ok: boolean; avgMs: number | null; runsMs: number[]; reasoningTokens: number | null; completionTokens: number | null; sample: string; error?: string; }

// `effort` (optional) sets the reasoning level via OpenRouter's `reasoning.effort`
// — pass 'low'|'medium'|'high' to compare; omit to measure the provider DEFAULT.
export async function benchModels(models: string[], rounds = 2, effort?: 'low' | 'medium' | 'high'): Promise<BenchRow[] | { error: string }> {
  const cfg = getConfig();
  if (!cfg.apiKey) return { error: 'No API key set. Open Settings (Esc), paste your OpenRouter key, Save, then re-run __benchModels(...).' };
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const rows: BenchRow[] = [];
  for (const model of models) {
    const runsMs: number[] = []; const reas: number[] = []; const comp: number[] = [];
    let ok = false, sample = '', error = '';
    for (let r = 0; r < rounds; r++) {
      const t0 = performance.now();
      try {
        const body: Record<string, unknown> = {
          model,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }],
          max_tokens: 400,
        };
        if (effort) body.reasoning = { effort };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body),
        });
        const ms = performance.now() - t0;
        if (!res.ok) { error = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 140)}`; continue; }
        const data = await res.json();
        const txt: string = data.choices?.[0]?.message?.content ?? '';
        const u = data.usage ?? {};
        runsMs.push(Math.round(ms));
        if (typeof u.completion_tokens === 'number') comp.push(u.completion_tokens);
        const rt = u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens;
        if (typeof rt === 'number') reas.push(rt);
        ok = true;
        if (!sample) {
          try { sample = String(JSON.parse(txt.replace(/```json|```/g, '')).npcLine ?? '').slice(0, 90); }
          catch { sample = txt.replace(/\s+/g, ' ').slice(0, 90); }
        }
      } catch (e) { error = String(e); }
    }
    const mean = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    rows.push({ model, ok, avgMs: mean(runsMs), runsMs, reasoningTokens: mean(reas), completionTokens: mean(comp), sample, error: ok ? undefined : error });
  }
  rows.sort((a, b) => (a.avgMs ?? 1e9) - (b.avgMs ?? 1e9));
  // eslint-disable-next-line no-console
  console.table(rows.map(r => ({ model: r.model, avgMs: r.avgMs, reasoningTokens: r.reasoningTokens, completionTokens: r.completionTokens, ok: r.ok, sample: r.sample, error: r.error })));
  return rows;
}

// Discover valid model ids on the configured provider (so we don't guess names).
export async function listModels(filter = ''): Promise<string[] | { error: string }> {
  const cfg = getConfig();
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/models`, {
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    const f = filter.toLowerCase();
    const ids: string[] = (data.data ?? []).map((m: { id: string }) => m.id);
    return f ? ids.filter(id => id.toLowerCase().includes(f)).sort() : ids.sort();
  } catch (e) { return { error: String(e) }; }
}

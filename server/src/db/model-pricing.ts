import type Database from 'better-sqlite3';

/**
 * Paid-equivalent pricing per model: what the SAME model (or its nearest
 * equivalent) costs per million tokens on paid APIs. Used by the analytics
 * "Est. savings" stat so it reflects realistic savings rather than pricing
 * every token like a frontier model.
 *
 * Source: OpenRouter public pricing API (paid, non-:free variants),
 * snapshot 2026-06-05; closed models use their official API prices.
 * `null` = no paid equivalent exists (stealth/preview models) — analytics
 * falls back to a modest default.
 *
 * Format: [platform, model_id, $/M input, $/M output]
 */
type PricingRow = [string, string, number | null, number | null];

export const MODEL_PRICING: PricingRow[] = [
  // Cerebras — speed_rank 1
  ['cerebras', 'gpt-oss-120b', 0.039, 0.18],
  ['cerebras', 'zai-glm-4.7', 0.40, 1.75],

  // Google AI Studio (official prices) — speed_rank 3–4
  ['google', 'gemini-2.5-flash-lite', 0.10, 0.40],
  ['google', 'gemini-3.1-flash-lite-preview', 0.25, 1.50],
  ['google', 'gemma-4-26b-a4b-it', 0.06, 0.33],
  ['google', 'gemma-4-31b-it', 0.12, 0.37],

  // Groq — speed_rank 2
  ['groq', 'groq/compound', 0.039, 0.18],
  ['groq', 'groq/compound-mini', 0.029, 0.14],
  ['groq', 'llama-3.1-8b-instant', 0.02, 0.03],
  ['groq', 'llama-3.3-70b-versatile', 0.10, 0.32],
  ['groq', 'meta-llama/llama-4-scout-17b-16e-instruct', 0.08, 0.30],
  ['groq', 'openai/gpt-oss-120b', 0.039, 0.18],
  ['groq', 'openai/gpt-oss-20b', 0.029, 0.14],
  ['groq', 'openai/gpt-oss-safeguard-20b', 0.075, 0.30],
  ['groq', 'qwen/qwen3-32b', 0.08, 0.28],

  // Kilo — speed_rank 3–4 (only fast routes kept)
  ['kilo', 'poolside/laguna-xs.2:free', null, null],
  ['kilo', 'stepfun/step-3.7-flash:free', 0.20, 1.15],

  // OpenCode Zen — speed_rank 4
  ['opencode', 'big-pickle', null, null],
  ['opencode', 'deepseek-v4-flash-free', 0.098, 0.197],
  ['opencode', 'mimo-v2.5-free', 0.14, 0.28],
  ['opencode', 'minimax-m3-free', 0.30, 1.20],
  ['opencode', 'nemotron-3-super-free', 0.09, 0.45],
  ['opencode', 'nemotron-3-ultra-free', 0.50, 2.50],

  // Zhipu — speed_rank 4
  ['zhipu', 'glm-4.5-flash', 0.06, 0.40],
  ['zhipu', 'glm-4.6v-flash', 0.30, 0.90],
  ['zhipu', 'glm-4.7-flash', 0.06, 0.40],
];

/** Fallback $/M for models with no mapping (custom endpoints, stealth). */
export const FALLBACK_INPUT_PER_M = 0.20;
export const FALLBACK_OUTPUT_PER_M = 0.80;

/**
 * Adds the pricing columns (idempotent) and refreshes prices for every
 * known model. Runs on every boot — it's ~100 UPDATEs in one transaction
 * and keeps prices current when this map is updated in a release.
 */
export function applyModelPricing(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  if (!columns.some(c => c.name === 'paid_input_per_m')) {
    db.prepare('ALTER TABLE models ADD COLUMN paid_input_per_m REAL').run();
  }
  if (!columns.some(c => c.name === 'paid_output_per_m')) {
    db.prepare('ALTER TABLE models ADD COLUMN paid_output_per_m REAL').run();
  }

  const update = db.prepare(`
    UPDATE models SET paid_input_per_m = ?, paid_output_per_m = ?
    WHERE platform = ? AND model_id = ?
  `);
  const applyAll = db.transaction(() => {
    for (const [platform, modelId, input, output] of MODEL_PRICING) {
      update.run(input, output, platform, modelId);
    }
  });
  applyAll();
}

import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getDb } from '../../db/index.js';

// Verifies the V17 intelligence-tier audit (2026-06): size_label is normalized
// to Artificial Analysis Intelligence Index v4.0 bands, and the same model
// family lands in ONE tier regardless of provider.
// After V26 this only tests kept models (speed_rank 1–4).
describe('intelligence tier audit (migrateModelsV17)', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  function tier(platform: string, modelId: string): string | undefined {
    const row = getDb()
      .prepare('SELECT size_label FROM models WHERE platform = ? AND model_id = ?')
      .get(platform, modelId) as { size_label: string } | undefined;
    return row?.size_label;
  }

  function tiersForFamily(like: string): string[] {
    const rows = getDb()
      .prepare("SELECT DISTINCT size_label FROM models WHERE LOWER(model_id) LIKE ?")
      .all(like.toLowerCase()) as { size_label: string }[];
    return rows.map(r => r.size_label);
  }

  it('assigns Frontier to top-tier kept models (AA ≥ 45)', () => {
    expect(tier('opencode', 'deepseek-v4-flash-free')).toBe('Frontier');
    expect(tier('opencode', 'minimax-m3-free')).toBe('Frontier');
    expect(tier('opencode', 'nemotron-3-ultra-free')).toBe('Frontier');
  });

  it('assigns Large to mid-tier kept models (AA 26–44)', () => {
    expect(tier('cerebras', 'gpt-oss-120b')).toBe('Large');
    expect(tier('groq', 'openai/gpt-oss-120b')).toBe('Large');
    expect(tier('cerebras', 'zai-glm-4.7')).toBe('Large');
    expect(tier('google', 'gemma-4-31b-it')).toBe('Large');
    expect(tier('google', 'gemma-4-26b-a4b-it')).toBe('Large');
    expect(tier('google', 'gemini-3.1-flash-lite-preview')).toBe('Large');
    expect(tier('zhipu', 'glm-4.7-flash')).toBe('Large');
  });

  it('assigns Medium to kept models (AA 13–25)', () => {
    expect(tier('groq', 'llama-3.3-70b-versatile')).toBe('Medium');
    expect(tier('groq', 'openai/gpt-oss-20b')).toBe('Medium');
    expect(tier('groq', 'openai/gpt-oss-safeguard-20b')).toBe('Medium');
    expect(tier('groq', 'groq/compound-mini')).toBe('Medium');
    expect(tier('groq', 'qwen/qwen3-32b')).toBe('Medium');
    expect(tier('groq', 'meta-llama/llama-4-scout-17b-16e-instruct')).toBe('Medium');
    expect(tier('google', 'gemini-2.5-flash-lite')).toBe('Medium');
  });

  it('assigns Small to the smallest kept models (AA ≤ 12)', () => {
    expect(tier('groq', 'llama-3.1-8b-instant')).toBe('Small');
  });

  it('assigns a single consistent tier per model family across providers', () => {
    // gpt-oss-120b exists on cerebras (Large) and groq (Large) — both agree.
    expect(tiersForFamily('%gpt-oss-120b%')).toEqual(['Large']);
    // llama-4-scout exists on groq only now — Medium.
    expect(tiersForFamily('%llama-4-scout%')).toEqual(['Medium']);
  });
});

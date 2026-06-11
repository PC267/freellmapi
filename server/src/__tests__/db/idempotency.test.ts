import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../../db/index.js';

/**
 * All migrations must be idempotent: running initDb twice on the same
 * physical database file should produce identical state.
 */
describe('Migration idempotency', () => {
  it('initDb on a fresh in-memory DB then re-run produces identical row counts', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    // Use a single shared file so both inits hit the same DB.
    const tmpPath = `/tmp/freeapi-idempotency-${Date.now()}.db`;

    const db1 = initDb(tmpPath);
    const before = {
      models: (db1.prepare('SELECT COUNT(*) AS c FROM models').get() as { c: number }).c,
      fallback: (db1.prepare('SELECT COUNT(*) AS c FROM fallback_config').get() as { c: number }).c,
      enabledModels: (db1.prepare('SELECT COUNT(*) AS c FROM models WHERE enabled = 1').get() as { c: number }).c,
      disabledModels: (db1.prepare('SELECT COUNT(*) AS c FROM models WHERE enabled = 0').get() as { c: number }).c,
      orphanFallbacks: (db1.prepare(`
        SELECT COUNT(*) AS c FROM fallback_config f
        LEFT JOIN models m ON f.model_db_id = m.id
        WHERE m.id IS NULL
      `).get() as { c: number }).c,
    };
    db1.close();

    // Re-init the same DB file — V1..V9 should all no-op idempotently.
    const db2 = initDb(tmpPath);
    const after = {
      models: (db2.prepare('SELECT COUNT(*) AS c FROM models').get() as { c: number }).c,
      fallback: (db2.prepare('SELECT COUNT(*) AS c FROM fallback_config').get() as { c: number }).c,
      enabledModels: (db2.prepare('SELECT COUNT(*) AS c FROM models WHERE enabled = 1').get() as { c: number }).c,
      disabledModels: (db2.prepare('SELECT COUNT(*) AS c FROM models WHERE enabled = 0').get() as { c: number }).c,
      orphanFallbacks: (db2.prepare(`
        SELECT COUNT(*) AS c FROM fallback_config f
        LEFT JOIN models m ON f.model_db_id = m.id
        WHERE m.id IS NULL
      `).get() as { c: number }).c,
    };
    db2.close();

    expect(after).toEqual(before);
    expect(after.orphanFallbacks).toBe(0);
  });

  it('every catalog row has exactly one fallback_config entry', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const db = initDb(':memory:');

    const rows = db.prepare(`
      SELECT m.id, COUNT(f.id) AS fb_count
        FROM models m
        LEFT JOIN fallback_config f ON m.id = f.model_db_id
       GROUP BY m.id
      HAVING COUNT(f.id) <> 1
    `).all() as { id: number; fb_count: number }[];

    expect(rows).toEqual([]);
  });

  it('UNIQUE(platform, model_id) constraint holds — no duplicate catalog rows', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const db = initDb(':memory:');

    const dups = db.prepare(`
      SELECT platform, model_id, COUNT(*) AS c FROM models
       GROUP BY platform, model_id
      HAVING COUNT(*) > 1
    `).all();

    expect(dups).toEqual([]);
  });

  it('V12: dead OR :free rows are absent (V26 removed all OR models)', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const db = initDb(':memory:');

    // V26 deleted all openrouter models (speed_rank >= 5).
    const orModels = db.prepare(`
      SELECT COUNT(*) AS n FROM models WHERE platform = 'openrouter'
    `).get() as { n: number };
    expect(orModels.n).toBe(0);
  });

  it('V13: surviving additions keep their limit/context updates', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const db = initDb(':memory:');

    // V26 deleted most V13 additions (slow models). The sole survivor is
    // groq/openai/gpt-oss-safeguard-20b (speed_rank 2). Verify its limits.
    const safeguard = db.prepare(`
      SELECT rpm_limit, rpd_limit, tpm_limit, tpd_limit FROM models
       WHERE platform = 'groq' AND model_id = 'openai/gpt-oss-safeguard-20b'
    `).get() as { rpm_limit: number; rpd_limit: number; tpm_limit: number; tpd_limit: number };
    expect(safeguard).toEqual({ rpm_limit: 30, rpd_limit: 1000, tpm_limit: 8000, tpd_limit: 200000 });

    // Cerebras gpt-oss-120b limits from V13.
    const cerebrasLimits = db.prepare(`
      SELECT rpm_limit, rpd_limit, tpm_limit, tpd_limit FROM models
       WHERE platform = 'cerebras' AND model_id = 'gpt-oss-120b'
    `).get() as { rpm_limit: number; rpd_limit: number; tpm_limit: number; tpd_limit: number };
    expect(cerebrasLimits).toEqual({ rpm_limit: 5, rpd_limit: 2400, tpm_limit: 30000, tpd_limit: 1000000 });
  });

  it('V14: cerebras deprecation rows removed by V25; only gpt-oss-120b remains', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const db = initDb(':memory:');

    const rows = db.prepare(`
      SELECT model_id, enabled FROM models
       WHERE platform = 'cerebras'
         AND model_id IN ('qwen-3-235b-a22b-instruct-2507', 'llama3.1-8b', 'gpt-oss-120b')
       ORDER BY model_id
    `).all() as { model_id: string; enabled: number }[];

    expect(rows).toEqual([
      { model_id: 'gpt-oss-120b', enabled: 1 },
    ]);
  });

  it('V23: sambanova/chutes are gone; only zhipu/glm-4.6v-flash survives V26', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const db = initDb(':memory:');

    // Platform drops — no model, fallback, or key rows survive.
    const deadRows = db.prepare(
      `SELECT COUNT(*) AS n FROM models WHERE platform IN ('sambanova', 'chutes')`
    ).get() as { n: number };
    expect(deadRows.n).toBe(0);
    const deadKeys = db.prepare(
      `SELECT COUNT(*) AS n FROM api_keys WHERE platform IN ('sambanova', 'chutes')`
    ).get() as { n: number };
    expect(deadKeys.n).toBe(0);

    // V26 deleted most V23 additions (all openrouter :free models). Only
    // zhipu/glm-4.6v-flash (speed_rank 4) survives.
    const added = db.prepare(`
      SELECT model_id, enabled, supports_vision, supports_tools FROM models
       WHERE platform = 'zhipu' AND model_id = 'glm-4.6v-flash'
    `).all() as { model_id: string; enabled: number; supports_vision: number; supports_tools: number }[];
    expect(added.map(r => [r.model_id, r.enabled, r.supports_vision, r.supports_tools])).toEqual([
      ['glm-4.6v-flash', 1, 1, 1],
    ]);
  });

  it('V24: Zen roster refresh lands and the hung NIM gemma is paused', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const db = initDb(':memory:');

    const zen = db.prepare(`
      SELECT model_id, enabled, supports_tools FROM models
       WHERE platform = 'opencode' AND model_id IN ('nemotron-3-ultra-free', 'minimax-m3-free')
       ORDER BY model_id
    `).all() as { model_id: string; enabled: number; supports_tools: number }[];
    expect(zen.map(r => [r.model_id, r.enabled, r.supports_tools])).toEqual([
      ['minimax-m3-free',       1, 1],
      ['nemotron-3-ultra-free', 1, 1],
    ]);

    // The hung NIM gemma route was paused (V24) then removed (V25) — row is gone.
    const gemma = db.prepare(`
      SELECT enabled FROM models WHERE platform = 'nvidia' AND model_id = 'google/gemma-4-31b-it'
    `).get() as { enabled: number } | undefined;
    expect(gemma).toBeUndefined();
  });

  it('all enabled catalog platforms have a registered provider', async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const db = initDb(':memory:');
    const { hasProvider } = await import('../../providers/index.js');

    const platforms = (db.prepare(
      `SELECT DISTINCT platform FROM models WHERE enabled = 1`
    ).all() as { platform: any }[]).map(r => r.platform);

    const missing = platforms.filter(p => !hasProvider(p));
    expect(missing).toEqual([]);
  });
});

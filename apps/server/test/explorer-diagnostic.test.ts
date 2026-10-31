import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnoseExplorerFile, diagnosticFailure, pgnFeatures } from '../src/explorer-diagnostic.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true }); });
async function fixture(records: string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-diagnostic-')); directories.push(directory);
  const file = join(directory, 'synthetic.pgn');
  await writeFile(file, records.join('\n\n')); return file;
}
const game = (body: string, tags = '[Result "1-0"]') => `[Event "Synthetic private example"]\n${tags}\n\n${body}`;

describe('read-only explorer source diagnostics', () => {
  it('recognizes syntax outside tags/comments and directives only within comments', () => {
    expect([...pgnFeatures(game('1. e4 e5 1-0', '[Site "!? ($5) {; [%eval 9]} \\"quoted\\""]'))]).toEqual([]);
    const plain = pgnFeatures(game('1. e4 {prose: !? ($22); eval +5 and clk 12} e5 1-0'));
    expect([...plain]).toEqual(['brace_comments']);
    const annotated = pgnFeatures(game('1.e4!?$1 {[%clk 0:05:00] [%eval +0.2]} e5\n; (fake variation) $9 !?\n(1...c5 (2.Nf3)) 1-0'));
    expect([...annotated].sort()).toEqual(['brace_comments', 'clock_directives', 'eval_directives',
      'nags', 'nested_variations', 'recursive_variations', 'semicolon_comments', 'symbolic_annotations'].sort());
    expect([...pgnFeatures(game('1.e4 ; [%eval -0.3]\ne5 1-0'))].sort()).toEqual(['eval_directives', 'semicolon_comments']);
    expect(pgnFeatures(game('1.e4 {[%eval +0.3 missing close} e5 1-0')).has('eval_directives')).toBe(false);
  });

  it('classifies independently of duplicates and separates exclusions from validation failures', async () => {
    const valid = game('1.e4! $1 {[%clk 0:05:00]} e5 (1...c5) 1-0');
    const file = await fixture([valid, valid, game('1.e4 *', '[Result "*"]'), game('1-0'),
      game('1.e4 1-0', '[Variant "Atomic"]'), game('1.e4 1-0', '[White "Private broken header]'),
      game('1.e5 1-0'), game('1.e4 1-0', '[Result "0-1"]'),
      game('1.e4 1-0', '[FEN "Private unsupported position"]'), game('1.e4 ) 1-0')]);
    const report = await diagnoseExplorerFile(file, { samples: 1 });
    expect(report.totals).toEqual({ records: 10, valid: 2, excluded: 3, invalid: 5, featureInspectable: 10, featureUnavailable: 0 });
    expect(report.percentages).toMatchObject({ valid: 20, excluded: 30, invalid: 50 });
    expect(Object.fromEntries(Object.entries(report.excluded).map(([k,v]) => [k,v.count])))
      .toEqual({ unfinished_result: 1, no_moves: 1, nonstandard_variant: 1 });
    expect(Object.keys(report.invalid).sort()).toEqual(['malformed_headers', 'illegal_moves_or_syntax',
      'result_mismatch', 'unsupported_starting_position', 'broken_annotations'].sort());
    expect(report.features.brace_comments).toEqual({ count: 2, percent: 20, samples: [1] });
    expect(report.overlaps['brace_comments & clock_directives']).toEqual({ count: 2, percent: 20, samples: [1] });
    expect(report.invalid.malformed_headers?.samples).toEqual([6]);
    expect(JSON.stringify(report)).not.toMatch(/Private|Synthetic private|e5|\.pgn|White/);
    const withoutSamples = await diagnoseExplorerFile(file, { samples: 0 });
    expect(withoutSamples.features.brace_comments.samples).toEqual([]);
  });

  it('bounds oversized records, resynchronizes, and reports unavailable feature coverage', async () => {
    const file = await fixture([game('{' + 'x'.repeat(1_000_001)), game('1.e4 e5 1-0')]);
    const report = await diagnoseExplorerFile(file);
    expect(report.totals).toMatchObject({ records: 2, valid: 1, invalid: 1, featureInspectable: 1, featureUnavailable: 1 });
    expect(report.invalid.oversized_or_damaged?.samples).toEqual([1]);
    expect(report.featurePercentDenominator).toBe(1);
    expect(report.categoryPercentDenominator).toBe(2);
    await expect(diagnoseExplorerFile(file, { samples: 21 })).rejects.toThrow('Samples');
  });

  it('never returns private exception details and handles an empty source', async () => {
    expect(diagnosticFailure(new Error('Illegal PGN move: PRIVATE_SECRET.'))).toEqual({
      category: 'illegal_moves_or_syntax', message: 'Main-line move sequence failed strict validation.' });
    const report = await diagnoseExplorerFile(await fixture([]));
    expect(report.totals.records).toBe(0);
    expect(report.features.eval_directives.percent).toBe(0);
  });

  it('runs the separate CLI without database configuration or leaking source paths/content', async () => {
    const file = await fixture([game('1.e4 e5 1-0')]);
    const cli = fileURLToPath(new URL('../src/explorer-diagnostic-cli.ts', import.meta.url));
    const args = ['--import', 'tsx', cli];
    const env = { ...process.env, DATABASE_URL: '', TEST_DATABASE_URL: '' };
    const output = execFileSync(process.execPath, [...args, '--file', file, '--samples', '2'], { env, encoding: 'utf8' });
    expect(JSON.parse(output).totals).toMatchObject({ records: 1, valid: 1, invalid: 0 });
    expect(output).not.toContain(file);
    expect(output).not.toContain('Synthetic private');
    expect(execFileSync(process.execPath, [...args, '--help'], { env, encoding: 'utf8' })).toContain('no database');
    const failed = spawnSync(process.execPath, [...args, '--file', file + '.missing'], { env, encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('No data was written');
    expect(failed.stderr).not.toContain(file);
  });
});

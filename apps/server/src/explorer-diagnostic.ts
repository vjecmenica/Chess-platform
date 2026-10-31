import { validatePgn } from '@chess/domain';
import { explorerMainLine, streamPgnGames } from './explorer-pgn.js';

export interface DiagnosticProgress { records: number; elapsedSeconds: number; recordsPerSecond: number }
export function classifyExplorerSource(text: string): 'valid' | 'nonstandard_variant' | 'unfinished_result' | 'no_moves' {
  if (text.includes('\0')) throw new Error('Oversized or damaged PGN.');
  const clean = explorerMainLine(text);
  const variant = /^\[Variant\s+"([^"]*)"\]/m.exec(clean)?.[1];
  if (variant && !['standard', 'chess', 'normal'].includes(variant.toLowerCase())) return 'nonstandard_variant';
  const parsed = validatePgn(clean);
  return parsed.result === '*' ? 'unfinished_result' : parsed.moveCount === 0 ? 'no_moves' : 'valid';
}

const features = ['brace_comments', 'semicolon_comments', 'recursive_variations', 'nested_variations',
  'nags', 'symbolic_annotations', 'clock_directives', 'eval_directives'] as const;
type Feature = typeof features[number];
interface Count { count: number; percent: number; samples: number[] }
interface FailureCount extends Count { message: string }
const counter = (): Count => ({ count: 0, percent: 0, samples: [] });

/** Lexical occurrences, including inside variations; never scan tag values as move text. */
export function pgnFeatures(text: string): Set<Feature> {
  const found = new Set<Feature>();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let first = 0;
  while (first < lines.length && (!lines[first]!.trim() || lines[first]!.trim().startsWith('['))) first++;
  const body = lines.slice(first).join('\n');
  let token = '', depth = 0;
  const flush = () => {
    if (/^(?:\d+\.{1,3})?(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)[!?]+$/.test(token))
      found.add('symbolic_annotations');
    token = '';
  };
  const comment = (value: string) => {
    if (/\[%clk\b[^\]\r\n]*\]/i.test(value)) found.add('clock_directives');
    if (/\[%eval\b[^\]\r\n]*\]/i.test(value)) found.add('eval_directives');
  };
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char === '{' || char === ';') {
      flush(); found.add(char === '{' ? 'brace_comments' : 'semicolon_comments');
      const end = body.indexOf(char === '{' ? '}' : '\n', i + 1);
      comment(body.slice(i + 1, end < 0 ? undefined : end));
      i = end < 0 ? body.length : end;
    } else if (char === '(') {
      flush(); found.add('recursive_variations'); depth++;
      if (depth > 1) found.add('nested_variations');
    } else if (char === ')') { flush(); depth = Math.max(0, depth - 1); }
    else if (char === '$' && /\d/.test(body[i + 1] ?? '')) {
      flush(); found.add('nags'); while (/\d/.test(body[i + 1] ?? '')) i++;
    } else if (/\s/.test(char)) flush();
    else token += char;
  }
  flush(); return found;
}

/** Do not return arbitrary exception text: illegal SAN and header names can contain source content. */
export function diagnosticFailure(cause: unknown): { category: string; message: string } {
  const text = cause instanceof Error ? cause.message : '';
  if (/Oversized or damaged|smaller than 1 MB/.test(text))
    return { category: 'oversized_or_damaged', message: 'Record exceeded the size bound or contained a damage sentinel.' };
  if (/Invalid PGN header|Duplicate PGN header/.test(text))
    return { category: 'malformed_headers', message: 'Invalid or duplicate PGN tag pair.' };
  if (/Unbalanced variation|Unterminated PGN annotation|closing brace|PGN annotations/.test(text))
    return { category: 'broken_annotations', message: 'Unbalanced or unsupported annotation syntax.' };
  if (/Result header|result conflicts/.test(text))
    return { category: 'result_mismatch', message: 'Result disagrees with the movetext or final board.' };
  if (/custom starting position|SetUp header/.test(text))
    return { category: 'unsupported_starting_position', message: 'Importer requires the standard starting position.' };
  if (/move text must end/.test(text))
    return { category: 'missing_result', message: 'Movetext has no supported final result marker.' };
  if (/1,000 half-moves/.test(text))
    return { category: 'move_limit', message: 'Record exceeds the supported move count.' };
  if (/Illegal PGN move|Invalid PGN syntax or illegal move/.test(text))
    return { category: 'illegal_moves_or_syntax', message: 'Main-line move sequence failed strict validation.' };
  return { category: 'other_preparation_error', message: 'Record failed importer preparation; private error details suppressed.' };
}

export async function diagnoseExplorerFile(file: string, options: { samples?: number; maxPlies?: number;
  limit?: number; onProgress?: (progress: DiagnosticProgress) => void;
  progressIntervalMs?: number; now?: () => number } = {}) {
  const sampleLimit = options.samples ?? 3, maxPlies = options.maxPlies ?? 24;
  if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 20) throw new Error('Samples must be between 0 and 20.');
  if (!Number.isInteger(maxPlies) || maxPlies < 1 || maxPlies > 80) throw new Error('Opening depth must be between 1 and 80 plies.');
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10_000_000))
    throw new Error('Limit must be between 1 and 10,000,000 records.');
  const interval = options.progressIntervalMs ?? 5000;
  if (!Number.isFinite(interval) || interval < 100 || interval > 60000) throw new Error('Invalid progress interval.');
  const now = options.now ?? (() => performance.now());
  const started = now(); let lastProgress = started;
  const totals = { records: 0, valid: 0, excluded: 0, invalid: 0, featureInspectable: 0, featureUnavailable: 0 };
  const invalid: Record<string, FailureCount> = {}, excluded: Record<string, Count> = {};
  const syntax = Object.fromEntries(features.map(name => [name, counter()])) as Record<Feature, Count>;
  const overlaps: Record<string, Count> = {};
  const add = (count: Count, ordinal: number) => {
    count.count++; if (count.samples.length < sampleLimit) count.samples.push(ordinal);
  };
  const progress = (time: number) => {
    const elapsedSeconds = Math.max(0, (time - started) / 1000);
    options.onProgress?.({ records: totals.records, elapsedSeconds,
      recordsPerSecond: elapsedSeconds ? totals.records / elapsedSeconds : 0 });
    lastProgress = time;
  };
  progress(started);
  let limitReached = false;
  for await (const text of streamPgnGames(file)) {
    const ordinal = ++totals.records;
    if (text.includes('\0')) totals.featureUnavailable++;
    else {
      totals.featureInspectable++;
      const found = pgnFeatures(text);
      for (const feature of found) add(syntax[feature], ordinal);
      const ordered = features.filter(feature => found.has(feature));
      for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
        const name = `${ordered[i]} & ${ordered[j]}`;
        add(overlaps[name] ??= counter(), ordinal);
      }
    }
    try {
      const reason = classifyExplorerSource(text);
      if (reason === 'valid') totals.valid++;
      else {
        totals.excluded++; add(excluded[reason] ??= counter(), ordinal);
      }
    } catch (cause) {
      totals.invalid++;
      const failure = diagnosticFailure(cause);
      add(invalid[failure.category] ??= { ...counter(), message: failure.message }, ordinal);
    }
    const time = now();
    if (time - lastProgress >= interval) progress(time);
    if (totals.records === options.limit) { limitReached = true; break; }
  }
  progress(now());
  for (const group of [invalid, excluded, syntax, overlaps]) for (const count of Object.values(group)) {
    const denominator = group === syntax || group === overlaps ? totals.featureInspectable : totals.records;
    count.percent = denominator ? Math.round(count.count / denominator * 10000) / 100 : 0;
  }
  return { formatVersion: 2, sampleLimit, maxPlies, totals,
    coverage: { scope: limitReached ? 'prefix' : 'complete_file', limit: options.limit ?? null, limitReached },
    percentages: { denominator: limitReached ? 'examined prefix only, before database deduplication' : 'all source records, before database deduplication',
      valid: totals.records ? totals.valid / totals.records * 100 : 0,
      excluded: totals.records ? totals.excluded / totals.records * 100 : 0,
      invalid: totals.records ? totals.invalid / totals.records * 100 : 0 },
    categoryPercentDenominator: totals.records, featurePercentDenominator: totals.featureInspectable,
    invalid, excluded, features: syntax, overlaps };
}

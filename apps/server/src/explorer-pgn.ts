import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { normalizedPositionKey, parsePgn } from '@chess/domain';

const maxGameChars = 1_000_000;

// Bound even a damaged file with no newlines. An oversized line poisons only its
// current game; the next header can resynchronize the stream.
async function* lines(file: string): AsyncGenerator<string> {
  let pending = '', oversized = false;
  for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 65_536 })) {
    for (const part of (chunk as string).split(/(?<=\n)/)) {
      if (!oversized) pending += part;
      if (pending.length > maxGameChars) { pending = ''; oversized = true; }
      if (part.endsWith('\n')) {
        yield oversized ? '\0' : pending;
        pending = ''; oversized = false;
      }
    }
  }
  if (pending || oversized) yield oversized ? '\0' : pending;
}

export async function* streamPgnGames(file: string): AsyncGenerator<string> {
  let text = '', movetext = false, broken = false, braces = 0;
  for await (const raw of lines(file)) {
    const line = raw.replace(/^\uFEFF/, '');
    const header = /^\s*\[[A-Za-z][A-Za-z0-9_]*\s+"/.test(line);
    if ((text || broken) && header && (movetext && braces === 0 || /^\s*\[Event\s/.test(line))) {
      yield broken ? '\0' : text;
      text = ''; movetext = false; broken = false; braces = 0;
    }
    if (!line.trim() && !text) continue;
    if (line.includes('\0') || text.length + line.length > maxGameChars) broken = true;
    if (!broken) text += raw;
    if (!header && line.trim()) movetext = true;
    if (!header) {
      for (const char of line.split(';')[0]!) {
        if (char === '{') braces += 1;
        if (char === '}') braces = Math.max(0, braces - 1);
      }
    }
  }
  if (text || broken) yield broken ? '\0' : text;
}

// Administrative ingestion accepts annotated main lines, while the existing
// user-facing PGN importer keeps its own narrower policy. Both replay through
// the same domain parser and chess.js adapter.
export function explorerMainLine(text: string): string {
  const firstMove = text.split(/\r?\n/).findIndex(line => line.trim() !== '' && !line.trim().startsWith('['));
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headers = lines.slice(0, firstMove).join('\n');
  const body = lines.slice(firstMove).join('\n');
  let clean = '', braces = 0, variation = 0, semicolon = false;
  for (const char of body) {
    if (semicolon) { if (char === '\n') { semicolon = false; clean += ' '; } continue; }
    if (braces) { if (char === '}') { braces = 0; clean += ' '; } continue; }
    if (char === '{') { braces = 1; continue; }
    if (char === ';') { semicolon = true; continue; }
    if (char === '(') { variation += 1; continue; }
    if (char === ')') { if (!variation) throw new Error('Unbalanced variation.'); variation -= 1; clean += ' '; continue; }
    if (!variation) clean += char;
  }
  if (braces || variation) throw new Error('Unterminated PGN annotation.');
  return `${headers}\n\n${clean.replace(/\$\d+/g, '').replace(/[!?]+/g, '')}`;
}

export interface ExplorerContribution { position: string; uci: string }
export interface ExplorerGame {
  fingerprint: string; result: '1-0' | '0-1' | '1/2-1/2'; moves: ExplorerContribution[];
  originalPgn: string; tags: Readonly<Record<string, string>>;
  positions: { position: string; ply: number; uci: string | null }[];
}

export function explorerMetadata(tags: Readonly<Record<string, string>>) {
  const tag = (name: string) => tags[name]?.trim() && !/^[?*-]+$/.test(tags[name]!.trim()) ? tags[name]! : null;
  const rating = (name: string) => /^\d{1,4}$/.test(tags[name] ?? '') && Number(tags[name]) > 0 ? Number(tags[name]) : null;
  return { white_name: tag('White'), black_name: tag('Black'), white_rating: rating('WhiteElo'), black_rating: rating('BlackElo'),
    white_fide_id: tag('WhiteFideId'), black_fide_id: tag('BlackFideId'), game_date: tag('Date'),
    event: tag('Event'), site: tag('Site'), round: tag('Round'), eco: tag('ECO'), opening: tag('Opening'), time_control: tag('TimeControl') };
}

export function prepareExplorerGame(text: string, maxPlies: number): ExplorerGame | null {
  if (text.includes('\0')) throw new Error('Oversized or damaged PGN.');
  const clean = explorerMainLine(text);
  const variant = /^\[Variant\s+"([^"]*)"\]/m.exec(clean)?.[1];
  if (variant && !['standard', 'chess', 'normal'].includes(variant.toLowerCase())) return null;
  const game = parsePgn(clean);
  if (game.result === '*' || !game.moves.length) return null;
  // FIDE IDs and ratings are intentionally excluded: older overlapping files
  // may omit or correct them. Names + event/date/round + complete play identify v1.
  const identity = ['White', 'Black', 'Date', 'Event', 'Site', 'Round'].map(key =>
    (game.headers[key] ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase());
  const fingerprint = createHash('sha256').update(JSON.stringify([
    1, identity, game.result, game.moves.map(move => move.uci),
  ])).digest('hex');
  const moves = new Map<string, ExplorerContribution>();
  for (const move of game.moves.slice(0, maxPlies)) {
    const position = normalizedPositionKey(move.beforeFen);
    moves.set(`${position}:${move.uci}`, { position, uci: move.uci });
  }
  const positions = new Map<string, { position: string; ply: number; uci: string | null }>();
  for (const move of game.moves.slice(0, maxPlies)) {
    const position = normalizedPositionKey(move.beforeFen);
    if (!positions.has(position)) positions.set(position, { position, ply: move.ply - 1, uci: move.uci });
  }
  const final = normalizedPositionKey(game.moves[Math.min(maxPlies, game.moves.length) - 1]!.afterFen);
  if (!positions.has(final)) positions.set(final, { position: final, ply: Math.min(maxPlies, game.moves.length),
    uci: game.moves[Math.min(maxPlies, game.moves.length)]?.uci ?? null });
  return { fingerprint, result: game.result, moves: [...moves.values()], originalPgn: text,
    tags: game.headers, positions: [...positions.values()] };
}

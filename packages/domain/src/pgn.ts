import { Chess } from 'chess.js';
import type { MoveRecord } from './position.js';

export interface ParsedPgn {
  readonly headers: Readonly<Record<string, string>>;
  readonly result: '1-0' | '0-1' | '1/2-1/2' | '*';
  readonly startingFen: string;
  readonly finalFen: string;
  readonly sideToMove: 'white' | 'black';
  readonly moves: readonly MoveRecord[];
}

const resultTokens = new Set(['1-0', '0-1', '1/2-1/2', '*']);

export function parsePgn(text: string): ParsedPgn {
  if (text.trim().length === 0) throw new Error('Enter PGN text or choose a .pgn file.');
  if (text.length > 1_000_000) throw new Error('PGN files must be smaller than 1 MB.');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headers: Record<string, string> = {};
  let index = 0;
  while (index < lines.length && lines[index]?.trim() === '') index += 1;
  while (index < lines.length && lines[index]?.trim().startsWith('[')) {
    const line = lines[index]!.trim();
    const match = /^\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\]$/.exec(line);
    if (!match) throw new Error(`Invalid PGN header on line ${index + 1}.`);
    const key = match[1]!;
    if (key in headers) throw new Error(`Duplicate PGN header: ${key}.`);
    headers[key] = match[2]!.replace(/\\(["\\])/g, '$1');
    index += 1;
  }
  const movetext = lines.slice(index).join('\n').trim();
  if (!movetext) throw new Error('PGN move text must end with a result (or *).');
  if (/[{}();$!?]/.test(movetext)) {
    throw new Error('This import supports one main line only; comments, variations, and PGN annotations are not supported yet.');
  }
  const marker = /(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)\s*$/.exec(movetext)?.[1];
  if (!marker || !resultTokens.has(marker)) throw new Error('PGN move text must end with 1-0, 0-1, 1/2-1/2, or *.');
  if (headers.Result !== undefined && headers.Result !== marker) {
    throw new Error('The Result header does not match the move text.');
  }
  if (headers.SetUp === '1' || headers.FEN !== undefined) {
    throw new Error('PGN games with a custom starting position are not supported yet.');
  }
  if (headers.SetUp !== undefined && headers.SetUp !== '0')
    throw new Error('The SetUp header must be 0 for a standard starting position.');
  let chess: Chess;
  try {
    chess = new Chess();
    chess.loadPgn(text, { strict: true });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown move';
    const illegalMove = /^Invalid move in PGN: (.{1,24})$/.exec(detail)?.[1];
    throw new Error(illegalMove ? `Illegal PGN move: ${illegalMove}.`
      : 'Invalid PGN syntax or illegal move. Check the move text.');
  }
  const history = chess.history({ verbose: true });
  if (history.length > 1_000) throw new Error('PGN import is limited to 1,000 half-moves.');
  if (chess.isCheckmate() && marker !== (chess.turn() === 'w' ? '0-1' : '1-0'))
    throw new Error('The PGN result conflicts with checkmate on the board.');
  if (chess.isStalemate() && marker !== '1/2-1/2')
    throw new Error('The PGN result conflicts with stalemate on the board.');
  const moves: MoveRecord[] = history.map((move, ply) => ({
    ply: ply + 1, side: move.color === 'w' ? 'white' : 'black',
    from: move.from, to: move.to,
    ...(move.promotion ? { promotion: move.promotion as 'q' | 'r' | 'b' | 'n' } : {}),
    san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ''}`,
    beforeFen: move.before, afterFen: move.after,
  }));
  return { headers: { ...headers, Result: marker }, result: marker as ParsedPgn['result'],
    startingFen: moves[0]?.beforeFen ?? chess.fen(), finalFen: chess.fen(),
    sideToMove: chess.turn() === 'w' ? 'white' : 'black', moves };
}

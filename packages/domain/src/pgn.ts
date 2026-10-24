import { Chess } from 'chess.js';
import type { MoveRecord } from './position.js';

export interface ParsedPgn {
  readonly headers: Readonly<Record<string, string>>;
  readonly result: '1-0' | '0-1' | '1/2-1/2' | '*';
  readonly startingFen: string;
  readonly finalFen: string;
  readonly sideToMove: 'white' | 'black';
  readonly moves: readonly MoveRecord[];
  readonly annotations: readonly { readonly ply: number; readonly comment?: string;
    readonly remainingMsAfterMove?: number }[];
}

const resultTokens = new Set(['1-0', '0-1', '1/2-1/2', '*']);

function clockMilliseconds(value: string): number | null {
  const match = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const first = Number(match[1]);
  const middle = Number(match[2]);
  const last = match[3] === undefined ? null : Number(match[3]);
  if (middle > 59 || last !== null && last > 59) return null;
  const seconds = last === null ? first * 60 + middle : first * 3600 + middle * 60 + last;
  const milliseconds = seconds * 1000 + Number((match[4] ?? '').padEnd(3, '0'));
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function mainlineText(text: string): { clean: string; annotations: ParsedPgn['annotations']; plyCount: number } {
  const tokens: string[] = [];
  const notes = new Map<number, { comment?: string; remainingMsAfterMove?: number }>();
  let token = '';
  let ply = 0;
  const flush = () => {
    if (!token) return;
    const number = /^(\d+)(\.{1,3})(.*)$/.exec(token);
    if (number) {
      tokens.push(`${number[1]}${number[2]}`);
      token = number[3]!;
      if (!token) return;
    }
    tokens.push(token);
    if (!resultTokens.has(token) && !/^\d+\.{1,3}$/.test(token) && token !== '...') ply += 1;
    token = '';
  };
  const comment = (raw: string) => {
    const previous = notes.get(ply) ?? {};
    const ordinary = raw.replace(/\[%clk\b([^\]]*)\]/gi, (directive, value: string) => {
      const milliseconds = clockMilliseconds(value);
      if (milliseconds === null || ply === 0) return directive;
      previous.remainingMsAfterMove = milliseconds;
      return '';
    }).trim().replace(/\s+/g, ' ');
    if (ordinary) {
      const combined = previous.comment ? `${previous.comment}\n${ordinary}` : ordinary;
      if (combined.length > 2000) throw new Error('A PGN comment exceeds the 2,000-character analysis limit.');
      previous.comment = combined;
    }
    if (previous.comment !== undefined || previous.remainingMsAfterMove !== undefined) notes.set(ply, previous);
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '{' || char === ';') {
      flush();
      if (char === '{') {
        const end = text.indexOf('}', index + 1);
        if (end < 0) throw new Error('A PGN comment is missing its closing brace.');
        comment(text.slice(index + 1, end));
        index = end;
      } else {
        const end = text.indexOf('\n', index + 1);
        comment(text.slice(index + 1, end < 0 ? undefined : end));
        index = end < 0 ? text.length : end;
      }
    } else if (/[()$!?}]/.test(char)) {
      throw new Error('This import supports one main line only; variations and PGN annotations are not supported.');
    } else if (/\s/.test(char)) flush();
    else token += char;
  }
  flush();
  return { clean: tokens.join(' '), plyCount: ply,
    annotations: [...notes].map(([at, note]) => ({ ply: at, ...note })) };
}

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
  const mainline = mainlineText(movetext);
  const marker = /(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)\s*$/.exec(mainline.clean)?.[1];
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
    chess.loadPgn(`${lines.slice(0, index).join('\n')}\n\n${mainline.clean}`, { strict: true });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown move';
    const illegalMove = /^Invalid move in PGN: (.{1,24})$/.exec(detail)?.[1];
    throw new Error(illegalMove ? `Illegal PGN move: ${illegalMove}.`
      : 'Invalid PGN syntax or illegal move. Check the move text.');
  }
  const history = chess.history({ verbose: true });
  if (history.length !== mainline.plyCount)
    throw new Error('Invalid PGN syntax or illegal move. Check the move text.');
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
    sideToMove: chess.turn() === 'w' ? 'white' : 'black', moves, annotations: mainline.annotations };
}

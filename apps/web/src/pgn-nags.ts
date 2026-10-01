// Section 10 of the PGN Standard defines $1–$139. $0 is null; $140–$255 are reserved.
// https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm#c10
export interface NagOption {
  readonly value: number;
  readonly glyph: string;
  readonly description: string;
}

function option(value: number, description: string, glyph: string): NagOption {
  return { value, glyph, description };
}

function sides(first: number, description: string, label: string): NagOption[] {
  return [option(first, `White ${description}`, `W: ${label}`),
    option(first + 1, `Black ${description}`, `B: ${label}`)];
}

export const nagGroups: readonly { readonly label: string; readonly options: readonly NagOption[] }[] = [
  { label: 'Move annotations', options: [
    option(1, 'Good move', '!'), option(2, 'Poor move', '?'),
    option(3, 'Very good move', '!!'), option(4, 'Very poor move', '??'),
    option(5, 'Speculative move', '!?'), option(6, 'Questionable move', '?!'),
    option(7, 'Forced move; all others lose quickly', 'forced'),
    option(8, 'Singular move; no reasonable alternatives', 'only move'),
    option(9, 'Worst move', 'worst'),
  ] },
  { label: 'Overall position', options: [
    option(10, 'Drawish position', '='), option(11, 'Equal chances, quiet position', '= quiet'),
    option(12, 'Equal chances, active position', '= active'), option(13, 'Unclear position', 'unclear'),
    option(14, 'White has a slight advantage', '+='), option(15, 'Black has a slight advantage', '=+'),
    option(16, 'White has a moderate advantage', '+/-'), option(17, 'Black has a moderate advantage', '-/+'),
    option(18, 'White has a decisive advantage', '+-'), option(19, 'Black has a decisive advantage', '-+'),
    ...sides(20, 'has a crushing advantage; the opponent should resign', 'crushing'),
    ...sides(22, 'is in zugzwang', 'zugzwang'),
  ] },
  { label: 'Space, development, and initiative', options: [
    ...sides(24, 'has a slight space advantage', 'space +'),
    ...sides(26, 'has a moderate space advantage', 'space ++'),
    ...sides(28, 'has a decisive space advantage', 'space decisive'),
    ...sides(30, 'has a slight time (development) advantage', 'development +'),
    ...sides(32, 'has a moderate time (development) advantage', 'development ++'),
    ...sides(34, 'has a decisive time (development) advantage', 'development decisive'),
    ...sides(36, 'has the initiative', 'initiative'),
    ...sides(38, 'has a lasting initiative', 'lasting initiative'),
    ...sides(40, 'has the attack', 'attack'),
  ] },
  { label: 'Compensation and board control', options: [
    ...sides(42, 'has insufficient compensation for a material deficit', 'compensation lacking'),
    ...sides(44, 'has sufficient compensation for a material deficit', 'compensation enough'),
    ...sides(46, 'has more than adequate compensation for a material deficit', 'compensation strong'),
    ...sides(48, 'has a slight center control advantage', 'center +'),
    ...sides(50, 'has a moderate center control advantage', 'center ++'),
    ...sides(52, 'has a decisive center control advantage', 'center decisive'),
    ...sides(54, 'has a slight kingside control advantage', 'kingside +'),
    ...sides(56, 'has a moderate kingside control advantage', 'kingside ++'),
    ...sides(58, 'has a decisive kingside control advantage', 'kingside decisive'),
    ...sides(60, 'has a slight queenside control advantage', 'queenside +'),
    ...sides(62, 'has a moderate queenside control advantage', 'queenside ++'),
    ...sides(64, 'has a decisive queenside control advantage', 'queenside decisive'),
  ] },
  { label: 'King safety, pawns, and pieces', options: [
    ...sides(66, 'has a vulnerable first rank', 'back rank weak'),
    ...sides(68, 'has a well protected first rank', 'back rank safe'),
    ...sides(70, 'has a poorly protected king', 'king exposed'),
    ...sides(72, 'has a well protected king', 'king safe'),
    ...sides(74, 'has a poorly placed king', 'king misplaced'),
    ...sides(76, 'has a well placed king', 'king placed well'),
    ...sides(78, 'has a very weak pawn structure', 'pawns very weak'),
    ...sides(80, 'has a moderately weak pawn structure', 'pawns weak'),
    ...sides(82, 'has a moderately strong pawn structure', 'pawns strong'),
    ...sides(84, 'has a very strong pawn structure', 'pawns very strong'),
    ...sides(86, 'has poor knight placement', 'knights poor'),
    ...sides(88, 'has good knight placement', 'knights good'),
    ...sides(90, 'has poor bishop placement', 'bishops poor'),
    ...sides(92, 'has good bishop placement', 'bishops good'),
    // The published table repeats 84–87 here; numeric sequence makes rook placement 94–97.
    ...sides(94, 'has poor rook placement', 'rooks poor'),
    ...sides(96, 'has good rook placement', 'rooks good'),
    ...sides(98, 'has poor queen placement', 'queen poor'),
    ...sides(100, 'has good queen placement', 'queen good'),
    ...sides(102, 'has poor piece coordination', 'coordination poor'),
    ...sides(104, 'has good piece coordination', 'coordination good'),
  ] },
  { label: 'Game phases and counterplay', options: [
    ...sides(106, 'has played the opening very poorly', 'opening very poor'),
    ...sides(108, 'has played the opening poorly', 'opening poor'),
    ...sides(110, 'has played the opening well', 'opening good'),
    ...sides(112, 'has played the opening very well', 'opening very good'),
    ...sides(114, 'has played the middlegame very poorly', 'middlegame very poor'),
    ...sides(116, 'has played the middlegame poorly', 'middlegame poor'),
    ...sides(118, 'has played the middlegame well', 'middlegame good'),
    ...sides(120, 'has played the middlegame very well', 'middlegame very good'),
    ...sides(122, 'has played the ending very poorly', 'endgame very poor'),
    ...sides(124, 'has played the ending poorly', 'endgame poor'),
    ...sides(126, 'has played the ending well', 'endgame good'),
    ...sides(128, 'has played the ending very well', 'endgame very good'),
    ...sides(130, 'has slight counterplay', 'counterplay +'),
    ...sides(132, 'has moderate counterplay', 'counterplay ++'),
    ...sides(134, 'has decisive counterplay', 'counterplay decisive'),
  ] },
  { label: 'Time pressure', options: [
    ...sides(136, 'has moderate time control pressure', 'clock pressure'),
    ...sides(138, 'has severe time control pressure', 'clock pressure severe'),
  ] },
];

const byValue = new Map(nagGroups.flatMap(group => group.options.map(item => [item.value, item] as const)));

// Compact board-list labels for paired White/Black assessments; the picker keeps the full label.
const compactPairs = new Map<number, string>([
  [20, 'crush'], [22, 'zug'],
  [24, 'space+'], [26, 'space++'], [28, 'space!'],
  [30, 'dev+'], [32, 'dev++'], [34, 'dev!'],
  [36, 'init'], [38, 'init+'], [40, 'attack'],
  [42, 'comp-'], [44, 'comp='], [46, 'comp+'],
  [48, 'center+'], [50, 'center++'], [52, 'center!'],
  [54, 'K-side+'], [56, 'K-side++'], [58, 'K-side!'],
  [60, 'Q-side+'], [62, 'Q-side++'], [64, 'Q-side!'],
  [66, 'rank-'], [68, 'rank+'], [70, 'king-'], [72, 'king+'],
  [74, 'king pos-'], [76, 'king pos+'],
  [78, 'pawns--'], [80, 'pawns-'], [82, 'pawns+'], [84, 'pawns++'],
  [86, 'N-'], [88, 'N+'], [90, 'B-'], [92, 'B+'],
  [94, 'R-'], [96, 'R+'], [98, 'Q-'], [100, 'Q+'],
  [102, 'coord-'], [104, 'coord+'],
  [106, 'open--'], [108, 'open-'], [110, 'open+'], [112, 'open++'],
  [114, 'middle--'], [116, 'middle-'], [118, 'middle+'], [120, 'middle++'],
  [122, 'end--'], [124, 'end-'], [126, 'end+'], [128, 'end++'],
  [130, 'counter+'], [132, 'counter++'], [134, 'counter!'],
  [136, 'time+'], [138, 'time!'],
]);

export function moveNagLabel(value: number): string | undefined {
  const nag = nagDetails(value);
  if (!nag) return undefined;
  if (value < 20) return nag.glyph;
  const short = compactPairs.get(value % 2 === 0 ? value : value - 1);
  return short === undefined ? undefined : `${value % 2 === 0 ? 'W' : 'B'}:${short}`;
}

export function nagDetails(value: number | undefined): NagOption | undefined {
  return value === undefined ? undefined : byValue.get(value);
}

export function filterNagGroups(query: string): typeof nagGroups {
  const term = query.trim().toLowerCase();
  if (!term) return nagGroups;
  return nagGroups.map(group => ({ label: group.label, options: group.options.filter(item =>
    `${item.value} $${item.value} ${item.glyph} ${item.description} ${group.label}`.toLowerCase().includes(term),
  ) })).filter(group => group.options.length > 0);
}

// Section 10 of the PGN Standard defines $1–$139. $0 is null; $140–$255 are reserved.
// https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm#c10
export interface NagOption {
  readonly value: number;
  readonly glyph: string;
  readonly description: string;
}

function option(value: number, description: string, glyph = `$${value}`): NagOption {
  return { value, glyph, description };
}

function sides(first: number, description: string): NagOption[] {
  return [option(first, `White ${description}`), option(first + 1, `Black ${description}`)];
}

export const nagGroups: readonly { readonly label: string; readonly options: readonly NagOption[] }[] = [
  { label: 'Move annotations', options: [
    option(1, 'Good move', '!'), option(2, 'Poor move', '?'),
    option(3, 'Very good move', '!!'), option(4, 'Very poor move', '??'),
    option(5, 'Speculative move', '!?'), option(6, 'Questionable move', '?!'),
    option(7, 'Forced move; all others lose quickly'),
    option(8, 'Singular move; no reasonable alternatives'), option(9, 'Worst move'),
  ] },
  { label: 'Overall position', options: [
    option(10, 'Drawish position', '='), option(11, 'Equal chances, quiet position', '= quiet'),
    option(12, 'Equal chances, active position', '= active'), option(13, 'Unclear position', '∞'),
    option(14, 'White has a slight advantage', '+='), option(15, 'Black has a slight advantage', '=+'),
    option(16, 'White has a moderate advantage', '+/-'), option(17, 'Black has a moderate advantage', '-/+'),
    option(18, 'White has a decisive advantage', '+-'), option(19, 'Black has a decisive advantage', '-+'),
    ...sides(20, 'has a crushing advantage; the opponent should resign'),
    ...sides(22, 'is in zugzwang'),
  ] },
  { label: 'Space, development, and initiative', options: [
    ...sides(24, 'has a slight space advantage'), ...sides(26, 'has a moderate space advantage'),
    ...sides(28, 'has a decisive space advantage'),
    ...sides(30, 'has a slight time (development) advantage'),
    ...sides(32, 'has a moderate time (development) advantage'),
    ...sides(34, 'has a decisive time (development) advantage'),
    ...sides(36, 'has the initiative'), ...sides(38, 'has a lasting initiative'),
    ...sides(40, 'has the attack'),
  ] },
  { label: 'Compensation and board control', options: [
    ...sides(42, 'has insufficient compensation for a material deficit'),
    ...sides(44, 'has sufficient compensation for a material deficit'),
    ...sides(46, 'has more than adequate compensation for a material deficit'),
    ...sides(48, 'has a slight center control advantage'),
    ...sides(50, 'has a moderate center control advantage'),
    ...sides(52, 'has a decisive center control advantage'),
    ...sides(54, 'has a slight kingside control advantage'),
    ...sides(56, 'has a moderate kingside control advantage'),
    ...sides(58, 'has a decisive kingside control advantage'),
    ...sides(60, 'has a slight queenside control advantage'),
    ...sides(62, 'has a moderate queenside control advantage'),
    ...sides(64, 'has a decisive queenside control advantage'),
  ] },
  { label: 'King safety, pawns, and pieces', options: [
    ...sides(66, 'has a vulnerable first rank'), ...sides(68, 'has a well protected first rank'),
    ...sides(70, 'has a poorly protected king'), ...sides(72, 'has a well protected king'),
    ...sides(74, 'has a poorly placed king'), ...sides(76, 'has a well placed king'),
    ...sides(78, 'has a very weak pawn structure'), ...sides(80, 'has a moderately weak pawn structure'),
    ...sides(82, 'has a moderately strong pawn structure'), ...sides(84, 'has a very strong pawn structure'),
    ...sides(86, 'has poor knight placement'), ...sides(88, 'has good knight placement'),
    ...sides(90, 'has poor bishop placement'), ...sides(92, 'has good bishop placement'),
    // The published table repeats 84–87 here; numeric sequence makes rook placement 94–97.
    ...sides(94, 'has poor rook placement'), ...sides(96, 'has good rook placement'),
    ...sides(98, 'has poor queen placement'), ...sides(100, 'has good queen placement'),
    ...sides(102, 'has poor piece coordination'), ...sides(104, 'has good piece coordination'),
  ] },
  { label: 'Game phases and counterplay', options: [
    ...sides(106, 'has played the opening very poorly'), ...sides(108, 'has played the opening poorly'),
    ...sides(110, 'has played the opening well'), ...sides(112, 'has played the opening very well'),
    ...sides(114, 'has played the middlegame very poorly'), ...sides(116, 'has played the middlegame poorly'),
    ...sides(118, 'has played the middlegame well'), ...sides(120, 'has played the middlegame very well'),
    ...sides(122, 'has played the ending very poorly'), ...sides(124, 'has played the ending poorly'),
    ...sides(126, 'has played the ending well'), ...sides(128, 'has played the ending very well'),
    ...sides(130, 'has slight counterplay'), ...sides(132, 'has moderate counterplay'),
    ...sides(134, 'has decisive counterplay'),
  ] },
  { label: 'Time pressure', options: [
    ...sides(136, 'has moderate time control pressure'),
    ...sides(138, 'has severe time control pressure'),
  ] },
];

const byValue = new Map(nagGroups.flatMap(group => group.options.map(item => [item.value, item] as const)));

export function nagDetails(value: number | undefined): NagOption | undefined {
  return value === undefined ? undefined : byValue.get(value);
}

export function filterNagGroups(query: string): typeof nagGroups {
  const term = query.trim().toLowerCase();
  if (!term) return nagGroups;
  return nagGroups.map(group => ({ label: group.label, options: group.options.filter(item =>
    `${item.value} ${item.glyph} ${item.description} ${group.label}`.toLowerCase().includes(term),
  ) })).filter(group => group.options.length > 0);
}

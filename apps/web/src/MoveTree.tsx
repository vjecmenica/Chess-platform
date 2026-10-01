import type { GameReadResponse } from '@chess/contracts';
import type { AnalysisCursor, AnalysisTree } from './analysis-model';
import { buildMoveTree, type VariationView } from './move-tree-model';

interface MoveTreeProps {
  readonly game: GameReadResponse;
  readonly tree: AnalysisTree | null;
  readonly selected: AnalysisCursor;
  readonly interactive: boolean;
  readonly onSelect: (cursor: AnalysisCursor) => void;
  readonly onDelete: (id: number, notation: string) => void;
}

function VariationItem({ item, onSelect, onDelete }: {
  item: VariationView;
  onSelect: MoveTreeProps['onSelect'];
  onDelete: MoveTreeProps['onDelete'];
}) {
  const line: VariationView[] = [];
  let current: VariationView | undefined = item;
  while (current !== undefined) {
    line.push(current);
    current = current.children.length === 1 ? current.children[0] : undefined;
  }
  const fork = line.at(-1)?.children ?? [];
  return <li className={`variation-item ${line.some(move => move.onPath) ? 'on-path' : ''}`}>
    <div className="variation-line">
      {line.map((move, index) => <span key={move.id} className={`variation-step ${move.onPath ? 'on-path' : ''}`}>
        <button type="button" className="move-link" aria-current={move.selected ? 'step' : undefined}
          aria-label={move.notation}
          onClick={() => onSelect({ kind: 'branch', id: move.id })}>
          {index > 0 ? move.notation.replace(/^\d+\.\.\. /, '') : move.notation}</button>
        <button type="button" className="delete-variation"
          aria-label={`Delete variation from ${move.notation}`} title={`Delete from ${move.notation}`}
          onClick={() => onDelete(move.id, move.notation)}>×</button>
      </span>)}
    </div>
    {fork.length > 1 && <ol className="variation-list">
      {fork.map(child => <VariationItem key={child.id} item={child}
        onSelect={onSelect} onDelete={onDelete} />)}
    </ol>}
  </li>;
}

export function MoveTree({ game, tree, selected, interactive, onSelect, onDelete }: MoveTreeProps) {
  const view = buildMoveTree(game, tree, selected);
  if (!interactive) return <section className="moves" aria-label="Confirmed move list">
    <h3>Moves</h3>
    {view.savedMoves.length === 0 ? <p>No confirmed moves yet.</p>
      : <ol className="main-line">{view.savedMoves.map(move =>
          <li key={move.ply} className="main-item"><span className="move-text">{move.notation}</span></li>)}</ol>}
  </section>;
  return <nav className="moves" aria-label="Saved moves and local variations">
    <h3>Moves</h3>
    <ol className="main-line">
      <li className="main-item on-path">
        <div className="move-row">
          <button type="button" className="move-link"
            aria-current={view.startSelected ? 'step' : undefined}
            onClick={() => onSelect({ kind: 'main', ply: 0 })}>Start</button>
        </div>
        {view.rootBranches.length > 0 && <ol className="variation-list">
          {view.rootBranches.map(item => <VariationItem key={item.id} item={item}
            onSelect={onSelect} onDelete={onDelete} />)}
        </ol>}
      </li>
      {view.savedMoves.map(move => <li key={move.ply}
        className={`main-item ${move.onPath ? 'on-path' : ''}`}>
        <div className="move-row">
          <button type="button" className="move-link"
            aria-current={move.selected ? 'step' : undefined}
            onClick={() => onSelect({ kind: 'main', ply: move.ply })}>{move.notation}</button>
        </div>
        {move.branches.length > 0 && <ol className="variation-list">
          {move.branches.map(item => <VariationItem key={item.id} item={item}
            onSelect={onSelect} onDelete={onDelete} />)}
        </ol>}
      </li>)}
    </ol>
  </nav>;
}

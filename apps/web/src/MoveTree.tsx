import { useEffect, useRef, useState } from 'react';
import type { GameReadResponse } from '@chess/contracts';
import type { AnalysisCursor, AnalysisTree, MoveNote } from './analysis-model';
import { cursorKey } from './analysis-model';
import { buildMoveTree, type MoveLine, type MoveView } from './move-tree-model';
import { nagDetails, nagGroups } from './pgn-nags';

interface MoveTreeProps {
  readonly game: GameReadResponse;
  readonly tree: AnalysisTree | null;
  readonly selected: AnalysisCursor;
  readonly interactive: boolean;
  readonly onSelect: (cursor: AnalysisCursor) => void;
  readonly onDelete: (id: number, notation: string) => void;
  readonly onPromote?: (id: number) => void;
  readonly onNote?: (cursor: AnalysisCursor, note: MoveNote) => void;
}

interface OpenMenu { move: MoveView; x: number; y: number; trigger: HTMLElement }

export function MoveTree({ game, tree, selected, interactive, onSelect, onDelete,
  onPromote, onNote }: MoveTreeProps) {
  const view = buildMoveTree(game, tree, selected);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (tree === null) setMenu(null); }, [tree?.gameId]);

  useEffect(() => {
    if (menu === null) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); menu.trigger.focus(); setMenu(null); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [menu]);

  function openMenu(move: MoveView, x: number, y: number, trigger: HTMLElement) {
    if (tree === null) return;
    setMenu({ move, trigger, x: Math.min(x, window.innerWidth - 290),
      y: Math.min(y, window.innerHeight - 360) });
    setComment(move.note?.comment ?? '');
    setEditing(false);
    setConfirmDelete(false);
  }

  function closeMenu() {
    menu?.trigger.focus();
    setMenu(null);
  }

  function moveButton(move: MoveView, compact = false, lineStart = false) {
    const nag = nagDetails(move.note?.nag);
    if (!interactive) return <span key={cursorKey(move.cursor)} className="move-text">{move.san}</span>;
    return <span key={cursorKey(move.cursor)}
      className={`move-entry ${move.cursor.kind === 'main' ? 'saved-move' : 'local-move'} ${move.onPath ? 'on-path' : ''}`}>
      {compact && (move.ply % 2 === 1 || lineStart)
        && <span className="inline-number">{Math.ceil(move.ply / 2)}{move.ply % 2 ? '.' : '...'}</span>}
      <button type="button" className="move-link" aria-current={move.selected ? 'step' : undefined}
        aria-label={move.notation} title={move.cursor.kind === 'main' ? 'Saved game move' : 'Local analysis move'}
        onContextMenu={event => { if (tree !== null) { event.preventDefault();
          openMenu(move, event.clientX, event.clientY, event.currentTarget); } }}
        onClick={() => onSelect(move.cursor)}>{move.san}{nag && <span className="nag-symbol"
          title={`${nag.description} (PGN $${nag.value})`}>{nag.glyph}</span>}</button>
      {tree !== null && <button type="button" className="move-options"
        aria-label={`Options for ${move.notation}`} title={`Options for ${move.notation}`}
        onClick={event => { const rect = event.currentTarget.getBoundingClientRect();
          openMenu(move, rect.left, rect.bottom, event.currentTarget); }}>⋯</button>}
      {move.note?.comment && <span className="move-comment" title={move.note.comment}>
        {move.note.comment}</span>}
    </span>;
  }

  function variations(move: MoveView, depth: number) {
    return move.alternatives.length > 0 && <div className="variation-list">
      {move.alternatives.map((branch, index) => <div className="variation-item"
        key={`${cursorKey(move.cursor)}-${index}`}>
        {renderLine(branch, depth + 1, false)}
      </div>)}
    </div>;
  }

  function renderLine(line: MoveLine, depth: number, main: boolean) {
    if (!main) {
      const segments: { moves: MoveView[]; fork?: MoveView }[] = [];
      let segment: MoveView[] = [];
      for (const move of line.moves) {
        segment.push(move);
        if (move.alternatives.length > 0) { segments.push({ moves: segment, fork: move }); segment = []; }
      }
      if (segment.length > 0) segments.push({ moves: segment });
      return <div className="variation-content">{segments.map((part, partIndex) =>
        <div key={partIndex}>
          <div className="variation-line">{part.moves.map((move, index) =>
            moveButton(move, true, partIndex === 0 && index === 0))}</div>
          {part.fork && variations(part.fork, depth)}
        </div>)}</div>;
    }
    const pairs: { white?: MoveView; black?: MoveView; number: number }[] = [];
    for (const move of line.moves) {
      const number = Math.ceil(move.ply / 2);
      let pair = pairs.at(-1);
      if (!pair || pair.number !== number || move.ply % 2 === 1) {
        pair = { number };
        pairs.push(pair);
      }
      if (move.ply % 2 === 1) pair.white = move;
      else pair.black = move;
    }
    return <ol className="main-line">{pairs.map(pair => <li key={pair.number} className="move-pair">
      <div className="move-pair-row"><span className="move-number">{pair.number}.</span>
        <span className="move-cell">{pair.white && moveButton(pair.white)}</span>
        <span className="move-cell">{pair.black && moveButton(pair.black)}</span></div>
      {pair.white && variations(pair.white, depth)}
      {pair.black && variations(pair.black, depth)}
    </li>)}</ol>;
  }

  return <nav className="moves" aria-label={interactive ? 'Saved moves and local variations' : 'Confirmed move list'}>
    <h3>Moves</h3>
    {interactive && <button type="button" className="move-link start-link"
      aria-current={view.startSelected ? 'step' : undefined}
      onClick={() => onSelect({ kind: 'main', ply: 0 })}>Start</button>}
    {view.main.moves.length === 0 ? <p>No confirmed moves yet.</p> : renderLine(view.main, 0, true)}
    {menu !== null && tree !== null && <div className="analysis-menu" ref={menuRef} role="dialog"
      aria-label={`Options for ${menu.move.notation}`}
      style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}>
      <strong>{menu.move.notation}</strong>
      {editing ? <div className="comment-editor">
        <label htmlFor="analysis-comment">Comment</label>
        <textarea id="analysis-comment" value={comment} maxLength={2000}
          onChange={event => setComment(event.target.value)} />
        <div className="menu-actions"><button type="button" onClick={() => {
          onNote?.(menu.move.cursor, { comment: comment.trim() || undefined }); closeMenu();
        }}>Save comment</button><button type="button" onClick={() => setEditing(false)}>Back</button></div>
      </div> : <>
        <button type="button" onClick={() => setEditing(true)}>
          {menu.move.note?.comment ? 'Edit comment' : 'Add comment'}</button>
        {menu.move.cursor.kind === 'branch' && <>
          <button type="button" onClick={() => { if (menu.move.cursor.kind === 'branch')
            onPromote?.(menu.move.cursor.id); closeMenu(); }}>
            Promote variation to main line</button>
          {confirmDelete ? <div className="menu-actions"><span>Delete this continuation?</span>
            <button type="button" onClick={() => {
              if (menu.move.cursor.kind === 'branch') onDelete(menu.move.cursor.id, menu.move.notation);
              closeMenu();
            }}>Confirm delete</button><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button></div>
            : <button type="button" onClick={() => setConfirmDelete(true)}>Delete continuation</button>}
        </>}
        <div className="nag-options"><strong>Annotation</strong>
          <button type="button" onClick={() => {
            onNote?.(menu.move.cursor, { nag: undefined }); closeMenu();
          }}>Clear annotation</button>
          {nagGroups.map(group => <section key={group.label} aria-label={group.label}>
            <h4>{group.label}</h4><div className="nag-grid">{group.options.map(option =>
              <button key={option.value} type="button" title={`${option.description} (PGN $${option.value})`}
                aria-label={`${option.description}, ${option.glyph}, PGN $${option.value}`}
                aria-pressed={menu.move.note?.nag === option.value}
                onClick={() => { onNote?.(menu.move.cursor, { nag: option.value }); closeMenu(); }}>
                {option.glyph}</button>)}</div>
          </section>)}
        </div>
      </>}
    </div>}
  </nav>;
}

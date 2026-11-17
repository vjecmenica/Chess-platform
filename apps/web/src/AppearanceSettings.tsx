import { useState, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from './SettingsDialog';
import { SettingsRange } from './SettingsRange';
import { appearanceVariables } from './appearance-styles';
import { boardThemes, boardThemeNames, boardCoordinateModes, pieceSets, defaultAppearance, type BoardAppearance } from '@chess/contracts';
import { useAppearance } from './Appearance';
import { pieceImage } from './board-interaction';
import type { Piece } from './board-model';
export function AppearanceSettings({ actionTarget }: { actionTarget?: HTMLElement | null }) {
    const { value, save, ready, owner, status: syncStatus } = useAppearance();
    const id = useId();
    const [v, change] = useState(value), [base, setBase] = useState(value), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [advanced, setAdvanced] = useState(false);
    useEffect(()=>{change(value);setBase(value);setStatus('');},[owner]);
    const dirty = JSON.stringify(v)!==JSON.stringify(base);
    const stale = JSON.stringify(value)!==JSON.stringify(base);
    useEffect(()=>{if(!dirty){change(value);setBase(value);}},[value]);
    const commit = async () => { setBusy(true); try { await save(v,base); setBase(v); setStatus('Saved'); } catch(e) {setStatus(e instanceof Error?e.message:'Save failed');} finally {setBusy(false);} };
    const set = (key: keyof BoardAppearance, value: unknown) => { change({ ...v, [key]: value }); setStatus(''); };
    const range = (key: 'scale' | 'offset' | 'frameWidth' | 'shadow', label: string, min: number, max: number, unit: string) =>
      <div className="settings-row">
        <label htmlFor={id + key}>{label}</label>
        <div className="settings-field settings-range-field">
          <SettingsRange id={id + key} min={min} max={max} value={v[key]}
            onChange={event => set(key, event.currentTarget.valueAsNumber)} />
          <output htmlFor={id + key}>{v[key]}{unit}</output>
          <button type="button" className="secondary" aria-label={'Reset ' + label}
            onClick={() => set(key, defaultAppearance[key])}>Reset</button>
        </div>
      </div>;
    const actions = <div className="settings-actions" role="group" aria-label="Board & Pieces actions">
      <span role="status" className="settings-save-status">{busy ? 'Saving…' : stale ? 'Saved appearance changed elsewhere. Close and reopen Settings.'
        : status || (!ready ? syncStatus || 'Loading saved appearance…' : dirty ? 'Unsaved changes' : '')}</span>
      <button type="button" className="secondary" onClick={() => { change({ ...defaultAppearance }); setStatus(''); }} disabled={busy}>Reset</button>
      <button type="button" className="primary" disabled={!ready || busy || stale} onClick={() => void commit()}>Save</button>
    </div>;
    return <section className="settings-section appearance-settings" aria-label="Board & Pieces">
      <h3>Board &amp; Pieces</h3>
      <div style={appearanceVariables(v)} className="appearance-preview engine-preview-board" role="img"
        aria-label="Appearance preview: both colors on light and dark squares">
        {('KQRBNPkqrbnp'.split('') as Piece[]).map((piece, i) => <span key={i} data-square={'abcdef'[i % 6]! + (8 - Math.floor(i / 6))}
          className={(i % 6 + Math.floor(i / 6)) % 2 ? 'dark' : 'light'}><img src={pieceImage(piece, v.pieceSet)} alt="" /></span>)}
      </div>
      <div className="settings-fields">
        <label className="settings-row"><span>Piece set</span>
          <span className="settings-select"><select value={v.pieceSet} onChange={event => set('pieceSet', event.currentTarget.value)}>
            {pieceSets.map(name => <option key={name}>{name}</option>)}
          </select></span>
        </label>
        <label className="settings-row"><span>Board theme</span>
          <span className="settings-select"><select value={v.theme} onChange={event => set('theme', event.currentTarget.value)}>
            {(Object.keys(boardThemes) as (keyof typeof boardThemes)[]).map(theme =>
              <option key={theme} value={theme}>{boardThemeNames[theme]}</option>)}
          </select></span>
        </label>
        <label className="settings-row"><span>Board coordinates</span>
          <span className="settings-select"><select value={v.coordinates} onChange={event => set('coordinates', event.currentTarget.value)}>
            {boardCoordinateModes.map(mode =>
              <option key={mode} value={mode}>{mode[0]!.toUpperCase() + mode.slice(1)}</option>)}
          </select></span>
        </label>
      </div>
      <button type="button" className="settings-disclosure secondary" aria-expanded={advanced}
        aria-controls={id + 'advanced'} onClick={() => setAdvanced(!advanced)}>
        Advanced <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div className="settings-fields" id={id + 'advanced'} hidden={!advanced}>
        {(['light', 'dark'] as const).map((key, index) => <div key={key} className="settings-row">
          <label htmlFor={id + key}>Custom {key} squares</label>
          <div className="settings-field">
            <input id={id + key} type="color" value={v[key] ?? boardThemes[v.theme][index]}
              onChange={event => set(key, event.currentTarget.value)} />
            <button type="button" className="secondary" onClick={() => set(key, null)}>Use theme color</button>
          </div>
        </div>)}
        {range('scale', 'Piece scale', 80, 110, '%')}
        {range('offset', 'Vertical offset', -8, 8, '%')}
        <label className="settings-row settings-check"><span>Board frame</span>
          <input type="checkbox" checked={v.frame} onChange={event => set('frame', event.currentTarget.checked)} />
        </label>
        <div className="settings-row">
          <label htmlFor={id + 'frameColor'}>Frame color</label>
          <div className="settings-field">
            <input id={id + 'frameColor'} type="color" value={v.frameColor} onChange={event => set('frameColor', event.currentTarget.value)} />
            <button type="button" className="secondary" aria-label="Reset Frame color"
              onClick={() => set('frameColor', defaultAppearance.frameColor)}>Reset</button>
          </div>
        </div>
        {range('frameWidth', 'Frame thickness', 1, 5, 'px')}
        <label className="settings-row settings-check"><span>Thin square borders</span>
          <input type="checkbox" checked={v.grid} onChange={event => set('grid', event.currentTarget.checked)} />
        </label>
        <label className="settings-row settings-check"><span>Piece shadow</span>
          <input type="checkbox" checked={v.shadow > 0} onChange={event => set('shadow', event.currentTarget.checked ? 15 : 0)} />
        </label>
        {range('shadow', 'Shadow intensity', 0, 30, '%')}
      </div>
      <a className="settings-resource" href="/pieces/credits.html" target="_blank" rel="noreferrer">Piece artwork credits and licenses</a>
      {actionTarget === undefined ? actions : actionTarget ? createPortal(actions, actionTarget) : null}
    </section>;
}
export function AppearanceLauncher() {
 const {open}=useSettings();
 return <button type="button" aria-label="Board and piece appearance" data-board-display-control onClick={()=>open('appearance')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 4 6 6M6 14 16 3a2.8 2.8 0 0 1 4 4L9 17M6 14l3 3c0 4-4 5-7 4 3-1 0-5 4-7Z"/></svg></button>;
}

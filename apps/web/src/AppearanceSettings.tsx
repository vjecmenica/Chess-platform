import { useState, useEffect } from 'react';
import { useSettings } from './SettingsDialog';
import { appearanceVariables } from './appearance-styles';
import { boardThemes, boardThemeNames, pieceSets, defaultAppearance, type BoardAppearance } from '@chess/contracts';
import { useAppearance } from './Appearance';
import { pieceImage } from './board-interaction';
import type { Piece } from './board-model';
export function AppearanceSettings() {
    const { value, save, ready, owner, status: syncStatus } = useAppearance();
    const [v, change] = useState(value), [base, setBase] = useState(value), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [advanced, setAdvanced] = useState(false);
    useEffect(()=>{change(value);setBase(value);setStatus('');},[owner]);
    const dirty = JSON.stringify(v)!==JSON.stringify(base);
    const stale = JSON.stringify(value)!==JSON.stringify(base);
    useEffect(()=>{if(!dirty){change(value);setBase(value);}},[value]);
    const commit = async () => { setBusy(true); try { await save(v,base); setBase(v); setStatus('Saved'); } catch(e) {setStatus(e instanceof Error?e.message:'Save failed');} finally {setBusy(false);} };
    const set = (key: keyof BoardAppearance, value: unknown) => { change({ ...v, [key]: value }); setStatus(''); };
    const range = (key: 'scale' | 'offset' | 'frameWidth' | 'shadow', label: string, min: number, max: number, unit: string) => <label>{label}<input type="range" aria-label={label} min={min} max={max} value={v[key]} onChange={e => set(key, Number(e.target.value))}/><output>{v[key]}{unit}</output><button type="button" className="secondary" aria-label={'Reset ' + label} onClick={() => set(key, defaultAppearance[key])}>Reset</button></label>;
    return <section className="appearance-settings" aria-label="Board & Pieces"><h3>Board &amp; Pieces</h3>
    <div style={appearanceVariables(v)} className="appearance-preview engine-preview-board" role="img" aria-label="Appearance preview: both colors on light and dark squares">{('KQRBNPkqrbnp'.split('') as Piece[]).map((p, i) => <span key={i} data-square={'abcdef'[i % 6]! + (8 - Math.floor(i / 6))} className={(i % 6 + Math.floor(i / 6)) % 2 ? 'dark' : 'light'}><img src={pieceImage(p, v.pieceSet)} alt=""/></span>)}</div>
    <label>Piece set<select value={v.pieceSet} onChange={e => set('pieceSet', e.target.value)}>{pieceSets.map(x => <option key={x}>{x}</option>)}</select></label>
    <label>Board theme<select value={v.theme} onChange={e => set('theme', e.target.value)}>{(Object.keys(boardThemes) as (keyof typeof boardThemes)[]).map(x => <option key={x} value={x}>{boardThemeNames[x]}</option>)}</select></label>
    <button type="button" className="settings-disclosure secondary" aria-expanded={advanced} aria-controls="appearance-advanced" onClick={()=>setAdvanced(!advanced)}>Advanced <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{transform:advanced?'rotate(180deg)':undefined}}><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2"/></svg></button><div id="appearance-advanced" hidden={!advanced}>{(['light', 'dark'] as const).map(key => <label key={key}>Custom {key} squares<input type="color" value={v[key] ?? boardThemes[v.theme][key === 'light' ? 0 : 1]} onChange={e => set(key, e.target.value)}/><button type="button" className="secondary" onClick={() => set(key, null)}>Use theme color</button></label>)}
    {range('scale', 'Piece scale', 80, 110, '%')}{range('offset', 'Vertical offset', -8, 8, '%')}
    <label>Board frame<input type="checkbox" checked={v.frame} onChange={e => set('frame', e.target.checked)}/></label><label>Frame color<input type="color" value={v.frameColor} onChange={e => set('frameColor', e.target.value)}/><button type="button" className="secondary" onClick={() => set('frameColor', defaultAppearance.frameColor)}>Reset</button></label>{range('frameWidth', 'Frame thickness', 1, 5, 'px')}
    <label>Thin square borders<input type="checkbox" checked={v.grid} onChange={e => set('grid', e.target.checked)}/></label><label>Piece shadow<input type="checkbox" checked={v.shadow > 0} onChange={e => set('shadow', e.target.checked ? 15 : 0)}/></label>{range('shadow', 'Shadow intensity', 0, 30, '%')}</div>
    <div className="appearance-actions"><button type="button" className="primary" disabled={!ready || busy || stale} onClick={() => void commit()}>Save</button><button type="button" className="secondary" onClick={() => {change({ ...defaultAppearance });setStatus('');}} disabled={busy}>Reset</button></div><small>{owner ? 'Saved appearance is stored in your account.' : 'Guest preferences stay in this browser.'}</small><p>Reset restores defaults in this draft. Save applies them.</p><p role="status">{stale ? 'Saved appearance changed elsewhere. Close and reopen Settings.' : status || (!ready ? syncStatus || 'Loading saved appearance…' : dirty ? 'Unsaved appearance changes' : '')}</p><a href="/pieces/credits.html" target="_blank" rel="noreferrer">Piece artwork credits and licenses</a></section>;
}
export function AppearanceLauncher() {
 const {open}=useSettings();
 return <button type="button" aria-label="Board and piece appearance" data-board-display-control onClick={()=>open('appearance')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 4 6 6M6 14 16 3a2.8 2.8 0 0 1 4 4L9 17M6 14l3 3c0 4-4 5-7 4 3-1 0-5 4-7Z"/></svg></button>;
}

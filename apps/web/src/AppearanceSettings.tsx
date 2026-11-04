import { useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { boardThemes, boardThemeNames, pieceSets, defaultAppearance, type BoardAppearance } from '@chess/contracts';
import { useAppearance } from './Appearance';
import { pieceImage } from './board-interaction';
import type { Piece } from './board-model';
export function AppearanceSettings() {
    const { value: v, change, save, ready, status, owner } = useAppearance();
    const set = (key: keyof BoardAppearance, value: unknown) => change({ ...v, [key]: value });
    const range = (key: 'scale' | 'offset' | 'frameWidth' | 'shadow', label: string, min: number, max: number, unit: string) => <label>{label}<input type="range" aria-label={label} min={min} max={max} value={v[key]} onChange={e => set(key, Number(e.target.value))}/><output>{v[key]}{unit}</output><button type="button" className="secondary" aria-label={'Reset ' + label} onClick={() => set(key, defaultAppearance[key])}>Reset</button></label>;
    return <section className="appearance-settings" aria-label="Board & Pieces"><h3>Board &amp; Pieces</h3>
    <div className="appearance-preview engine-preview-board" role="img" aria-label="Appearance preview: both colors on light and dark squares">{('KQRBNPkqrbnp'.split('') as Piece[]).map((p, i) => <span key={i} className={i % 2 ? 'dark' : 'light'}><img src={pieceImage(p, v.pieceSet)} alt=""/></span>)}</div>
    <label>Piece set<select value={v.pieceSet} onChange={e => set('pieceSet', e.target.value)}>{pieceSets.map(x => <option key={x}>{x}</option>)}</select></label>
    <label>Board theme<select value={v.theme} onChange={e => set('theme', e.target.value)}>{(Object.keys(boardThemes) as (keyof typeof boardThemes)[]).map(x => <option key={x} value={x}>{boardThemeNames[x]}</option>)}</select></label>
    <details><summary>Advanced</summary>{(['light', 'dark'] as const).map(key => <label key={key}>Custom {key} squares<input type="color" value={v[key] ?? boardThemes[v.theme][key === 'light' ? 0 : 1]} onChange={e => set(key, e.target.value)}/><button type="button" className="secondary" onClick={() => set(key, null)}>Use theme color</button></label>)}
    {range('scale', 'Piece scale', 80, 110, '%')}{range('offset', 'Vertical offset', -8, 8, '%')}
    <label>Board frame<input type="checkbox" checked={v.frame} onChange={e => set('frame', e.target.checked)}/></label><label>Frame color<input type="color" value={v.frameColor} onChange={e => set('frameColor', e.target.value)}/><button type="button" className="secondary" onClick={() => set('frameColor', defaultAppearance.frameColor)}>Reset</button></label>{range('frameWidth', 'Frame thickness', 1, 5, 'px')}
    <label>Thin square borders<input type="checkbox" checked={v.grid} onChange={e => set('grid', e.target.checked)}/></label><label>Piece shadow<input type="checkbox" checked={v.shadow > 0} onChange={e => set('shadow', e.target.checked ? 15 : 0)}/></label>{range('shadow', 'Shadow intensity', 0, 30, '%')}</details>
    <div className="appearance-actions"><button type="button" className="primary" disabled={!ready} onClick={() => void save()}>Save appearance</button><button type="button" className="secondary" onClick={() => change({ ...defaultAppearance })}>Reset appearance</button></div><small>{owner ? 'Saved to your account.' : 'Guest preferences stay in this browser.'}</small><p role="status">{status}</p><a href="/pieces/credits.html" target="_blank" rel="noreferrer">Piece artwork credits and licenses</a></section>;
}
export function AppearanceLauncher() {
 const ref=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLButtonElement>(null);const [open,setOpen]=useState(false);
 useLayoutEffect(()=>{if(open)ref.current?.showModal();},[open]);
 const close=()=>{ref.current?.close();setOpen(false);trigger.current?.focus({preventScroll:true});};
 return <><button type="button" ref={trigger} aria-label="Board and piece appearance" data-board-display-control onClick={()=>setOpen(true)}>
   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
     <path d="m14 4 6 6M6 14 16 3a2.8 2.8 0 0 1 4 4L9 17M6 14l3 3c0 4-4 5-7 4 3-1 0-5 4-7Z"/>
   </svg>
 </button>{open&&createPortal(<dialog className="appearance-dialog" aria-label="Board & Pieces" ref={ref} onCancel={close}>
   <button type="button" className="appearance-close" aria-label="Close" onClick={close}>
     <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg>
   </button><AppearanceSettings/></dialog>,document.body)}</>;
}

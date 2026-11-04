import { loadGuestSession } from './guest-session-client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { boardThemes, defaultAppearance, restoreAppearance, type BoardAppearance } from '@chess/contracts';
const guestKey = 'chess-board-appearance:guest:v1';
function local() { try {
    return restoreAppearance(JSON.parse(localStorage.getItem(guestKey) ?? 'null'));
}
catch {
    return { ...defaultAppearance };
} }
const Context = createContext({ value: defaultAppearance, change: (_v: BoardAppearance) => { }, save: async () => { }, ready: false, status: '', owner: null as string | null });
export const useAppearance = () => useContext(Context);
export function AppearanceProvider({ children }: {
    children: ReactNode;
}) {
    const [value, setValue] = useState(local), [owner, setOwner] = useState<string | null>(null), [ready, setReady] = useState(false), [status, setStatus] = useState('');
    const csrf = useRef(''), dirty = useRef(false), identity = useRef<string | null>(null), latest = useRef(value);
    latest.current = value;
    useEffect(() => { let active = true, generation = 0; async function load() { const request = ++generation; try {
        const session = await loadGuestSession();
        const response = await fetch('/api/account/appearance', { cache: 'no-store' });
        if (!response.ok)
            throw Error();
        const data = await response.json();
        if (!active || request !== generation)
            return;
        csrf.current = session.csrfToken;
        if (identity.current !== data.owner || !dirty.current) {
            setValue(data.owner ? restoreAppearance(data.appearance) : local());
            dirty.current = false;
            setStatus('');
        }
        identity.current = data.owner;
        setOwner(data.owner);
        setReady(true);
    }
    catch {
        if (active && request === generation)
            setStatus('Appearance sync unavailable. Retry by returning to this page.');
    } } void load(); window.addEventListener('focus', load); return () => { active = false; window.removeEventListener('focus', load); }; }, []);
    useEffect(() => { const colors = boardThemes[value.theme]; const root = document.documentElement; const vars = { '--appearance-light': value.light ?? colors[0], '--appearance-dark': value.dark ?? colors[1], '--appearance-scale': String(value.scale / 100), '--appearance-offset': value.offset + '%', '--appearance-frame': value.frame ? value.frameColor : 'transparent', '--appearance-frame-width': value.frame ? value.frameWidth + 'px' : '0px', '--appearance-grid': value.grid ? 'inset 0 0 0 0.5px #5e4a3860' : 'none', '--appearance-shadow': value.shadow ? 'drop-shadow(0 1px 2px rgb(0 0 0 / ' + value.shadow / 100 + '))' : 'none' }; for (const [key, val] of Object.entries(vars))
        root.style.setProperty(key, val); }, [value]);
    const change = (v: BoardAppearance) => { dirty.current = true; setValue(v); setStatus('Unsaved appearance'); };
    async function save() { const snapshot=latest.current; setStatus('Saving…'); try {
        if (owner) {
            const response = await fetch('/api/account/appearance', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.current, 'X-Appearance-Owner': owner }, body: JSON.stringify(snapshot) });
            const data = await response.json();
            if (!response.ok || data.owner !== owner)
                throw Error();
        }
        else
            localStorage.setItem(guestKey, JSON.stringify(latest.current));
        if(identity.current!==owner)return;
        dirty.current = latest.current!==snapshot;
        setStatus(dirty.current?'Unsaved appearance':'Appearance saved');
    }
    catch {
        setStatus('Could not save appearance. Your preview is retained; retry Save appearance.');
    } }
    return <Context.Provider value={{ value, change, save, ready, status, owner }}>{children}</Context.Provider>;
}

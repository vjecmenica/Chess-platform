import {commitSettings} from './settings-transaction';
import { loadGuestSession } from './guest-session-client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultAppearance, restoreAppearance, type BoardAppearance } from '@chess/contracts';
import { appearanceVariables } from './appearance-styles';
const guestKey = 'chess-board-appearance:guest:v1';
function local() { try {
    return restoreAppearance(JSON.parse(localStorage.getItem(guestKey) ?? 'null'));
}
catch {
    return { ...defaultAppearance };
} }
const Context = createContext({ value: defaultAppearance, save: async (_v: BoardAppearance, _expected: BoardAppearance) => { }, ready: false, status: '', owner: null as string | null });
export const useAppearance = () => useContext(Context);
export function AppearanceProvider({ children }: {
    children: ReactNode;
}) {
    const [value, setValue] = useState(local), [owner, setOwner] = useState<string | null>(null), [ready, setReady] = useState(false), [status, setStatus] = useState('');
    const csrf = useRef(''), identity = useRef<string | null>(null), latest = useRef(value);
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
        {
            setValue(data.owner ? restoreAppearance(data.appearance) : local());
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
    useEffect(() => { const root = document.documentElement; for (const [key, val] of Object.entries(appearanceVariables(value)))
        root.style.setProperty(key, val); }, [value]);
    useEffect(() => { const sync = (e: StorageEvent) => { if (!identity.current && e.key === guestKey) setValue(local()); if (e.key === 'chess-appearance-sync') window.dispatchEvent(new Event('focus')); }; window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync); }, []);
    async function save(snapshot: BoardAppearance, expected: BoardAppearance) { if (JSON.stringify(latest.current)!==JSON.stringify(expected)) throw Error('Appearance changed elsewhere. Close and reopen Settings before saving.'); setStatus('Saving…'); try {
        await commitSettings(snapshot, expected, async()=>{
          if (!owner) return local();
          const response=await fetch('/api/account/appearance',{cache:'no-store'});
          if(!response.ok)throw Error();
          const data=await response.json();
          if(data.owner!==owner)throw Error();
          return restoreAppearance(data.appearance);
        }, async()=>{ if (owner) {
            const response = await fetch('/api/account/appearance', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.current, 'X-Appearance-Owner': owner }, body: JSON.stringify(snapshot) });
            const data = await response.json();
            if (!response.ok || data.owner !== owner)
                throw Error();
        }
        else
            localStorage.setItem(guestKey, JSON.stringify(snapshot));
        });
        if(identity.current!==owner) throw Error('Account changed. Reopen Settings.');
        setValue(snapshot); latest.current=snapshot;
        try { localStorage.setItem('chess-appearance-sync', String(Date.now())); } catch {}
        setStatus('Appearance saved');
    }
    catch {
        setStatus('Could not save appearance. Retry Save.'); throw Error('Could not save appearance. Your draft is retained; retry Save.');
    } }
    return <Context.Provider value={{ value, save, ready, status, owner }}>{children}</Context.Provider>;
}

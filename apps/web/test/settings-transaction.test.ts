import {it,expect,vi,afterEach} from 'vitest';
import {commitSettings} from '../src/settings-transaction';
import {defaultEngineSettings,readSettings,saveSettings,setRuntimeSettings,settingsKey} from '../src/settings-store';
afterEach(()=>{setRuntimeSettings(null);vi.unstubAllGlobals();});
it('keeps the active setting unchanged until persistence succeeds and retains it on failure',async()=>{
 let active='cream';let release!:()=>void;
 const pending=commitSettings('oak','cream',async()=>active,async()=>new Promise<void>(r=>{release=r;}));
 await Promise.resolve();await Promise.resolve();expect(active).toBe('cream');release();active=await pending;expect(active).toBe('oak');
 await expect(commitSettings('blue','oak',async()=>active,async()=>{throw Error('Offline');})).rejects.toThrow('Offline');expect(active).toBe('oak');
});
it('rejects a stale draft before a write, including account settings changed in another tab',async()=>{
 const write=vi.fn();await expect(commitSettings('oak','cream',async()=>'blue',write)).rejects.toThrow('changed elsewhere');expect(write).not.toHaveBeenCalled();
});
it('persists all engine limits together only on Save, broadcasts once, and reports storage failures',()=>{
 const data=new Map<string,string>();const dispatch=vi.fn();
 vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});vi.stubGlobal('window',{dispatchEvent:dispatch});
 const base=readSettings(),draft={...base,lines:5 as const};expect(readSettings().lines).toBe(3);
 saveSettings(draft,base);expect(readSettings().lines).toBe(5);expect(dispatch).toHaveBeenCalledTimes(1);
 expect(()=>saveSettings(base,base)).toThrow('changed elsewhere');
 vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:()=>{throw Error('Quota');}});
 expect(()=>saveSettings(defaultEngineSettings(),draft)).toThrow('Quota');expect(JSON.parse(data.get(settingsKey)!).lines).toBe(5);
});

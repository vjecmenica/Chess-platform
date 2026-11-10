import {createContext,useContext,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {AppearanceSettings} from './AppearanceSettings';
import {EngineSettings} from './EngineSettings';
type Category='appearance'|'engine';
const Context=createContext({open:(_category:Category)=>{},isOpen:false});
export const useSettings=()=>useContext(Context);
export function SettingsProvider({children}:{children:ReactNode}){
 const [category,setCategory]=useState<Category>('appearance'),[isOpen,setOpen]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null);
 const close=()=>{dialog.current?.close();setOpen(false);trigger.current?.focus({preventScroll:true});};
 useLayoutEffect(()=>{if(isOpen)dialog.current?.showModal();},[isOpen]);
 return <Context.Provider value={{isOpen,open:category=>{trigger.current=document.activeElement as HTMLElement;setCategory(category);setOpen(true);}}}>{children}{isOpen&&createPortal(<dialog id="engine-settings" className="shared-settings-dialog" ref={dialog} aria-labelledby="settings-title" onCancel={e=>{e.preventDefault();close();}}>
 <header><h2 id="settings-title">Settings</h2><button className="secondary" aria-label="Close settings" onClick={close}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
 <div className="settings-layout"><nav aria-label="Settings categories">{(['appearance','engine'] as const).map(c=><button key={c} className="secondary" aria-current={category===c?'page':undefined} onClick={()=>setCategory(c)}>{c==='appearance'?'Appearance':'Engine'}</button>)}<a href="/account#settings">Account settings</a></nav>
 <div className="settings-sections"><div hidden={category!=='appearance'}><AppearanceSettings/></div><div hidden={category!=='engine'}><EngineSettings/></div></div></div>
 </dialog>,document.body)}</Context.Provider>;
}

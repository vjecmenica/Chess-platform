import {readEnginePreference, type EnginePreference} from './engine-builds';
import {createInteractiveSettings, updateDepthSlider, updateTimeSlider, type InteractiveSettingsState} from './interactive-engine';
import type {MultiPvCount} from './engine-analysis';
export interface EngineSettingsValue {preference:EnginePreference;search:InteractiveSettingsState;lines:MultiPvCount}
export const settingsKey='chess-engine-settings:v1', settingsChanged='chess-engine-settings-saved';
let runtime: (()=>{preference:EnginePreference;lineCount:MultiPvCount;searchSettings:InteractiveSettingsState}) | null=null;
export const setRuntimeSettings=(read:typeof runtime)=>{runtime=read;};
export const defaultEngineSettings=():EngineSettingsValue=>({preference:{choice:'full',threads:1},search:createInteractiveSettings(),lines:3});
export function readSettings(persisted=false):EngineSettingsValue {
 if(runtime&&!persisted){const r=runtime();return {preference:r.preference,search:r.searchSettings,lines:r.lineCount};}
 try {const v=JSON.parse(localStorage.getItem(settingsKey)??'null');
  if(v && ['full','lite'].includes(v.preference.choice)&&Number.isInteger(v.preference.threads)&&v.preference.threads>=1&&v.preference.threads<=4&&[1,2,3,4,5].includes(v.lines)){
   for(const limits of [v.search.current,v.search.bounded]){updateDepthSlider(createInteractiveSettings(),limits.depth);updateTimeSlider(createInteractiveSettings(),limits.timeMs);if(typeof limits.unlimitedDepth!=='boolean'||typeof limits.unlimitedTime!=='boolean')throw Error();}
   return v;
  }
  return {...defaultEngineSettings(),preference:readEnginePreference(localStorage)};
 }catch{return defaultEngineSettings();}
}
export function saveSettings(value:EngineSettingsValue,expected:EngineSettingsValue){
 if(JSON.stringify(readSettings())!==JSON.stringify(expected))throw Error('Engine settings changed elsewhere. Close and reopen Settings.');
 localStorage.setItem(settingsKey,JSON.stringify(value));
 window.dispatchEvent(new Event(settingsChanged));
}

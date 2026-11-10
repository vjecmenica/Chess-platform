import {useState} from 'react';
import {readSettings, saveSettings, defaultEngineSettings, type EngineSettingsValue} from './settings-store';
import {browserEngineThreadCapabilities,engineThreadFailure,resolveEngine,effectiveThreads,maximumEngineThreads} from './engine-builds';
import {depthSlider,timeSlider,updateDepthSlider,updateTimeSlider} from './interactive-engine';
import type {MultiPvCount} from './engine-analysis';
export function EngineSettings(){
 const [base,setBase]=useState(readSettings),[draft,setDraft]=useState(base),[status,setStatus]=useState('');
 const preference=draft.preference,searchSettings=draft.search,lineCount=draft.lines;
 const {depth,timeMs,unlimitedDepth,unlimitedTime}=searchSettings.current;
 const capabilities=browserEngineThreadCapabilities(),threadFailure=engineThreadFailure(capabilities);
 const variant=resolveEngine(preference.choice,threadFailure===null),maxThreads=maximumEngineThreads(typeof navigator==='undefined'?2:navigator.hardwareConcurrency),threads=effectiveThreads(variant,preference.threads,maxThreads);
 const changeEngine=(preference:EngineSettingsValue['preference'])=>{setDraft({...draft,preference});setStatus('');};
 const applySettings=(search:EngineSettingsValue['search'])=>{setDraft({...draft,search});setStatus('');};
 const setLineCount=(lines:MultiPvCount)=>{setDraft({...draft,lines});setStatus('');};
 const dirty=JSON.stringify(draft)!==JSON.stringify(base);
 return <section className="engine-settings-content" aria-label="Engine settings"><h3>Engine</h3>      <label className="engine-line-setting">Engine
        <select aria-label="Analysis engine" aria-description="Applies to Analysis and Computer Analysis."
          value={preference.choice} onChange={event => {
          changeEngine({ ...preference, choice: event.target.value === 'lite' ? 'lite' : 'full' });
        }}><option value="full">Stockfish 19 Full</option><option value="lite">Stockfish 19 Lite</option></select>
      </label>
      {variant.multithreaded && <label className="engine-range-setting engine-thread-setting">Threads
        <input type="range" aria-label="Engine threads" min="1" max={maxThreads} value={threads}
          disabled={maxThreads === 1} onChange={event => changeEngine({ ...preference, threads: Number(event.target.value) })} />
        <output>{threads}</output>
      </label>}
      {preference.choice === 'full' && threadFailure !== null && <small>Full single-threaded: {threadFailure}</small>}
      {preference.choice === 'full' && <details className="engine-thread-diagnostics">
        <summary>Thread diagnostics</summary>
        <dl>{[
          ['Secure context', capabilities.secure], ['Cross-origin isolated', capabilities.isolated],
          ['Top-level document', !capabilities.embedded], ['Permissions-Policy allows isolation', capabilities.policyAllowed],
          ['SharedArrayBuffer', capabilities.sharedArrayBuffer], ['Shared WebAssembly memory', capabilities.sharedWasmMemory],
        ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt>
          <dd>{value === null ? 'Not reported' : value ? 'Yes' : 'No'}</dd></div>)}</dl>
      </details>}
      <label className="engine-line-setting engine-line-count">Lines
          <select value={lineCount}
            aria-label="Candidate lines" onChange={event => {
              setLineCount(Number(event.target.value) as MultiPvCount);
            }}>
            {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
    <div className="engine-search-settings" role="group" aria-label="Interactive search limits">
      <label className="engine-range-setting">Depth
        <input type="range" aria-label="Depth" min={depthSlider.min} max={depthSlider.max} step={depthSlider.step}
          value={unlimitedDepth ? depthSlider.max : depth} aria-valuetext={unlimitedDepth ? 'Unlimited depth' : `Depth ${depth}`}
          onChange={event => applySettings(updateDepthSlider(searchSettings, Number(event.target.value)))} />
        <output aria-label={unlimitedDepth ? 'Unlimited depth' : undefined}>{unlimitedDepth ? '∞' : depth}</output>
      </label>
      <label className="engine-range-setting">Search time
        <input type="range" aria-label="Search time" min={timeSlider.min} max={timeSlider.max} step={timeSlider.step}
          value={unlimitedTime ? timeSlider.max : timeMs}
          aria-valuetext={unlimitedTime ? 'Unlimited search time' : `${(timeMs / 1000).toFixed(1)} seconds`}
          onChange={event => applySettings(updateTimeSlider(searchSettings, Number(event.target.value)))} />
        <output aria-label={unlimitedTime ? 'Unlimited search time' : undefined}>{unlimitedTime ? '∞' : `${(timeMs / 1000).toFixed(1)}s`}</output>
      </label>
    </div>
    <a className="engine-credit" href="/engine/NOTICE.md" target="_blank" rel="noreferrer"
      >Engine license and source</a>

 <div className="appearance-actions"><button className="primary" onClick={()=>{try{saveSettings(draft,base);setBase(draft);setStatus('Saved');}catch(e){setStatus(e instanceof Error?e.message:'Could not save');}}}>Save</button><button className="secondary" onClick={()=>{setDraft(defaultEngineSettings());setStatus('');}}>Reset</button></div><p>Reset restores defaults in this draft. Save applies them to this browser.</p><p role="status">{status || (dirty?'Unsaved engine changes':'')}</p></section>;
}

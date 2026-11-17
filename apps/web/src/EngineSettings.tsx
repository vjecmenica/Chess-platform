import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SettingsRange } from './SettingsRange';
import { readSettings, saveSettings, defaultEngineSettings, type EngineSettingsValue } from './settings-store';
import { browserEngineThreadCapabilities, engineThreadFailure, resolveEngine, effectiveThreads, maximumEngineThreads } from './engine-builds';
import { depthSlider, timeSlider, updateDepthSlider, updateTimeSlider } from './interactive-engine';
import type { MultiPvCount } from './engine-analysis';

export function EngineSettings({ actionTarget }: { actionTarget: HTMLElement | null }) {
  const [base, setBase] = useState(readSettings);
  const [draft, setDraft] = useState(base);
  const [status, setStatus] = useState('');
  const { preference, search, lines } = draft;
  const { depth, timeMs, unlimitedDepth, unlimitedTime } = search.current;
  const capabilities = browserEngineThreadCapabilities();
  const threadFailure = engineThreadFailure(capabilities);
  const variant = resolveEngine(preference.choice, threadFailure === null);
  const maxThreads = maximumEngineThreads(typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency);
  const threads = effectiveThreads(variant, preference.threads, maxThreads);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);

  function change(next: EngineSettingsValue) {
    setDraft(next);
    setStatus('');
  }
  function save() {
    try {
      saveSettings(draft, base);
      setBase(draft);
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return <section className="settings-section" aria-label="Engine settings">
    <h3>Engine</h3>
    <div className="settings-fields">
      <label className="settings-row"><span>Engine</span>
        <span className="settings-select">
          <select aria-label="Analysis engine" aria-description="Applies to Analysis and Computer Analysis."
            value={preference.choice} onChange={event => change({
            ...draft, preference: { ...preference, choice: event.currentTarget.value === 'lite' ? 'lite' : 'full' },
          })}>
            <option value="full">Stockfish 19 Full</option>
            <option value="lite">Stockfish 19 Lite</option>
          </select>
        </span>
      </label>
      {variant.multithreaded && <label className="settings-row"><span>Threads</span>
        <span className="settings-field settings-range-field">
          <SettingsRange aria-label="Engine threads" min={1} max={maxThreads} value={threads} disabled={maxThreads === 1}
            onChange={event => change({ ...draft, preference: { ...preference, threads: event.currentTarget.valueAsNumber } })} />
          <output>{threads}</output>
        </span>
      </label>}
      {preference.choice === 'full' && threadFailure !== null &&
        <small className="settings-note">Full single-threaded: {threadFailure}</small>}
      {preference.choice === 'full' && <details className="engine-thread-diagnostics">
        <summary>Thread diagnostics</summary>
        <dl>{[
          ['Secure context', capabilities.secure], ['Cross-origin isolated', capabilities.isolated],
          ['Top-level document', !capabilities.embedded], ['Permissions-Policy allows isolation', capabilities.policyAllowed],
          ['SharedArrayBuffer', capabilities.sharedArrayBuffer], ['Shared WebAssembly memory', capabilities.sharedWasmMemory],
        ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt>
          <dd>{value === null ? 'Not reported' : value ? 'Yes' : 'No'}</dd></div>)}</dl>
      </details>}
      <label className="settings-row"><span>Lines</span>
        <span className="settings-select">
          <select aria-label="Candidate lines" value={lines}
            onChange={event => change({ ...draft, lines: Number(event.currentTarget.value) as MultiPvCount })}>
            {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count}</option>)}
          </select>
        </span>
      </label>
      <div className="settings-fields" role="group" aria-label="Interactive search limits">
        <label className="settings-row"><span>Depth</span>
          <span className="settings-field settings-range-field">
            <SettingsRange aria-label="Depth" min={depthSlider.min} max={depthSlider.max} step={depthSlider.step}
              value={unlimitedDepth ? depthSlider.max : depth} aria-valuetext={unlimitedDepth ? 'Unlimited depth' : `Depth ${depth}`}
              onChange={event => change({ ...draft, search: updateDepthSlider(search, event.currentTarget.valueAsNumber) })} />
            <output aria-label={unlimitedDepth ? 'Unlimited depth' : undefined}>{unlimitedDepth ? '∞' : depth}</output>
          </span>
        </label>
        <label className="settings-row"><span>Search time</span>
          <span className="settings-field settings-range-field">
            <SettingsRange aria-label="Search time" min={timeSlider.min} max={timeSlider.max} step={timeSlider.step}
              value={unlimitedTime ? timeSlider.max : timeMs}
              aria-valuetext={unlimitedTime ? 'Unlimited search time' : `${(timeMs / 1000).toFixed(1)} seconds`}
              onChange={event => change({ ...draft, search: updateTimeSlider(search, event.currentTarget.valueAsNumber) })} />
            <output aria-label={unlimitedTime ? 'Unlimited search time' : undefined}>{unlimitedTime ? '∞' : `${(timeMs / 1000).toFixed(1)}s`}</output>
          </span>
        </label>
      </div>
    </div>
    <a className="settings-resource" href="/engine/NOTICE.md" target="_blank" rel="noreferrer">Engine license and source</a>
    {actionTarget && createPortal(<div className="settings-actions" role="group" aria-label="Engine settings actions">
      <span role="status" className="settings-save-status">{status || (dirty ? 'Unsaved changes' : '')}</span>
      <button type="button" className="secondary" onClick={() => change(defaultEngineSettings())}>Reset</button>
      <button type="button" className="primary" onClick={save}>Save</button>
    </div>, actionTarget)}
  </section>;
}

import { expect, it } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { EngineCache, EngineController, type EngineWorker } from '../src/engine-analysis';
import { ThreatController, type ThreatState } from '../src/threat-analysis';

function workers() {
  const all: { worker: EngineWorker; commands: unknown[]; ended: boolean; emit: (text: string) => void }[] = [];
  return { all, make() {
    const item = { commands: [] as unknown[], ended: false, worker: null as unknown as EngineWorker,
      emit(text: string) { item.worker.onmessage?.({ data: text } as MessageEvent<string>); } };
    item.worker = { onmessage: null, onerror: null, postMessage(command) { item.commands.push(command); }, terminate() { item.ended = true; } };
    all.push(item); return item.worker;
  } };
}
const fen = STANDARD_STARTING_FEN;
it('shows independent, refining opponent moves while ordinary analysis continues untouched', () => {
  const normalWorkers = workers(), threatWorkers = workers();
  const ordinary: unknown[] = [], threats: ThreatState[] = [];
  const normal = new EngineController(() => normalWorkers.make(), state => ordinary.push(state), new EngineCache());
  const controller = new ThreatController(() => threatWorkers.make(), state => threats.push(state));
  normal.setSearchLimits({ mode: 'infinite' }); normal.setLineCount(3);
  normal.start(fen); controller.start(fen, 'game');
  const n = normalWorkers.all[0]!, t = threatWorkers.all[0]!;
  for (const item of [n,t]) { item.emit('uciok'); item.emit('readyok'); }
  expect(t.commands).toContain(`position fen ${fen.replace(' w ', ' b ').replace('0 1', '1 1')}`);
  expect(t.commands).toContain('go depth 14 movetime 1200');
  expect(t.commands).toContain('setoption name MultiPV value 1');
  expect(n.commands).toContain('go infinite');
  expect(n.commands).toContain('setoption name MultiPV value 3');
  t.emit('info depth 5 score cp 2 pv e7e5');
  expect(threats.at(-1)).toMatchObject({ kind: 'searching', move: { gameId: 'game', fen, from: 'e7', to: 'e5' } });
  t.emit('info depth 7 score cp 8 pv d7d5');
  expect(threats.at(-1)).toMatchObject({ move: { from: 'd7', to: 'd5' } });
  n.emit('info depth 8 score cp 22 pv e2e4');
  expect(ordinary.at(-1)).toMatchObject({ kind: 'searching', fen, evaluation: { variation: ['e2e4'] } });
  controller.dispose();
  expect(t.ended).toBe(true); expect(n.ended).toBe(false);
  n.emit('info depth 9 score cp 24 pv d2d4');
  expect(ordinary.at(-1)).toMatchObject({ evaluation: { variation: ['d2d4'] } });
  normal.dispose();
});
it('ignores stopped/replaced output, validates opponent moves, and never opens a worker for check', () => {
  const factory=workers(), states: ThreatState[]=[];
  const controller=new ThreatController(()=>factory.make(), state=>states.push(state));
  controller.start(fen,'game'); const old=factory.all[0]!;
  old.emit('uciok'); old.emit('readyok');
  old.emit('info depth 4 score cp 2 pv e2e4');
  expect(states.at(-1)).toMatchObject({ move:null }); // Wrong side, not an opponent threat.
  const black=fen.replace(' w ', ' b ');
  controller.start(black,'game'); const next=factory.all[1]!;
  expect(old.ended).toBe(true);
  const count=states.length; old.emit('info depth 12 score cp 45 pv e7e5'); old.emit('bestmove e7e5');
  expect(states).toHaveLength(count);
  next.emit('uciok'); next.emit('readyok'); next.emit('info depth 4 score cp 3 pv e2e4');
  expect(states.at(-1)).toMatchObject({ move:{fen:black,from:'e2',to:'e4'} });
  controller.dispose(); const stopped=states.length; next.emit('info depth 12 score cp 100 pv d2d4');
  expect(states).toHaveLength(stopped);
  controller.start('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1','game');
  expect(factory.all).toHaveLength(2);
  expect(states.at(-1)).toEqual({kind:'unavailable',message:'Threat unavailable while in check.'});
});
it('keeps failures isolated from ordinary evaluation', () => {
  const factory=workers(), states:ThreatState[]=[];
  const controller=new ThreatController(()=>factory.make(), state=>states.push(state));
  controller.start(fen,'game'); factory.all[0]!.worker.onerror?.({} as ErrorEvent);
  expect(states.at(-1)?.kind).toBe('error'); expect(factory.all[0]!.ended).toBe(true);
});

it('does not republish score and PV churn when the threat move is unchanged', () => {
  const factory=workers(),states:ThreatState[]=[];
  const controller=new ThreatController(()=>factory.make(),state=>states.push(state));
  controller.start(fen,'game');const worker=factory.all[0]!;worker.emit('uciok');worker.emit('readyok');
  worker.emit('info depth 4 score cp 0 pv e7e5');const count=states.length;
  worker.emit('info depth 5 score cp 8 pv e7e5 g1f3');
  expect(states).toHaveLength(count);
  worker.emit('bestmove e7e5');expect(states.at(-1)).toMatchObject({kind:'done',move:{from:'e7',to:'e5'}});
  controller.dispose();
});

import type { ReactNode } from 'react';
import { ActionIcon } from './GameRematch';

interface FinishedResultAreaProps {
  readonly score: string;
  readonly beforeAnalysis?: ReactNode;
  readonly explanation: string;
  readonly analysisOpen: boolean;
  readonly onToggleAnalysis: () => void;
  readonly analysisHref?: string | undefined;
}

export function FinishedResultArea({ score, explanation, analysisOpen,
  onToggleAnalysis, analysisHref, beforeAnalysis }: FinishedResultAreaProps) {
  return <div className={`finished-result-area${analysisOpen ? ' analysis-result-area' : ''}`}>
    <div className="final-result" role="status">
      <strong>{score}</strong><span>{explanation}</span>
    </div>
    <div className="finished-result-actions">{beforeAnalysis}
      {!analysisOpen && analysisHref ? <a className="primary analysis-open" href={analysisHref} target="_blank" rel="noopener noreferrer"
        aria-label="Open game Analysis in a new tab"><ActionIcon kind="analysis"/>Analysis</a> : <button type="button" className={analysisOpen ? "secondary" : "primary"} aria-pressed={analysisOpen}
        aria-description="Analysis edits last until Analysis closes and do not affect the game."
        onClick={onToggleAnalysis}>{analysisOpen ? 'Close analysis' : 'Analysis'}</button>}
    </div>
  </div>;
}

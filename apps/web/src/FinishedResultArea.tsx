import type { ReactNode } from 'react';
import { ActionIcon } from './ActionIcon';

interface FinishedResultAreaProps {
  readonly score: string;
  readonly beforeAnalysis?: ReactNode;
  readonly explanation: string;
  readonly analysisHref?: string | undefined;
  readonly share?: ReactNode;
}

export function FinishedResultArea({ score, explanation, analysisHref, beforeAnalysis, share }: FinishedResultAreaProps) {
  return <div className="finished-result-area">
    <div className="final-result" role="status">
      <strong>{score}</strong><span>{explanation}</span>
    </div>
    {(beforeAnalysis || analysisHref || share) && <div className="finished-result-actions">
      {beforeAnalysis}
      {analysisHref && <a className="primary analysis-open" href={analysisHref} target="_blank" rel="noopener noreferrer"
        aria-label="Open game Analysis in a new tab"><ActionIcon kind="analysis"/>Analysis</a>}
      {share}
    </div>}
  </div>;
}

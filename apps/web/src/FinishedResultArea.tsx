import { useEffect, useRef, useState } from 'react';
import { isCompactResultHeight, resizedResultHeight } from './result-area';

interface FinishedResultAreaProps {
  readonly score: string;
  readonly explanation: string;
  readonly analysisOpen: boolean;
  readonly onToggleAnalysis: () => void;
}

export function FinishedResultArea({ score, explanation, analysisOpen,
  onToggleAnalysis }: FinishedResultAreaProps) {
  const [height, setHeight] = useState<number | null>(null);
  const area = useRef<HTMLDivElement | null>(null);
  const maximumHeight = useRef<number | null>(null);
  const gesture = useRef<{ id: number; y: number; height: number } | null>(null);

  useEffect(() => {
    const resetSize = () => {
      setHeight(null);
      maximumHeight.current = null;
      gesture.current = null;
    };
    window.addEventListener('resize', resetSize);
    return () => window.removeEventListener('resize', resetSize);
  }, []);

  return <div ref={area}
    className={`finished-result-area${isCompactResultHeight(height, maximumHeight.current) ? ' compact' : ''}`}
    style={height === null ? undefined : { height }}>
    <div className="final-result" role="status">
      <strong>{score}</strong><span>{explanation}</span>
    </div>
    <div className="finished-result-actions">
      <button type="button" aria-pressed={analysisOpen}
        title="Analysis notes stay in this browser and do not affect the game."
        onClick={onToggleAnalysis}>{analysisOpen ? 'Close analysis' : 'Analysis'}</button>
    </div>
    <button type="button" className="result-resize-handle"
      aria-label="Resize result area" title="Drag to resize result area; use arrow keys on the handle"
      onPointerDown={event => {
        if (event.button !== 0 || area.current === null) return;
        const currentHeight = area.current.getBoundingClientRect().height;
        maximumHeight.current ??= currentHeight;
        gesture.current = { id: event.pointerId, y: event.clientY, height: currentHeight };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (current?.id !== event.pointerId || maximumHeight.current === null) return;
        setHeight(resizedResultHeight(current.height,
          maximumHeight.current, event.clientY - current.y));
      }}
      onPointerUp={event => {
        if (gesture.current?.id === event.pointerId) gesture.current = null;
      }}
      onPointerCancel={event => {
        if (gesture.current?.id === event.pointerId) gesture.current = null;
      }}
      onLostPointerCapture={() => { gesture.current = null; }}
      onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' || area.current === null) return;
        event.preventDefault();
        maximumHeight.current ??= area.current.getBoundingClientRect().height;
        setHeight(resizedResultHeight(height ?? maximumHeight.current,
          maximumHeight.current, event.key === 'ArrowUp' ? -8 : 8));
      }} />
  </div>;
}

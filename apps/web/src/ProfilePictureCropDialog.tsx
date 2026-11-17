import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { avatarCropRect, boundAvatarCrop, initialAvatarCrop, renderAvatarCrop, type AvatarCrop } from './avatar-crop';
import { avatarSourceMaxBytes, checkAvatarDimensions, inspectAvatarSource, type ImageSize } from './avatar-source';

export function ProfilePictureCropDialog({ file, onSave, onClose }: {
  file: File; onSave: (blob: Blob) => Promise<void>; onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ width: number; points: Map<number, { x: number; y: number }> } | null>(null);
  const [url, setUrl] = useState<string>();
  const [size, setSize] = useState<ImageSize>();
  const [crop, setCrop] = useState<AvatarCrop>();
  const [sourceError, setSourceError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const zoomBy = useCallback((direction: number) => {
    if (!size || saving) return;
    setCrop(value => value && boundAvatarCrop(size, { ...value, zoom: Math.round((value.zoom + direction * .1) * 20) / 20 }));
  }, [size, saving]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    async function prepare() {
      try {
        if (file.size > avatarSourceMaxBytes) throw new Error('Choose an original image no larger than 10 MB.');
        const { mime } = inspectAvatarSource(await file.arrayBuffer());
        if (!active) return;
        objectUrl = URL.createObjectURL(file.slice(0, file.size, mime));
        setUrl(objectUrl);
      } catch (cause) {
        if (active) setSourceError(cause instanceof Error ? cause.message : 'This image could not be opened.');
      }
    }
    void prepare();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file]);

  useEffect(() => {
    const element = stage.current;
    if (!element || !size || saving) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || event.ctrlKey) return;
      event.preventDefault();
      zoomBy(-Math.sign(event.deltaY));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [size, saving, zoomBy]);

  function pan(horizontal: number, vertical: number) {
    if (!size || saving) return;
    setCrop(value => {
      if (!value) return value;
      const { size: side } = avatarCropRect(size, value);
      return boundAvatarCrop(size, { ...value, x: value.x - horizontal * side, y: value.y - vertical * side });
    });
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!crop || saving || event.button !== 0 || !frame.current) return;
    if (drag.current && (event.pointerType !== 'touch' || drag.current.points.size >= 2)) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current ??= { width: frame.current.getBoundingClientRect().width, points: new Map() };
    drag.current.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    const last = gesture?.points.get(event.pointerId);
    if (!gesture || !last || gesture.width <= 0 || !size || saving) return;
    const { clientX: x, clientY: y } = event;
    const other = [...gesture.points].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const distance = Math.hypot(last.x - other.x, last.y - other.y);
      if (distance > 0) {
        const scale = Math.hypot(x - other.x, y - other.y) / distance;
        setCrop(value => value && boundAvatarCrop(size, { ...value, zoom: value.zoom * scale }));
      }
    } else pan((x - last.x) / gesture.width, (y - last.y) / gesture.width);
    gesture.points.set(event.pointerId, { x, y });
  }

  async function save() {
    if (saving || !image.current || !stage.current || !crop) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const output = await renderAvatarCrop(image.current, crop, getComputedStyle(stage.current).backgroundColor);
      await onSave(output);
      onClose();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the picture. Try again.');
    } finally { setSaving(false); }
  }

  const rect = size && crop ? avatarCropRect(size, crop) : null;
  return <dialog ref={dialog} className="profile-crop-dialog" aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <div className="profile-crop-heading">
      <h2 id={`${id}-title`}>Crop profile picture</h2>
      <button type="button" aria-label="Close crop dialog" className="secondary profile-crop-close"
        disabled={saving} onClick={onClose}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
    <div ref={stage} className="profile-crop-stage" tabIndex={crop ? 0 : undefined} role="group" aria-label="Position photo"
      aria-description={crop ? 'Use the arrow keys to move the photo and plus or minus to zoom.' : undefined}
      onPointerDown={startDrag} onPointerMove={moveDrag} onLostPointerCapture={event => {
        drag.current?.points.delete(event.pointerId);
        if (drag.current?.points.size === 0) drag.current = null;
      }}
      onKeyDown={event => {
        if (!crop || saving || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === '+' || event.key === '=' || event.key === '-') {
          event.preventDefault();
          zoomBy(event.key === '-' ? -1 : 1);
          return;
        }
        const step = event.shiftKey ? .15 : .035;
        const direction = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (direction) { event.preventDefault(); pan(direction[0]!, direction[1]!); }
      }}>
      <div ref={frame} className="profile-crop-frame">
        {url && <img ref={image} src={url} alt="" draggable={false}
          style={rect && size ? { width: `${100 * size.width / rect.size}%`, height: `${100 * size.height / rect.size}%`,
            left: `${-100 * rect.x / rect.size}%`, top: `${-100 * rect.y / rect.size}%` } : { visibility: 'hidden' }}
          onLoad={event => {
            const dimensions = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
            try { checkAvatarDimensions(dimensions); setSize(dimensions); setCrop(initialAvatarCrop(dimensions)); }
            catch (cause) { setSourceError((cause as Error).message); }
          }} onError={() => setSourceError('This image could not be opened. Try a different file.')} />}
      </div>
      {crop ? <div className="profile-crop-shade" aria-hidden="true" /> : !sourceError && <span role="status">Opening image…</span>}
    </div>
    {(sourceError || saveError) && <p className="error" role="alert">{sourceError || saveError}</p>}
    {saving && <span className="visually-hidden" role="status">Saving profile picture…</span>}
    <div className="profile-crop-actions">
      <button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancel</button>
      <button type="button" className="primary" disabled={!crop || saving} onClick={() => void save()}>Save</button>
    </div>
  </dialog>;
}

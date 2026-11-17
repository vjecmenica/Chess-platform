import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { avatarCropRect, boundAvatarCrop, initialAvatarCrop, maxAvatarZoom, renderAvatarCrop, type AvatarCrop } from './avatar-crop';
import { avatarSourceMaxBytes, checkAvatarDimensions, inspectAvatarSource, type ImageSize } from './avatar-source';

export function ProfilePictureCropDialog({ file, onSave, onClose }: {
  file: File; onSave: (blob: Blob) => Promise<void>; onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; width: number } | null>(null);
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
      setCrop(value => value && boundAvatarCrop(size, { ...value, zoom: Math.round((value.zoom - Math.sign(event.deltaY) * .1) * 20) / 20 }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [size, saving]);

  function pan(horizontal: number, vertical: number) {
    if (!size || saving) return;
    setCrop(value => {
      if (!value) return value;
      const { size: side } = avatarCropRect(size, value);
      return boundAvatarCrop(size, { ...value, x: value.x - horizontal * side, y: value.y - vertical * side });
    });
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!crop || saving || event.button !== 0 || !event.isPrimary || !frame.current) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: frame.current.getBoundingClientRect().width };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const last = drag.current;
    if (!last || event.pointerId !== last.id || last.width <= 0) return;
    pan((event.clientX - last.x) / last.width, (event.clientY - last.y) / last.width);
    last.x = event.clientX;
    last.y = event.clientY;
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
        disabled={saving} onClick={onClose}>×</button>
    </div>
    <div ref={stage} className="profile-crop-stage" tabIndex={crop ? 0 : undefined} role="group" aria-label="Position photo"
      aria-describedby={crop ? `${id}-help` : undefined}
      onPointerDown={startDrag} onPointerMove={moveDrag} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        const step = event.shiftKey ? .15 : .035;
        const direction = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (direction && crop) { event.preventDefault(); pan(direction[0]!, direction[1]!); }
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
    {crop && size && <>
      <small id={`${id}-help`}>Drag the photo or use the arrow keys to position it.</small>
      <div className="profile-crop-zoom">
        <label htmlFor={`${id}-zoom`}>Zoom</label>
        <input type="range" id={`${id}-zoom`} min={1} max={maxAvatarZoom} step={.05} value={crop.zoom}
          aria-valuetext={`${Math.round(crop.zoom * 100)}%`} disabled={saving}
          onChange={event => setCrop(boundAvatarCrop(size, { ...crop, zoom: event.currentTarget.valueAsNumber }))} />
        <button type="button" className="secondary" disabled={saving} onClick={() => setCrop(initialAvatarCrop(size))}>Reset crop</button>
      </div>
    </>}
    {(sourceError || saveError) && <p className="error" role="alert">{sourceError || saveError}</p>}
    {saving && <span className="visually-hidden" role="status">Saving profile picture…</span>}
    <div className="profile-crop-actions">
      <button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancel</button>
      <button type="button" className="primary" disabled={!crop || saving} onClick={() => void save()}>
        {saving ? 'Saving picture…' : 'Save picture'}</button>
    </div>
  </dialog>;
}

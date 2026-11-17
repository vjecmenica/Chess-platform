import { useId, useRef, useState } from 'react';
import type { AccountIdentity } from '@chess/contracts';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfilePictureCropDialog } from './ProfilePictureCropDialog';

export function ProfilePictureSettings({ account, disabled, onChange }: {
  account: AccountIdentity; disabled: boolean;
  onChange: (image: Blob | null, owner: string) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();
  const id = useId();
  function closeCrop() {
    setFile(null);
    requestAnimationFrame(() => picker.current?.focus({ preventScroll: true }));
  }
  async function remove() {
    setError(undefined); setRemoving(true);
    try { await onChange(null, account.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove your picture. Try again.'); }
    finally { setRemoving(false); }
  }
  return <section className="profile-picture-settings" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Profile picture</h3>
    <div className="profile-picture-row">
      <ProfileAvatar className="profile-picture-preview" name={account.username} url={account.avatarUrl} />
      <div>
        <input hidden type="file" ref={fileInput} accept="image/jpeg,image/png,image/webp"
          aria-label="Choose profile picture" disabled={disabled} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) { setError(undefined); setFile(file); }
          }} />
        <div className="profile-picture-actions">
          <button ref={picker} type="button" aria-describedby={`${id}-help`} disabled={disabled} onClick={() => fileInput.current?.click()}>
            {account.avatarUrl ? 'Change picture' : 'Upload picture'}</button>
          {account.avatarUrl && <button type="button" className="secondary" disabled={disabled}
            onClick={() => void remove()}>Remove picture</button>}
        </div>
        <small id={`${id}-help`}>Public profile picture. JPEG, PNG or WebP, up to 10 MB before cropping.</small>
      </div>
    </div>
    {removing && <p role="status">Removing picture…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {file && <ProfilePictureCropDialog file={file} onClose={closeCrop} onSave={image => onChange(image, account.id)} />}
  </section>;
}

import { useId, useRef } from 'react';
import type { AccountIdentity } from '@chess/contracts';
import { ProfileAvatar } from './ProfileAvatar';

export function ProfilePictureSettings({ account, disabled, pending, error, onChange }: {
  account: AccountIdentity; disabled: boolean; pending: 'upload' | 'remove' | null;
  error: string | null;
  onChange: (file: File | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  return <section className="profile-picture-settings" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Profile picture</h3>
    <div className="profile-picture-row">
      <ProfileAvatar className="profile-picture-preview" name={account.username} url={account.avatarUrl} />
      <div>
        <input hidden type="file" ref={fileInput} accept="image/jpeg,image/png,image/webp"
          aria-label="Choose profile picture" disabled={disabled} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) onChange(file);
          }} />
        <div className="profile-picture-actions">
          <button type="button" aria-describedby={`${id}-help`} disabled={disabled} onClick={() => fileInput.current?.click()}>
            {account.avatarUrl ? 'Change picture' : 'Upload picture'}</button>
          {account.avatarUrl && <button type="button" className="secondary" disabled={disabled}
            onClick={() => onChange(null)}>Remove picture</button>}
        </div>
        <small id={`${id}-help`}>Public profile picture. JPEG, PNG or WebP, up to 2 MB.</small>
      </div>
    </div>
    {pending && <p role="status">{pending === 'upload' ? 'Uploading picture…' : 'Removing picture…'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

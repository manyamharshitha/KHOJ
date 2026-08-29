import { useRef } from 'react';
import styled from 'styled-components';
import { TextInput } from './dashboardUI';
import Button from '../ui/Button';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(10, 12, 14, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
`;

const Panel = styled.div`
  width: 100%;
  max-width: 380px;
  background: ${({ theme }) => theme.surface};
  border-radius: 14px;
  padding: 1.8rem;
  box-shadow: ${({ theme }) => theme.shadowLg};
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.4rem;
`;

const Title = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.25rem;
  margin: 0;
  color: ${({ theme }) => theme.ink};
`;

const CloseButton = styled.button`
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 50%;
  border: 1px solid ${({ theme }) => theme.rule2};
  background: ${({ theme }) => theme.surface};
  color: ${({ theme }) => theme.muted};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    width: 12px;
    height: 12px;
  }
`;

const AvatarRow = styled.div`
  display: flex;
  align-items: center;
  gap: 1.1rem;
  margin-bottom: 1.6rem;
`;

const AvatarPreview = styled.button`
  width: 4.2rem;
  height: 4.2rem;
  border-radius: 50%;
  background: ${({ theme, $hasImage }) => ($hasImage ? 'transparent' : theme.ink)};
  color: ${({ theme }) => theme.bg};
  border: none;
  cursor: pointer;
  overflow: hidden;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 1.1rem;
  font-weight: 600;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const AvatarActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;

  button {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
  }
`;

const UploadLink = styled.button`
  color: ${({ theme }) => theme.ink};
  text-decoration: underline;
  text-underline-offset: 2px;
`;

const RemoveLink = styled.button`
  color: ${({ theme }) => theme.muted};

  &:hover {
    color: ${({ theme }) => theme.bad};
  }
`;

const Field = styled.div`
  margin-bottom: 1.6rem;

  label {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.muted};
    margin-bottom: 0.5rem;
  }
`;

const initials = (name) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'K';

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ProfileModal = ({ profile, onChange, onClose }) => {
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange({ ...profile, avatar: reader.result });
    reader.readAsDataURL(file);
  };

  return (
    <Overlay onClick={onClose}>
      <Panel onClick={(e) => e.stopPropagation()}>
        <Head>
          <Title>Edit profile</Title>
          <CloseButton onClick={onClose} aria-label="Close">
            <CloseIcon />
          </CloseButton>
        </Head>

        <AvatarRow>
          <AvatarPreview
            type="button"
            $hasImage={!!profile.avatar}
            onClick={() => fileRef.current?.click()}
            aria-label="Change photo"
          >
            {profile.avatar ? <img src={profile.avatar} alt="" /> : initials(profile.name)}
          </AvatarPreview>
          <AvatarActions>
            <UploadLink type="button" onClick={() => fileRef.current?.click()}>
              Upload photo
            </UploadLink>
            {profile.avatar && (
              <RemoveLink type="button" onClick={() => onChange({ ...profile, avatar: null })}>
                Remove photo
              </RemoveLink>
            )}
          </AvatarActions>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
        </AvatarRow>

        <Field>
          <label htmlFor="profile-name">Full name</label>
          <TextInput
            id="profile-name"
            value={profile.name}
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
          />
        </Field>

        <Button full arrow={false} onClick={onClose}>
          Done
        </Button>
      </Panel>
    </Overlay>
  );
};

export default ProfileModal;

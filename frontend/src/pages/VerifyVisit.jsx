/**
 * The page a broker opens from an SMS to record live video proof.
 *
 * Everything about this screen assumes a stranger on a phone, standing in a
 * stairwell, who did not ask to be here. So: no sign-in, no app, no Khoj
 * navigation, one button, and plain language about what is being recorded and
 * why. It is deliberately the least branded page in the product.
 *
 * The link itself is the credential — it arrived by SMS at one number. That is
 * why this page never shows who requested the visit, what the listing is, or
 * anything else about the renter: whoever is holding the phone is, as far as
 * this page knows, unauthenticated.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';

const API = (import.meta.env.VITE_API_URL ?? 'http://localhost:8010').replace(/\/$/, '');

/** How long a proof clip runs. Matches what the SMS promised. */
const CLIP_SECONDS = 120;

const Screen = styled.div`
  min-height: 100vh;
  background: #12110f;
  color: #f4f1ea;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.4rem 1.1rem 2.4rem;
  font-family: 'Inter', system-ui, sans-serif;
`;

const Frame = styled.div`
  width: 100%;
  max-width: 30rem;
`;

const Brand = styled.p`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.55;
  margin: 0 0 1.1rem;
`;

const Title = styled.h1`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.5rem;
  line-height: 1.25;
  margin: 0 0 0.5rem;
`;

const Address = styled.p`
  font-size: 0.95rem;
  opacity: 0.85;
  margin: 0 0 1rem;
`;

const Note = styled.p`
  font-size: 0.85rem;
  line-height: 1.55;
  opacity: 0.65;
  margin: 0 0 1.4rem;
`;

const Preview = styled.video`
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  background: #000;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
`;

const Timer = styled.div`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 2rem;
  text-align: center;
  margin: 1rem 0 0.3rem;
  color: ${({ $low }) => ($low ? '#ffb4a2' : '#f4f1ea')};
`;

const Bar = styled.div`
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
  margin-bottom: 1.2rem;

  span {
    display: block;
    height: 100%;
    width: ${({ $pct }) => $pct}%;
    background: #e8dcc8;
    transition: width 0.9s linear;
  }
`;

const Button = styled.button`
  width: 100%;
  font: inherit;
  font-size: 1rem;
  font-weight: 500;
  padding: 1rem;
  border-radius: 999px;
  border: none;
  background: #f4f1ea;
  color: #12110f;
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const Ghost = styled(Button)`
  background: transparent;
  color: #f4f1ea;
  border: 1px solid rgba(255, 255, 255, 0.28);
  margin-top: 0.7rem;
`;

const Status = styled.div`
  border-radius: 12px;
  padding: 1.1rem 1.2rem;
  margin-bottom: 1.2rem;
  font-size: 0.88rem;
  line-height: 1.55;
  background: ${({ $tone }) =>
    $tone === 'bad' ? 'rgba(255, 120, 100, 0.14)' : 'rgba(255, 255, 255, 0.08)'};
  border: 1px solid
    ${({ $tone }) => ($tone === 'bad' ? 'rgba(255, 120, 100, 0.4)' : 'rgba(255,255,255,0.14)')};
`;

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * The device's position, or null.
 *
 * Never rejects: a refused permission and an indoor fix that never resolves are
 * the same outcome here — no coordinates. The video is still worth having, and
 * the server records it as received-but-unchecked rather than failing the
 * broker for a sensor they do not control.
 */
const getPosition = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });

const VerifyVisit = () => {
  const { token } = useParams();
  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const [context, setContext] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | recording | uploading | done | error
  const [left, setLeft] = useState(CLIP_SECONDS);
  const [problem, setProblem] = useState(null);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API}/api/visits/token/${token}`);
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setLoadError(body.detail || 'This link is not valid.');
          return;
        }
        setContext(body);
      } catch {
        if (alive) setLoadError('Could not reach the server. Check your connection.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  // Release the camera on unmount. Without this the indicator light stays on
  // after the tab is closed, which is alarming and rightly so.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const upload = useCallback(
    async (blob, seconds) => {
      setPhase('uploading');
      const position = await getPosition();

      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      form.append('video', blob, `visit.${ext}`);
      form.append('seconds', String(seconds));
      if (position) {
        form.append('lat', String(position.lat));
        form.append('lng', String(position.lng));
      }

      try {
        const res = await fetch(`${API}/api/visits/token/${token}/upload`, {
          method: 'POST',
          body: form,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setProblem(body.detail || 'The upload was refused.');
          setPhase('error');
          return;
        }
        setOutcome(body);
        setPhase('done');
      } catch {
        setProblem('The upload failed. Please check your connection and try again.');
        setPhase('error');
      }
    },
    [token],
  );

  const start = useCallback(async () => {
    setProblem(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera: this is a video of a property, not of a face.
        video: { facingMode: { ideal: 'environment' } },
        audio: true,
      });
    } catch {
      setProblem(
        'Khoj could not open the camera. Allow camera access in your browser and try again.',
      );
      setPhase('error');
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;

    // Ask for location while recording rather than before: the fix improves
    // over the two minutes, and asking for two permissions before anything
    // visible happens is where people give up.
    void getPosition();

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      void upload(blob, CLIP_SECONDS - left);
    };

    recorder.start();
    setPhase('recording');
    setLeft(CLIP_SECONDS);
  }, [left, upload]);

  // The countdown, and the automatic stop at zero.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    if (left <= 0) {
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      return undefined;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, left]);

  const stopEarly = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  if (loadError) {
    return (
      <Screen>
        <Frame>
          <Brand>Khoj</Brand>
          <Status $tone="bad">{loadError}</Status>
          <Note>
            If you received this by SMS and it has stopped working, the request may already
            have been completed. You can safely ignore this message.
          </Note>
        </Frame>
      </Screen>
    );
  }

  return (
    <Screen>
      <Frame>
        <Brand>Khoj · verification</Brand>

        {phase === 'done' ? (
          <>
            <Title>Thank you — video received.</Title>
            <Note>
              {outcome?.verified
                ? 'The location matched the property address. Nothing further is needed.'
                : 'It has been passed to the person who asked for it. Nothing further is needed.'}
            </Note>
          </>
        ) : (
          <>
            <Title>Please record a short video here</Title>
            {context?.address && <Address>{context.address}</Address>}
            <Note>
              A prospective tenant has asked for live proof that this property exists and is
              available. Walk through it for two minutes. Your location is recorded with the
              video and is shared only as a yes/no match against the address — never your live
              position, and never afterwards.
            </Note>
          </>
        )}

        {problem && <Status $tone="bad">{problem}</Status>}

        {phase !== 'done' && (
          <>
            <Preview ref={videoRef} autoPlay playsInline muted />
            {phase === 'recording' && (
              <>
                <Timer $low={left <= 15}>{clock(left)}</Timer>
                <Bar $pct={((CLIP_SECONDS - left) / CLIP_SECONDS) * 100}>
                  <span />
                </Bar>
              </>
            )}
          </>
        )}

        {phase === 'idle' && <Button onClick={start}>Start recording</Button>}
        {phase === 'recording' && (
          <Ghost onClick={stopEarly}>
            {left > CLIP_SECONDS - 10 ? 'Cancel' : 'Finish early and send'}
          </Ghost>
        )}
        {phase === 'uploading' && <Button disabled>Sending…</Button>}
        {phase === 'error' && <Button onClick={start}>Try again</Button>}
      </Frame>
    </Screen>
  );
};

export default VerifyVisit;

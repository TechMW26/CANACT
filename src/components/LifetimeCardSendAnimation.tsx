'use client';

import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import styles from './LifetimeCardSendAnimation.module.css';

type CardRect = { left: number; top: number; width: number; height: number; naturalWidth: number; naturalHeight: number };
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  width: number;
  height: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  circle: boolean;
  opacity: number;
};
type ReceiveCard = {
  id: string;
  group: 'connection' | 'lifetime';
  label: string;
  renderCard: (className: string, style: CSSProperties) => ReactNode;
};

const audioCache = new Map<string, AudioBuffer>();
let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    if (!sharedAudioCtx) {
      const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) sharedAudioCtx = new Ctor();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

async function preloadAudio(url: string): Promise<AudioBuffer | null> {
  if (audioCache.has(url)) return audioCache.get(url)!;
  const context = getAudioCtx();
  if (!context) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    audioCache.set(url, buffer);
    return buffer;
  } catch {
    return null;
  }
}

function playCardSound(url: string) {
  const play = (buffer: AudioBuffer) => {
    const context = getAudioCtx();
    if (!context) return;
    if (context.state === 'suspended') void context.resume();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = .64;
    source.connect(gain).connect(context.destination);
    source.start();
  };
  const cached = audioCache.get(url);
  if (cached) play(cached);
  else void preloadAudio(url).then((buffer) => { if (buffer) play(buffer); });
}

if (typeof window !== 'undefined') {
  void preloadAudio('/sounds/lifetime-card.mp3');
  void preloadAudio('/sounds/connection-card.mp3');
}

export function LifetimeCardSendAnimation({
  sourceRect,
  renderCard,
  onComplete,
  ariaLabel = 'Sending card',
  tone = 'connection',
  direction = 'send',
  presentationKey,
  receiveCards,
}: {
  sourceRect: CardRect;
  renderCard: (className: string, style: CSSProperties) => ReactNode;
  onComplete: () => void;
  ariaLabel?: string;
  tone?: 'connection' | 'lifetime';
  direction?: 'send' | 'receive';
  presentationKey?: string;
  receiveCards?: ReceiveCard[];
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dismissRef = useRef<(() => void) | null>(null);
  const completeRef = useRef(onComplete);
  const completedRef = useRef(false);
  const [receiveReady, setReceiveReady] = useState(false);
  const [activeCard, setActiveCard] = useState(0);
  const swipeStartRef = useRef<number | null>(null);

  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);

  const geometry = useMemo(() => {
    const viewportWidth = typeof window === 'undefined' ? 390 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 844 : window.innerHeight;
    const naturalWidth = Math.max(1, sourceRect.naturalWidth);
    const naturalHeight = Math.max(1, sourceRect.naturalHeight);
    const displayWidth = Math.min(620, viewportWidth - 28, naturalWidth);
    return {
      naturalWidth,
      naturalHeight,
      targetScale: displayWidth / naturalWidth,
      sourceScale: sourceRect.width / naturalWidth,
      sourceX: sourceRect.left + sourceRect.width / 2 - viewportWidth / 2,
      sourceY: sourceRect.top + sourceRect.height / 2 - viewportHeight / 2,
      viewportHeight,
    };
  }, [sourceRect.height, sourceRect.left, sourceRect.naturalHeight, sourceRect.naturalWidth, sourceRect.top, sourceRect.width]);

  useEffect(() => {
    setActiveCard((current) => Math.min(current, Math.max(0, (receiveCards?.length ?? 1) - 1)));
  }, [receiveCards?.length]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const card = cardRef.current;
    const glow = glowRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !card || !glow || !canvas) return;

    completedRef.current = false;
    setReceiveReady(false);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = (value: number) => reducedMotion ? .01 : value;
    const context = canvas.getContext('2d');
    let confettiFrame = 0;
    let particles: Particle[] = [];
    const colors = tone === 'lifetime'
      ? ['#fff7c9', '#f8d15a', '#d99a16', '#fff0a1', '#bd7410', '#ffffff']
      : ['#1f6b55', '#8ab9a5', '#e7e1d1', '#d9ad45', '#7560a8', '#ffffff'];

    const finishOnce = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      completeRef.current();
    };

    const resizeCanvas = () => {
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const stopConfetti = () => {
      cancelAnimationFrame(confettiFrame);
      confettiFrame = 0;
      particles = [];
      context?.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };

    const startConfetti = () => {
      if (!context) return;
      stopConfetti();
      const count = reducedMotion ? 24 : window.innerWidth < 768 ? 70 : 110;
      const centreX = window.innerWidth / 2;
      const centreY = window.innerHeight / 2;
      particles = Array.from({ length: count }, (_, index) => {
        const angle = Math.PI * (1.08 + Math.random() * .84);
        const speed = 2.8 + Math.random() * 6.4;
        return {
          x: centreX + (Math.random() - .5) * Math.min(260, window.innerWidth * .55),
          y: centreY + (Math.random() - .5) * 38 + (index % 3) * 3,
          vx: Math.cos(angle) * speed + (Math.random() - .5) * 1.8,
          vy: Math.sin(angle) * speed - 1.8,
          gravity: .075 + Math.random() * .065,
          width: 5 + Math.random() * 7,
          height: 7 + Math.random() * 10,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: -.16 + Math.random() * .32,
          color: colors[Math.floor(Math.random() * colors.length)]!,
          circle: Math.random() > .8,
          opacity: .84 + Math.random() * .16,
        };
      });
      const startedAt = performance.now();
      const draw = (now: number) => {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        const elapsed = now - startedAt;
        for (const particle of particles) {
          particle.vy += particle.gravity;
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.rotation += particle.rotationSpeed;
          context.save();
          context.globalAlpha = particle.opacity * Math.max(0, 1 - elapsed / 1650);
          context.translate(particle.x, particle.y);
          context.rotate(particle.rotation);
          context.fillStyle = particle.color;
          if (particle.circle) {
            context.beginPath();
            context.arc(0, 0, particle.width * .52, 0, Math.PI * 2);
            context.fill();
          } else {
            context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
          }
          context.restore();
        }
        if (elapsed < 1650) confettiFrame = requestAnimationFrame(draw);
        else stopConfetti();
      };
      confettiFrame = requestAnimationFrame(draw);
    };

    resizeCanvas();
    const sound = tone === 'lifetime' ? '/sounds/lifetime-card.mp3' : '/sounds/connection-card.mp3';
    const timeline = gsap.timeline({ paused: true, defaults: { overwrite: 'auto' } });
    gsap.set(overlay, { opacity: 0, visibility: 'visible' });
    gsap.set(glow, { opacity: 0, scale: .55, force3D: true });

    if (direction === 'receive') {
      const presentationStorageKey = presentationKey ? `canact:card-reveal-played:${presentationKey}` : '';
      let introAlreadyPlayed = false;
      if (presentationStorageKey) {
        try {
          introAlreadyPlayed = window.sessionStorage.getItem(presentationStorageKey) === '1';
        } catch { /* session storage can be unavailable */ }
      }
      const playIntroOnce = () => {
        if (presentationStorageKey) {
          try {
            if (window.sessionStorage.getItem(presentationStorageKey) === '1') return;
            window.sessionStorage.setItem(presentationStorageKey, '1');
          } catch { /* session storage can be unavailable */ }
        }
        playCardSound(sound);
        startConfetti();
      };
      gsap.set(card, {
        xPercent: -50,
        yPercent: -50,
        x: 0,
        y: 22,
        scale: geometry.targetScale * .82,
        rotation: -1.5,
        opacity: 0,
        force3D: true,
      });
      if (introAlreadyPlayed) {
        timeline
          .set(overlay, { opacity: 1 })
          .set(glow, { opacity: 1, scale: 1 })
          .set(card, { y: 0, scale: geometry.targetScale, rotation: 0, opacity: 1 })
          .call(() => setReceiveReady(true));
      } else {
        timeline
          .to(overlay, { duration: duration(.18), opacity: 1, ease: 'power1.out' })
          .call(playIntroOnce, undefined, '<.02')
          .to(glow, { duration: duration(.48), opacity: 1, scale: 1, ease: 'power2.out' }, '<')
          .to(card, { duration: duration(.52), y: 0, scale: geometry.targetScale, rotation: 0, opacity: 1, ease: 'back.out(1.35)' }, '<.03')
          .call(() => setReceiveReady(true));
      }

      dismissRef.current = () => {
        setReceiveReady(false);
        gsap.timeline({ defaults: { overwrite: 'auto' }, onComplete: finishOnce })
          .to(card, { duration: duration(.24), y: 18, scale: geometry.targetScale * .94, opacity: 0, ease: 'power2.in' })
          .to(glow, { duration: duration(.2), opacity: 0, scale: 1.12, ease: 'power1.in' }, '<')
          .to(overlay, { duration: duration(.18), opacity: 0, ease: 'power1.in' }, '<.05');
      };
    } else {
      gsap.set(card, {
        xPercent: -50,
        yPercent: -50,
        x: geometry.sourceX,
        y: geometry.sourceY,
        scale: geometry.sourceScale,
        rotation: 0,
        opacity: 1,
        force3D: true,
      });
      timeline
        .to(overlay, { duration: duration(.12), opacity: 1, ease: 'power1.out' })
        .to(card, { duration: duration(.36), x: 0, y: 0, scale: geometry.targetScale, ease: 'power3.out' }, '<')
        .to(glow, { duration: duration(.28), opacity: 1, scale: 1, ease: 'power2.out' }, '<.08')
        .call(() => { playCardSound(sound); startConfetti(); })
        .to(card, { duration: duration(.46), y: -geometry.viewportHeight * .72, scale: geometry.targetScale * .74, rotation: -3, opacity: 0, ease: 'power3.in' }, '+=.12')
        .to(glow, { duration: duration(.34), opacity: 0, scale: 1.3, ease: 'power2.in' }, '<')
        .to(overlay, { duration: duration(.16), opacity: 0, ease: 'power1.in' }, '<.18')
        .call(finishOnce);
    }

    requestAnimationFrame(() => requestAnimationFrame(() => timeline.play(0)));
    return () => {
      dismissRef.current = null;
      timeline.kill();
      stopConfetti();
      gsap.killTweensOf([overlay, card, glow]);
    };
  }, [direction, geometry, tone]);

  const dismissReceive = useCallback(() => dismissRef.current?.(), []);
  const cardCount = receiveCards?.length ?? 0;
  const activeGroup = receiveCards?.[activeCard]?.group;
  const groups = useMemo(() => (['connection', 'lifetime'] as const).flatMap((group) => {
    const indices = (receiveCards ?? []).flatMap((card, index) => card.group === group ? [index] : []);
    return indices.length ? [{ group, indices }] : [];
  }), [receiveCards]);
  const groupIndices = groups.find((item) => item.group === activeGroup)?.indices ?? [];
  const groupPosition = Math.max(0, groupIndices.indexOf(activeCard)) + 1;
  const selectCard = useCallback((next: number) => {
    setActiveCard(Math.max(0, Math.min(cardCount - 1, next)));
  }, [cardCount]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-tone={tone}
      data-direction={direction}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      onClick={(event) => { if (direction === 'receive' && cardCount <= 1 && event.target === event.currentTarget) dismissReceive(); }}
    >
      <canvas ref={canvasRef} className={styles.confetti} aria-hidden="true" />
      <div className={styles.stage}>
        <div ref={glowRef} className={styles.glow} aria-hidden="true" />
        <div
          ref={cardRef}
          className={styles.cardHost}
          data-receive-stack={direction === 'receive' && cardCount > 0 ? 'true' : undefined}
          style={{ width: geometry.naturalWidth, height: geometry.naturalHeight }}
          onPointerDown={(event) => { if (direction === 'receive' && cardCount > 1) swipeStartRef.current = event.clientX; }}
          onPointerUp={(event) => {
            const start = swipeStartRef.current;
            swipeStartRef.current = null;
            if (start === null || Math.abs(event.clientX - start) < 36) return;
            selectCard(activeCard + (event.clientX < start ? 1 : -1));
          }}
          onPointerCancel={() => { swipeStartRef.current = null; }}
        >
          {direction === 'receive' && receiveCards?.length ? receiveCards.map((item, index) => {
            const distance = index - activeCard;
            const visible = Math.abs(distance) <= 2;
            return (
              <div
                key={item.id}
                className={styles.stackCard}
                data-active={distance === 0 ? 'true' : undefined}
                aria-hidden={distance !== 0}
                style={{
                  zIndex: 20 - Math.abs(distance),
                  opacity: visible ? (distance === 0 ? 1 : .38) : 0,
                  transform: `translate3d(${distance * 14}px, ${Math.abs(distance) * 8}px, 0) scale(${1 - Math.min(2, Math.abs(distance)) * .035})`,
                }}
              >
                {item.renderCard(styles.cardLayer, { width: geometry.naturalWidth, height: geometry.naturalHeight })}
              </div>
            );
          }) : renderCard(styles.cardLayer, { width: geometry.naturalWidth, height: geometry.naturalHeight })}
          {direction === 'receive' && receiveReady && cardCount > 1 ? (
            <div className={styles.receiveNavigator} aria-label="Received cards">
              <div className={styles.receiveGroups} data-count={groups.length} data-active={activeGroup}>
                {groups.map(({ group, indices }) => (
                  <button key={group} type="button" data-active={group === activeGroup ? 'true' : undefined} onClick={() => selectCard(indices[0]!)}>
                    {group === 'connection' ? 'Connection' : 'Lifetime'} · {indices.length}
                  </button>
                ))}
              </div>
              <div className={styles.receiveControls}>
                <button type="button" onClick={() => selectCard(activeCard - 1)} disabled={activeCard === 0} aria-label="Previous card">‹</button>
                <span><strong>{receiveCards?.[activeCard]?.label}</strong>{groupPosition} of {groupIndices.length} {activeGroup === 'lifetime' ? 'lifetime' : 'connection'}</span>
                <button type="button" onClick={() => selectCard(activeCard + 1)} disabled={activeCard === cardCount - 1} aria-label="Next card">›</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {direction === 'receive' && receiveReady ? (
        <button
          type="button"
          className={styles.receiveClose}
          onClick={dismissReceive}
          aria-label="Close received cards"
        >
          Done
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

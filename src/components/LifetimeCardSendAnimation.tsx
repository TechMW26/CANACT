'use client';

import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import styles from './LifetimeCardSendAnimation.module.css';

type CardRect = { left: number; top: number; width: number; height: number; naturalWidth: number; naturalHeight: number };

export function LifetimeCardSendAnimation({
  sourceRect,
  renderCard,
  onComplete,
  ariaLabel = 'Sending lifetime card',
  tone = 'connection',
  direction = 'send',
}: {
  sourceRect: CardRect;
  renderCard: (className: string, style: CSSProperties) => ReactNode;
  onComplete: () => void;
  ariaLabel?: string;
  tone?: 'connection' | 'lifetime';
  direction?: 'send' | 'receive';
}) {
  const mailerRef = useRef<HTMLDivElement | null>(null);
  const envelopeRef = useRef<HTMLDivElement | null>(null);
  const flapRef = useRef<HTMLDivElement | null>(null);
  const cardBehindRef = useRef<HTMLDivElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);
  const trailsRef = useRef<HTMLDivElement | null>(null);
  const raysRef = useRef<HTMLDivElement | null>(null);
  const shineRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dismissReceiveRef = useRef<(() => void) | null>(null);
  const [receiveReady, setReceiveReady] = useState(false);

  const geometry = useMemo(() => {
    const viewportWidth = typeof window === 'undefined' ? 390 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 844 : window.innerHeight;
    const initialMailerY = Math.max(viewportHeight * .72, 520);
    const envelopeWidth = Math.min(Math.max(240, sourceRect.width), Math.max(240, viewportWidth - 32));
    const envelopeHeight = sourceRect.height * (envelopeWidth / Math.max(sourceRect.width, 1));
    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    return {
      initialMailerY,
      envelopeWidth,
      envelopeHeight,
      sourceX: sourceCenterX - viewportWidth / 2,
      sourceY: sourceCenterY - viewportHeight / 2 - initialMailerY,
    };
  }, [sourceRect]);

  const initialCardStyle = {
    width: sourceRect.naturalWidth,
    height: sourceRect.naturalHeight,
    transform: `translate(-50%, -50%) translate3d(${geometry.sourceX}px, ${geometry.sourceY}px, 0) scale(${sourceRect.width / sourceRect.naturalWidth})`,
  } satisfies CSSProperties;

  useEffect(() => {
    setReceiveReady(false);
    const mailer = mailerRef.current;
    const envelope = envelopeRef.current;
    const flap = flapRef.current;
    const cardBehind = cardBehindRef.current?.firstElementChild as HTMLElement | null;
    const groundShadow = shadowRef.current;
    const speedTrails = trailsRef.current;
    const rays = raysRef.current;
    const shine = shineRef.current;
    const canvas = canvasRef.current;
    if (!mailer || !envelope || !flap || !cardBehind || !groundShadow || !speedTrails || !rays || !shine || !canvas) return;

    const cards = [cardBehind];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = (normal: number) => reducedMotion ? .01 : normal;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const initialMailerY = Math.max(viewportHeight * .72, 520);
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const targetEnvelopeCenterY = direction === 'receive'
      ? viewportHeight / 2
      : Math.min(viewportHeight * .62, sourceRect.top + sourceRect.height + 72);
    const restingMailerY = targetEnvelopeCenterY - viewportHeight / 2;
    const cardRestingLocalY = sourceCenterY - targetEnvelopeCenterY;
    const sourceX = sourceRect.left + sourceRect.width / 2 - viewportWidth / 2;
    const sourceY = sourceCenterY - viewportHeight / 2 - initialMailerY;
    const sourceScale = sourceRect.width / sourceRect.naturalWidth;
    const fullScale = geometry.envelopeWidth / sourceRect.naturalWidth;
    const insideScale = fullScale * .94;
    const revealLift = Math.max(108, geometry.envelopeHeight * .62);
    const launchHeight = Math.max(viewportHeight, 720);
    let confettiFrame = 0;
    let particles: Array<{ x: number; y: number; width: number; height: number; vx: number; vy: number; gravity: number; rotation: number; rotationSpeed: number; sway: number; swayOffset: number; color: string; circle: boolean; opacity: number }> = [];
    const context = canvas.getContext('2d');
    const colors = tone === 'lifetime'
      ? ['#fff7c9', '#f8d15a', '#d99a16', '#fff0a1', '#bd7410', '#ffffff']
      : ['#1f6b55', '#8ab9a5', '#e7e1d1', '#d9ad45', '#7560a8', '#ffffff'];

    function resizeCanvas() {
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(window.innerWidth * ratio);
      canvas!.height = Math.round(window.innerHeight * ratio);
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function createParticle(index = 0) {
      return {
        x: Math.random() * window.innerWidth,
        y: -30 - Math.random() * 180 - index * .9,
        width: 5 + Math.random() * 7,
        height: 8 + Math.random() * 11,
        vx: -1.15 + Math.random() * 2.3,
        vy: 2.35 + Math.random() * 3.7,
        gravity: .012 + Math.random() * .018,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: -.13 + Math.random() * .26,
        sway: .5 + Math.random() * 1.4,
        swayOffset: Math.random() * Math.PI * 2,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        circle: Math.random() > .78,
        opacity: .82 + Math.random() * .18,
      };
    }

    function stopConfetti() {
      cancelAnimationFrame(confettiFrame);
      confettiFrame = 0;
      particles = [];
      context?.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    function startConfetti(onFinished?: () => void) {
      if (!context) { onFinished?.(); return; }
      stopConfetti();
      particles = Array.from({ length: reducedMotion ? 45 : 145 }, (_, index) => createParticle(index));
      const startedAt = performance.now();
      const draw = (now: number) => {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        particles.forEach((particle, index) => {
          particle.vy += particle.gravity;
          particle.y += particle.vy;
          particle.x += particle.vx + Math.sin(now * .004 + particle.swayOffset) * particle.sway;
          particle.rotation += particle.rotationSpeed;
          context.save();
          context.globalAlpha = particle.opacity;
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
          if (particle.y > window.innerHeight + 40 && now - startedAt < 2350) {
            particles[index] = createParticle(index % 18);
            particles[index]!.y = -25 - Math.random() * 65;
          }
        });
        if (now - startedAt < 3000) confettiFrame = requestAnimationFrame(draw);
        else { stopConfetti(); onFinished?.(); }
      };
      confettiFrame = requestAnimationFrame(draw);
    }

    function playSwish() {
      if (reducedMotion || direction !== 'send') return;
      try {
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        const audio = new AudioContextClass();
        const length = Math.floor(audio.sampleRate * .34);
        const buffer = audio.createBuffer(1, length, audio.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let index = 0; index < length; index += 1) channel[index] = (Math.random() * 2 - 1) * (1 - index / length);
        const source = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const gain = audio.createGain();
        source.buffer = buffer;
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(420, audio.currentTime);
        filter.frequency.exponentialRampToValueAtTime(3400, audio.currentTime + .25);
        filter.Q.value = .7;
        gain.gain.setValueAtTime(.0001, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(.16, audio.currentTime + .045);
        gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .34);
        source.connect(filter).connect(gain).connect(audio.destination);
        source.onended = () => { void audio.close(); };
        source.start();
      } catch { /* Audio is enhancement-only and may be blocked by the OS. */ }
    }

    resizeCanvas();
    gsap.set(mailer, { xPercent: -50, yPercent: -50, x: 0, y: initialMailerY, rotation: 0, scale: 1, opacity: 1, visibility: 'visible', force3D: true });
    gsap.set(cards, { xPercent: -50, yPercent: -50, x: sourceX, y: sourceY, scale: sourceScale, rotation: 0, opacity: 1, visibility: 'visible', force3D: true });
    gsap.set(cardBehind, { opacity: direction === 'receive' ? 0 : 1 });
    gsap.set(envelope, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, force3D: true });
    gsap.set(flap, { rotateX: 180, transformOrigin: 'top center', zIndex: 2, force3D: true });
    gsap.set(groundShadow, { xPercent: -50, scaleX: .42, scaleY: .7, opacity: 0, force3D: true });
    gsap.set(speedTrails, { opacity: 0, scaleY: .4, y: 20, force3D: true });
    gsap.set(rays, { opacity: 0, scale: .35, rotation: -12, force3D: true });
    gsap.set(shine, { opacity: direction === 'receive' ? 1 : 0 });

    let motionFinished = false;
    let confettiFinished = direction === 'receive';
    const finishSendWhenComplete = () => {
      if (direction === 'send' && motionFinished && confettiFinished) onComplete();
    };
    const timeline = gsap.timeline({
      paused: true,
      defaults: { overwrite: 'auto' },
      onComplete: () => {
        if (direction === 'receive') setReceiveReady(true);
        else { motionFinished = true; finishSendWhenComplete(); }
      },
    });
    if (direction === 'receive') {
      const envelopeParts = [envelope.querySelector(`.${styles.envelopeBack}`), flap, envelope.querySelector(`.${styles.right}`), envelope.querySelector(`.${styles.bottom}`), envelope.querySelector(`.${styles.left}`), shine].filter(Boolean);
      gsap.set(mailer, { y: -launchHeight * .72, opacity: 0, scale: .82 });
      gsap.set(cards, { x: 0, y: 12, scale: insideScale, opacity: 0 });
      gsap.set(flap, { rotateX: 0, zIndex: 10 });
      timeline
        .to(mailer, { duration: duration(.42), y: restingMailerY, opacity: 1, scale: 1, rotation: 0, ease: 'power3.out' })
        .to(groundShadow, { duration: duration(.3), opacity: 1, scaleX: 1, scaleY: 1, ease: 'power2.out' }, '<.08')
        .to(shine, { duration: duration(.12), opacity: 0, ease: 'power1.out' })
        .to(flap, { duration: duration(.36), rotateX: 180, zIndex: 2, ease: 'power2.inOut' })
        .set(cardBehind, { opacity: 1 })
        .to(cardBehind, { duration: duration(.5), y: -revealLift, scale: fullScale, ease: 'power3.out' })
        .to(envelopeParts, { duration: duration(.24), y: 34, opacity: 0, ease: 'power2.in' }, '<.3')
        .to(groundShadow, { duration: duration(.24), opacity: 0, scaleX: .5, ease: 'power2.in' }, '<')
        .to(cardBehind, { duration: duration(.34), y: 0, ease: 'power2.inOut' }, '<.08')
        .call(() => startConfetti());

      dismissReceiveRef.current = () => {
        setReceiveReady(false);
        gsap.timeline({ defaults: { overwrite: 'auto' }, onComplete })
          .to(envelopeParts, { duration: duration(.24), y: 0, opacity: 1, ease: 'power2.out' })
          .to(cardBehind, { duration: duration(.42), y: 10, scale: insideScale, ease: 'power3.inOut' }, '<')
          .to(flap, { duration: duration(.32), rotateX: 0, zIndex: 10, ease: 'power2.inOut' })
          .set(cardBehind, { opacity: 0 })
          .to(speedTrails, { duration: duration(.08), opacity: .8, scaleY: 1, y: 0, ease: 'power1.out' })
          .call(playSwish)
          .to(mailer, { duration: duration(.44), y: -launchHeight, scale: .8, opacity: 0, ease: 'power3.in' })
          .to(speedTrails, { duration: duration(.2), opacity: 0, scaleY: 1.6, ease: 'power2.in' }, '<.12');
      };
    } else {
      timeline
        .to({}, { duration: duration(.08) })
        .to(mailer, { duration: duration(.56), y: restingMailerY, ease: 'power3.out' })
        .to(cards, { duration: duration(.56), y: cardRestingLocalY, ease: 'power3.out' }, '<')
        .to(groundShadow, { duration: duration(.38), opacity: 1, scaleX: 1, scaleY: 1, ease: 'power2.out' }, '<.1')
        .set(cardBehind, { opacity: 1 })
        .to(cards, { duration: duration(.2), y: cardRestingLocalY - 20, scale: Math.min(sourceScale, insideScale), ease: 'power2.out' })
        .to(cards, { duration: duration(.48), y: 10, scale: insideScale, ease: 'power3.inOut' })
        .to(flap, { duration: duration(.36), rotateX: 0, zIndex: 10, ease: 'power2.inOut' })
        .set(cards, { opacity: 0 })
        .to(shine, { duration: duration(.16), opacity: 1, ease: 'power1.out' })
        .to(rays, { duration: duration(.28), opacity: tone === 'lifetime' ? .9 : .34, scale: 1, rotation: 4, ease: 'power2.out' }, '<')
        .call(() => startConfetti(() => {
          confettiFinished = true;
          finishSendWhenComplete();
        }))
        .call(playSwish)
        .to(speedTrails, { duration: duration(.08), opacity: .86, scaleY: 1, y: 0, ease: 'power1.out' })
        .to(mailer, { duration: duration(.46), y: -launchHeight, rotation: 0, scale: .78, opacity: 0, ease: 'power3.in' })
        .to(speedTrails, { duration: duration(.25), opacity: 0, scaleY: 1.7, ease: 'power2.in' }, '<.12')
        .to(rays, { duration: duration(.3), opacity: 0, scale: 1.35, ease: 'power2.in' }, '<')
        .to(groundShadow, { duration: duration(.22), opacity: 0, scaleX: .2, scaleY: .2, ease: 'power2.in' }, '<')
        .to({}, { duration: duration(.35) });
    }

    requestAnimationFrame(() => timeline.play(0));
    return () => {
      dismissReceiveRef.current = null;
      timeline.kill();
      stopConfetti();
      gsap.killTweensOf([cards, mailer, envelope, flap, groundShadow, speedTrails, rays]);
    };
  }, [direction, geometry.envelopeHeight, geometry.envelopeWidth, onComplete, sourceRect, tone]);

  const dismissReceive = useCallback(() => dismissReceiveRef.current?.(), []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className={styles.overlay} data-tone={tone} role="status" aria-live="polite" aria-label={ariaLabel}>
      <canvas ref={canvasRef} className={styles.confetti} />
      <div className={styles.stage}>
        <div ref={shadowRef} className={styles.groundShadow} />
        <div
          ref={mailerRef}
          className={styles.mailer}
          style={{
            width: geometry.envelopeWidth,
            height: geometry.envelopeHeight,
            transform: `translate(-50%, -50%) translate3d(0, ${geometry.initialMailerY}px, 0)`,
          }}
        >
          <div ref={raysRef} className={styles.rays} aria-hidden="true" style={{ width: Math.max(520, geometry.envelopeWidth * 1.3), height: Math.max(520, geometry.envelopeWidth * 1.3) }} />
          <div ref={trailsRef} className={styles.speedTrails} aria-hidden="true"><span /><span /><span /><span /><span /></div>
          <div ref={envelopeRef} className={styles.envelope}>
            <div className={styles.envelopeBack} />
            <div ref={flapRef} className={styles.flap} />
            <div ref={cardBehindRef}>{renderCard(`${styles.cardLayer} ${styles.cardBehind}`, initialCardStyle)}</div>
            <div className={styles.right} />
            <div className={styles.bottom} />
            <div className={styles.left} />
            <div ref={shineRef} className={styles.envelopeShine} />
          </div>
        </div>
      </div>
      {direction === 'receive' && receiveReady ? (
        <button type="button" className={styles.receiveClose} onClick={dismissReceive} aria-label="Close received card">Done</button>
      ) : null}
    </div>,
    document.body,
  );
}

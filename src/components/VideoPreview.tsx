'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from './icons';

/** A controlled preview surface for a captured/imported video.
 *  Shows a tap-to-play/pause overlay and a mute toggle pill.
 *  Plays the video at its native quality (object-contain) so we never
 *  upscale a low-res frame. */
export function VideoPreview({
  src,
  className = '',
  style,
  fit = 'cover',
  initialMuted = true,
  loop = true,
  autoPlay = true,
  rounded = '',
  poster,
}: {
  src: string;
  className?: string;
  style?: React.CSSProperties;
  fit?: 'cover' | 'contain';
  initialMuted?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  rounded?: string;
  /** Optional poster image; falls back to themed placeholder so the
   *  browser never shows its black play-triangle default. */
  poster?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(initialMuted);
  const [playing, setPlaying] = useState(autoPlay);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, []);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
    setShowHint(true);
    setTimeout(() => setShowHint(false), 600);
  };

  return (
    <div className={`relative overflow-hidden bg-brand-light/40 ${rounded} ${className}`} style={style}>
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? '/video-poster.svg'}
        autoPlay={autoPlay}
        loop={loop}
        playsInline
        preload="metadata"
        muted={muted}
        onClick={toggle}
        className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
      />

      {/* Mute toggle (top right) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMuted((m) => !m);
        }}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
      >
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>

      {/* Play/Pause hint pulse */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity ${
          showHint || !playing ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </span>
      </button>
    </div>
  );
}

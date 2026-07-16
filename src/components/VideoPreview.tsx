'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Pause, Play, Volume2, VolumeX } from './icons';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => { setPlaying(true); setLoading(false); };
    const onPause = () => setPlaying(false);
    const onCanPlay = () => setLoading(false);
    const onError = () => { setError(true); setLoading(false); };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('error', onError);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('error', onError);
    };
  }, [retryKey]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
    setShowHint(true);
    setTimeout(() => setShowHint(false), 600);
  };

  return (
    <div className={`relative overflow-hidden bg-[#0E0E10] ${rounded} ${className}`} style={style}>
      {/* Error state */}
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0E0E10] text-white/60">
          <AlertTriangle size={24} />
          <span className="text-xs font-semibold">Failed to load media</span>
          <button
            type="button"
            onClick={() => { setError(false); setLoading(true); setRetryKey((k) => k + 1); }}
            className="mt-1 rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white hover:bg-white/25 transition"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Loading skeleton */}
          {loading && (
            <div className="absolute inset-0 animate-pulse bg-[#1A1A1E]">
              <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-white/[0.02]" />
            </div>
          )}

          <video
            ref={videoRef}
            key={retryKey}
            src={src}
            poster={poster ?? '/video-poster.svg'}
            autoPlay={autoPlay}
            loop={loop}
            playsInline
            preload="metadata"
            muted={muted}
            onClick={toggle}
            className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${loading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
          />

          {/* Mute toggle (top right) */}
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
            }}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </span>

          {/* Play/Pause hint pulse */}
          <span
            role="button"
            tabIndex={-1}
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity ${
              showHint || !playing ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

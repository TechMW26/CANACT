'use client';

import { useEffect, type RefObject } from 'react';

export type ReelAudioOptions = { startAtSec?: number; musicVolume?: number };

/** Keeps a reel's soundtrack locked to the video timeline. */
export function useReelAudioSync(
  videoRef: RefObject<HTMLVideoElement | null>,
  audioRef: RefObject<HTMLAudioElement | null>,
  enabled: boolean,
  startAtSec = 0,
  volume = 0.8,
) {
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || !enabled) return;
    audio.volume = volume;
    const sync = () => {
      if (!Number.isFinite(audio.duration) || !audio.duration) return;
      const target = (video.currentTime + startAtSec) % audio.duration;
      if (Math.abs(audio.currentTime - target) > 0.12) audio.currentTime = target;
      audio.playbackRate = video.playbackRate;
    };
    const play = () => { sync(); void audio.play().catch(() => undefined); };
    const pause = () => audio.pause();
    video.addEventListener('play', play);
    video.addEventListener('pause', pause);
    video.addEventListener('seeking', sync);
    video.addEventListener('seeked', sync);
    video.addEventListener('ratechange', sync);
    video.addEventListener('timeupdate', sync);
    video.addEventListener('ended', pause);
    if (!video.paused) play();
    return () => {
      video.removeEventListener('play', play);
      video.removeEventListener('pause', pause);
      video.removeEventListener('seeking', sync);
      video.removeEventListener('seeked', sync);
      video.removeEventListener('ratechange', sync);
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('ended', pause);
      audio.pause();
    };
  }, [audioRef, enabled, startAtSec, videoRef, volume]);
}

/** Records video + original audio + soundtrack into one uploaded media blob. */
export async function stitchReelAudio(
  videoUrl: string,
  musicUrl: string,
  { startAtSec = 0, musicVolume = 0.8 }: ReelAudioOptions = {},
): Promise<Blob | null> {
  if (typeof window === 'undefined' || !window.MediaRecorder || !window.AudioContext) return null;
  const canvas = document.createElement('canvas');
  if (!canvas.captureStream) return null;
  let localVideo = '';
  let localMusic = '';
  let context: AudioContext | null = null;
  try {
    const [videoBlob, musicBlob] = await Promise.all([
      fetch(videoUrl).then((r) => { if (!r.ok) throw new Error('video'); return r.blob(); }),
      fetch(musicUrl, { mode: 'cors' }).then((r) => { if (!r.ok) throw new Error('music'); return r.blob(); }),
    ]);
    localVideo = URL.createObjectURL(videoBlob);
    localMusic = URL.createObjectURL(musicBlob);
    const video = document.createElement('video');
    const music = document.createElement('audio');
    video.src = localVideo; video.playsInline = true; video.preload = 'auto';
    music.src = localMusic; music.preload = 'auto'; music.loop = true;
    await Promise.all([
      new Promise<void>((res, rej) => { video.onloadeddata = () => res(); video.onerror = () => rej(new Error('video decode')); }),
      new Promise<void>((res, rej) => { music.onloadeddata = () => res(); music.onerror = () => rej(new Error('audio decode')); }),
    ]);
    let width = video.videoWidth || 720;
    let height = video.videoHeight || 1280;
    const scale = Math.min(1, 720 / Math.max(width, height));
    width = Math.max(2, Math.round(width * scale) & ~1);
    height = Math.max(2, Math.round(height * scale) & ~1);
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    context = new AudioContext();
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const original = context.createMediaElementSource(video);
    const soundtrack = context.createMediaElementSource(music);
    const originalGain = context.createGain();
    const musicGain = context.createGain();
    originalGain.gain.value = 0.45;
    musicGain.gain.value = musicVolume;
    original.connect(originalGain).connect(destination);
    soundtrack.connect(musicGain).connect(destination);

    const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
      .find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? 'video/webm';
    const stream = canvas.captureStream(30);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const result = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    });
    video.currentTime = 0;
    music.currentTime = Math.min(startAtSec, Math.max(0, music.duration - 0.05));
    recorder.start(500);
    await Promise.all([video.play(), music.play()]);
    let raf = 0;
    const draw = () => {
      ctx.drawImage(video, 0, 0, width, height);
      if (!video.ended) raf = requestAnimationFrame(draw);
    };
    draw();
    await new Promise<void>((resolve) => video.addEventListener('ended', () => resolve(), { once: true }));
    cancelAnimationFrame(raf);
    music.pause();
    recorder.stop();
    const blob = await result;
    return blob.size ? blob : null;
  } catch {
    return null;
  } finally {
    if (localVideo) URL.revokeObjectURL(localVideo);
    if (localMusic) URL.revokeObjectURL(localMusic);
    void context?.close();
  }
}

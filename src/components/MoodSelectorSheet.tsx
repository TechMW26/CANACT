'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from './icons';
import { MoodIcon } from './MoodIcon';
import { Sheet } from './Sheet';
import { toast } from './Toaster';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { MOODS, saveMoodEntry, type MoodEntry } from '@/lib/moodTracker';
import styles from './MoodSelectorSheet.module.css';

const MOOD_COOLDOWN_MS = 2 * 60 * 60 * 1000;

function formatCooldown(remainingMs: number) {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function MoodSelectorSheet({
  open,
  onClose,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  onPublished?: (accent: string) => void;
}) {
  const { user, profile, updateMyProfile } = useAuth();
  const initialIndex = Math.max(0, MOODS.findIndex((item) => item.id === profile?.currentMood?.kind));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [intensity, setIntensity] = useState(Math.max(1, Math.min(5, Number(profile?.currentMood?.intensity || 3))));
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(0);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollFrameRef = useRef(0);
  const previousIntensityRef = useRef(intensity);
  const mood = MOODS[activeIndex] ?? MOODS[1]!;

  useEffect(() => {
    if (!open) return;
    const nextIndex = Math.max(0, MOODS.findIndex((item) => item.id === profile?.currentMood?.kind));
    setActiveIndex(nextIndex);
    setIntensity(Math.max(1, Math.min(5, Number(profile?.currentMood?.intensity || 3))));
    previousIntensityRef.current = Math.max(1, Math.min(5, Number(profile?.currentMood?.intensity || 3)));
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [open, profile?.currentMood?.intensity, profile?.currentMood?.kind]);

  useEffect(() => {
    if (!open) return;
    const centreActiveMood = () => {
      const carousel = carouselRef.current;
      const card = cardRefs.current[activeIndex];
      if (!carousel || !card) return;
      carousel.scrollTo({
        left: card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2,
        behavior: 'auto',
      });
    };
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(centreActiveMood);
    });
    const retry = window.setTimeout(centreActiveMood, 260);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(retry);
    };
  }, [activeIndex, open]);

  const lastMoodUpdate = Math.max(
    Number(profile?.moodUpdatedAt || 0),
    Number(profile?.currentMood?.updatedAt || 0),
  );
  const cooldownRemaining = clock ? Math.max(0, lastMoodUpdate + MOOD_COOLDOWN_MS - clock) : 0;
  const cooldownActive = cooldownRemaining > 0;
  const cooldownLabel = useMemo(() => formatCooldown(cooldownRemaining), [cooldownRemaining]);

  const selectMood = (index: number) => {
    if (index === activeIndex) return;
    setActiveIndex(index);
    haptic('selection');
  };

  const handleCarouselScroll = () => {
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      const carousel = carouselRef.current;
      if (!carousel) return;
      const carouselRect = carousel.getBoundingClientRect();
      const viewportCentre = carouselRect.left + carouselRect.width / 2;
      let closestIndex = activeIndex;
      let closestDistance = Number.POSITIVE_INFINITY;
      cardRefs.current.forEach((card, index) => {
        if (!card) return;
        const rect = card.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - viewportCentre);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      if (closestIndex !== activeIndex) selectMood(closestIndex);
    });
  };

  const changeIntensity = (next: number) => {
    const snapped = Math.max(1, Math.min(5, Math.round(next)));
    if (snapped === previousIntensityRef.current) return;
    previousIntensityRef.current = snapped;
    setIntensity(snapped);
    haptic('selection');
  };

  const publish = async () => {
    if (!user?.uid || saving) return;
    const remaining = lastMoodUpdate + MOOD_COOLDOWN_MS - Date.now();
    if (remaining > 0) {
      toast(`You can update your mood in ${formatCooldown(remaining)}`, 'info');
      return;
    }
    const now = Date.now();
    const entry: MoodEntry = {
      id: `${now}-${mood.id}`,
      mood: mood.id,
      state: mood.state,
      intensity,
      contexts: [],
      note: '',
      completedActions: [],
      createdAt: now,
    };
    setSaving(true);
    try {
      await updateMyProfile({ currentMood: { kind: mood.id, intensity, updatedAt: now }, moodUpdatedAt: now });
      try { await saveMoodEntry(user.uid, entry); } catch { /* public mood succeeded; local history is best effort */ }
      haptic('success');
      onPublished?.(mood.accent);
      onClose();
      toast(`${mood.label} is now visible on your profile`, 'success');
    } catch (error: any) {
      toast(error?.message || 'Could not set your mood', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={saving ? () => {} : onClose} title="Set your mood" topmost>
      <div className={styles.content} style={{ '--mood-accent': mood.accent, '--mood-soft': mood.soft } as React.CSSProperties}>
        <div className={styles.heading}>
          <span><small>PUBLIC MOOD</small><strong>{mood.label}</strong></span>
          <b><MoodIcon kind={mood.id} size={20} /></b>
        </div>

        <div ref={carouselRef} className={styles.carousel} onScroll={handleCarouselScroll} aria-label="Choose a mood">
          {MOODS.map((item, index) => {
            const active = index === activeIndex;
            return (
              <button
                ref={(element) => { cardRefs.current[index] = element; }}
                key={item.id}
                type="button"
                className={styles.moodCard}
                data-active={active || undefined}
                style={{ '--item-accent': item.accent, '--item-soft': item.soft } as React.CSSProperties}
                aria-pressed={active}
                onClick={() => selectMood(index)}
              >
                <span><MoodIcon kind={item.id} size={active ? 38 : 26} /></span>
                <strong>{item.label}</strong>
                <small>{item.state === 'balanced' ? 'Balanced' : item.state === 'low' ? 'Low energy' : 'Needs care'}</small>
              </button>
            );
          })}
        </div>

        <section className={styles.intensity} aria-labelledby="mood-intensity-title">
          <div><span><small>INTENSITY</small><strong id="mood-intensity-title">How strongly?</strong></span><b>{intensity}/5</b></div>
          <input type="range" min="1" max="5" step="1" value={intensity} onChange={(event) => changeIntensity(Number(event.target.value))} aria-label="Mood intensity from one to five" />
          <div className={styles.ticks} aria-hidden="true">{[1, 2, 3, 4, 5].map((value) => <i key={value} data-active={value <= intensity ? 'true' : undefined} />)}</div>
          <footer><span>Gentle</span><span>Strong</span></footer>
        </section>

        {cooldownActive ? <p className={styles.cooldown}><Clock size={16} /><span><strong>Available in {cooldownLabel}</strong><small>Moods can be updated once every two hours.</small></span></p> : null}
        <button type="button" className={styles.setButton} data-cooldown={cooldownActive || undefined} disabled={saving || !clock} onClick={publish}>
          {saving ? 'Setting mood…' : cooldownActive ? `Set mood in ${cooldownLabel}` : `Set ${mood.label} mood`}
        </button>
      </div>
    </Sheet>
  );
}

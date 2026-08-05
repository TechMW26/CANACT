'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, BatteryLow, Check, Clock, Globe2, Heart, ShieldCheck, Sparkles, Trash2 } from '@/components/icons';
import { MoodIcon } from '@/components/MoodIcon';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import {
  clearMoodEntries,
  getMoodDefinition,
  loadMoodEntries,
  MOODS,
  moodStreak,
  saveMoodEntry,
  type MoodEntry,
  type MoodKind,
  type MoodState,
} from '@/lib/moodTracker';
import styles from './MoodTracker.module.css';

type View = 'checkin' | 'insights';
const MOOD_COOLDOWN_MS = 2 * 60 * 60 * 1000;

const STATE_LABELS: Record<MoodState, string> = {
  balanced: 'Balanced',
  low: 'Low energy',
  vulnerable: 'Needs care',
};

function dayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatCooldown(remainingMs: number) {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function StateIcon({ state }: { state: MoodState }) {
  if (state === 'balanced') return <Activity size={20} />;
  if (state === 'low') return <BatteryLow size={20} />;
  return <Heart size={20} />;
}

export default function MoodPage() {
  const { user, profile, updateMyProfile } = useAuth();
  const [view, setView] = useState<View>('checkin');
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [selectedMood, setSelectedMood] = useState<MoodKind>('calm');
  const [intensity, setIntensity] = useState(3);
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const updateClock = () => setClock(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    loadMoodEntries(user.uid).then((items) => { if (active) setEntries(items); });
    return () => { active = false; };
  }, [user?.uid]);

  const publishedMoodKind = profile?.currentMood?.kind;
  const publishedMoodIntensity = Number(profile?.currentMood?.intensity || 3);
  const publishedMoodAt = Number(profile?.currentMood?.updatedAt || 0);

  // Sync only when the published value actually changes. Depending on the
  // whole object caused live profile snapshots to reset a user's new choice
  // back to the current mood immediately after every tap.
  useEffect(() => {
    if (!publishedMoodKind) return;
    setSelectedMood(publishedMoodKind);
    setIntensity(Math.max(1, Math.min(5, publishedMoodIntensity)));
  }, [publishedMoodAt, publishedMoodIntensity, publishedMoodKind]);

  const mood = getMoodDefinition(selectedMood) ?? MOODS[1];
  const currentMood = getMoodDefinition(profile?.currentMood?.kind);
  const lastMoodUpdate = Math.max(
    Number(profile?.moodUpdatedAt || 0),
    Number(profile?.currentMood?.updatedAt || 0),
    Number(entries[0]?.createdAt || 0),
  );
  const cooldownRemaining = clock ? Math.max(0, lastMoodUpdate + MOOD_COOLDOWN_MS - clock) : 0;
  const cooldownActive = cooldownRemaining > 0;
  const cooldownLabel = cooldownActive ? formatCooldown(cooldownRemaining) : '';
  const hasDraftChanges = !!profile?.currentMood && (
    selectedMood !== profile.currentMood.kind || intensity !== profile.currentMood.intensity
  );
  const streak = moodStreak(entries);
  const firstName = profile?.firstName || profile?.fullName?.split(' ')[0] || 'there';
  const lastSevenDays = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - offset));
      const daily = entries.filter((entry) => dayKey(entry.createdAt) === dayKey(date.getTime()));
      const stateCounts: Record<MoodState, number> = { balanced: 0, low: 0, vulnerable: 0 };
      daily.forEach((entry) => { stateCounts[entry.state] += 1; });
      const leading = (Object.entries(stateCounts) as Array<[MoodState, number]>).sort((left, right) => right[1] - left[1])[0];
      return { label: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1), count: daily.length, state: leading[1] ? leading[0] : null };
    });
  }, [entries]);
  const stateDistribution = useMemo(() => {
    const recent = entries.filter((entry) => Date.now() - entry.createdAt <= 30 * 24 * 3_600_000);
    const counts: Record<MoodState, number> = { balanced: 0, low: 0, vulnerable: 0 };
    recent.forEach((entry) => { counts[entry.state] += 1; });
    return { counts, total: recent.length };
  }, [entries]);

  const publishMood = async () => {
    if (!user?.uid || saving) return;
    const remaining = lastMoodUpdate + MOOD_COOLDOWN_MS - Date.now();
    if (remaining > 0) {
      toast(`You can update your mood in ${formatCooldown(remaining)}`, 'info');
      return;
    }
    setSaving(true);
    const now = Date.now();
    const entry: MoodEntry = {
      id: `${now}-${selectedMood}`,
      mood: selectedMood,
      state: mood.state,
      intensity,
      contexts: [],
      note: '',
      completedActions: [],
      createdAt: now,
    };
    try {
      await updateMyProfile({ currentMood: { kind: selectedMood, intensity, updatedAt: now }, moodUpdatedAt: now });
      const next = await saveMoodEntry(user.uid, entry);
      setEntries(next);
      haptic('success');
      toast(`${mood.label} is now visible on your profile`, 'success');
    } catch (error: any) {
      toast(error?.message || 'Could not publish your mood', 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearCurrentMood = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateMyProfile({ currentMood: null, moodUpdatedAt: Date.now() });
      toast('Current mood removed from your profile', 'success');
    } catch (error: any) {
      toast(error?.message || 'Could not remove your mood', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <main
      className={styles.page}
      data-state={mood.state}
      style={{ '--mood-accent': mood.accent, '--mood-soft': mood.soft } as React.CSSProperties}
    >
      <header className={styles.hero}>
        <div className={styles.heroTopline}>
          <small>PUBLIC MOOD</small>
          <span className={styles.streak}><Sparkles size={14} /><strong>{streak}</strong><small>day streak</small></span>
        </div>
        <h1>How are you, {firstName}?</h1>
        <p>Choose what feels closest and publish it to your profile.</p>
      </header>

      <nav className={styles.tabs} aria-label="Mood sections">
        <button type="button" data-active={view === 'checkin'} onClick={() => setView('checkin')}>Set mood</button>
        <button type="button" data-active={view === 'insights'} onClick={() => setView('insights')}>History</button>
      </nav>

      {view === 'checkin' ? (
        <section className={styles.moodSelector} aria-labelledby="mood-selector-title">
          <div className={styles.sectionHeading}>
            <span><small>ONE-TAP CHOICE</small><h2 id="mood-selector-title">What feels closest?</h2></span>
            {currentMood ? <b><MoodIcon kind={currentMood.id} size={14} /> Current · {currentMood.label}</b> : <b>Not set</b>}
          </div>

          <div className={styles.moodGrid}>
            {MOODS.map((item) => {
              const selected = item.id === selectedMood;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-selected={selected}
                  style={{ '--item-accent': item.accent, '--item-soft': item.soft } as React.CSSProperties}
                  aria-pressed={selected}
                  onClick={() => { setSelectedMood(item.id); haptic('subtle'); }}
                >
                  <span><MoodIcon kind={item.id} size={22} /></span>
                  <strong>{item.label}</strong>
                  {selected ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <div className={styles.selectionSummary}>
            <span className={styles.selectedMoodIcon}><MoodIcon kind={mood.id} size={28} /></span>
            <span><small>{hasDraftChanges ? 'NEW SELECTION' : 'YOUR SELECTION'}</small><strong>{mood.label}</strong></span>
            <b>{intensity}/5</b>
          </div>
          <label className={styles.intensity}>
            <span>Gentle</span>
            <input type="range" min="1" max="5" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} aria-label="Mood intensity" />
            <span>Strong</span>
          </label>

          <p className={styles.publicNote}><Globe2 size={16} /><span><strong>Public on your profile</strong><small>Your mood and intensity are visible. Your history stays on this device.</small></span></p>
          {cooldownActive ? <p className={styles.cooldownNote} aria-live="polite"><Clock size={15} /><span><strong>Update available in {cooldownLabel}</strong><small>{hasDraftChanges ? `Your ${mood.label} selection is ready. Publish it when the timer ends.` : 'You can choose another mood now and publish it when the timer ends.'}</small></span></p> : null}
          <button type="button" className={styles.saveButton} data-cooldown={cooldownActive || undefined} disabled={saving || !clock} onClick={publishMood}>{saving ? 'Publishing…' : !clock ? 'Checking availability…' : cooldownActive ? `Available in ${cooldownLabel}` : profile?.currentMood ? `Update to ${mood.label}` : `Publish ${mood.label}`}</button>
          {profile?.currentMood ? <button type="button" className={styles.removeMood} disabled={saving} onClick={clearCurrentMood}>Remove current mood</button> : null}
        </section>
      ) : (
        <section className={styles.insights}>
          <div className={styles.insightLead}><Activity size={22} /><span><small>PRIVATE HISTORY</small><h2>Your recent rhythm</h2><p>Only your current mood is public.</p></span></div>
          <div className={styles.weekChart}>
            {lastSevenDays.map((day, index) => <div key={`${day.label}-${index}`}><span data-state={day.state ?? 'empty'} style={{ height: `${Math.max(8, day.count * 28)}px` }} /><small>{day.label}</small></div>)}
          </div>
          <div className={styles.distributionCards}>
            {(['balanced', 'low', 'vulnerable'] as MoodState[]).map((state) => {
              const count = stateDistribution.counts[state];
              const percentage = stateDistribution.total ? Math.round((count / stateDistribution.total) * 100) : 0;
              return <article key={state} data-state={state}><StateIcon state={state} /><strong>{percentage}%</strong><small>{STATE_LABELS[state]}</small></article>;
            })}
          </div>
          <div className={styles.recentMoods}>
            <h2>Recent check-ins</h2>
            {entries.slice(0, 5).map((entry) => {
              const definition = getMoodDefinition(entry.mood);
              if (!definition) return null;
              return <article key={entry.id} style={{ '--item-accent': definition.accent, '--item-soft': definition.soft } as React.CSSProperties}><span><MoodIcon kind={entry.mood} size={18} /></span><strong>{definition.label}</strong><small>{entry.intensity}/5 · {new Date(entry.createdAt).toLocaleDateString()}</small></article>;
            })}
            {!entries.length ? <p>No check-ins yet. Set your first mood to begin.</p> : null}
          </div>
          <p className={styles.privacyNote}><ShieldCheck size={17} /> History is encrypted and stored only on this device.</p>
          <button type="button" className={styles.clearButton} onClick={() => {
            if (!window.confirm('Delete all mood history stored on this device?')) return;
            clearMoodEntries(user.uid);
            setEntries([]);
            toast('Mood history removed from this device', 'success');
          }}><Trash2 size={16} /> Delete local history</button>
        </section>
      )}
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, Award, Heart, MapPin, ShieldCheck, Sparkles, Users } from '@/components/icons';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { calculateCanactScore, getCanactScoreLabel } from '@/lib/canactScore';
import styles from './CanactHome.module.css';

function firstName(value?: string | null) {
  return String(value || 'there').trim().split(/\s+/)[0] || 'there';
}

export function CanactHome() {
  const { profile, user } = useAuth();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const summary = useMemo(() => calculateCanactScore(profile), [profile]);
  const score = summary.score;
  const tier = getCanactScoreLabel(score);
  const name = firstName(profile?.firstName || profile?.fullName || user?.displayName);
  const positiveSignals = Math.max(0, (profile?.likesCount || 0) + (profile?.ratingCount || 0));
  const goodActs = (profile?.helpStats?.resolved || 0) + (profile?.helpStats?.confirmed || 0);
  const progressStyle = {
    '--home-progress': progress,
    '--greeting-opacity': 1 - progress,
    '--greeting-y': `${-42 * progress}px`,
    '--shape-width': `calc(${94 * (1 - progress)}vw + ${150 * progress}px)`,
    '--shape-height': `calc(${94 * (1 - progress)}vw + ${44 * progress}px)`,
    '--shape-radius': `calc(${47 * (1 - progress)}vw + ${22 * progress}px)`,
    '--shape-y': `${-8 * progress}px`,
    '--shape-bg': `rgb(${Math.round(255 - (231 * progress))} ${Math.round(255 - (195 * progress))} ${Math.round(255 - (205 * progress))})`,
    '--ring-opacity': Math.max(0, 1 - (progress * 1.4)),
    '--score-opacity': Math.max(0, 1 - (progress * 1.7)),
    '--score-scale': 1 - (progress * .35),
    '--pill-opacity': Math.max(0, Math.min(1, (progress - .72) * 3.6)),
  } as React.CSSProperties;

  return (
    <section className={styles.home} style={progressStyle} aria-label="Canact home">
      <div
        ref={scrollRef}
        className={styles.scroller}
        onScroll={(event) => setProgress(Math.min(Math.max(event.currentTarget.scrollTop / 360, 0), 1))}
      >
        <div className={styles.hero}>
          <div className={styles.greeting}>
            <div className={styles.avatar}><Avatar src={profile?.photoURL || user?.photoURL || null} name={profile?.fullName || user?.displayName || 'Canact user'} size={50} /></div>
            <p>hey {name},</p>
            <h1>you&apos;re in the <strong>{summary.club} club</strong> now</h1>
          </div>
        </div>

        <div className={`${styles.scoreDock} canact-header-aware-sticky`}>
          <div className={styles.scoreShape} data-compact={progress >= .72 ? 'true' : undefined}>
            <svg className={styles.scoreRing} viewBox="0 0 280 280" aria-hidden="true">
              <circle cx="140" cy="140" r="126" pathLength="100" />
              <circle className={styles.scoreArc} cx="140" cy="140" r="126" pathLength="100" style={{ strokeDashoffset: 100 - Math.max(4, Math.min(100, (score / Math.max(summary.max, 1)) * 100)) }} />
            </svg>
            <div className={styles.scoreInner}>
              <span>CANACT SCORE</span><b>{score}</b><small>{summary.delta >= 0 ? '↑' : '↓'} {Math.abs(summary.delta)} this month</small><em>TRUST</em>
            </div>
            <div className={styles.pillInner}><i /><b>{score}</b><span>{tier}</span></div>
          </div>
        </div>

        <div className={styles.scrollHint}><ArrowDown /><span>scroll to explore</span></div>

        <div className={styles.content}>
          <div className={styles.sectionHeading}><div><small>YOUR IMPACT</small><h2>Trust that grows with you</h2></div><ShieldCheck /></div>
          <div className={styles.stats}>
            <div><span><Heart /></span><b>{positiveSignals}</b><small>Positive signals</small></div>
            <div><span><Users /></span><b>{profile?.ratingCount || 0}</b><small>Connections</small></div>
            <div><span><Sparkles /></span><b>{goodActs}</b><small>Good acts</small></div>
          </div>

          <div className={styles.insight}>
            <span><Activity /></span>
            <div><small>SCORE INSIGHT</small><h3>{summary.delta >= 0 ? 'Your trust is trending upward' : 'Small reliable actions rebuild momentum'}</h3><p>Consistency, genuine interactions, and community help shape your score.</p></div>
          </div>

          <div className={styles.actions}>
            <Link href="/favourites"><span><MapPin /></span><div><b>People near you</b><small>Discover genuine connections nearby</small></div><strong>→</strong></Link>
            <Link href="/leaderboard"><span><Award /></span><div><b>Community leaders</b><small>See the most trusted people around you</small></div><strong>→</strong></Link>
          </div>
        </div>
      </div>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Crown } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { LeaderScope, listenLeaderboard } from '@/lib/services/leaderboard';
import { UserProfile } from '@/lib/types';
import styles from './Leaderboard.module.css';

type Movement = { direction: 'up' | 'down' | 'steady'; label: string };

function movementForRank(rank: number): Movement {
  if (rank % 3 === 1) return { direction: 'up', label: 'Moving up' };
  if (rank % 3 === 2) return { direction: 'down', label: 'Slight drop' };
  return { direction: 'steady', label: 'Holding steady' };
}

export default function LeaderboardPage() {
  const { profile, user } = useAuth();
  const [scope, setScope] = useState<LeaderScope>('app');
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onScopeChange = (event: Event) => {
      const nextScope = (event as CustomEvent<LeaderScope>).detail;
      if (nextScope) setScope(nextScope);
    };
    window.addEventListener('canact:leaderboard-scope', onScopeChange);
    return () => window.removeEventListener('canact:leaderboard-scope', onScopeChange);
  }, []);

  useEffect(() => {
    setLoading(true);
    return listenLeaderboard(scope, profile, (nextRows) => {
      setRows(nextRows);
      setLoading(false);
    });
  }, [scope, profile]);

  const podium = useMemo(() => [rows[1], rows[0], rows[2]], [rows]);
  const visibleRows = rows.slice(3, 6);
  const currentIndex = rows.findIndex((entry) => entry.uid === user?.uid);
  const currentUser = currentIndex >= 0 ? rows[currentIndex] : profile;
  const showCurrentUser = !!currentUser && currentIndex >= 6;

  return (
    <main className={styles.page} aria-label="Leaderboard">
      <section className={styles.podium} aria-label="Top three community leaders">
        <Crown className={styles.crown} aria-hidden="true" />
        {podium.map((entry, visualIndex) => {
          const rank = visualIndex === 0 ? 2 : visualIndex === 1 ? 1 : 3;
          return (
            <div key={entry?.uid || `empty-${rank}`} className={`${styles.place} ${styles[`place${rank}`]}`}>
              {entry ? (
                <Link href={`/profile/${entry.uid}`} aria-label={`${entry.fullName}, rank ${rank}`} className={styles.podiumAvatar}>
                  <Avatar src={entry.photoURL} name={entry.fullName} size={rank === 1 ? 96 : 72} />
                </Link>
              ) : <span className={styles.avatarPlaceholder} />}
              <div className={`${styles.cube} ${styles[`cube${rank}`]}`} aria-hidden="true">
                <span>{rank}</span>
              </div>
            </div>
          );
        })}
      </section>

      <section className={styles.rankSheet} aria-label="Leaderboard rankings">
        {loading ? (
          <div className={styles.loadingRows} aria-label="Loading leaderboard">
            <span /><span /><span />
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>No one is ranked in this scope yet.</div>
        ) : (
          <>
            <ol className={styles.rows} start={4}>
              {visibleRows.map((entry, index) => (
                <RankRow key={entry.uid} profile={entry} rank={index + 4} />
              ))}
            </ol>
            {showCurrentUser && currentUser ? (
              <Link href="/profile" className={styles.currentRow} aria-label={`Your rank is ${currentIndex + 1}`}>
                <span className={styles.currentRank}>{currentIndex + 1}</span>
                <Avatar src={currentUser.photoURL} name={currentUser.fullName} size={42} />
                <span className={styles.currentIdentity}>
                  <strong>{currentUser.firstName || currentUser.fullName} <small>(You)</small></strong>
                  <em><i /> Currently Active</em>
                </span>
              </Link>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

function RankRow({ profile, rank }: { profile: UserProfile; rank: number }) {
  const movement = movementForRank(rank);
  return (
    <li>
      <Link href={`/profile/${profile.uid}`} className={styles.rankRow}>
        <span className={styles.rank}>{rank}</span>
        <Avatar src={profile.photoURL} name={profile.fullName} size={48} />
        <span className={styles.identity}>
          <strong>{profile.firstName || profile.fullName}</strong>
          <em className={styles[movement.direction]}>{movement.direction === 'up' ? '↑' : movement.direction === 'down' ? '↓' : '•'} {movement.label}</em>
        </span>
      </Link>
    </li>
  );
}

function ordinalSuffix(rank: number) {
  const remainder = rank % 100;
  if (remainder >= 11 && remainder <= 13) return 'th';
  if (rank % 10 === 1) return 'st';
  if (rank % 10 === 2) return 'nd';
  if (rank % 10 === 3) return 'rd';
  return 'th';
}

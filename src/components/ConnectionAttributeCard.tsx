import type { ReactNode } from 'react';
import { CARD_LABELS, type CardKey } from '@/lib/types';
import styles from './ProfileRecognitionFolders.module.css';

export const CONNECTION_CARD_DESCRIPTIONS: Record<CardKey, string> = {
  understanding: 'Listens deeply and makes people feel genuinely seen.',
  humour: 'Turns ordinary moments into something worth laughing about.',
  goodVibes: 'Makes every space feel lighter, brighter, and better.',
  confidence: 'Walks into every challenge with courage and self-belief.',
  cooperative: 'Brings people together and makes teamwork feel effortless.',
  intelligence: 'Sees patterns, asks better questions, and shares clarity.',
  creativity: 'Turns fresh ideas into possibilities people can believe in.',
  daring: 'Takes the meaningful leap when everyone else is still thinking.',
};

function CardMotif({ kind }: { kind: CardKey }) {
  if (kind === 'goodVibes' || kind === 'creativity') {
    return <><path d="M127 20l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" /><path d="M151 45l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></>;
  }
  if (kind === 'confidence' || kind === 'daring') {
    return <><path d="M142 18l-11 22h10l-6 20 20-27h-11l7-15z" /><path d="M119 27l-8-8M115 39h-11" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></>;
  }
  if (kind === 'cooperative' || kind === 'understanding') {
    return <><circle cx="143" cy="27" r="9" fill="none" stroke="currentColor" strokeWidth="4" /><path d="M128 51c3-10 9-15 15-15s12 5 15 15" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" /></>;
  }
  if (kind === 'intelligence') {
    return <><path d="M138 18a14 14 0 0 1 8 25v8h-16v-8a14 14 0 0 1 8-25z" fill="none" stroke="currentColor" strokeWidth="4" /><path d="M132 58h12M138 8V2M119 15l-5-5M157 15l5-5" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></>;
  }
  return <><path d="M132 19c7-8 19-2 16 8-2 7-8 11-16 17-8-6-14-10-16-17-3-10 9-16 16-8z" /><path d="M154 48l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" /></>;
}

export function ConnectionCardPortrait({ kind, compact = false }: { kind: CardKey; compact?: boolean }) {
  return (
    <svg className={compact ? styles.connectionPortraitCompact : styles.connectionPortrait} viewBox="0 0 180 140" aria-hidden="true">
      <g className={styles.connectionMotif}><CardMotif kind={kind} /></g>
      <path d="M31 132c4-27 24-44 51-46 29-2 53 15 59 46z" fill="currentColor" opacity=".9" />
      <path d="M61 78c-12-9-17-25-11-39C56 22 70 13 88 15c18 1 33 13 37 31 3 14-3 28-15 36-13 9-36 7-49-4z" fill="currentColor" />
      <path d="M61 47c3-16 14-24 28-24 17 0 29 13 29 31 0 24-13 41-29 41-16 0-29-18-29-41 0-2 0-5 1-7z" fill="var(--connection-card-bg)" />
      <path d="M58 44c7-25 28-29 46-19 8 5 14 12 17 23-11-2-18-7-23-14-8 8-22 13-40 10z" fill="currentColor" />
      <path d="M72 58c4-4 9-4 13 0M98 58c4-4 9-4 13 0" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M79 74c7 8 17 8 24 0" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M78 91v10c7 6 17 6 24 0V91" fill="var(--connection-card-bg)" />
    </svg>
  );
}

export function ConnectionCardContent({
  cardKey,
  footer,
  trailing,
}: {
  cardKey: CardKey;
  footer: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <>
      <div className={styles.connectionCardCopy}>
        <h3>{CARD_LABELS[cardKey]}</h3>
        <span className={styles.connectionTitleRule} />
        <small>Attribute card</small>
        <p>{CONNECTION_CARD_DESCRIPTIONS[cardKey]}</p>
      </div>
      <div className={styles.connectionCardArtwork}><ConnectionCardPortrait kind={cardKey} /></div>
      <div className={styles.connectionCardFooter}><span>{footer}</span>{trailing}</div>
    </>
  );
}

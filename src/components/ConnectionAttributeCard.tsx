'use client';

import { CARD_LABELS, type CardKey } from '@/lib/types';
import { useAttributeCardStyle } from '@/lib/attributeCardStyle';
import styles from './ProfileRecognitionFolders.module.css';

const CARD_ARTWORK: Record<CardKey, string> = {
  creativity: '/attribute-cards/creativity-clean.webp',
  intelligence: '/attribute-cards/intelligence-clean.webp',
  daring: '/attribute-cards/daring-clean.webp',
  humour: '/attribute-cards/humour-clean.webp',
  cooperative: '/attribute-cards/cooperative-clean.webp',
  goodVibes: '/attribute-cards/good-vibes-clean.webp',
  confidence: '/attribute-cards/confidence-clean.webp',
  understanding: '/attribute-cards/understanding-clean.webp',
};

const IMAGE_CARD_ARTWORK: Partial<Record<CardKey, string>> = {
  creativity: '/attribute-cards/metallic/01-creativity.png',
  intelligence: '/attribute-cards/metallic/02-intelligence.png',
  daring: '/attribute-cards/metallic/03-daring.png',
  humour: '/attribute-cards/metallic/04-humour.png',
  cooperative: '/attribute-cards/metallic/05-cooperative.png',
  goodVibes: '/attribute-cards/metallic/06-good-vibes.png',
  confidence: '/attribute-cards/metallic/07-confidence.png',
  understanding: '/attribute-cards/metallic/08-understanding.png',
};

export function ConnectionCardContent({
  cardKey,
  givenBy,
  date,
  showGivenDetails = false,
}: {
  cardKey: CardKey;
  givenBy: string;
  date: string;
  showGivenDetails?: boolean;
}) {
  const configuredStyle = useAttributeCardStyle();
  const imageArtwork = IMAGE_CARD_ARTWORK[cardKey];
  const effectiveStyle = configuredStyle === 'image' && imageArtwork ? 'image' : 'html';
  const label = CARD_LABELS[cardKey].toUpperCase();

  if (effectiveStyle === 'image') {
    return (
      <div
        className={`${styles.attributeCardStage} ${styles.attributeImageCardStage}`}
        data-attribute-card-style="image"
        aria-label={`${label} attribute card. Given by ${givenBy} on ${date}.`}
      >
        <div className={styles.attributeImageFrame}>
          <img className={styles.attributeImageArtwork} src={imageArtwork} alt="" draggable={false} decoding="async" />
        </div>
        {showGivenDetails ? (
          <div className={styles.attributeImageDetails}>
            <span>Given by</span>
            <strong title={givenBy}>{givenBy}</strong>
            <small>{date}</small>
          </div>
        ) : null}
      </div>
    );
  }

  const artwork = CARD_ARTWORK[cardKey];

  return (
    <div className={styles.attributeCardStage} data-attribute-card-style="html" aria-label={`${label} attribute card. Given by ${givenBy} on ${date}.`}>
      <img className={styles.attributeCardArtwork} src={artwork} alt="" draggable={false} decoding="async" />
      <img className={styles.attributeCardFragment} src={artwork} alt="" draggable={false} decoding="async" aria-hidden="true" />

      <span className={`${styles.attributeLiveCopy} ${styles.attributeGivenWrap}`}>
        <span className={styles.attributeGivenLabel}>GIVEN BY</span>
        <span className={styles.attributeGivenValue}>{givenBy} · {date}</span>
      </span>
    </div>
  );
}

import { CARD_KEYS, NEGATIVE_ATTRS, POSITIVE_ATTRS, type UserProfile } from './types';

export const CANACT_SCORE_MIN = 300;
export const CANACT_SCORE_BASELINE = 750;
export const CANACT_SCORE_MAX = 900;

export type CanactScoreSummary = {
  score: number;
  baseline: number;
  max: number;
  delta: number;
  label: 'TRUST' | 'GOOD' | 'FAIR' | 'LOW';
  club: number;
};

export function calculateCanactScore(profile?: UserProfile | null): CanactScoreSummary {
  if (!profile) return makeSummary(CANACT_SCORE_BASELINE);

  let adjustment = 0;

  const ratingCount = nonNegative(profile.ratingCount);
  if (ratingCount > 0) {
    const rating = clampNumber(profile.rating, 0, 5);
    const confidence = confidenceFromCount(ratingCount, 18);
    adjustment += clampNumber(((rating - 3.75) / 1.25) * 70, -105, 70) * confidence;
  }

  const likes = nonNegative(profile.likesCount);
  const dislikes = nonNegative(profile.dislikesCount);
  const sentimentTotal = likes + dislikes;
  if (sentimentTotal > 0) {
    const sentiment = (likes - dislikes) / sentimentTotal;
    adjustment += sentiment * 45 * confidenceFromCount(sentimentTotal, 24);
  }

  const positiveAttrs = POSITIVE_ATTRS.reduce((sum, key) => sum + nonNegative(profile.attrs?.[key]), 0);
  const negativeAttrs = NEGATIVE_ATTRS.reduce((sum, key) => sum + nonNegative(profile.attrs?.[key]), 0);
  const attrTotal = positiveAttrs + negativeAttrs;
  if (attrTotal > 0) {
    adjustment += ((positiveAttrs - negativeAttrs) / attrTotal) * 55 * confidenceFromCount(attrTotal, 18);
  }

  const cardsTotal = CARD_KEYS.reduce((sum, key) => sum + nonNegative(profile.cardsReceived?.[key]), 0);
  if (cardsTotal > 0) adjustment += Math.min(38, Math.log1p(cardsTotal) * 14);

  const helpStats = profile.helpStats;
  if (helpStats) {
    const helpSignal =
      nonNegative(helpStats.confirmed) * 1.2 +
      nonNegative(helpStats.resolved) * 1.5 +
      nonNegative(helpStats.offered) * 0.35;
    if (helpSignal > 0) adjustment += Math.min(42, Math.log1p(helpSignal) * 16);
  }

  if (profile.profileVerified) adjustment += 12;
  const nonVerificationBadges = (profile.badges ?? []).filter((badge) => badge.toLowerCase() !== 'verified').length;
  if (nonVerificationBadges > 0) adjustment += Math.min(12, nonVerificationBadges * 2);

  return makeSummary(CANACT_SCORE_BASELINE + adjustment);
}

export function getCanactScoreLabel(score: number): CanactScoreSummary['label'] {
  if (score >= 750) return 'TRUST';
  if (score >= 650) return 'GOOD';
  if (score >= 500) return 'FAIR';
  return 'LOW';
}

function makeSummary(rawScore: number): CanactScoreSummary {
  const score = Math.round(clampNumber(rawScore, CANACT_SCORE_MIN, CANACT_SCORE_MAX));
  return {
    score,
    baseline: CANACT_SCORE_BASELINE,
    max: CANACT_SCORE_MAX,
    delta: score - CANACT_SCORE_BASELINE,
    label: getCanactScoreLabel(score),
    club: Math.max(CANACT_SCORE_MIN, Math.floor(score / 50) * 50),
  };
}

function confidenceFromCount(count: number, fullConfidenceAt: number) {
  return clampNumber(Math.log1p(count) / Math.log1p(fullConfidenceAt), 0, 1);
}

function nonNegative(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
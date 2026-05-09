import { CARD_KEYS, NEGATIVE_ATTRS, POSITIVE_ATTRS, type UserProfile } from './types';

export const CANACT_SCORE_MIN = 250;
export const CANACT_SCORE_BASELINE = 700;
export const CANACT_SCORE_MAX = 950;

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

  // === PROFILE RATING (most critical) ===
  // Likes/dislikes from proximity encounters - direct trust signal
  const likes = nonNegative(profile.likesCount);
  const dislikes = nonNegative(profile.dislikesCount);
  const sentimentTotal = likes + dislikes;
  if (sentimentTotal > 0) {
    const sentiment = (likes - dislikes) / sentimentTotal;
    // Asymmetric: very harsh on dislikes, moderate gain on likes
    const confidence = confidenceFromCount(sentimentTotal, 20);
    const base = sentiment >= 0 
      ? sentiment * 55  // Gains: max +55 for perfect
      : sentiment * 120; // Penalties: min -120 for all dislikes
    adjustment += Math.max(-120, base) * confidence;
  }

  // === ATTRIBUTE BIAS (character assessment) ===
  const positiveAttrs = POSITIVE_ATTRS.reduce((sum, key) => sum + nonNegative(profile.attrs?.[key]), 0);
  const negativeAttrs = NEGATIVE_ATTRS.reduce((sum, key) => sum + nonNegative(profile.attrs?.[key]), 0);
  const attrTotal = positiveAttrs + negativeAttrs;
  if (attrTotal > 0) {
    const bias = (positiveAttrs - negativeAttrs) / attrTotal;
    const confidence = confidenceFromCount(attrTotal, 16);
    // Asymmetric: heavy penalty for negative bias
    const base = bias >= 0
      ? bias * 65   // Gains: max +65
      : bias * 140; // Penalties: min -140
    adjustment += Math.max(-140, base) * confidence;
  }

  // === HELP REPUTATION (actions matter) ===
  const helpStats = profile.helpStats;
  if (helpStats) {
    const resolved = nonNegative(helpStats.resolved);
    const confirmed = nonNegative(helpStats.confirmed);
    const offered = nonNegative(helpStats.offered);
    const failed = nonNegative(helpStats.failed);
    const noShow = nonNegative(helpStats.noShow);

    // Positive signals
    let helpGain = 0;
    if (resolved > 0) helpGain += Math.min(45, Math.log1p(resolved) * 18); // +45 max for resolved
    if (confirmed > 0) helpGain += Math.min(30, Math.log1p(confirmed) * 12); // +30 max for confirmed

    // Negative signals (severe penalties)
    let helpLoss = 0;
    if (failed > 0) helpLoss -= Math.min(80, Math.log1p(failed) * 32); // -80 max for failed
    if (noShow > 0) helpLoss -= Math.min(100, Math.log1p(noShow) * 40); // -100 max for no-shows

    adjustment += helpGain + helpLoss;
  }

  // === CARDS (minor positive factor) ===
  const cardsTotal = CARD_KEYS.reduce((sum, key) => sum + nonNegative(profile.cardsReceived?.[key]), 0);
  if (cardsTotal > 0) adjustment += Math.min(25, Math.log1p(cardsTotal) * 10); // Minor: max +25

  // === VERIFICATION (small bonus) ===
  if (profile.profileVerified) adjustment += 15;
  const nonVerificationBadges = (profile.badges ?? []).filter((badge) => badge.toLowerCase() !== 'verified').length;
  if (nonVerificationBadges > 0) adjustment += Math.min(10, nonVerificationBadges * 2);

  return makeSummary(CANACT_SCORE_BASELINE + adjustment);
}

export function getCanactScoreLabel(score: number): CanactScoreSummary['label'] {
  if (score >= 800) return 'TRUST';
  if (score >= 680) return 'GOOD';
  if (score >= 520) return 'FAIR';
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
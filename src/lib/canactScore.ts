import { CARD_KEYS, NEGATIVE_ATTRS, POSITIVE_ATTRS, type UserProfile } from './types';

export const CANACT_SCORE_MIN = 0;
export const CANACT_SCORE_BASELINE = 0;
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
  if (!profile) return makeSummary(0, 0);

  const isOnboardingAccount = profile.onboarding?.version === 1;
  if (!isOnboardingAccount) return makeSummary(0, 0);

  const startingScore = Math.max(0, Math.min(300, Number(profile.onboarding?.points || 0)));
  // Setup is an intentional 0 → 300 progression. Reputation signals begin
  // affecting the score only after all onboarding tasks have completed.
  if (!profile.onboarding?.completedAt) return makeSummary(startingScore, startingScore);

  const adjustment = calculateCanactAdjustment(profile) - Number(profile.scoreAdjustmentOffset || 0);
  return makeSummary(startingScore + adjustment, startingScore);
}

export function calculateCanactAdjustment(profile: UserProfile): number {

  let adjustment = 0;

  // ===================================================================
  // T1 — PROXIMITY ENCOUNTER RATING (strongest signal: +55 / −120)
  // ===================================================================
  const likes = nonNegative(profile.likesCount);
  const dislikes = nonNegative(profile.dislikesCount);
  const sentimentTotal = likes + dislikes;
  if (sentimentTotal > 0) {
    const sentiment = (likes - dislikes) / sentimentTotal;
    const confidence = confidenceFromCount(sentimentTotal, 20);
    const base = sentiment >= 0
      ? sentiment * 55   // max +55 for perfect
      : sentiment * 120; // max −120 for all-dislike
    adjustment += Math.max(-120, Math.min(55, base)) * confidence;
  }

  // ===================================================================
  // T2 — ATTRIBUTE VOTES (character labels: +65 / −140)
  // ===================================================================
  const positiveAttrs = POSITIVE_ATTRS.reduce((sum, key) => sum + nonNegative(profile.attrs?.[key]), 0);
  const negativeAttrs = NEGATIVE_ATTRS.reduce((sum, key) => sum + nonNegative(profile.attrs?.[key]), 0);
  const attrTotal = positiveAttrs + negativeAttrs;
  if (attrTotal > 0) {
    const bias = (positiveAttrs - negativeAttrs) / attrTotal;
    const confidence = confidenceFromCount(attrTotal, 16);
    const base = bias >= 0
      ? bias * 65   // max +65
      : bias * 140; // max −140
    adjustment += Math.max(-140, Math.min(65, base)) * confidence;
  }

  // ===================================================================
  // T3 — HELP ACTIONS (real-world reliability)
  // ===================================================================
  const helpStats = profile.helpStats;
  if (helpStats) {
    const noShow = nonNegative(helpStats.noShow);

    // --- Positive: Resolved (per-type with multiplier) ---
    const redR = nonNegative(helpStats.redResolved);
    const orangeR = nonNegative(helpStats.orangeResolved);
    const yellowR = nonNegative(helpStats.yellowResolved);
    const totalResolved = redR + orangeR + yellowR;

    let resolvedScore = 0;
    if (totalResolved > 0) {
      // Base resolved score (log-scaled, capped at 45)
      const baseResolved = Math.min(45, Math.log1p(totalResolved) * 18);
      // Weighted average multiplier from type distribution
      const rMul = totalResolved > 0
        ? (1.5 * redR + 1.2 * orangeR + 1.0 * yellowR) / totalResolved
        : 1.0;
      resolvedScore = baseResolved * rMul;
    }

    // --- Positive: Confirmed (per-type with multiplier) ---
    const redC = nonNegative(helpStats.redConfirmed);
    const orangeC = nonNegative(helpStats.orangeConfirmed);
    const yellowC = nonNegative(helpStats.yellowConfirmed);
    const totalConfirmed = redC + orangeC + yellowC;

    let confirmedScore = 0;
    if (totalConfirmed > 0) {
      const baseConfirmed = Math.min(30, Math.log1p(totalConfirmed) * 12);
      const cMul = totalConfirmed > 0
        ? (1.5 * redC + 1.2 * orangeC + 1.0 * yellowC) / totalConfirmed
        : 1.0;
      confirmedScore = baseConfirmed * cMul;
    }

    // --- Outcome: Yes (confidence-scaled, per "yes" judgment) ---
    let yesScore = 0;
    const yesCount = nonNegative(helpStats.yesOutcomes);
    if (yesCount > 0) {
      yesScore = Math.min(45, 45 * confidenceFromCount(yesCount, 10));
    }

    // --- Outcome: Tried (good intent) → +10 flat each ---
    const triedGood = nonNegative(helpStats.triedGood);
    const triedGoodScore = triedGood * 10;

    // --- Outcome: Tried (bad intent) → −100 flat each ---
    const triedBad = nonNegative(helpStats.triedBad);
    const triedBadScore = triedBad * -100;

    // --- Negative: No-Show (log-scaled penalty) ---
    let noShowScore = 0;
    if (noShow > 0) {
      noShowScore = -Math.min(100, Math.log1p(noShow) * 40);
    }

    adjustment += resolvedScore + confirmedScore + yesScore + triedGoodScore + triedBadScore + noShowScore;
  }

  // ===================================================================
  // T4 — CONTENT REACTIONS (post/poll likes & dislikes: +40 / −60)
  // ===================================================================
  const contentLikes = nonNegative(profile.contentLikes);
  const contentDislikes = nonNegative(profile.contentDislikes);
  const contentTotal = contentLikes + contentDislikes;
  if (contentTotal > 0) {
    const contentSentiment = (contentLikes - contentDislikes) / contentTotal;
    const contentConfidence = confidenceFromCount(contentTotal, 30);
    const base = contentSentiment >= 0
      ? contentSentiment * 40   // max +40
      : contentSentiment * 60;  // max −60
    adjustment += Math.max(-60, Math.min(40, base)) * contentConfidence;
  }

  // --- Voter engagement (+0.50 per poll interaction, no daily cap in total) ---
  const engagementScore = nonNegative(profile.contentEngagementScore);
  if (engagementScore > 0) {
    adjustment += Math.min(10, engagementScore);
  }

  // ===================================================================
  // T5 — CARDS (positive-only: max +25)
  // ===================================================================
  const cardsTotal = CARD_KEYS.reduce((sum, key) => sum + nonNegative(profile.cardsReceived?.[key]), 0);
  if (cardsTotal > 0) adjustment += Math.min(25, Math.log1p(cardsTotal) * 10);

  // ===================================================================
  // T5 — VERIFICATION & BADGES
  // ===================================================================
  // KYC is already one of the 300 onboarding points.
  const nonVerificationBadges = (profile.badges ?? []).filter((badge) => badge.toLowerCase() !== 'verified').length;
  if (nonVerificationBadges > 0) adjustment += Math.min(10, nonVerificationBadges * 2);

  return adjustment;
}

export function getCanactScoreLabel(score: number): CanactScoreSummary['label'] {
  if (score >= 800) return 'TRUST';
  if (score >= 680) return 'GOOD';
  if (score >= 520) return 'FAIR';
  return 'LOW';
}

function makeSummary(rawScore: number, baseline = CANACT_SCORE_BASELINE, min = CANACT_SCORE_MIN): CanactScoreSummary {
  const score = Math.round(clampNumber(rawScore, min, CANACT_SCORE_MAX));
  return {
    score,
    baseline,
    max: CANACT_SCORE_MAX,
    delta: score - baseline,
    label: getCanactScoreLabel(score),
    club: Math.max(min, Math.floor(score / 50) * 50),
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

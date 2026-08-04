export const POSITIVE_ATTRS = ['behaviour', 'reliability', 'civic_sense'] as const;
export const NEGATIVE_ATTRS = ['rude', 'unreliable', 'uncivil'] as const;
export type PositiveAttr = typeof POSITIVE_ATTRS[number];
export type NegativeAttr = typeof NEGATIVE_ATTRS[number];
export type AttrKey = PositiveAttr | NegativeAttr;

export const ATTR_LABELS: Record<AttrKey, string> = {
  behaviour: 'Behaviour',
  reliability: 'Reliability',
  civic_sense: 'Civic Sense',
  rude: 'Rude',
  unreliable: 'Unreliable',
  uncivil: 'Uncivil',
};

export const CARD_KEYS = ['understanding', 'humour', 'goodVibes', 'confidence', 'cooperative', 'intelligence', 'creativity', 'daring'] as const;
export type CardKey = typeof CARD_KEYS[number];
export const CARD_LABELS: Record<CardKey, string> = {
  understanding: 'Understanding',
  humour: 'Humour',
  goodVibes: 'Good Vibes',
  confidence: 'Confidence',
  cooperative: 'Cooperative',
  intelligence: 'Intelligence',
  creativity: 'Creativity',
  daring: 'Daring',
};

/** A standalone social recognition card. These are intentionally independent
 * from profile vote counters and never affect the Canact score. */
export interface ConnectionCardGift {
  id: string;
  kind: CardKey;
  fromUid: string;
  fromName: string;
  fromPhoto?: string;
  toUid: string;
  toName: string;
  sentAt: number;
}

/** One-time recognition cards. This domain is intentionally separate from
 * profile vote cards: transfers are permanent and never affect Canact score. */
export const LIFETIME_CARD_KINDS = ['life_saver', 'golden_person', 'custom'] as const;
export type LifetimeCardKind = typeof LIFETIME_CARD_KINDS[number];
export const LIFETIME_CARD_LABELS: Record<LifetimeCardKind, string> = {
  life_saver: 'Life Saver',
  golden_person: 'Golden Person',
  custom: 'Your Words',
};

export interface LifetimeCardSlot {
  kind: LifetimeCardKind;
  status: 'available' | 'sent';
  sentAt?: number;
  recipientUid?: string;
  recipientName?: string;
}

export interface LifetimeCardGift {
  id: string;
  kind: LifetimeCardKind;
  fromUid: string;
  fromName: string;
  fromPhoto?: string;
  toUid: string;
  toName: string;
  customText?: string;
  sentAt: number;
  transferCount?: number;
}

export type GiftCandidateCategory = 'interacted' | 'nearby' | 'contacts' | 'favourites' | 'friends';
export interface GiftCandidate {
  uid: string;
  name: string;
  photoURL?: string;
  city?: string;
  categories: GiftCandidateCategory[];
}

export type HelpType = 'red' | 'orange' | 'yellow';
export type HelpStatus = 'open' | 'inProcess' | 'closed';
export type HelpAudience = 'public' | 'favourites' | 'contacts';
export type HelpChannel = 'chat' | 'call' | 'inPerson';

export type MoodState = 'balanced' | 'low' | 'vulnerable';
export type MoodKind = 'joyful' | 'calm' | 'grateful' | 'tired' | 'drained' | 'numb' | 'sad' | 'anxious' | 'lonely';

export interface PublicMood {
  kind: MoodKind;
  intensity: number;
  updatedAt: number;
}

export interface UserProfile {
  uid: string;
  fullName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  mobile?: string;
  mobileVerifiedAt?: number;
  selfieVerifiedAt?: number;
  selfieVerificationMethod?: 'blink-liveness-v1';
  city?: string;
  country?: string;
  countryCode?: string;
  address?: string;
  dateOfBirth?: string;
  bio?: string;
  /** The user's current public mood. Private mood history remains on-device. */
  currentMood?: PublicMood | null;
  /** Last mood publish/removal time, used to enforce the two-hour update cooldown. */
  moodUpdatedAt?: number;
  photoURL?: string;
  coverPhoto?: string;
  profileVerified?: boolean;
  verificationProvider?: 'digilocker';
  verificationIdLast4?: string;
  verifiedAt?: number;
  verificationLockedAt?: number;
  rating: number;
  ratingCount: number;
  /** Persisted Canact score cache. Ranking still recomputes from source
   * signals so stale clients cannot affect leaderboard order. */
  canactScore?: number;
  canactScoreUpdatedAt?: number;
  likesCount: number;
  dislikesCount: number;
  attrs: Record<AttrKey, number>;
  cardsReceived: Record<CardKey, number>;
  badges: string[];
  tags: string[];
  notificationSound: boolean;
  underground?: boolean;
  undergroundUntil?: number;
  undergroundStartedAt?: number;
  undergroundExtendedAt?: number;
  undergroundDayCount?: number;
  undergroundDayKey?: string;
  rateMeOn?: boolean;
  rateMeUntil?: number;
  /** True once the user has filled the post-Google-signin onboarding form. */
  profileComplete?: boolean;
  /** Versioned first-run progression. Version 1 uses contextual, paced tasks
   * that total exactly 300 points; legacy profiles intentionally omit it. */
  onboarding?: {
    version: 1;
    points: number;
    startedAt: number;
    completedAt?: number;
    completed?: Record<string, { at: number; points: number }>;
    signals?: Record<string, number>;
    reminders?: Record<string, { shownAt?: number; skippedAt?: number; nextEligibleAt?: number; showCount?: number }>;
    lastPromptAt?: number;
    activity?: { lastActiveAt?: number; routeViews?: Record<string, number> };
    tours?: Record<string, { completedAt?: number; skippedAt?: number }>;
  };
  /** Historical reputation adjustment captured during the zero-score reset.
   * It lets existing votes/cards remain visible without carrying old points. */
  scoreAdjustmentOffset?: number;
  scoreResetAt?: number;
  /** Aggregate help statistics shown on profile + help cards. */
  helpStats?: {
    offered?: number;   // offers extended by this user
    confirmed?: number; // offers asker confirmed (total, all types)
    resolved?: number;  // helps closed as resolved that this user worked on (total)
    noShow?: number;    // offers where user didn't show up
    asked?: number;     // help requests posted by this user
    taken?: number;     // their help requests that closed (any outcome)
    /** Per-type resolved counts for help-type multiplier (Red 1.5×, Orange 1.2×, Yellow 1.0×). */
    redResolved?: number;
    orangeResolved?: number;
    yellowResolved?: number;
    redConfirmed?: number;
    orangeConfirmed?: number;
    yellowConfirmed?: number;
    /** Help-seeker outcome judgments. */
    triedGood?: number;  // helper tried, genuine effort → +10 flat each
    triedBad?: number;   // helper tried, bad intent → −100 flat each
    yesOutcomes?: number; // seeker said "yes" — for confidence scaling of +45
  };
  /** Accumulated content reaction score from post/poll likes & dislikes (T4). */
  contentLikes?: number;
  contentDislikes?: number;
  /** Accumulated voter engagement score (+0.50 per poll interaction, capped +10/day). */
  contentEngagementScore?: number;
  contentEngagementDayKey?: string;
  contentEngagementDayCount?: number;
  /** Durable +1 community activity points, capped at 10 per day and 50 total. */
  activityScorePoints?: number;
  activityScoreDayKey?: string;
  activityScoreDayCount?: number;
  gender?: 'female' | 'male' | 'nonbinary' | 'other';
  createdAt: number;
}

export interface WhaPost {
  id: string;
  uid: string;
  authorName: string;
  authorPhoto?: string;
  text: string;
  mediaUrls: string[];
  /** Optional thumbnail URLs aligned 1:1 with `mediaUrls`. For images we
   *  reuse the image URL itself; for videos we upload a JPEG poster from
   *  the first frame so feed grid tiles paint instantly without having to
   *  download the video. Sparse array — index `i` may be missing if poster
   *  generation failed for that item. */
  mediaPosters?: string[];
  /** Tiny (~20px) base64 blur placeholders, 1:1 with `mediaUrls`.
   *  Rendered as an instant background-image behind the full-res media
   *  so feed tiles show a blur-up transition instead of a blank tile. */
  mediaLqips?: string[];
  lat?: number;
  lng?: number;
  createdAt: number;
  /** Legacy field retained for older records. Feed posts no longer expire;
   * map discovery derives its 24-hour window from `createdAt`. */
  expiresAt?: number;
  reactions?: Record<'cool' | 'love' | 'wow' | 'sad' | 'angry', number>;
  reactionVoters?: Record<string, string>;
  commentCount?: number;
}

export interface PollOption { id: string; text: string; votes: number }
export interface Poll {
  id: string;
  uid: string;
  authorName: string;
  question: string;
  photoURL?: string;
  /** Tiny base64 blur placeholder for the poll photo. */
  lqip?: string;
  options: PollOption[];
  openEnded: boolean;
  createdAt: number;
  endsAt: number;
  voters?: Record<string, string>;
  likes?: number;
  dislikes?: number;
  reactionVoters?: Record<string, 'like' | 'dislike'>;
  commentCount?: number;
  lat?: number;
  lng?: number;
}

export interface RateMeSession {
  id: string;
  uid: string;
  authorName: string;
  photoURL?: string;
  /** Tiny base64 blur placeholder for the session photo. */
  lqip?: string;
  startedAt: number;
  endsAt: number;
  votes?: Record<string, 'like' | 'dislike'>;
  likes: number;
  dislikes: number;
  commentCount?: number;
}

export interface StoryOverlay {
  id: string;
  text: string;
  /** 0..1 relative position */
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
  color?: string;
  background?: string;
}

export interface StoryViewer {
  uid: string;
  name: string;
  photoURL?: string;
  at: number;
  liked?: boolean;
}

export interface StoryReply {
  id: string;
  fromUid: string;
  fromName: string;
  fromPhoto?: string;
  text: string;
  createdAt: number;
}

export interface StoryItem {
  id: string;
  uid: string;
  authorName: string;
  authorPhoto?: string;
  mediaUrl: string;
  /** Tiny base64 blur placeholder for the story media. */
  lqip?: string;
  caption?: string;
  /** Location at publish time, used for map-bound story discovery. */
  lat?: number;
  lng?: number;
  /** CSS filter id from MEDIA_FILTERS (e.g. 'vivid', 'mono'). */
  filter?: string;
  overlays?: StoryOverlay[];
  viewers?: Record<string, StoryViewer>;
  likes?: Record<string, number>;
  replies?: Record<string, StoryReply>;
  createdAt: number;
  expiresAt: number;
  durationHours?: 12 | 24 | 48 | 72;
}

export interface HelpRequest {
  id: string;
  uid: string;
  authorName: string;
  authorPhoto?: string;
  authorRating: number;
  type: HelpType;
  text: string;
  audience: HelpAudience;
  channel: HelpChannel;
  vicinityMeters: number;
  lat?: number;
  lng?: number;
  status: HelpStatus;
  createdAt: number;
  acceptedBy?: Record<string, { name: string; photoURL?: string; at: number }>;
  /** Asker explicitly confirms an offering helper to unlock chat/call/location actions. */
  confirmedHelpers?: Record<string, { at: number }>;
  /** Auto-created chat thread per confirmed helper (chat-channel helps). */
  helpThreads?: Record<string, string>;
  /** Active in-app call id for this help (call-channel helps). */
  callId?: string;
  /** Bilateral ratings keyed by `${fromUid}__${toUid}`. */
  ratings?: Record<string, { fromUid: string; toUid: string; stars: number; note?: string; at: number }>;
  closedAt?: number;
  closeOutcome?: 'yes' | 'no' | 'tried' | 'tried-good' | 'tried-bad';
}

export interface ChatMessage {
  id: string;
  fromUid: string;
  toUid: string;
  text: string;
  createdAt: number;
  /** Edited timestamp; presence implies the message has been edited. */
  editedAt?: number;
  /** Soft delete: when true, body is replaced with a tombstone. */
  deleted?: boolean;
  /** Emoji reactions keyed by uid -> emoji. */
  reactions?: Record<string, string>;
  /** Quoted/replied message context shown above the bubble. */
  replyTo?: {
    id: string;
    fromUid: string;
    text: string;
  };
  /** Optional shared attachment rendered as a rich card. */
  attachment?: ChatAttachment;
}

export type ChatAttachment =
  | {
      kind: 'post';
      postId: string;
      authorName?: string;
      text?: string;
      thumbUrl?: string;
    }
  | {
      kind: 'poll';
      pollId: string;
      authorName?: string;
      question?: string;
      thumbUrl?: string;
    }
  | {
      kind: 'reel';
      reelId: string;
      authorName?: string;
      caption?: string;
      thumbUrl?: string;
      videoUrl?: string;
    }
  | {
      kind: 'rateme';
      sessionId: string;
      authorName?: string;
      thumbUrl?: string;
    }
  | {
      kind: 'voice';
      audioUrl: string;
      durationSec: number;
    };

export type ChatThreadStatus = 'pending' | 'accepted' | 'declined';

export interface ChatThread {
  id: string;
  members: Record<string, true>;
  initiator: string;
  status: ChatThreadStatus;
  createdAt: number;
  lastMessageAt: number;
  lastMessageText?: string;
  participants: Record<string, { uid: string; name: string; photoURL?: string }>;
  unread?: Record<string, number>;
}

export interface ReelItem {
  id: string;
  uid: string;
  authorName: string;
  authorPhoto?: string;
  videoUrl: string;
  /** Tiny base64 blur placeholder for the reel thumbnail. */
  lqip?: string;
  posterUrl?: string;
  caption?: string;
  /** Location captured when the reel was published. Map discovery only
   * exposes it for the first 24 hours; the reel itself remains in the feed. */
  lat?: number;
  lng?: number;
  /** CSS filter id from MEDIA_FILTERS (e.g. 'vivid', 'mono'). */
  filter?: string;
  music?: { id: string; title: string; artist: string; url: string; startAtSec?: number; volume?: number };
  /** True when soundtrack and original audio are already muxed into videoUrl. */
  audioStitched?: boolean;
  likes?: Record<string, number>;
  views?: number;
  commentCount?: number;
  createdAt: number;
}

export type FriendStatus = 'none' | 'requested' | 'incoming' | 'friends';

export interface FriendEdge {
  uid: string;
  name: string;
  photoURL?: string;
  at: number;
}

export interface NotificationItem {
  id: string;
  kind: 'help' | 'follow' | 'react' | 'comment' | 'gift' | 'system';
  title: string;
  body?: string;
  data?: any;
  read: boolean;
  createdAt: number;
}

export type FeedItem =
  | { kind: 'wha'; data: WhaPost }
  | { kind: 'poll'; data: Poll }
  | { kind: 'rateme'; data: RateMeSession }
  | { kind: 'reel'; data: ReelItem };

/* ---------- Vicinity / proximity rating ---------- */

export interface PresenceEntry {
  uid: string;
  lat: number;
  lng: number;
  accuracy: number;
  name: string;
  photoURL?: string;
  updatedAt: number;
}

export interface Encounter {
  a: string;
  b: string;
  startedAt: number;
  lastSeen: number;
  samples: number;
  qualified?: boolean;
  closestMeters?: number;
}

export interface PendingRating {
  pairKey: string;
  otherUid: string;
  otherName: string;
  otherPhoto?: string;
  encounteredAt: number;
  departedAt: number;
  durationMs: number;
}

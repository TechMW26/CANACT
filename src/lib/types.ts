export const POSITIVE_ATTRS = ['behaviour', 'action', 'reliable'] as const;
export const NEGATIVE_ATTRS = ['rude', 'inactive', 'unreliable'] as const;
export type PositiveAttr = typeof POSITIVE_ATTRS[number];
export type NegativeAttr = typeof NEGATIVE_ATTRS[number];
export type AttrKey = PositiveAttr | NegativeAttr;

export const CARD_KEYS = ['understanding', 'humour', 'goodVibes', 'confidence', 'intelligence', 'creativity', 'daring'] as const;
export type CardKey = typeof CARD_KEYS[number];
export const CARD_LABELS: Record<CardKey, string> = {
  understanding: 'Understanding',
  humour: 'Humour',
  goodVibes: 'Good Vibes',
  confidence: 'Confidence',
  intelligence: 'Intelligence',
  creativity: 'Creativity',
  daring: 'Daring',
};

export type HelpType = 'red' | 'orange' | 'yellow';
export type HelpStatus = 'open' | 'inProcess' | 'closed';
export type HelpAudience = 'public' | 'favourites' | 'contacts';
export type HelpChannel = 'chat' | 'call' | 'inPerson';

export interface UserProfile {
  uid: string;
  fullName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  mobile?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  address?: string;
  dateOfBirth?: string;
  bio?: string;
  photoURL?: string;
  profileVerified?: boolean;
  verificationProvider?: 'digilocker';
  verificationIdLast4?: string;
  verifiedAt?: number;
  verificationLockedAt?: number;
  rating: number;
  ratingCount: number;
  likesCount: number;
  dislikesCount: number;
  attrs: Record<AttrKey, number>;
  cardsReceived: Record<CardKey, number>;
  badges: string[];
  tags: string[];
  notificationSound: boolean;
  underground?: boolean;
  undergroundUntil?: number;
  undergroundDayCount?: number;
  undergroundDayKey?: string;
  rateMeOn?: boolean;
  rateMeUntil?: number;
  /** True once the user has filled the post-Google-signin onboarding form. */
  profileComplete?: boolean;
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
  lat?: number;
  lng?: number;
  createdAt: number;
  expiresAt: number;
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
  startedAt: number;
  endsAt: number;
  votes?: Record<string, 'like' | 'dislike'>;
  likes: number;
  dislikes: number;
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
  caption?: string;
  /** CSS filter id from MEDIA_FILTERS (e.g. 'vivid', 'mono'). */
  filter?: string;
  overlays?: StoryOverlay[];
  viewers?: Record<string, StoryViewer>;
  likes?: Record<string, number>;
  replies?: Record<string, StoryReply>;
  createdAt: number;
  expiresAt: number;
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
  closedAt?: number;
  closeOutcome?: 'yes' | 'no' | 'tried';
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
      kind: 'reel';
      reelId: string;
      authorName?: string;
      caption?: string;
      thumbUrl?: string;
      videoUrl?: string;
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
  posterUrl?: string;
  caption?: string;
  /** CSS filter id from MEDIA_FILTERS (e.g. 'vivid', 'mono'). */
  filter?: string;
  music?: { id: string; title: string; artist: string; url: string };
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
  kind: 'help' | 'follow' | 'react' | 'comment' | 'system';
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

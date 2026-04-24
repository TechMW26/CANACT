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
  bio?: string;
  photoURL?: string;
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
  passwordHash?: string;
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
  | { kind: 'rateme'; data: RateMeSession };

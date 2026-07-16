'use client';
import { push, ref, set } from 'firebase/database';
import { db } from '../firebase';

/** Known page route IDs for heatzone mapping. Add new routes here. */
export const PAGE_IDS: Record<string, string> = {
  '/': 'Home',
  '/feed': 'Feed',
  '/leaderboard': 'Leaderboard',
  '/favourites': 'Favourites',
  '/create': 'Create',
  '/inbox': 'Inbox',
  '/profile': 'Profile',
  '/search': 'Search',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
  '/help': 'Help',
  '/underground': 'Underground',
  '/post/create': 'Post Create',
  '/reel/create': 'Reel Create',
  '/story/create': 'Story Create',
  '/poll/create': 'Poll Create',
  '/rateme/start': 'RateMe Start',
  '/explore': 'Explore',
  '/welcome': 'Welcome',
  '/onboard': 'Onboarding',
};

/** Known feature/action IDs per page for feature heatmapping. */
export const FEATURE_IDS: Record<string, Record<string, string>> = {
  Feed: {
    'tab_posts': 'Posts tab',
    'tab_reels': 'Reels tab',
    'tab_polls': 'Polls tab',
    'tab_rateme': 'RateMe tab',
    'react_like': 'Like reaction',
    'react_comment': 'Comment',
    'share_post': 'Share',
    'scroll': 'Feed scroll',
  },
  Home: {
    'score_tap': 'Score island',
    'nearby_tap': 'Nearby map',
    'create_tap': 'Create button',
    'profile_tap': 'Profile pill',
  },
  Leaderboard: {
    'tab_global': 'Global tab',
    'tab_friends': 'Friends tab',
    'profile_tap': 'View profile',
  },
  Profile: {
    'edit_profile': 'Edit profile',
    'settings': 'Settings',
    'add_friend': 'Add friend',
    'message': 'Message',
    'tab_posts': 'Posts tab',
    'tab_reels': 'Reels tab',
    'tab_polls': 'Polls tab',
  },
  Create: {
    'post': 'Post',
    'reel': 'Reel',
    'story': 'Story',
    'poll': 'Poll',
    'rateme': 'Rate Me',
    'help': 'Help',
    'search': 'Search',
  },
  Inbox: {
    'chat_open': 'Open chat',
    'chat_send': 'Send message',
    'call_start': 'Start call',
  },
};

/** Resolve a pathname to its page label. */
export function pageLabel(pathname: string): string {
  // Exact match first
  if (PAGE_IDS[pathname]) return PAGE_IDS[pathname];
  // Try prefix match (e.g. /profile/abc123 → Profile)
  for (const [prefix, label] of Object.entries(PAGE_IDS)) {
    if (prefix !== '/' && pathname.startsWith(prefix)) return label;
  }
  return 'Unknown';
}

/**
 * Record a page view to RTDB. Called on every route change.
 * Data stored at: heatzones/pageViews/{pageLabel}_{YYYY-MM-DD}/{pushKey}
 */
export async function recordPageView(pathname: string, fromPage: string, uid?: string) {
  if (!uid) return;
  try {
    const label = pageLabel(pathname);
    const date = new Date().toISOString().slice(0, 10);
    const node = push(ref(db, `heatzones/pageViews/${label}_${date}`));
    await set(node, {
      pageId: label,
      fromPage: fromPage === 'Direct' ? 'Direct' : pageLabel(fromPage),
      timestamp: Date.now(),
    });
  } catch { /* fire-and-forget */ }
}

/**
 * Record a feature interaction to RTDB.
 * Data stored at: heatzones/featureClicks/{pageLabel}_{YYYY-MM-DD}/{pushKey}
 */
export async function recordFeatureClick(pageLabel: string, featureId: string, uid?: string) {
  if (!uid) return;
  try {
    const date = new Date().toISOString().slice(0, 10);
    const node = push(ref(db, `heatzones/featureClicks/${pageLabel}_${date}`));
    await set(node, {
      pageId: pageLabel,
      featureId,
      timestamp: Date.now(),
    });
  } catch { /* fire-and-forget */ }
}

import { ref, runTransaction, update } from 'firebase/database';
import { db } from '../firebase';

export const ONBOARDING_VERSION = 1 as const;

export const ONBOARDING_TASKS = [
  { id: 'complete-profile', title: 'Complete your profile', description: 'Add your real details so trusted connections can recognise you.', points: 25, href: '/edit-profile' },
  { id: 'face-identity', title: 'Set up facial identity', description: 'Your registration selfie protects your profile and confirms it is yours.', points: 20, href: '/edit-profile' },
  { id: 'verify-identity', title: 'Verify your identity', description: 'Complete the mandatory DigiLocker KYC identity lock.', points: 40, href: '/profile/settings' },
  { id: 'welcome-tour', title: 'Take the Canact tour', description: 'Learn how nearby profiles, ratings, Help and community trust work.', points: 20, href: '/' },
  { id: 'sync-contacts', title: 'Sync your contacts', description: 'Choose contacts to discover people you already know on Canact.', points: 30 },
  { id: 'enable-notifications', title: 'Enable notifications', description: 'Stay informed about ratings, favourites, Help and connection activity.', points: 20 },
  { id: 'enable-location', title: 'Enable nearby discovery', description: 'Allow location access to use vicinity cards and the live Explore map.', points: 25, href: '/favourites' },
  { id: 'rate-profile', title: 'Rate your first profile', description: 'Give an honest like, dislike or attribute to someone you know.', points: 30, href: '/favourites' },
  { id: 'visit-feed', title: 'Explore the community feed', description: 'See what is happening, polls, Rate Me sessions, stories and reels.', points: 20, href: '/feed' },
  { id: 'learn-help', title: 'Learn the Help system', description: 'Review red, orange and yellow Help requests and how outcomes work.', points: 25, href: '/help' },
  { id: 'add-favourite', title: 'Add your first favourite', description: 'Send a favourite request to someone you want to stay connected with.', points: 20, href: '/search' },
  { id: 'view-leaderboard', title: 'Open the leaderboard', description: 'See community trust rankings after completing your main setup.', points: 25, href: '/leaderboard' },
] as const;

export type OnboardingTaskId = typeof ONBOARDING_TASKS[number]['id'];
export const ONBOARDING_MAX_POINTS = ONBOARDING_TASKS.reduce((sum, task) => sum + task.points, 0);

type Progress = {
  version: 1;
  points: number;
  startedAt: number;
  completedAt?: number;
  completed: Partial<Record<OnboardingTaskId, { at: number; points: number }>>;
  signals: Partial<Record<OnboardingTaskId, number>>;
};

export function currentOnboardingTask(progress?: Progress | null) {
  return ONBOARDING_TASKS.find((task) => !progress?.completed?.[task.id]) ?? null;
}

/** Records durable evidence, then releases every now-eligible sequential task. */
export async function recordOnboardingSignal(uid: string, taskId: OnboardingTaskId) {
  if (!uid) return;
  const now = Date.now();
  await runTransaction(ref(db, `users/${uid}/onboarding`), (value: Progress | null) => {
    if (value?.version !== ONBOARDING_VERSION) return value;
    const next: Progress = {
      ...value,
      points: Number(value.points || 0),
      completed: { ...(value.completed || {}) },
      signals: { ...(value.signals || {}), [taskId]: value.signals?.[taskId] || now },
    };
    for (const task of ONBOARDING_TASKS) {
      if (next.completed[task.id]) continue;
      if (!next.signals[task.id]) break;
      next.completed[task.id] = { at: now, points: task.points };
      next.points = Math.min(ONBOARDING_MAX_POINTS, next.points + task.points);
    }
    if (ONBOARDING_TASKS.every((task) => next.completed[task.id])) next.completedAt ||= now;
    return next;
  });
}

export async function saveContactSync(uid: string, contacts: Array<{ name?: string[]; tel?: string[]; email?: string[] }>) {
  const entries = Object.fromEntries(contacts.map((contact, index) => [`c${index}`, {
    name: contact.name?.[0] || '',
    tel: contact.tel?.[0] || '',
    email: contact.email?.[0] || '',
  }]));
  await update(ref(db, `contactSyncs/${uid}`), { syncedAt: Date.now(), count: contacts.length, entries });
  await recordOnboardingSignal(uid, 'sync-contacts');
}

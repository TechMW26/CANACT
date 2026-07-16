import { ref, runTransaction, update } from 'firebase/database';
import { db } from '../firebase';

export const ONBOARDING_VERSION = 1 as const;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const INTERNAL_ONBOARDING_WINDOW = 7 * DAY;

export const ONBOARDING_TASKS = [
  { id: 'complete-profile', title: 'Complete your profile', description: 'Add your real details so trusted connections can recognise you.', points: 25, href: '/edit-profile', contexts: ['/', '/profile', '/edit-profile'], minAge: 0 },
  { id: 'face-identity', title: 'Add your profile identity', description: 'Use a clear profile photo so people you meet can recognise you.', points: 20, href: '/edit-profile', contexts: ['/', '/profile', '/edit-profile'], minAge: 0 },
  { id: 'verify-identity', title: 'Verify your identity', description: 'Complete DigiLocker verification to secure your profile and unlock trusted features.', points: 40, href: '/settings', contexts: ['/', '/profile', '/settings'], minAge: 0 },
  { id: 'sync-contacts', title: 'Find people you already know', description: 'Allow contact access and choose up to 10 people to discover on Canact.', points: 30, contexts: ['/', '/search', '/profile'], minAge: 30 * 60 * 1000 },
  { id: 'enable-notifications', title: 'Stay in the loop', description: 'Enable notifications for ratings, favourites, Help and nearby activity.', points: 15, contexts: ['/', '/feed', '/inbox'], minAge: 2 * HOUR },
  { id: 'enable-location', title: 'Discover your community', description: 'Allow location access for vicinity cards and the live Explore map.', points: 20, href: '/favourites', contexts: ['/', '/favourites'], minAge: 30 * 60 * 1000 },
  { id: 'rate-profile', title: 'Recognise someone', description: 'Like someone or add an honest attribute after a real interaction.', points: 30, href: '/favourites', contexts: ['/favourites', '/profile'], minAge: 2 * HOUR },
  { id: 'add-favourite', title: 'Keep someone close', description: 'Add someone meaningful to your favourites so you can stay connected.', points: 20, href: '/search', contexts: ['/search', '/profile', '/favourites'], minAge: 6 * HOUR },
  { id: 'create-post', title: 'Share what is happening', description: 'Create your first community post and help people understand what is happening nearby.', points: 30, href: '/post/create', contexts: ['/feed'], minAge: 12 * HOUR },
  { id: 'engage-post', title: 'Join a conversation', description: 'React to or comment on a community post for the first time.', points: 25, href: '/feed', contexts: ['/feed'], minAge: 6 * HOUR },
  { id: 'offer-help', title: 'Offer to help', description: 'Respond to a genuine Help request when you are able to contribute.', points: 45, href: '/help', contexts: ['/help'], minAge: DAY },
] as const;

export type OnboardingTaskId = typeof ONBOARDING_TASKS[number]['id'];
export const ONBOARDING_MAX_POINTS = ONBOARDING_TASKS.reduce((sum, task) => sum + task.points, 0);

export type OnboardingPromptRecord = {
  shownAt?: number;
  skippedAt?: number;
  nextEligibleAt?: number;
  showCount?: number;
};

export type OnboardingProgress = {
  version: 1;
  points: number;
  startedAt: number;
  completedAt?: number;
  completed: Partial<Record<OnboardingTaskId, { at: number; points: number }>>;
  signals: Partial<Record<OnboardingTaskId, number>>;
  reminders?: Partial<Record<OnboardingTaskId, OnboardingPromptRecord>>;
  lastPromptAt?: number;
  activity?: { lastActiveAt?: number; routeViews?: Record<string, number> };
  tours?: Record<string, { completedAt?: number; skippedAt?: number }>;
};

function routeMatches(pathname: string, context: string) {
  if (context === '/') return pathname === '/';
  return pathname === context || pathname.startsWith(`${context}/`);
}

function promptGap(progress: OnboardingProgress, now: number) {
  const age = Math.max(0, now - Number(progress.startedAt || now));
  if (age >= 6 * DAY) return 75 * 60 * 1000;
  if (age >= 4 * DAY) return 3 * HOUR;
  return 6 * HOUR;
}

/** Selects a useful prompt for the current screen without forcing a linear queue. */
export function currentOnboardingTask(progress?: OnboardingProgress | null, pathname = '/', now = Date.now()) {
  if (!progress || progress.version !== ONBOARDING_VERSION) return null;
  if (progress.lastPromptAt && now - progress.lastPromptAt < promptGap(progress, now)) return null;

  const age = Math.max(0, now - Number(progress.startedAt || now));
  const deadlineMode = age >= INTERNAL_ONBOARDING_WINDOW * 0.72;
  const incomplete = ONBOARDING_TASKS.filter((task) => {
    if (progress.completed?.[task.id]) return false;
    if (!deadlineMode && age < task.minAge) return false;
    if (Number(progress.reminders?.[task.id]?.nextEligibleAt || 0) > now) return false;
    return task.contexts.some((context) => routeMatches(pathname, context));
  });

  if (incomplete.length) return incomplete[0];
  if (deadlineMode && pathname === '/') {
    return ONBOARDING_TASKS.find((task) => !progress.completed?.[task.id] && Number(progress.reminders?.[task.id]?.nextEligibleAt || 0) <= now) ?? null;
  }
  return null;
}

/** Records durable evidence and awards the matching task immediately. */
export async function recordOnboardingSignal(uid: string, taskId: OnboardingTaskId) {
  if (!uid) return { awarded: 0, points: 0 };
  const task = ONBOARDING_TASKS.find((item) => item.id === taskId);
  if (!task) return { awarded: 0, points: 0 };
  const now = Date.now();
  const result = await runTransaction(ref(db, `users/${uid}/onboarding`), (value: OnboardingProgress | null) => {
    if (value?.version !== ONBOARDING_VERSION) return value;
    if (value.completed?.[taskId]) return value;
    const completed = { ...(value.completed || {}), [taskId]: { at: now, points: task.points } };
    const next: OnboardingProgress = {
      ...value,
      points: Math.min(ONBOARDING_MAX_POINTS, Number(value.points || 0) + task.points),
      completed,
      signals: { ...(value.signals || {}), [taskId]: value.signals?.[taskId] || now },
    };
    if (ONBOARDING_TASKS.every((item) => completed[item.id])) next.completedAt ||= now;
    return next;
  });
  const progress = result.snapshot.val() as OnboardingProgress | null;
  const awarded = progress?.completed?.[taskId]?.at === now ? task.points : 0;
  return { awarded, points: Number(progress?.points || 0) };
}

export async function markOnboardingPromptShown(uid: string, taskId: OnboardingTaskId) {
  const now = Date.now();
  await runTransaction(ref(db, `users/${uid}/onboarding`), (value: OnboardingProgress | null) => {
    if (value?.version !== ONBOARDING_VERSION || value.completed?.[taskId]) return value;
    const current = value.reminders?.[taskId] || {};
    return {
      ...value,
      lastPromptAt: now,
      reminders: {
        ...(value.reminders || {}),
        [taskId]: { ...current, shownAt: now, showCount: Number(current.showCount || 0) + 1 },
      },
    };
  });
}

export async function snoozeOnboardingTask(uid: string, taskId: OnboardingTaskId) {
  const now = Date.now();
  await runTransaction(ref(db, `users/${uid}/onboarding`), (value: OnboardingProgress | null) => {
    if (value?.version !== ONBOARDING_VERSION || value.completed?.[taskId]) return value;
    const current = value.reminders?.[taskId] || {};
    const repeat = Math.max(1, Number(current.showCount || 1));
    const age = Math.max(0, now - Number(value.startedAt || now));
    const delay = age >= 6 * DAY ? 90 * 60 * 1000 : Math.min(18 * HOUR, (4 + repeat * 2) * HOUR);
    return {
      ...value,
      reminders: {
        ...(value.reminders || {}),
        [taskId]: { ...current, skippedAt: now, nextEligibleAt: now + delay },
      },
    };
  });
}

export async function recordOnboardingActivity(uid: string, pathname: string) {
  if (!uid) return;
  const now = Date.now();
  const route = pathname.split('/').filter(Boolean)[0] || 'home';
  await runTransaction(ref(db, `users/${uid}/onboarding`), (value: OnboardingProgress | null) => {
    if (value?.version !== ONBOARDING_VERSION || value.completedAt) return value;
    const views = { ...(value.activity?.routeViews || {}) };
    views[route] = Number(views[route] || 0) + 1;
    return { ...value, activity: { ...(value.activity || {}), lastActiveAt: now, routeViews: views } };
  });
}

export async function markOnboardingTour(uid: string, routeKey: string, outcome: 'completed' | 'skipped') {
  const now = Date.now();
  await update(ref(db, `users/${uid}/onboarding/tours/${routeKey}`), outcome === 'completed' ? { completedAt: now } : { skippedAt: now });
}

export async function saveContactSync(uid: string, contacts: Array<{ name?: string[]; tel?: string[]; email?: string[] }>) {
  const selected = contacts.slice(0, 10);
  const entries = Object.fromEntries(selected.map((contact, index) => [`c${index}`, {
    name: contact.name?.[0] || '',
    tel: contact.tel?.[0] || '',
    email: contact.email?.[0] || '',
  }]));
  await update(ref(db, `contactSyncs/${uid}`), { syncedAt: Date.now(), count: selected.length, entries });
  await recordOnboardingSignal(uid, 'sync-contacts');
  return selected.length;
}

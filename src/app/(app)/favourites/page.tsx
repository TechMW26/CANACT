'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { FriendsWorldMap, type FriendMapPerson } from '@/components/FriendsWorldMap';
import { acceptFollow, blockUser, listenFavourites, listenFollowRequests, rejectFollow } from '@/lib/services/favourites';
import {
  acceptFriendRequest, declineFriendRequest, listenFriends, listenIncomingRequests, unfriend,
} from '@/lib/services/friends';
import type { FriendEdge, UserProfile } from '@/lib/types';
import { AlignLeft, MapPin, Star } from '@/components/icons';

type Tab = 'friends' | 'favourites' | 'requests';
type PeopleView = 'map' | 'list';
type MapLocation = { lat: number; lng: number; at?: number; source: 'live' | 'city' };
type CityPoint = { lat: number; lng: number };
type FriendProfile = UserProfile & { lastLocation?: { lat?: number; lng?: number; at?: number } };
type PeoplePerson = FriendMapPerson & { at?: number; rating?: number; relation: 'friend' | 'favourite' };
type FavouriteRequest = { fromUid: string; fromName: string; createdAt: number; profile?: UserProfile | null };

export default function FavouritesPage() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState<Tab>('friends');
  const [peopleView, setPeopleView] = useState<PeopleView>('map');
  const [friends, setFriends] = useState<FriendEdge[]>([]);
  const [friendReqs, setFriendReqs] = useState<FriendEdge[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, FriendProfile | null>>({});
  const [favs, setFavs] = useState<FriendProfile[]>([]);
  const [favReqs, setFavReqs] = useState<FavouriteRequest[]>([]);
  const knownProfiles = useMemo(() => [
    ...Object.values(friendProfiles).filter(isFriendProfile),
    ...favs,
    profile as FriendProfile | null,
  ].filter(isFriendProfile), [friendProfiles, favs, profile]);
  const cityLocations = useCityLocations(knownProfiles);

  useEffect(() => { if (user) return listenFriends(user.uid, setFriends); }, [user?.uid]);
  useEffect(() => { if (user) return listenIncomingRequests(user.uid, setFriendReqs); }, [user?.uid]);

  const friendIds = useMemo(() => friends.map((friend) => friend.uid).sort().join('|'), [friends]);
  useEffect(() => {
    if (!friends.length) { setFriendProfiles({}); return; }
    const uidSet = new Set(friends.map((friend) => friend.uid));
    setFriendProfiles((current) => Object.fromEntries(Object.entries(current).filter(([uid]) => uidSet.has(uid))) as Record<string, FriendProfile | null>);
    const offs = friends.map((friend) => onValue(ref(db, `users/${friend.uid}`), (snap) => {
      setFriendProfiles((current) => ({ ...current, [friend.uid]: snap.val() as FriendProfile | null }));
    }));
    return () => { offs.forEach((off) => off()); };
  }, [friendIds, friends]);

  useEffect(() => {
    if (!user) return;
    return listenFavourites(user.uid, async (uids) => {
      const out: FriendProfile[] = [];
      await Promise.all(uids.map(async (uid) => {
        const s = await new Promise<FriendProfile | null>((res) => {
          const off = onValue(ref(db, `users/${uid}`), (snap) => { off(); res(snap.val() as FriendProfile | null); }, { onlyOnce: true });
        });
        if (s) out.push(s);
      }));
      setFavs(out);
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    return listenFollowRequests(user.uid, async (rs) => {
      const out: FavouriteRequest[] = [];
      await Promise.all(rs.map(async (r) => {
        const s = await new Promise<UserProfile | null>((res) => {
          const off = onValue(ref(db, `users/${r.fromUid}`), (snap) => { off(); res(snap.val()); }, { onlyOnce: true });
        });
        out.push({ ...r, profile: s });
      }));
      setFavReqs(out);
    });
  }, [user?.uid]);

  const friendPeople = useMemo<PeoplePerson[]>(() => friends.map((friend) => {
    const friendProfile = friendProfiles[friend.uid] ?? null;
    const location = resolveProfileLocation(friendProfile, cityLocations);
    return {
      uid: friend.uid,
      at: friend.at,
      relation: 'friend' as const,
      name: friendProfile?.fullName ?? friend.name,
      photoURL: friendProfile?.photoURL ?? friend.photoURL ?? null,
      city: friendProfile?.city,
      country: friendProfile?.country,
      lat: location?.lat,
      lng: location?.lng,
      locationAt: location?.at,
      locationSource: location?.source,
      rating: friendProfile?.rating,
    };
  }).sort((a, b) => a.name.localeCompare(b.name)), [friends, friendProfiles, cityLocations]);

  const favouritePeople = useMemo<PeoplePerson[]>(() => favs.map((fav) => {
    const location = resolveProfileLocation(fav, cityLocations);
    return {
      uid: fav.uid,
      relation: 'favourite' as const,
      name: fav.fullName,
      photoURL: fav.photoURL ?? null,
      city: fav.city,
      country: fav.country,
      lat: location?.lat,
      lng: location?.lng,
      locationAt: location?.at,
      locationSource: location?.source,
      rating: fav.rating,
    };
  }).sort((a, b) => a.name.localeCompare(b.name)), [favs, cityLocations]);

  const visiblePeople = tab === 'favourites' ? favouritePeople : friendPeople;
  const currentLocation = useMemo(() => resolveProfileLocation(profile as FriendProfile | null, cityLocations), [profile, cityLocations]);
  const totalRequests = friendReqs.length + favReqs.length;
  const mapMode = tab !== 'requests' && peopleView === 'map';
  useLockPageScroll(mapMode);
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-canact-map-fade', mapMode);
    root.toggleAttribute('data-canact-friends-map-fade', mapMode);
    root.toggleAttribute('data-canact-fullscreen-page', mapMode);
    return () => {
      root.removeAttribute('data-canact-map-fade');
      root.removeAttribute('data-canact-friends-map-fade');
      root.removeAttribute('data-canact-fullscreen-page');
    };
  }, [mapMode]);

  if (!user) return null;
  return (
    <div className={mapMode ? 'canact-map-surface fixed left-0 right-0 top-0 h-[var(--canact-viewport-height)] min-h-[var(--canact-viewport-height)] w-screen overflow-hidden bg-[#FFF8F8]' : 'relative left-1/2 min-h-[calc(var(--canact-viewport-height)-8.5rem)] w-screen -translate-x-1/2 overflow-hidden bg-[#FFF8F8] lg:min-h-[calc(var(--canact-viewport-height)-3rem)]'}>
      {tab === 'requests' ? (
        <RequestsSurface
          friendReqs={friendReqs}
          favReqs={favReqs}
          onAcceptFriend={async (request) => {
            if (!profile) return;
            await acceptFriendRequest(
              user.uid,
              { name: profile.fullName, photoURL: profile.photoURL },
              request.uid,
              { name: request.name, photoURL: request.photoURL },
            );
          }}
          onDeclineFriend={(request) => declineFriendRequest(user.uid, request.uid)}
          onAcceptFavourite={(request) => acceptFollow(user.uid, request.fromUid)}
          onRejectFavourite={(request) => rejectFollow(user.uid, request.fromUid)}
        />
      ) : peopleView === 'map' ? (
        <FriendsWorldMap
          friends={visiblePeople}
          currentLocation={currentLocation}
          className="absolute inset-0 h-full min-h-full w-screen"
          emptyTitle={`No ${tab} locations yet`}
          emptyBody={`${tab === 'friends' ? 'Friends' : 'Favourites'} appear here from live location first, then selected city.`}
        />
      ) : (
        <PeopleListSurface
          people={visiblePeople}
          tab={tab}
          onUnfriend={(person) => unfriend(user.uid, person.uid)}
          onBlock={(person) => blockUser(user.uid, person.uid)}
        />
      )}

      <div className={`pointer-events-none absolute inset-x-0 top-0 z-50 px-3 lg:px-6 lg:pt-6 ${mapMode ? 'pt-[calc(env(safe-area-inset-top,0px)+88px)]' : 'pt-3'}`}>
        <RelationshipToggle tab={tab} onTabChange={setTab} friendCount={friends.length} favouriteCount={favs.length} requestCount={totalRequests} />
        {tab !== 'requests' ? (
          <MapToolbar tab={tab} people={visiblePeople} view={peopleView} onViewChange={setPeopleView} />
        ) : null}
      </div>
    </div>
  );
}

function RelationshipToggle({
  tab,
  onTabChange,
  friendCount,
  favouriteCount,
  requestCount,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  friendCount: number;
  favouriteCount: number;
  requestCount: number;
}) {
  return (
    <div className="pointer-events-auto mx-auto w-[min(calc(100vw-24px),540px)] overflow-hidden rounded-[28px] border border-[#F1D7DC] bg-white/95 p-1 shadow-sm backdrop-blur">
      <div className="grid grid-cols-3 gap-1">
        <PillTab active={tab === 'friends'} onClick={() => onTabChange('friends')} label="Friends" badge={friendCount} />
        <PillTab active={tab === 'favourites'} onClick={() => onTabChange('favourites')} label="Favourites" badge={favouriteCount} />
        <PillTab active={tab === 'requests'} onClick={() => onTabChange('requests')} label="Requests" badge={requestCount} />
      </div>
    </div>
  );
}

function MapToolbar({ tab, people, view, onViewChange }: { tab: Exclude<Tab, 'requests'>; people: PeoplePerson[]; view: PeopleView; onViewChange: (view: PeopleView) => void }) {
  const locatedCount = people.filter(hasLocation).length;
  return (
    <div className="pointer-events-auto mx-auto mt-2 flex w-[min(calc(100vw-24px),540px)] items-center justify-between gap-2 rounded-[100px] border border-[#F0D7DC] bg-white/50 pl-6 pr-2 py-2 shadow-sm backdrop-blur">
      <div className="min-w-0">
        <h3 className="truncate text-base font-extrabold text-ink">{tab === 'friends' ? 'My friends' : 'My favourites'}</h3>
        <div className="mt-0.5 truncate text-xs font-semibold text-ink/50">{locatedCount} of {people.length} visible on map</div>
      </div>
      <ViewSwitch view={view} onChange={onViewChange} />
    </div>
  );
}

function ViewSwitch({ view, onChange }: { view: PeopleView; onChange: (view: PeopleView) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-full border border-[#D9DDE5] bg-white p-1">
      <button
        type="button"
        onClick={() => onChange('map')}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-extrabold transition ${view === 'map' ? 'bg-brand text-white' : 'text-ink/60'}`}
      >
        <MapPin size={13} /> Map
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-extrabold transition ${view === 'list' ? 'bg-brand text-white' : 'text-ink/60'}`}
      >
        <AlignLeft size={13} /> List
      </button>
    </div>
  );
}

function PeopleListSurface({ people, tab, onUnfriend, onBlock }: { people: PeoplePerson[]; tab: Exclude<Tab, 'requests'>; onUnfriend: (person: PeoplePerson) => Promise<void> | void; onBlock: (person: PeoplePerson) => Promise<void> | void }) {
  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#FFF8F8] px-3 pb-6 pt-[132px] lg:px-6 lg:pt-[156px]">
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-[28px] border border-[#F1D7DC] bg-white p-2 shadow-sm">
        <PeopleList people={people} tab={tab} onUnfriend={onUnfriend} onBlock={onBlock} />
      </div>
    </div>
  );
}

function PeopleList({ people, tab, onUnfriend, onBlock }: { people: PeoplePerson[]; tab: Exclude<Tab, 'requests'>; onUnfriend: (person: PeoplePerson) => Promise<void> | void; onBlock: (person: PeoplePerson) => Promise<void> | void }) {
  if (people.length === 0) {
    return <p className="px-3 py-10 text-center text-sm font-semibold text-muted">{tab === 'friends' ? 'You don\'t have any friends yet.' : 'Search for users to add them.'}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {people.map((person) => {
        const place = [person.city, person.country].filter(Boolean).join(', ');
        const locationLabel = typeof person.lat === 'number' && typeof person.lng === 'number'
          ? person.locationSource === 'city'
            ? (place ? `Selected city · ${place}` : 'Selected city')
            : place || formatLocationTime(person.locationAt)
          : 'No recent location';
        return (
          <li key={person.uid} className="flex items-center gap-3 px-2 py-3">
            <Link href={`/profile/${person.uid}`} prefetch><Avatar src={person.photoURL ?? null} name={person.name} /></Link>
            <Link href={`/profile/${person.uid}`} prefetch className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold text-ink">{person.name}</div>
              <div className="mt-0.5 truncate text-xs font-semibold text-ink/45">{locationLabel}</div>
              {tab === 'favourites' ? (
                <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-muted">
                  <Star size={11} fill="currentColor" strokeWidth={0} className="text-brand" /> {(person.rating ?? 0).toFixed(1)}
                </div>
              ) : null}
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              {tab === 'friends' ? (
                <>
                  <Link href={`/inbox/${person.uid}`} prefetch><Button size="sm" variant="subtle">Message</Button></Link>
                  <Button size="sm" variant="outline" onClick={() => onUnfriend(person)}>Unfriend</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onBlock(person)}>Block</Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RequestsSurface({
  friendReqs,
  favReqs,
  onAcceptFriend,
  onDeclineFriend,
  onAcceptFavourite,
  onRejectFavourite,
}: {
  friendReqs: FriendEdge[];
  favReqs: FavouriteRequest[];
  onAcceptFriend: (request: FriendEdge) => Promise<void> | void;
  onDeclineFriend: (request: FriendEdge) => Promise<void> | void;
  onAcceptFavourite: (request: FavouriteRequest) => Promise<void> | void;
  onRejectFavourite: (request: FavouriteRequest) => Promise<void> | void;
}) {
  const empty = friendReqs.length === 0 && favReqs.length === 0;
  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#FFF8F8] px-3 pb-6 pt-[74px] lg:px-6 lg:pt-[102px]">
      <div className="mx-auto w-full max-w-xl space-y-3">
        {empty ? (
          <div className="rounded-[28px] border border-[#F1D7DC] bg-white px-4 py-8 text-center shadow-sm">
            <div className="text-sm font-extrabold text-ink">No pending requests</div>
            <div className="mt-1 text-xs font-semibold text-ink/50">Friend and favourite requests will appear here.</div>
          </div>
        ) : null}
        {friendReqs.length > 0 ? (
          <RequestSection title="Friend requests">
            {friendReqs.map((request) => (
              <RequestRow
                key={request.uid}
                href={`/profile/${request.uid}`}
                name={request.name}
                photoURL={request.photoURL}
                primaryLabel="Accept"
                secondaryLabel="Decline"
                onPrimary={() => onAcceptFriend(request)}
                onSecondary={() => onDeclineFriend(request)}
              />
            ))}
          </RequestSection>
        ) : null}
        {favReqs.length > 0 ? (
          <RequestSection title="Favourite requests">
            {favReqs.map((request) => {
              const name = request.profile?.fullName ?? request.fromName;
              return (
                <RequestRow
                  key={request.fromUid}
                  href={`/profile/${request.fromUid}`}
                  name={name}
                  photoURL={request.profile?.photoURL}
                  primaryLabel="Accept"
                  secondaryLabel="Reject"
                  onPrimary={() => onAcceptFavourite(request)}
                  onSecondary={() => onRejectFavourite(request)}
                />
              );
            })}
          </RequestSection>
        ) : null}
      </div>
    </div>
  );
}

function RequestSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-[#F1D7DC] bg-white p-2 shadow-sm">
      <h3 className="px-2 py-2 text-[11px] font-extrabold uppercase tracking-wide text-ink/45">{title}</h3>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

function RequestRow({
  href,
  name,
  photoURL,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  href: string;
  name: string;
  photoURL?: string | null;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => Promise<void> | void;
  onSecondary: () => Promise<void> | void;
}) {
  return (
    <li className="flex items-center gap-2 px-2 py-3">
      <Link href={href} prefetch><Avatar src={photoURL ?? null} name={name} size={38} /></Link>
      <Link href={href} prefetch className="min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold text-ink">{name}</div>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" className="h-8 px-3 text-xs" onClick={onPrimary}>{primaryLabel}</Button>
        <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={onSecondary}>{secondaryLabel}</Button>
      </div>
    </li>
  );
}

function PillTab({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-11 min-w-0 items-center justify-center rounded-full px-1 text-[13px] font-extrabold transition sm:text-sm ${active ? 'bg-brand text-white' : 'text-ink/60 hover:text-ink'}`}
    >
      <span className="truncate">{label}</span>
      {badge > 0 && (
        <span className={`ml-1.5 inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-extrabold ${active ? 'bg-white text-brand' : 'bg-brand text-white'}`}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

function hasLocation(person: PeoplePerson) {
  return typeof person.lat === 'number' && Number.isFinite(person.lat) && typeof person.lng === 'number' && Number.isFinite(person.lng);
}

function useLockPageScroll(locked: boolean) {
  useEffect(() => {
    if (!locked || typeof document === 'undefined') return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [locked]);
}

function useCityLocations(profiles: FriendProfile[]) {
  const [locations, setLocations] = useState<Record<string, CityPoint | null>>({});
  const requests = useMemo(() => {
    const out = new Map<string, string>();
    profiles.forEach((profile) => {
      if (normalizeLiveLocation(profile.lastLocation)) return;
      const key = cityLocationKey(profile);
      const query = cityLocationQuery(profile);
      if (key && query) out.set(key, query);
    });
    return [...out.entries()].map(([key, query]) => ({ key, query }));
  }, [profiles]);

  useEffect(() => {
    const pending = requests.filter(({ key }) => !(key in locations)).slice(0, 6);
    if (!pending.length) return;
    let cancelled = false;
    pending.forEach(async ({ key, query }) => {
      const location = await loadCityLocation(key, query);
      if (cancelled) return;
      setLocations((current) => (key in current ? current : { ...current, [key]: location }));
    });
    return () => { cancelled = true; };
  }, [requests, locations]);

  return locations;
}

function resolveProfileLocation(profile: FriendProfile | null | undefined, cityLocations: Record<string, CityPoint | null>): MapLocation | null {
  const live = normalizeLiveLocation(profile?.lastLocation);
  if (live) return live;
  if (!profile) return null;
  const key = cityLocationKey(profile);
  const city = key ? cityLocations[key] : null;
  return city ? { ...city, source: 'city' } : null;
}

function normalizeLiveLocation(raw: unknown): MapLocation | null {
  const value = raw as { lat?: unknown; lng?: unknown; at?: unknown } | null | undefined;
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const at = Number(value?.at);
  return { lat, lng, at: Number.isFinite(at) ? at : undefined, source: 'live' };
}

function cityLocationKey(profile: FriendProfile | null | undefined) {
  const city = normalizeCityPart(profile?.city);
  if (!city) return null;
  const country = normalizeCityPart(profile?.country || profile?.countryCode);
  return [city, country].filter(Boolean).join('|').toLowerCase();
}

function cityLocationQuery(profile: FriendProfile | null | undefined) {
  const city = normalizeCityPart(profile?.city);
  if (!city) return null;
  const country = normalizeCityPart(profile?.country || profile?.countryCode);
  return [city, country].filter(Boolean).join(', ');
}

function normalizeCityPart(value?: string) {
  const text = value?.trim().replace(/\s+/g, ' ');
  return text || null;
}

function isFriendProfile(value: FriendProfile | null | undefined): value is FriendProfile {
  return !!value?.uid;
}

async function loadCityLocation(key: string, query: string): Promise<CityPoint | null> {
  const cached = readCityLocationCache(key);
  if (cached !== undefined) return cached;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const results = await response.json() as Array<{ lat?: string; lon?: string }>;
    const lat = Number(results[0]?.lat);
    const lng = Number(results[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const point = { lat, lng };
    writeCityLocationCache(key, point);
    return point;
  } catch {
    return null;
  }
}

function readCityLocationCache(key: string): CityPoint | null | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(`canact:city-location:${key}`);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as CityPoint | null;
    if (!value) return null;
    return Number.isFinite(value.lat) && Number.isFinite(value.lng) ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeCityLocationCache(key: string, point: CityPoint) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`canact:city-location:${key}`, JSON.stringify(point));
  } catch {
    // Cache misses are harmless; the map still works with live locations.
  }
}

function formatLocationTime(at?: number) {
  if (!at) return 'Location available';
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
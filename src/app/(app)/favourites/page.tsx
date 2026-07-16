'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { get, onValue, ref, remove as fbRemove, set as fbSet } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import type { FriendMapPerson } from '@/components/FriendsWorldMap';
import { ExploreMap, type ExploreActivity } from '@/components/ExploreMap';
import { acceptFollow, blockUser, listenFavourites, listenFollowRequests, rejectFollow } from '@/lib/services/favourites';
import {
  acceptFriendRequest, declineFriendRequest, listenFriends, listenIncomingRequests, unfriend,
} from '@/lib/services/friends';
import type { AttrKey, FriendEdge, UserProfile } from '@/lib/types';
import { ATTR_LABELS, NEGATIVE_ATTRS, POSITIVE_ATTRS } from '@/lib/types';
import { AlignLeft, Filter, MapPin, Star, ThumbsDown, ThumbsUp, Users } from '@/components/icons';
import { useGeo } from '@/lib/useGeo';
import { useDistance } from '@/lib/distance';
import { haversineMeters } from '@/lib/utils';
import { removeAttribute, setAttribute, setLikeDislike, SIX_HOURS } from '@/lib/services/votes';
import { toast } from '@/components/Toaster';
import { RocketLaunchOverlay } from '@/components/RocketLaunchOverlay';
import { listenWhaFeed } from '@/lib/services/wha';
import { listenActiveStories } from '@/lib/services/stories';
import { listenPollFeed } from '@/lib/services/poll';
import { listenReels } from '@/lib/services/reels';
import type { Poll, ReelItem, StoryItem, WhaPost } from '@/lib/types';
import styles from './ExplorePage.module.css';

type Tab = 'friends' | 'favourites' | 'requests';
type PeopleView = 'map' | 'list';
type MapLocation = { lat: number; lng: number; at?: number; source: 'live' | 'city' };
type CityPoint = { lat: number; lng: number };
type FriendProfile = UserProfile & { lastLocation?: { lat?: number; lng?: number; at?: number } };
type PeoplePerson = FriendMapPerson & { at?: number; rating?: number; relation: 'friend' | 'favourite' };
type FavouriteRequest = { fromUid: string; fromName: string; createdAt: number; profile?: UserProfile | null };

export default function FavouritesPage() {
  const { user, profile } = useAuth();
  const { coords: liveCoords, error: locationError } = useGeo();
  const [tab, setTab] = useState<Tab>('friends');
  const [peopleView, setPeopleView] = useState<PeopleView>('map');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [posts, setPosts] = useState<WhaPost[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [friends, setFriends] = useState<FriendEdge[]>([]);
  const [friendReqs, setFriendReqs] = useState<FriendEdge[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, FriendProfile | null>>({});
  const [favs, setFavs] = useState<FriendProfile[]>([]);
  const [favReqs, setFavReqs] = useState<FavouriteRequest[]>([]);
  const homeMapHandoffRef = useRef(false);
  const knownProfiles = useMemo(() => [
    ...Object.values(friendProfiles).filter(isFriendProfile),
    ...favs,
    profile as FriendProfile | null,
  ].filter(isFriendProfile), [friendProfiles, favs, profile]);
  const cityLocations = useCityLocations(knownProfiles);

  useEffect(() => { if (user) return listenFriends(user.uid, setFriends); }, [user?.uid]);
  useEffect(() => { if (user) return listenIncomingRequests(user.uid, setFriendReqs); }, [user?.uid]);
  useEffect(() => listenWhaFeed(setPosts), []);
  useEffect(() => listenActiveStories(setStories), []);
  useEffect(() => listenPollFeed(setPolls), []);
  useEffect(() => listenReels(setReels), []);
  useEffect(() => {
    document.documentElement.setAttribute('data-canact-fullscreen-page', 'true');
    return () => document.documentElement.removeAttribute('data-canact-fullscreen-page');
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const active = homeMapHandoffRef.current || root.hasAttribute('data-canact-explore-handoff');
    homeMapHandoffRef.current = active;
    if (!active) return;
    root.setAttribute('data-canact-explore-handoff', 'true');
    const timer = window.setTimeout(() => root.removeAttribute('data-canact-explore-handoff'), 720);
    return () => {
      window.clearTimeout(timer);
      root.removeAttribute('data-canact-explore-handoff');
    };
  }, []);

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
        const snap = await get(ref(db, `users/${uid}`));
        const s = snap.val() as FriendProfile | null;
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
        const snap = await get(ref(db, `users/${r.fromUid}`));
        out.push({ ...r, profile: snap.val() as UserProfile | null });
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

  const { radius } = useDistance();
  const storedLocation = useMemo(() => resolveProfileLocation(profile as FriendProfile | null, cityLocations), [profile, cityLocations]);
  const currentLocation = liveCoords ?? storedLocation;

  const visiblePeople = useMemo(() => {
    const candidates = tab === 'favourites' ? favouritePeople : friendPeople;
    if (!currentLocation) return candidates;
    return candidates.filter((person) => {
      if (typeof person.lat !== 'number' || typeof person.lng !== 'number') return false;
      const distance = haversineMeters(currentLocation, { lat: person.lat, lng: person.lng });
      return Number.isFinite(radius) && distance <= radius;
    });
  }, [tab, favouritePeople, friendPeople, currentLocation, radius]);
  const totalRequests = friendReqs.length + favReqs.length;
  const mapActivities = useMemo<ExploreActivity[]>(() => {
    const now = Date.now();
    const locatedPeople = [...friendPeople, ...favouritePeople].filter(hasLocation);
    const personByUid = new Map(locatedPeople.map((person) => [person.uid, person]));
    const peopleActivity: ExploreActivity[] = locatedPeople.map((person) => ({
      id: `person-${person.uid}`,
      kind: 'person',
      lat: person.lat!,
      lng: person.lng!,
      weight: 1 + Math.min(1.2, Math.max(0, (person.rating ?? 0) / 1000)),
      href: `/profile/${encodeURIComponent(person.uid)}`,
    }));
    const isMapFresh = (createdAt: number) => Number.isFinite(createdAt) && now - createdAt <= 24 * 3600 * 1000;
    const postActivity: ExploreActivity[] = posts.flatMap((post) => {
      if (!isMapFresh(post.createdAt)) return [];
      if (typeof post.lat !== 'number' || typeof post.lng !== 'number') return [];
      const reactionCount = Object.values(post.reactions ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);
      const freshness = Math.max(.25, 1 - (now - post.createdAt) / (24 * 3600 * 1000));
      const thumbUrl = post.mediaPosters?.[0] || post.mediaUrls?.[0] || undefined;
      const isVideo = thumbUrl ? /\.(mp4|mov|webm|mkv)/i.test(thumbUrl) : false;
      return [{
        id: `post-${post.id}`,
        kind: 'post' as const,
        lat: post.lat,
        lng: post.lng,
        weight: .9 + freshness + Math.min(1, reactionCount / 12),
        href: `/post/${post.id}`,
        authorUid: post.uid,
        authorName: post.authorName,
        label: post.text || 'Post',
        createdAt: post.createdAt,
        thumbUrl: isVideo ? undefined : thumbUrl,
        color: '#1f6b55',  // brand green for regular posts
      }];
    });
    const seenStoryAuthors = new Set<string>();
    const storyActivity: ExploreActivity[] = stories.flatMap((story) => {
      if (!isMapFresh(story.createdAt)) return [];
      if (seenStoryAuthors.has(story.uid)) return [];
      const person = personByUid.get(story.uid);
      const lat = typeof story.lat === 'number' ? story.lat : person?.lat;
      const lng = typeof story.lng === 'number' ? story.lng : person?.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') return [];
      seenStoryAuthors.add(story.uid);
      return [{ id: `story-${story.id}`, kind: 'story' as const, lat, lng, weight: 1.25, href: '/feed', authorUid: story.uid, authorName: story.authorName, label: story.caption || 'Story', createdAt: story.createdAt, thumbUrl: story.mediaUrl }];
    });
    const pollActivity: ExploreActivity[] = polls.flatMap((poll) => {
      if (!isMapFresh(poll.createdAt) || typeof poll.lat !== 'number' || typeof poll.lng !== 'number') return [];
      return [{ id: `poll-${poll.id}`, kind: 'poll' as const, lat: poll.lat, lng: poll.lng, weight: 1.1, href: `/poll/${poll.id}`, authorUid: poll.uid, authorName: poll.authorName, label: poll.question, createdAt: poll.createdAt, thumbUrl: poll.photoURL, color: '#5f7fce' }];
    });
    const reelActivity: ExploreActivity[] = reels.flatMap((reel) => {
      if (!isMapFresh(reel.createdAt) || typeof reel.lat !== 'number' || typeof reel.lng !== 'number') return [];
      return [{ id: `reel-${reel.id}`, kind: 'reel' as const, lat: reel.lat, lng: reel.lng, weight: 1.15, href: `/reel/${reel.id}`, authorUid: reel.uid, authorName: reel.authorName, label: reel.caption || 'Reel', createdAt: reel.createdAt, thumbUrl: reel.posterUrl, color: '#8c62b7' }];
    });
    return [...peopleActivity, ...postActivity, ...storyActivity, ...pollActivity, ...reelActivity];
  }, [friendPeople, favouritePeople, posts, stories, polls, reels]);
  if (!user) return null;

  // Map view renders outside the transformed container so position:fixed works correctly.
  if (tab !== 'requests' && peopleView === 'map') {
    return (
      <ExploreMapSurface
        firstName={profile?.firstName || profile?.fullName?.split(' ')[0] || 'there'}
        people={visiblePeople}
        currentLocation={currentLocation}
        activities={mapActivities}
        locationUnavailable={!!locationError && !currentLocation}
        tab={tab}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((value) => !value)}
        friendCount={friends.length}
        favouriteCount={favs.length}
        requestCount={totalRequests}
        onTabChange={setTab}
        onSeeAll={() => setPeopleView('list')}
        onVote={async (person, kind) => {
          try { await setLikeDislike(person.uid, user.uid, kind); toast(kind === 'like' ? 'Liked' : 'Disliked', 'success'); }
          catch (error: any) { toast(error?.message ?? 'Could not rate this person', 'error'); }
        }}
        onAttr={async (person, attr) => {
          try { const r = await setAttribute(person.uid, user.uid, attr); if (!r.ok) toast(`You gave ${ATTR_LABELS[attr]} · available again in ${Math.ceil((r.waitMs ?? 0) / 3_600_000)}h`, 'error'); else toast(`${ATTR_LABELS[attr]} updated`, 'success'); }
          catch (error: any) { toast(error?.message ?? 'Could not update attribute', 'error'); }
        }}
        myPhotoURL={profile?.photoURL}
      />
    );
  }

  return (
    <div className="relative left-1/2 min-h-[calc(var(--canact-viewport-height)-8.5rem)] w-screen -translate-x-1/2 bg-[#FAF8F2] px-5 pb-20 lg:min-h-[calc(var(--canact-viewport-height)-3rem)] lg:px-8 overflow-hidden" style={{ paddingTop: 'calc(var(--canact-header-top-inset, 0px) + var(--canact-header-offset, 0px) + 92px)' }}>
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
      ) : (
        <PeopleListSurface
          people={visiblePeople}
          tab={tab}
          onUnfriend={(person) => unfriend(user.uid, person.uid)}
          onBlock={(person) => blockUser(user.uid, person.uid)}
        />
      )}

      {peopleView === 'list' && tab !== 'requests' ? <div className="mx-auto mt-4 w-full max-w-[540px]"><MapToolbar tab={tab} people={visiblePeople} view={peopleView} onViewChange={setPeopleView} /></div> : null}
    </div>
  );
}

function ExploreMapSurface({
  firstName,
  people,
  currentLocation,
  activities,
  locationUnavailable,
  tab,
  filtersOpen,
  onToggleFilters,
  friendCount,
  favouriteCount,
  requestCount,
  onTabChange,
  onSeeAll,
  onVote,
  onAttr,
  myPhotoURL,
}: {
  firstName: string;
  people: PeoplePerson[];
  currentLocation: { lat: number; lng: number } | null;
  activities: ExploreActivity[];
  locationUnavailable: boolean;
  tab: Exclude<Tab, 'requests'>;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  friendCount: number;
  favouriteCount: number;
  requestCount: number;
  onTabChange: (tab: Tab) => void;
  onSeeAll: () => void;
  onVote: (person: PeoplePerson, kind: 'like' | 'dislike') => Promise<void> | void;
  onAttr: (person: PeoplePerson, attr: AttrKey) => Promise<void> | void;
  myPhotoURL?: string | null;
}) {
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStart = useRef<number | null>(null);

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    const raw = event.clientY - dragStart.current;
    setDragOffset(sheetExpanded ? Math.max(0, raw) : Math.min(0, raw));
  };
  const onHandlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    const delta = event.clientY - dragStart.current;
    if (delta < -42) setSheetExpanded(true);
    if (delta > 42) setSheetExpanded(false);
    dragStart.current = null;
    setDragOffset(0);
  };
  const sheetStyle = { '--canact-sheet-drag': `${dragOffset}px` } as CSSProperties;

  return (
    <section className={styles.exploreScreen} aria-label="Explore nearby activity">
      <ExploreMap
        people={people}
        currentLocation={currentLocation}
        activities={activities}
        myPhotoURL={myPhotoURL}
      />
      <div className={styles.mapTopFade} aria-hidden="true" style={{ opacity: sheetExpanded ? 0 : 1, transition: 'opacity .3s ease' }} />

      <button
        type="button"
        className={styles.mapHeading}
        style={{ opacity: sheetExpanded ? 0 : 1, pointerEvents: sheetExpanded ? 'none' : 'auto', transition: 'opacity .3s ease' }}
      >
        <small>Hey {firstName} <span aria-hidden="true">👋</span></small>
        <span>Explore <strong>Canactors</strong><br />near you</span>
      </button>

      <div data-liquid-glass="surface" data-liquid-radius="999" data-liquid-blur="0" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.14" className={styles.legend} aria-label="Map legend" style={{ opacity: sheetExpanded ? 0 : 1, transition: 'opacity .3s ease' }}>
        <span><i className={styles.heatDot} /> Activity</span>
        <span><i className={styles.postDot} /> Posts</span>
        <span><i className={styles.storyDot} /> Stories</span>
      </div>

      {locationUnavailable ? <div data-liquid-glass="surface" data-liquid-radius="14" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.20" className={styles.locationNotice}><span>Enable location to center the map around you.</span></div> : null}

      <aside
        data-onboarding="people-nearby"
        data-liquid-glass="surface"
        data-liquid-radius="30"
        data-liquid-blur="0"
        data-liquid-thickness="38"
        data-liquid-bezel="14"
        data-liquid-specular-opacity="0.52"
        data-liquid-tint="248,244,232"
        data-liquid-tint-opacity="0.2"
        className={`${styles.peopleSheet} ${sheetExpanded ? styles.peopleSheetExpanded : ''}`}
        style={sheetStyle}
        aria-label="People nearby"
      >
        <div
          className={styles.sheetGrabArea}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerEnd}
          onPointerCancel={onHandlePointerEnd}
          onDoubleClick={() => setSheetExpanded((value) => !value)}
        >
          <span className={styles.sheetHandle} aria-hidden="true" />
          <div className={styles.sheetTitleRow}>
            <button type="button" onClick={() => setSheetExpanded((value) => !value)} className={styles.sheetTitle} aria-expanded={sheetExpanded}>
              <Users size={21} /> <strong>People Nearby</strong><span>{people.length}</span>
            </button>
            <div className={styles.sheetActions}>
              <button type="button" data-liquid-glass="switcher" data-liquid-radius="999" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.10" onClick={onToggleFilters} aria-label="Filter nearby people" aria-expanded={filtersOpen}><Filter size={17} /></button>
              <button type="button" data-liquid-glass="switcher" data-liquid-radius="999" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.10" onClick={onSeeAll}><span>See all</span></button>
            </div>
          </div>
          {!sheetExpanded ? <p className={styles.swipeHint}>Swipe up to explore nearby people</p> : null}
        </div>

        <div className={styles.sheetBody}>
          {filtersOpen ? (
            <div data-liquid-glass="surface" data-liquid-radius="20" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.12" className={styles.filtersPanel}>
              <div className={styles.filterLegend}>
                <span><i className={styles.heatDot} /> High activity</span>
                <span><Star size={15} className="text-[#f2b72e]" /> Favourites</span>
              </div>
              <RelationshipToggle tab={tab} onTabChange={onTabChange} friendCount={friendCount} favouriteCount={favouriteCount} requestCount={requestCount} />
            </div>
          ) : null}
          {people.length ? (
            <NearbyPeopleDeck people={people} onVote={onVote} onAttr={onAttr} />
          ) : (
            <div className={styles.emptyPeople}>People will appear here when their location is available.</div>
          )}
        </div>
      </aside>
    </section>
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
    <div data-liquid-glass="surface" data-liquid-radius="28" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.08" className="pointer-events-auto mx-auto w-[min(calc(100vw-24px),540px)] overflow-hidden rounded-[28px] border border-white/60 bg-transparent p-1 shadow-sm">
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
    <div data-liquid-glass="surface" data-liquid-radius="999" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.16" className="pointer-events-auto sticky top-[calc(var(--canact-header-top-inset,0px)+var(--canact-header-offset,0px)+92px)] z-10 mx-auto mt-2 flex w-[min(calc(100vw-24px),540px)] items-center justify-between gap-2 rounded-[100px] border border-white/60 bg-transparent pl-6 pr-2 py-2 shadow-sm backdrop-blur-xl">
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
    <div data-liquid-glass="surface" data-liquid-radius="999" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.08" className="inline-flex shrink-0 rounded-full border border-white/60 bg-transparent p-1">
      <button
        type="button"
        data-liquid-glass={view === 'map' ? 'switcher' : 'none'}
        data-liquid-radius="999"
        data-liquid-tint="31,107,85"
        data-liquid-tint-opacity="0.08"
        onClick={() => onChange('map')}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full bg-transparent px-3 text-xs font-extrabold transition ${view === 'map' ? 'text-brand' : 'text-ink/60'}`}
      >
        <MapPin size={13} /> <span>Map</span>
      </button>
      <button
        type="button"
        data-liquid-glass={view === 'list' ? 'switcher' : 'none'}
        data-liquid-radius="999"
        data-liquid-tint="31,107,85"
        data-liquid-tint-opacity="0.08"
        onClick={() => onChange('list')}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full bg-transparent px-3 text-xs font-extrabold transition ${view === 'list' ? 'text-brand' : 'text-ink/60'}`}
      >
        <AlignLeft size={13} /> <span>List</span>
      </button>
    </div>
  );
}

function NearbyPeopleDeck({ people, onVote, onAttr }: { people: PeoplePerson[]; onVote: (person: PeoplePerson, kind: 'like' | 'dislike') => Promise<void> | void; onAttr: (person: PeoplePerson, attr: AttrKey) => Promise<void> | void }) {
  const { user } = useAuth();
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragDelta, setDragDelta] = useState(0);
  const dragStart = useRef<{ x: number; baseIndex: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [attrVotes, setAttrVotes] = useState<Record<string, Record<string, { at: number }>>>({});
  const [mainVotes, setMainVotes] = useState<Record<string, 'like' | 'dislike' | null>>({});
  const [launchLabel, setLaunchLabel] = useState<string | null>(null);
  const [launchKind, setLaunchKind] = useState<'give' | 'take' | null>(null);

  // Listen for attr votes (multi-attribute — one entry per attr key).
  useEffect(() => {
    if (!user?.uid) return;
    const offs = people.map((person) => {
      if (!person.uid) return () => {};
      return onValue(ref(db, `votes/${person.uid}/${user.uid}/attrs`), (snap) => {
        const map: Record<string, { at: number }> = {};
        snap.forEach((child) => { const v = child.val(); if (v) map[child.key!] = v; });
        setAttrVotes((prev) => ({ ...prev, [person.uid]: map }));
      });
    });
    return () => offs.forEach((off) => off());
  }, [user?.uid, people.map((p) => p.uid).join('|')]);

  // Listen for main like/dislike votes
  useEffect(() => {
    if (!user?.uid) return;
    const offs = people.map((person) => {
      if (!person.uid) return () => {};
      return onValue(ref(db, `votes/${person.uid}/${user.uid}/main`), (snap) => {
        const val = snap.val() as 'like' | 'dislike' | null;
        setMainVotes((prev) => ({ ...prev, [person.uid]: val }));
      });
    });
    return () => offs.forEach((off) => off());
  }, [user?.uid, people.map((p) => p.uid).join('|')]);

  useEffect(() => { if (activeIndex >= people.length) setActiveIndex(0); }, [activeIndex, people.length]);

  const handleAttr = async (person: PeoplePerson, attr: AttrKey) => {
    const myAttrs = attrVotes[person.uid] ?? {};
    const hasAttr = attr in myAttrs;
    const voteAt = myAttrs[attr]?.at ?? 0;
    const cooldownRemaining = voteAt ? Math.max(0, SIX_HOURS - (Date.now() - voteAt)) : 0;
    const isTakeBack = hasAttr && cooldownRemaining === 0;
    const label = ATTR_LABELS[attr];

    // Already given and still in cooldown — block and explain.
    if (hasAttr && cooldownRemaining > 0) {
      const hrs = Math.ceil(cooldownRemaining / 3_600_000);
      toast(`You gave ${label}. You can take it back in ${hrs}h.`, 'error');
      return;
    }

    if (isTakeBack) {
      // Optimistic: remove attr locally
      setAttrVotes((prev) => {
        const next = { ...(prev[person.uid] ?? {}) };
        delete next[attr];
        return { ...prev, [person.uid]: next };
      });
      try {
        const r = await removeAttribute(person.uid, user!.uid, attr);
        if (!r.ok) {
          // Revert on failure
          setAttrVotes((prev) => {
            const next = { ...(prev[person.uid] ?? {}), [attr]: { at: voteAt } };
            return { ...prev, [person.uid]: next };
          });
          toast('Wait before taking back attributes', 'error');
        } else {
          setLaunchKind('take');
          setLaunchLabel(label);
          toast(`${label} taken back`, 'success');
        }
      } catch (error: any) {
        setAttrVotes((prev) => {
          const next = { ...(prev[person.uid] ?? {}), [attr]: { at: voteAt } };
          return { ...prev, [person.uid]: next };
        });
        toast(error?.message ?? 'Could not take back attribute', 'error');
      }
    } else {
      // Giving a new attribute — optimistic add, revert if server rejects.
      const rollbackAttrs = { ...(attrVotes[person.uid] ?? {}) };
      setAttrVotes((prev) => {
        const next = { ...(prev[person.uid] ?? {}), [attr]: { at: Date.now() } };
        return { ...prev, [person.uid]: next };
      });
      try {
        const r = await setAttribute(person.uid, user!.uid, attr);
        if (!r.ok) {
          // Server rejected — revert optimistic update.
          setAttrVotes((prev) => ({ ...prev, [person.uid]: rollbackAttrs }));
          toast(`You gave ${label} · available again in ${Math.ceil((r.waitMs ?? 0) / 3_600_000)}h`, 'error');
        } else {
          setLaunchKind('give');
          setLaunchLabel(label);
          toast(`${label} added`, 'success');
        }
      } catch (error: any) {
        setAttrVotes((prev) => ({ ...prev, [person.uid]: rollbackAttrs }));
        toast(error?.message ?? 'Could not update attribute', 'error');
      }
    }
  };

  const getCooldownMs = (personUid: string, attr: AttrKey): number => {
    const myAttrs = attrVotes[personUid] ?? {};
    const vote = myAttrs[attr];
    if (!vote?.at) return 0;
    const remaining = SIX_HOURS - (Date.now() - vote.at);
    return remaining > 0 ? remaining : 0;
  };

  const handleVote = async (person: PeoplePerson, kind: 'like' | 'dislike') => {
    const current = mainVotes[person.uid] ?? null;
    if (current === kind) {
      // Toggle off
      setMainVotes((prev) => ({ ...prev, [person.uid]: null }));
      try {
        await fbRemove(ref(db, `votes/${person.uid}/${user!.uid}/main`));
      } catch (error: any) {
        setMainVotes((prev) => ({ ...prev, [person.uid]: current }));
        toast(error?.message ?? 'Could not remove vote', 'error');
      }
    } else {
      // Set new vote
      setMainVotes((prev) => ({ ...prev, [person.uid]: kind }));
      await onVote(person, kind);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = { x: e.clientX, baseIndex: activeIndex };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    setDragDelta(e.clientX - dragStart.current.x);
  };
  const onPointerUp = () => {
    if (!dragStart.current) return;
    const threshold = 60;
    if (dragDelta < -threshold && activeIndex < people.length - 1) {
      setActiveIndex((i) => i + 1);
    } else if (dragDelta > threshold && activeIndex > 0) {
      setActiveIndex((i) => i - 1);
    }
    dragStart.current = null;
    setDragDelta(0);
  };

  const ALL_ATTRS = [...POSITIVE_ATTRS, ...NEGATIVE_ATTRS] as AttrKey[];

  return (
    <>
      {launchLabel && launchKind ? <RocketLaunchOverlay label={launchLabel} kind={launchKind} onDone={() => { setLaunchLabel(null); setLaunchKind(null); }} /> : null}
      <div
        ref={containerRef}
        className="relative h-[470px] overflow-hidden touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {people.map((person, index) => {
          const offset = index - activeIndex;
          const distance = Math.abs(offset);
          if (distance > 2) return null;
          const direction = offset < 0 ? -1 : 1;
          const dragShift = distance === 0 ? dragDelta * 0.4 : 0;
          const x = distance === 0 ? dragShift : direction * (distance === 1 ? 170 : 280);
          const scale = distance === 0 ? 1 : distance === 1 ? .88 : .74;
          const y = distance === 0 ? 0 : distance === 1 ? 24 : 42;
          const myAttrs = attrVotes[person.uid] ?? {};
          const myMainVote = mainVotes[person.uid] ?? null;
          return (
            <article
              key={person.uid}
              className={styles.personCard}
              style={{ transform: `translateX(calc(-50% + ${x}px)) translateY(${y}px) scale(${scale})`, zIndex: 20 - distance, opacity: distance === 2 ? .35 : distance === 1 ? .68 : 1, filter: distance ? `blur(${distance}px)` : 'none' }}
            >
              {distance ? (
                <button type="button" onClick={() => setActiveIndex(index)} className={styles.personMedia}>
                  {person.photoURL ? <img src={person.photoURL} alt={person.name} className={styles.personImage} /> : <span className="grid h-full place-items-center"><Avatar src={null} name={person.name} size={104} /></span>}
                  <span className={styles.personImageVeil} />
                </button>
              ) : (
                <Link href={`/profile/${person.uid}`} className={styles.personMedia}>
                  {person.photoURL ? <img src={person.photoURL} alt={person.name} className={styles.personImage} /> : <span className="grid h-full place-items-center"><Avatar src={null} name={person.name} size={104} /></span>}
                  <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-1.5 text-[10px] font-bold text-white">Reliable</span>
                </Link>
              )}
              <div className={styles.personDetails}>
                <Link href={`/profile/${person.uid}`} className={styles.personName}>{person.name}</Link>
                {!distance ? (
                  <div className={styles.personAttrGrid}>
                    {ALL_ATTRS.map((attr) => {
                      const isPositive = (POSITIVE_ATTRS as readonly string[]).includes(attr);
                      const selected = attr in myAttrs;
                      const cooldownMs = getCooldownMs(person.uid, attr);
                      const locked = cooldownMs > 0;
                      let btnClass = styles.personAttrBtnDefault;
                      if (selected && isPositive) btnClass = styles.personAttrBtnPositive;
                      else if (selected && !isPositive) btnClass = styles.personAttrBtnNegative;
                      return (
                        <button
                          key={attr}
                          type="button"
                          disabled={locked}
                          onClick={() => handleAttr(person, attr)}
                          className={`${styles.personAttrBtn} ${btnClass}`}
                          aria-label={`${ATTR_LABELS[attr]}: ${person.name}`}
                          title={locked ? `Cooldown: ${Math.ceil(cooldownMs / 3600000)}h` : selected ? 'Tap to take back' : undefined}
                        >
                          {ATTR_LABELS[attr]}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className={styles.personActions}>
                  <button type="button" disabled={!!distance} onClick={() => handleVote(person, 'like')} aria-label={`Like ${person.name}`} className={`${styles.personLike} ${myMainVote === 'like' ? styles.personLikeActive : ''}`}><ThumbsUp size={18} /></button>
                  <button type="button" disabled={!!distance} onClick={() => handleVote(person, 'dislike')} aria-label={`Dislike ${person.name}`} className={`${styles.personDislike} ${myMainVote === 'dislike' ? styles.personDislikeActive : ''}`}><ThumbsDown size={18} /></button>
                </div>
              </div>
            </article>
          );
        })}
        {people.length > 1 ? <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-1.5">{people.slice(0, 8).map((person, index) => <button key={person.uid} type="button" aria-label={`Show ${person.name}`} onClick={() => setActiveIndex(index)} className={`h-1.5 rounded-full transition-all ${index === activeIndex ? 'w-6 bg-brand' : 'w-1.5 bg-brand/20'}`} />)}</div> : null}
      </div>
    </>
  );
}

function PeopleListSurface({ people, tab, onUnfriend, onBlock }: { people: PeoplePerson[]; tab: Exclude<Tab, 'requests'>; onUnfriend: (person: PeoplePerson) => Promise<void> | void; onBlock: (person: PeoplePerson) => Promise<void> | void }) {
  return (
    <div className="bg-[#FAF8F2] pt-4">
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-[28px] border border-[#E4E7E2] bg-white p-2 shadow-sm">
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
    <div className="bg-[#FAF8F2] pt-4">
      <div className="mx-auto w-full max-w-xl space-y-3">
        {empty ? (
          <div className="rounded-[28px] border border-[#E4E7E2] bg-white px-4 py-8 text-center shadow-sm">
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
    <section className="overflow-hidden rounded-[28px] border border-[#E4E7E2] bg-white p-2 shadow-sm">
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
      data-liquid-glass={active ? 'switcher' : 'none'}
      data-liquid-radius="999"
      data-liquid-tint="31,107,85"
      data-liquid-tint-opacity="0.08"
      onClick={onClick}
      className={`relative flex h-11 min-w-0 items-center justify-center rounded-full bg-transparent px-1 text-[13px] font-extrabold transition sm:text-sm ${active ? 'text-brand' : 'text-ink/60 hover:text-ink'}`}
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

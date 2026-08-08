'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { toast } from './Toaster';
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Heart,
  Loader2,
  Search,
  Send,
  Sparkles,
} from './icons';
import { ATTR_LABELS, CARD_KEYS, CARD_LABELS, LIFETIME_CARD_KINDS, LIFETIME_CARD_LABELS, type AttrKey, type CardKey, type ConnectionCardGift, type GiftCandidate, type GiftCandidateCategory, type LifetimeCardGift, type LifetimeCardKind, type LifetimeCardSlot, type UserProfile } from '@/lib/types';
import { defaultLifetimeInventory, listenLifetimeInventory, listenReceivedLifetimeCards, loadGiftCandidates, sendLifetimeCard } from '@/lib/services/lifetimeCards';
import { listenReceivedConnectionCards, sendConnectionCard } from '@/lib/services/connectionCards';
import { getAttributePairCooldownMs, listenAttributeVoteState, removeAttribute, setAttribute, type AttributeVoteMap } from '@/lib/services/votes';
import { useAuth } from '@/lib/auth';
import styles from './ProfileRecognitionFolders.module.css';
import { CardsFolderSVG, ConnectionCardsFolderSVG } from './FolderSVGs';
import { LifetimeCardSendAnimation } from './LifetimeCardSendAnimation';
import { RocketLaunchOverlay } from './RocketLaunchOverlay';
import { ConnectionCardContent } from './ConnectionAttributeCard';
import { useAttributeCardStyle } from '@/lib/attributeCardStyle';

type Folder = 'connections' | 'cards';
type CardMode = 'received' | 'reward';
type ConnectionMode = 'received' | 'send';
type CandidateFilter = 'all' | GiftCandidateCategory;
type SendAnimationRect = { left: number; top: number; width: number; height: number; naturalWidth: number; naturalHeight: number };

function getGestureAxis(dx: number, dy: number): 'x' | 'y' | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < 10) return null;
  return absX >= absY * 1.25 ? 'x' : 'y';
}

function useCardSwipe() {
  const [dragY, setDragY] = useState(0);
  const dragYRef = useRef(0);
  const launchPendingRef = useRef(false);
  const launchRef = useRef<(() => void) | null>(null);
  const onDrag = useCallback((dy: number, phase: 'move' | 'end') => {
    const next = Math.max(-180, Math.min(0, dy));
    if (phase === 'move') {
      if (launchPendingRef.current) return;
      dragYRef.current = next;
      setDragY(next);
      return;
    }
    const shouldLaunch = next <= -54 && !launchPendingRef.current;
    dragYRef.current = 0;
    setDragY(0);
    if (!shouldLaunch) return;
    launchPendingRef.current = true;
    launchRef.current?.();
    requestAnimationFrame(() => { launchPendingRef.current = false; });
  }, []);
  const reset = useCallback(() => {
    dragYRef.current = 0;
    launchPendingRef.current = false;
    setDragY(0);
  }, []);
  return { dragY, launchRef, onDrag, reset };
}

function getSendAnimationRect(sourceKey: string): SendAnimationRect {
  const source = Array.from(document.querySelectorAll<HTMLElement>('[data-lifetime-card-source]'))
    .find((element) => element.dataset.lifetimeCardSource === sourceKey);
  if (source) {
    const rect = source.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        naturalWidth: source.offsetWidth || rect.width,
        naturalHeight: source.offsetHeight || rect.height,
      };
    }
  }
  const naturalWidth = Math.min(620, Math.max(300, window.innerWidth - 32));
  const naturalHeight = naturalWidth * .52;
  return {
    left: (window.innerWidth - naturalWidth) / 2,
    top: Math.max(56, window.innerHeight * .08),
    width: naturalWidth,
    height: naturalHeight,
    naturalWidth,
    naturalHeight,
  };
}

const FILTERS: Array<{ id: CandidateFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'interacted', label: 'Interacted' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'friends', label: 'Friends' },
];

const CARD_DESCRIPTIONS: Record<LifetimeCardKind, string> = {
  life_saver: 'For the person who showed up when it truly mattered.',
  golden_person: 'For someone whose presence made your life meaningfully better.',
  custom: 'Your permanent words for someone who deserves to keep them.',
};

const ATTRIBUTE_PAIRS: ReadonlyArray<{ negative: AttrKey; positive: AttrKey }> = [
  { negative: 'rude', positive: 'behaviour' },
  { negative: 'unreliable', positive: 'reliability' },
  { negative: 'uncivil', positive: 'civic_sense' },
];

export function AttributePairSlider({
  negative,
  positive,
  negativeCount,
  positiveCount,
  selectedValue,
  busy,
  cooldownMs,
  readOnly,
  labelMode = 'counts',
  dynamicLabel = false,
  onCommit,
}: {
  negative: AttrKey;
  positive: AttrKey;
  negativeCount: number;
  positiveCount: number;
  selectedValue: -1 | 0 | 1;
  busy: boolean;
  cooldownMs: number;
  readOnly: boolean;
  labelMode?: 'counts' | 'names';
  dynamicLabel?: boolean;
  onCommit: (value: -1 | 0 | 1) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [draftPct, setDraftPct] = useState<number | null>(null);
  const [edgeMargin, setEdgeMargin] = useState(15); // min % for pill center, ensures side gap = top/bottom gap
  const total = negativeCount + positiveCount;
  const communityBalance = total ? (positiveCount / total) * 100 : 50;
  const locked = cooldownMs > 0;
  const cooldownLabel = cooldownMs >= 3_600_000
    ? `${Math.ceil(cooldownMs / 3_600_000)}h`
    : `${Math.max(1, Math.ceil(cooldownMs / 60_000))}m`;
  const label = ATTR_LABELS[positive];
  const disabled = busy || (!readOnly && locked && selectedValue === 0);

  // Measure pill + track to compute equal side margin matching top/bottom gap (5px)
  useEffect(() => {
    const pill = pillRef.current;
    const bar = barRef.current;
    if (!pill || !bar) return;
    const measure = () => {
      const pw = pill.offsetWidth;
      const bw = bar.offsetWidth;
      if (bw > 0) {
        // Top/bottom gap: (44 - 34) / 2 = 5px. Side gap must match: 5px.
        // Pill center at 5px + halfPillWidth from edge → (5 + pw/2) / bw * 100
        const margin = ((5 + pw / 2) / bw) * 100;
        setEdgeMargin(margin);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pill);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // Clamp so pill edges stay exactly 5px from track edges (matching top/bottom)
  const clampPct = (pct: number) => Math.max(edgeMargin, Math.min(100 - edgeMargin, pct));

  // Resolve position: draft during drag, committed value otherwise, community balance for readOnly
  const committedPct = clampPct(selectedValue === -1 ? edgeMargin : selectedValue === 1 ? 100 - edgeMargin : 50);
  const pillPosition = readOnly
    ? clampPct(communityBalance)
    : draftPct ?? committedPct;

  // Reset draft when selectedValue changes externally
  useEffect(() => {
    if (!dragging.current) setDraftPct(null);
  }, [selectedValue]);

  const getPctFromX = (clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 50;
    const rect = bar.getBoundingClientRect();
    const raw = ((clientX - rect.left) / rect.width) * 100;
    return clampPct(raw);
  };

  const valueFromPct = (pct: number): -1 | 0 | 1 => {
    const third = 100 / 3;
    if (pct <= 50 - third / 2) return -1;
    if (pct >= 50 + third / 2) return 1;
    return 0;
  };
  const pillValue = valueFromPct(pillPosition);
  const pillLabel = dynamicLabel
    ? pillValue === -1 ? ATTR_LABELS[negative] : pillValue === 1 ? ATTR_LABELS[positive] : 'Neutral'
    : label;

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || readOnly) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraftPct(getPctFromX(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || disabled || readOnly) return;
    setDraftPct(getPctFromX(e.clientX));
  };

  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const pct = draftPct ?? committedPct;
    const v = valueFromPct(pct);
    setDraftPct(null);
    if (locked && selectedValue !== 0 && v !== 0) return;
    if (v !== selectedValue) onCommit(v);
  };

  return (
    <div className={styles.attributePair} data-busy={busy} data-locked={locked} data-selected={selectedValue}>
      <div className={styles.attributeSpectrumLabels}>
        <span>{labelMode === 'names' ? ATTR_LABELS[negative] : `+${negativeCount}`}</span>
        <span>{labelMode === 'names' ? ATTR_LABELS[positive] : `+${positiveCount}`}</span>
      </div>
      <div
        ref={barRef}
        className={styles.attributeSpectrumTrack}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: disabled ? 'none' : 'pan-y' }}
      >
        <div className={styles.attributeSpectrumBg} />
        <div
          ref={pillRef}
          className={`${styles.attributeSpectrumPill} ${selectedValue === -1 ? styles.attributeSpectrumPillNeg : selectedValue === 1 ? styles.attributeSpectrumPillPos : ''}`}
          style={{ left: `${pillPosition}%` }}
        >
          <span>{pillLabel}</span>
        </div>
      </div>
      {busy ? <Loader2 className={styles.attributeSpinner} size={17} aria-label="Updating attribute" /> : null}
      {!readOnly && locked ? <small className={styles.attributeLock}>{selectedValue ? `Centre to take back · other changes in ${cooldownLabel}` : `Locked for ${cooldownLabel}`}</small> : null}
    </div>
  );
}

export function ProfileRecognitionFolders({
  profile,
  isSelf,
  communityLeadersHref,
  showAttributes = true,
  showCards = true,
  connectionCards: suppliedConnectionCards,
}: {
  profile: UserProfile;
  isSelf: boolean;
  communityLeadersHref?: string;
  showAttributes?: boolean;
  showCards?: boolean;
  connectionCards?: ConnectionCardGift[];
}) {
  const { user } = useAuth();
  const viewingSelf = isSelf || !profile.uid || user?.uid === profile.uid;
  const [folder, setFolder] = useState<Folder | null>(null);
  const [mode, setMode] = useState<CardMode>('received');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('received');
  const [received, setReceived] = useState<LifetimeCardGift[]>([]);
  const [loadedConnections, setLoadedConnections] = useState<ConnectionCardGift[]>([]);
  const [inventory, setInventory] = useState<Record<LifetimeCardKind, LifetimeCardSlot>>(defaultLifetimeInventory);
  const [slide, setSlide] = useState(0);
  const requestedSlideRef = useRef<number | null>(null);
  const [giftKind, setGiftKind] = useState<LifetimeCardKind | null>(null);
  const [receivedGift, setReceivedGift] = useState<LifetimeCardGift | null>(null);
  const [sendingSource, setSendingSource] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [closingGift, setClosingGift] = useState(false);
  const rewardSwipe = useCardSwipe();
  const [connectionKind, setConnectionKind] = useState<CardKey | null>(null);
  const [connectionPickerOpen, setConnectionPickerOpen] = useState(false);
  const [closingConnection, setClosingConnection] = useState(false);
  const [sendingConnection, setSendingConnection] = useState<CardKey | null>(null);
  const connectionSwipe = useCardSwipe();
  const [myAttrVotes, setMyAttrVotes] = useState<AttributeVoteMap>({});
  const [myAttrCooldowns, setMyAttrCooldowns] = useState<AttributeVoteMap>({});
  const [attributeBusy, setAttributeBusy] = useState<AttrKey | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [launchLabel, setLaunchLabel] = useState<string | null>(null);
  const [launchKind, setLaunchKind] = useState<'give' | 'take' | null>(null);

  useEffect(() => {
    if (!showCards) return;
    return listenReceivedLifetimeCards(profile.uid, setReceived);
  }, [profile.uid, showCards]);
  useEffect(() => {
    if (!showCards || suppliedConnectionCards) return;
    return listenReceivedConnectionCards(profile.uid, setLoadedConnections);
  }, [profile.uid, showCards, suppliedConnectionCards]);
  useEffect(() => {
    if (viewingSelf) return listenLifetimeInventory(profile.uid, setInventory);
    if (user?.uid) return listenLifetimeInventory(user.uid, setInventory);
  }, [viewingSelf, profile.uid, user?.uid]);
  useEffect(() => {
    setSlide(requestedSlideRef.current ?? 0);
    requestedSlideRef.current = null;
  }, [mode, connectionMode]);
  useEffect(() => {
    if (pickerOpen || closingGift) rewardSwipe.reset();
  }, [closingGift, pickerOpen, rewardSwipe.reset]);
  useEffect(() => {
    if (connectionPickerOpen || closingConnection) connectionSwipe.reset();
  }, [closingConnection, connectionPickerOpen, connectionSwipe.reset]);
  useEffect(() => {
    if (!user || viewingSelf) { setMyAttrVotes({}); setMyAttrCooldowns({}); return; }
    return listenAttributeVoteState(profile.uid, user.uid, ({ attrs, cooldowns }) => {
      setMyAttrVotes(attrs);
      setMyAttrCooldowns(cooldowns);
    });
  }, [viewingSelf, profile.uid, user?.uid]);
  useEffect(() => {
    if (viewingSelf) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [viewingSelf]);
  const receivedConnections = suppliedConnectionCards ?? loadedConnections;
  const rewardCards = LIFETIME_CARD_KINDS.map((kind) => inventory[kind]);
  const availableCount = rewardCards.filter((item) => item.status === 'available').length;
  const sentConnectionKinds = useMemo(() => new Set(
    receivedConnections
      .filter((gift) => gift.fromUid === user?.uid && gift.toUid === profile.uid)
      .map((gift) => gift.kind),
  ), [profile.uid, receivedConnections, user?.uid]);
  const connectionCards = useMemo(() => CARD_KEYS
    .map((key) => ({ key, sent: sentConnectionKinds.has(key) }))
    .sort((left, right) => Number(left.sent) - Number(right.sent)), [sentConnectionKinds]);
  const connectionCount = receivedConnections.length;
  const giftSourceKey = receivedGift ? `received:${receivedGift.id}` : giftKind ? `inventory:${giftKind}` : null;
  const profileRecipient = useMemo<GiftCandidate>(() => ({
    uid: profile.uid,
    name: profile.fullName || profile.firstName || 'Canact user',
    photoURL: profile.photoURL,
    city: profile.city,
    categories: [],
  }), [profile.city, profile.firstName, profile.fullName, profile.photoURL, profile.uid]);
  const givenAttrKeys = useMemo(() => new Set(Object.keys(myAttrVotes)), [myAttrVotes]);

  function openFolder(next: Folder, nextConnectionMode: ConnectionMode = 'received') {
    setPickerOpen(false); setClosingGift(false); setGiftKind(null); setReceivedGift(null);
    setConnectionPickerOpen(false); setClosingConnection(false); setConnectionKind(null);
    setSlide(0);
    setFolder(next);
    if (next === 'cards') setMode('received');
    if (next === 'connections') setConnectionMode(nextConnectionMode);
  }

  function openConnectionStack(kind: CardKey) {
    setPickerOpen(false); setClosingGift(false); setGiftKind(null); setReceivedGift(null);
    setConnectionPickerOpen(false); setClosingConnection(false); setConnectionKind(null);
    const targetSlide = Math.max(0, receivedConnections.findIndex((gift) => gift.kind === kind));
    requestedSlideRef.current = targetSlide;
    setConnectionMode('received');
    setSlide(targetSlide);
    setFolder('connections');
  }

  function closeFolder() {
    setFolder(null);
    setPickerOpen(false); setClosingGift(false); setGiftKind(null); setReceivedGift(null);
    setConnectionPickerOpen(false); setClosingConnection(false); setConnectionKind(null);
  }

  async function addAttribute(key: AttrKey) {
    if (!user || viewingSelf || attributeBusy) return;

    // Taking a signal back is always allowed. The persisted pair ledger still
    // prevents re-giving or switching sides until the cooldown expires.
    if (givenAttrKeys.has(key)) {
      setAttributeBusy(key);
      const label = ATTR_LABELS[key];
      try {
        const r = await removeAttribute(profile.uid, user.uid, key);
        if (!r.ok) toast(`Wait before taking back ${label}`, 'error');
        else {
          setLaunchKind('take');
          setLaunchLabel(label);
          toast(`${label} taken back`, 'success');
        }
      } catch (error: any) {
        toast(error?.message || 'Could not take back attribute', 'error');
      } finally {
        setAttributeBusy(null);
      }
      return;
    }

    // Giving or switching sides uses the pair-wide cooldown enforced by the
    // shared service, so every attribute entry point follows the same ledger.
    setAttributeBusy(key);
    const label = ATTR_LABELS[key];
    try {
      const result = await setAttribute(profile.uid, user.uid, key);
      if (!result.ok) toast(`You already gave ${label} · available again in ${Math.ceil((result.waitMs ?? 0) / 3_600_000)}h`, 'error');
      else {
        setLaunchKind('give');
        setLaunchLabel(label);
        toast(`${label} added`, 'success');
      }
    } catch (error: any) {
      toast(error?.message || 'Could not update attribute', 'error');
    } finally {
      setAttributeBusy(null);
    }
  }

  function updateAttributePair(negative: AttrKey, positive: AttrKey, value: number) {
    if (viewingSelf || attributeBusy) return;
    const current = givenAttrKeys.has(positive) ? positive : givenAttrKeys.has(negative) ? negative : null;
    const next = value > 0 ? positive : value < 0 ? negative : null;
    if (next === current) return;
    if (next) void addAttribute(next);
    else if (current) void addAttribute(current);
  }

  function openGiftPicker(kind: LifetimeCardKind, gift: LifetimeCardGift | null = null) {
    setClosingGift(false);
    setReceivedGift(gift);
    setGiftKind(kind);
    setPickerOpen(true);
  }

  function closeGiftPicker() {
    if (!giftKind || closingGift) return;
    setPickerOpen(false);
    setClosingGift(true);
  }

  function finishGiftClose() {
    if (!closingGift) return;
    setClosingGift(false);
    setGiftKind(null);
    setReceivedGift(null);
  }

  function finishGift() {
    setPickerOpen(false);
    setClosingGift(false);
    setGiftKind(null);
    setReceivedGift(null);
    setMode(receivedGift ? 'received' : 'reward');
  }

  function openConnectionPicker(kind: CardKey) {
    setClosingConnection(false);
    setConnectionKind(kind);
    setConnectionPickerOpen(true);
  }

  function closeConnectionPicker() {
    if (!connectionKind || closingConnection) return;
    setConnectionPickerOpen(false);
    setClosingConnection(true);
  }

  function finishConnectionClose() {
    if (!closingConnection) return;
    setClosingConnection(false);
    setConnectionKind(null);
  }

  function finishConnectionSend() {
    setConnectionPickerOpen(false);
    setClosingConnection(false);
    setConnectionKind(null);
    setSlide(0);
    setConnectionMode('send');
  }

  return (
    <>
      {showCards ? <section className={styles.connectionShowcase} data-onboarding="recognition-folders" aria-labelledby={`connection-cards-${profile.uid}`}>
        <header className={styles.connectionShowcaseHeader}>
          <div>
            <strong id={`connection-cards-${profile.uid}`}>Connection cards</strong>
            <small>{connectionCount ? `${connectionCount} received` : 'Recognition from your connections'}</small>
          </div>
        </header>
        {receivedConnections.length ? (
          <ConnectionCardShowcaseCarousel cards={receivedConnections} onExpand={openConnectionStack} />
        ) : (
          <button type="button" className={styles.connectionEmpty} onClick={() => openFolder('connections', 'received')}>
            <Sparkles size={22} />
            <span><strong>No cards yet</strong><small>Swipe up on a card to recognise someone.</small></span>
          </button>
        )}
        {!viewingSelf ? (
          <button type="button" className={styles.connectionGive} onClick={() => openFolder('connections', 'send')}>
            <ArrowUp size={16} /> Give a card
          </button>
        ) : null}
      </section> : null}

      {showAttributes ? <section className={styles.attributeSliders} aria-labelledby={`attribute-sliders-${profile.uid}`}>
        <header>
          <div>
            <strong id={`attribute-sliders-${profile.uid}`}>{viewingSelf ? 'Your attributes' : `Know ${profile.firstName || profile.fullName.split(' ')[0]}`}</strong>
            <small>{viewingSelf ? 'Community balance across three paired signals.' : 'Slide toward the signal that matches your experience.'}</small>
          </div>
        </header>
        <div className={styles.attributePairList}>
          {ATTRIBUTE_PAIRS.map(({ negative, positive }) => {
            const negativeCount = Number(profile.attrs?.[negative]) || 0;
            const positiveCount = Number(profile.attrs?.[positive]) || 0;
            const selectedValue: -1 | 0 | 1 = givenAttrKeys.has(positive) ? 1 : givenAttrKeys.has(negative) ? -1 : 0;
            const busy = attributeBusy === negative || attributeBusy === positive;
            const cooldownMs = getAttributePairCooldownMs(myAttrVotes, myAttrCooldowns, positive, clock);
            return (
              <AttributePairSlider
                key={positive}
                negative={negative}
                positive={positive}
                negativeCount={negativeCount}
                positiveCount={positiveCount}
                selectedValue={selectedValue}
                busy={busy}
                cooldownMs={cooldownMs}
                readOnly={viewingSelf}
                onCommit={(value) => updateAttributePair(negative, positive, value)}
              />
            );
          })}
        </div>
        {!viewingSelf ? <p className={styles.attributeHint}>Drag to an edge to give a signal. Return to the centre to take it back after the cooldown.</p> : null}
      </section> : null}

      {communityLeadersHref ? (
        <Link href={communityLeadersHref} className={styles.attributeAction}>
          <span><strong>Community leaders</strong></span>
          <ChevronRight size={20} />
        </Link>
      ) : null}

      {showCards ? <Sheet open={folder !== null} onClose={closeFolder} title={folder === 'connections' ? 'Connection cards' : 'Lifetime cards'} hideClose topmost nearFullscreen flatSurface={folder === 'connections'}>
        {folder === 'connections' ? (
          <div className={styles.gallery} data-connection-popup="true">
            {connectionMode === 'received' ? (
              <CardGallery items={receivedConnections} index={slide} setIndex={setSlide} empty="No connection cards received yet." loop render={(gift) => <ConnectionCard gift={gift} />} />
            ) : (
              <CardGallery
                items={connectionCards}
                index={slide}
                setIndex={setSlide}
                empty="No connection cards available."
                loop
                onDragY={connectionCards[Math.min(slide, Math.max(connectionCards.length - 1, 0))]?.sent ? undefined : connectionSwipe.onDrag}
                render={(item) => (
                <SendableConnectionCard
                  cardKey={item.key}
                  active={connectionPickerOpen && connectionKind === item.key}
                  exiting={closingConnection && connectionKind === item.key}
                  sending={sendingConnection === item.key}
                  sent={item.sent}
                  recipientName={profile.firstName || profile.fullName || 'this person'}
                  dragY={connectionSwipe.dragY}
                  launchRef={connectionSwipe.launchRef}
                  onSend={() => openConnectionPicker(item.key)}
                />
                )}
              />
            )}
          </div>
        ) : folder === 'cards' ? (
          <div className={styles.gallery}>
            <div className={styles.tabs}>
              <button type="button" className={mode === 'received' ? styles.activeTab : ''} onClick={() => setMode('received')}>Received · {received.length}</button>
              <button type="button" className={mode === 'reward' ? styles.activeTab : ''} onClick={() => setMode('reward')}>Give · {availableCount}/3</button>
            </div>
            {mode === 'received' ? (
              <CardGallery items={received} index={slide} setIndex={setSlide} empty="No lifetime cards received yet." onDragY={viewingSelf ? rewardSwipe.onDrag : undefined} render={(gift) => (
                viewingSelf ? (
                  <ReceivedLifetimeCard
                    card={gift}
                    active={pickerOpen && receivedGift?.id === gift.id}
                    exiting={closingGift && receivedGift?.id === gift.id}
                    sending={sendingSource === `received:${gift.id}`}
                    dragY={rewardSwipe.dragY}
                    launchRef={rewardSwipe.launchRef}
                    onGift={() => openGiftPicker(gift.kind, gift)}
                  />
                ) : <LifetimeCard card={gift} />
              )} />
            ) : (
              <CardGallery items={rewardCards} index={slide} setIndex={setSlide} empty="All three lifetime cards have been given." onDragY={rewardSwipe.onDrag} render={(slot) => <RewardCard slot={slot} active={pickerOpen && !receivedGift && giftKind === slot.kind} exiting={closingGift && !receivedGift && giftKind === slot.kind} sending={sendingSource === `inventory:${slot.kind}`} dragY={rewardSwipe.dragY} launchRef={rewardSwipe.launchRef} onGift={() => { if (slot.status === 'available') openGiftPicker(slot.kind); }} />} />
            )}
          </div>
        ) : null}
      </Sheet> : null}

      <RecipientPicker
        open={pickerOpen}
        kind={giftKind}
        sourceGift={receivedGift}
        profile={profile}
        fixedRecipient={viewingSelf ? null : profileRecipient}
        onClose={closeGiftPicker}
        onExited={finishGiftClose}
        onSendingChange={(sending) => setSendingSource(sending ? giftSourceKey : null)}
        onSent={finishGift}
      />

      {showCards ? <ConnectionRecipientPicker
        open={connectionPickerOpen}
        kind={connectionKind}
        profile={profile}
        fixedRecipient={viewingSelf ? null : profileRecipient}
        onClose={closeConnectionPicker}
        onExited={finishConnectionClose}
        onSendingChange={(sending) => setSendingConnection(sending ? connectionKind : null)}
        onSent={finishConnectionSend}
      /> : null}

      {launchLabel && launchKind ? <RocketLaunchOverlay label={launchLabel} kind={launchKind} onDone={() => { setLaunchLabel(null); setLaunchKind(null); }} /> : null}
    </>
  );
}

function ConnectionCardShowcaseCarousel({ cards, onExpand }: { cards: ConnectionCardGift[]; onExpand: (kind: CardKey) => void }) {
  const groups = useMemo(() => {
    const grouped = new Map<CardKey, ConnectionCardGift[]>();
    for (const gift of cards) {
      const existing = grouped.get(gift.kind) ?? [];
      existing.push(gift);
      grouped.set(gift.kind, existing);
    }
    return Array.from(grouped.entries()).map(([kind, gifts]) => ({ kind, gifts }));
  }, [cards]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const dragXRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startedAt: number; axis: 'x' | 'y' | null; target: EventTarget | null } | null>(null);
  const touchDragRef = useRef<{ identifier: number; startX: number; startY: number; startedAt: number; axis: 'x' | 'y' | null } | null>(null);
  const suppressClickRef = useRef(false);
  const count = groups.length;
  const wrapIndex = useCallback((value: number) => count ? (value + count) % count : 0, [count]);

  useEffect(() => {
    setActiveIndex((current) => count ? current % count : 0);
  }, [count]);

  const move = useCallback((direction: number) => {
    if (count < 2) return;
    setActiveIndex((current) => wrapIndex(current + direction));
  }, [count, wrapIndex]);

  const finishSwipe = useCallback((axis: 'x' | 'y' | null, travelled: number, startedAt: number, cancelled = false) => {
    const elapsed = Math.max(1, performance.now() - startedAt);
    const velocity = Math.abs(travelled) / elapsed;
    const committedSwipe = !cancelled && axis === 'x'
      && (Math.abs(travelled) >= 34 || (Math.abs(travelled) >= 16 && velocity >= .32));
    if (committedSwipe) move(travelled < 0 ? 1 : -1);
    if (axis === 'x' && Math.abs(travelled) >= 8) {
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 120);
    }
    dragXRef.current = 0;
    setDragX(0);
  }, [move]);

  const finishDrag = useCallback((pointerId: number, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    const travelled = dragXRef.current;
    // Release pointer capture so child click events fire on mobile
    const captureTarget = drag.target as Element | null;
    if (captureTarget?.hasPointerCapture?.(pointerId)) {
      captureTarget.releasePointerCapture(pointerId);
    }
    finishSwipe(drag.axis, travelled, drag.startedAt, cancelled);
  }, [finishSwipe]);

  const positions = count > 1 ? [-1, 0, 1] : [0];
  const activeGroup = groups[activeIndex];

  useLayoutEffect(() => {
    const activeItem = activeItemRef.current;
    if (!activeItem) return;
    const frontCard = Array.from(activeItem.children).find((child): child is HTMLElement => (
      child instanceof HTMLElement
      && child.tagName === 'ARTICLE'
      && !child.hasAttribute('data-stack-layer')
    ));
    const cardStage = frontCard?.querySelector<HTMLElement>('[data-attribute-card-style]') ?? null;
    const measure = () => {
      const stackTail = activeGroup && activeGroup.gifts.length > 1 ? 24 : 9;
      const cardHeight = Math.max(
        activeItem.offsetHeight,
        frontCard?.offsetHeight ?? 0,
        frontCard?.scrollHeight ?? 0,
        cardStage?.offsetHeight ?? 0,
        cardStage?.scrollHeight ?? 0,
      );
      const nextHeight = Math.ceil(cardHeight + stackTail);
      setViewportHeight((current) => current === nextHeight ? current : nextHeight);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(activeItem);
    if (frontCard) observer.observe(frontCard);
    if (cardStage) observer.observe(cardStage);
    measure();
    return () => observer.disconnect();
  }, [activeGroup]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const findTouch = (touches: TouchList, identifier: number) => {
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (touch?.identifier === identifier) return touch;
      }
      return null;
    };
    const resetTouch = (cancelled: boolean) => {
      const drag = touchDragRef.current;
      if (!drag) return;
      touchDragRef.current = null;
      finishSwipe(drag.axis, dragXRef.current, drag.startedAt, cancelled);
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        resetTouch(true);
        return;
      }
      const touch = event.touches.item(0);
      if (!touch) return;
      touchDragRef.current = {
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: performance.now(),
        axis: null,
      };
      dragXRef.current = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const drag = touchDragRef.current;
      if (!drag) return;
      const touch = findTouch(event.touches, drag.identifier);
      if (!touch) return;
      const nextX = touch.clientX - drag.startX;
      const nextY = touch.clientY - drag.startY;
      if (!drag.axis) drag.axis = getGestureAxis(nextX, nextY);
      if (drag.axis !== 'x') return;
      if (event.cancelable) event.preventDefault();
      dragXRef.current = nextX;
      setDragX(nextX);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const drag = touchDragRef.current;
      if (!drag || !findTouch(event.changedTouches, drag.identifier)) return;
      resetTouch(false);
    };
    const onTouchCancel = (event: TouchEvent) => {
      const drag = touchDragRef.current;
      if (!drag || !findTouch(event.changedTouches, drag.identifier)) return;
      resetTouch(true);
    };

    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [finishSwipe]);

  return (
    <div className={styles.connectionCarousel}>
      <div
        ref={viewportRef}
        className={styles.connectionCarouselViewport}
        data-dragging={dragRef.current !== null}
        style={{
          '--carousel-drag': `${dragX * .72}px`,
          '--connection-carousel-height': viewportHeight ? `${viewportHeight}px` : undefined,
        } as React.CSSProperties}
        onPointerDown={(event) => {
          if (event.pointerType === 'touch' || !event.isPrimary || dragRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
          dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startedAt: performance.now(), axis: null, target: event.currentTarget };
          dragXRef.current = 0;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'touch') return;
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const nextX = event.clientX - drag.startX;
          const nextY = event.clientY - drag.startY;
          if (!drag.axis) drag.axis = getGestureAxis(nextX, nextY);
          if (drag.axis === 'x') {
            dragXRef.current = nextX;
            setDragX(nextX);
          }
        }}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.pointerId, true)}
        onLostPointerCapture={(event) => finishDrag(event.pointerId, true)}
        aria-label="Received connection cards"
      >
        {positions.map((position) => {
          const groupIndex = wrapIndex(activeIndex + position);
          const group = groups[groupIndex]!;
          const representative = group.gifts[0]!;
          const active = position === 0;
          return (
            <div
              ref={active ? activeItemRef : undefined}
              key={count === 2 ? `${position}:${group.kind}` : group.kind}
              className={styles.connectionCarouselItem}
              data-position={position}
              data-stacked={active && group.gifts.length > 1}
              data-connection-kind={group.kind}
            >
              {active && group.gifts.length > 1 ? (
                <>
                  <ConnectionCard gift={representative} stackLayer={2} />
                  <ConnectionCard gift={representative} stackLayer={1} />
                </>
              ) : null}
              <ConnectionCard gift={representative} />
              {active && group.gifts.length > 1 ? <span className={styles.connectionStackCount}>×{group.gifts.length}</span> : null}
              <button
                type="button"
                className={styles.connectionCarouselHit}
                aria-label={active
                  ? `${group.gifts.length > 1 ? `Expand ${group.gifts.length}` : 'Open'} ${CARD_LABELS[group.kind]} connection ${group.gifts.length > 1 ? 'cards' : 'card'}`
                  : `Show ${CARD_LABELS[group.kind]} card`}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  if (active) onExpand(group.kind);
                  else move(position);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CardGallery<T>({ items, index, setIndex, empty, render, onDragY, loop = false }: { items: T[]; index: number; setIndex: (index: number) => void; empty: string; render: (item: T) => React.ReactNode; onDragY?: (dy: number, phase: 'move' | 'end') => void; loop?: boolean }) {
  const safeIndex = Math.min(index, Math.max(items.length - 1, 0));
  const canLoop = loop && items.length > 1;
  const previousIndex = safeIndex > 0 ? safeIndex - 1 : items.length - 1;
  const nextIndex = safeIndex < items.length - 1 ? safeIndex + 1 : 0;
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startedAt: number; idx: number; dir: 'h' | 'v' | null } | null>(null);
  const dragXRef = useRef(0);
  const dragYRef = useRef(0);
  const [dragX, setDragX] = useState(0);
  const [animDir, setAnimDir] = useState<'left' | 'right' | null>(null);

  useEffect(() => { setAnimDir(null); setDragX(0); dragXRef.current = 0; }, [safeIndex]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary || dragRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startedAt: performance.now(), idx: safeIndex, dir: null };
    dragXRef.current = 0;
    dragYRef.current = 0;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    // Determine direction once threshold passed
    if (!dragRef.current.dir) {
      const axis = getGestureAxis(dx, dy);
      if (axis) dragRef.current.dir = axis === 'x' ? 'h' : 'v';
    }
    if (dragRef.current.dir === 'h') {
      const atStart = !canLoop && safeIndex === 0 && dx > 0;
      const atEnd = !canLoop && safeIndex === items.length - 1 && dx < 0;
      const resistedX = atStart || atEnd ? dx * .28 : dx;
      dragXRef.current = resistedX;
      setDragX(resistedX);
    } else if (dragRef.current.dir === 'v' && onDragY) {
      e.preventDefault();
      dragYRef.current = dy;
      onDragY(dy, 'move');
    }
  };
  const finishPointer = (cancelled = false, pointerId?: number) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    dragRef.current = null;
    if (drag.dir === 'h') {
      const x = dragXRef.current;
      const elapsed = Math.max(1, performance.now() - drag.startedAt);
      const velocity = Math.abs(x) / elapsed;
      const committed = !cancelled && (Math.abs(x) >= 34 || (Math.abs(x) >= 16 && velocity >= .32));
      if (committed && x < 0 && (canLoop || safeIndex < items.length - 1)) { setAnimDir('left'); setIndex(nextIndex); }
      else if (committed && x > 0 && (canLoop || safeIndex > 0)) { setAnimDir('right'); setIndex(previousIndex); }
    } else if (drag.dir === 'v' && onDragY) {
      onDragY(cancelled ? 0 : dragYRef.current, 'end');
    } else if (onDragY) {
      onDragY(0, 'end');
    }
    setDragX(0); dragXRef.current = 0; dragYRef.current = 0;
  };

  if (!items.length) return <div className={styles.empty}>{empty}</div>;
  return (
    <div className={styles.gallery}>
      <div className={styles.slider} data-vertical-swipe={onDragY ? 'true' : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={(event) => finishPointer(false, event.pointerId)}
        onPointerCancel={(event) => finishPointer(true, event.pointerId)}
        onLostPointerCapture={(event) => finishPointer(true, event.pointerId)}>
        <div className={`${styles.cardWrap} ${animDir ? styles[`slide${animDir === 'left' ? 'Out' : 'In'}Left`] : ''}`}
          style={{ transform: dragX ? `translateX(${dragX * 0.6}px)` : undefined }}>
          {render(items[safeIndex]!)}
        </div>
        <div className={styles.galleryNav}>
          <button type="button" aria-label="Previous card" disabled={items.length < 2 || (!canLoop && safeIndex === 0)} onClick={() => { setAnimDir('right'); setIndex(previousIndex); }}><ChevronLeft size={19} /></button>
          <div className={styles.dots}>{items.map((_, dot) => <button key={dot} type="button" aria-label={`Show card ${dot + 1}`} className={dot === safeIndex ? styles.activeDot : ''} onClick={() => { setAnimDir(dot > safeIndex ? 'left' : 'right'); setIndex(dot); }} />)}</div>
          <button type="button" aria-label="Next card" disabled={items.length < 2 || (!canLoop && safeIndex === items.length - 1)} onClick={() => { setAnimDir('left'); setIndex(nextIndex); }}><ChevronRight size={19} /></button>
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({ gift, stackLayer }: { gift: ConnectionCardGift; stackLayer?: 1 | 2 }) {
  const cardStyle = useAttributeCardStyle();
  return (
    <article
      className={`${styles.card} ${styles.connectionCard}`}
      data-kind={gift.kind}
      data-family="connection"
      data-connection-kind={gift.kind}
      data-connection-card-style={cardStyle}
      data-stack-layer={stackLayer}
      aria-hidden={stackLayer ? true : undefined}
    >
      <ConnectionCardContent
        cardKey={gift.kind}
        givenBy={gift.fromName}
        date={new Date(gift.sentAt).toLocaleDateString()}
        showGivenDetails
      />
    </article>
  );
}

function SendableConnectionCard({ cardKey, active, exiting, sending, sent, recipientName, dragY, launchRef, onSend }: { cardKey: CardKey; active: boolean; exiting: boolean; sending: boolean; sent: boolean; recipientName: string; dragY: number; launchRef: React.MutableRefObject<(() => void) | null>; onSend: () => void }) {
  return (
    <SwipeableLifetimeCard kind={cardKey} family="connection" sourceKey={`connection:${cardKey}`} enabled={!sent} active={active} exiting={exiting} sending={sending} sent={sent} dragY={dragY} launchRef={launchRef} onGift={onSend}>
      <ConnectionCardContent
        cardKey={cardKey}
        givenBy="YOU"
        date={new Date().toLocaleDateString()}
      />
      {sent ? (
        <span className={styles.sentConnectionShell} aria-label={`${CARD_LABELS[cardKey]} already sent to ${recipientName}`}>
          <span><Check size={18} /></span>
          <small>Already given</small>
          <strong>{CARD_LABELS[cardKey]}</strong>
          <em>Sent to {recipientName}</em>
        </span>
      ) : null}
    </SwipeableLifetimeCard>
  );
}

function CardIcon({ kind }: { kind: LifetimeCardKind }) {
  if (kind === 'life_saver') return <Heart size={29} fill="currentColor" />;
  if (kind === 'golden_person') return <Crown size={30} />;
  return <Sparkles size={29} />;
}

function LifetimeCard({ card }: { card: LifetimeCardGift }) {
  return (
    <article className={styles.card} data-kind={card.kind}>
      <span className={styles.cardIcon}><CardIcon kind={card.kind} /></span>
      <div className={styles.cardCopy}>
        <small>Given forever by {card.fromName}</small>
        <h3>{LIFETIME_CARD_LABELS[card.kind]}</h3>
        <p>{card.customText || CARD_DESCRIPTIONS[card.kind]}</p>
      </div>
      <div className={styles.giftHint}><span>Received {new Date(card.sentAt).toLocaleDateString()}</span><Check size={18} /></div>
    </article>
  );
}

function ReceivedLifetimeCard({ card, active, exiting, sending, dragY, launchRef, onGift }: { card: LifetimeCardGift; active: boolean; exiting: boolean; sending: boolean; dragY: number; launchRef: React.MutableRefObject<(() => void) | null>; onGift: () => void }) {
  return (
    <SwipeableLifetimeCard kind={card.kind} sourceKey={`received:${card.id}`} enabled active={active} exiting={exiting} sending={sending} dragY={dragY} launchRef={launchRef} onGift={onGift}>
      <span className={styles.cardIcon}><CardIcon kind={card.kind} /></span>
      <div className={styles.cardCopy}>
        <small>Given by {card.fromName}</small>
        <h3>{LIFETIME_CARD_LABELS[card.kind]}</h3>
        <p>{card.customText || CARD_DESCRIPTIONS[card.kind]}</p>
      </div>
      <div className={styles.giftHint}><span>{active || exiting ? null : <ArrowUp size={17} />} {active || exiting ? 'Choose its next person' : 'Swipe up to pass it on'}</span><Send size={18} /></div>
    </SwipeableLifetimeCard>
  );
}

function RewardCard({ slot, active, exiting, sending, dragY, launchRef, onGift }: { slot: LifetimeCardSlot; active: boolean; exiting: boolean; sending: boolean; dragY: number; launchRef: React.MutableRefObject<(() => void) | null>; onGift: () => void }) {
  return (
    <SwipeableLifetimeCard kind={slot.kind} sourceKey={`inventory:${slot.kind}`} enabled={slot.status === 'available'} active={active} exiting={exiting} sending={sending} dragY={dragY} launchRef={launchRef} onGift={onGift} sent={slot.status === 'sent'}>
      <span className={styles.cardIcon}><CardIcon kind={slot.kind} /></span>
      <div className={styles.cardCopy}><small>One of your three lifetime gifts</small><h3>{LIFETIME_CARD_LABELS[slot.kind]}</h3><p>{CARD_DESCRIPTIONS[slot.kind]}</p></div>
      {slot.status === 'available' ? (
        <div className={styles.giftHint}><span>{active || exiting ? null : <ArrowUp size={17} />} {active || exiting ? 'Choose someone meaningful' : 'Swipe up to give forever'}</span><Send size={18} /></div>
      ) : (
        <div className={styles.giftHint}><span>Given forever to {slot.recipientName || 'someone special'}</span><Check size={18} /></div>
      )}
    </SwipeableLifetimeCard>
  );
}

function SwipeableLifetimeCard({ kind, family = 'lifetime', sourceKey, enabled, active, exiting, sending, sent = false, dragY, launchRef, onGift, children }: { kind: string; family?: 'lifetime' | 'connection'; sourceKey: string; enabled: boolean; active: boolean; exiting: boolean; sending: boolean; sent?: boolean; dragY: number; launchRef: React.MutableRefObject<(() => void) | null>; onGift: () => void; children: React.ReactNode }) {
  const connectionCardStyle = useAttributeCardStyle();
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const onGiftRef = useRef(onGift);
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [popupBounds, setPopupBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => { onGiftRef.current = onGift; });
  useEffect(() => {
    launchRef.current = enabled ? () => onGiftRef.current() : null;
    return () => { launchRef.current = null; };
  }, [enabled, launchRef]);

  useLayoutEffect(() => {
    const placeholder = placeholderRef.current;
    if (!placeholder) return;
    const measure = () => {
      if (active || exiting) return;
      const rect = placeholder.getBoundingClientRect();
      setBounds((current) => current
        && Math.abs(current.left - rect.left) < .5
        && Math.abs(current.top - rect.top) < .5
        && Math.abs(current.width - rect.width) < .5
        && Math.abs(current.height - rect.height) < .5
        ? current
        : { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(placeholder);
    const sheet = placeholder.closest<HTMLElement>('[data-canact-sheet-panel="true"]');
    sheet?.addEventListener('transitionend', measure);
    document.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      sheet?.removeEventListener('transitionend', measure);
      document.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [active, exiting, sourceKey]);

  useLayoutEffect(() => {
    if (!active && !exiting) {
      setPopupBounds(null);
      return;
    }
    let panel: HTMLElement | null = null;
    const resizeObserver = new ResizeObserver(() => syncPanel());
    const syncPanel = () => {
      const ownerPanel = placeholderRef.current?.closest<HTMLElement>('[data-canact-sheet-panel="true"]') ?? null;
      const nextPanel = Array.from(document.querySelectorAll<HTMLElement>('[data-canact-sheet-panel="true"]'))
        .reverse()
        .find((candidate) => candidate !== ownerPanel) ?? null;
      if (!nextPanel) {
        setPopupBounds(null);
        return;
      }
      if (panel !== nextPanel) {
        panel?.style.removeProperty('--canact-lifted-card-clearance');
        resizeObserver.disconnect();
        resizeObserver.observe(nextPanel);
        panel = nextPanel;
      }
      const rect = nextPanel.getBoundingClientRect();
      const next = {
        left: rect.left,
        top: Math.max(0, window.innerHeight - nextPanel.offsetHeight),
        width: nextPanel.offsetWidth || rect.width,
        height: nextPanel.offsetHeight || rect.height,
      };
      if (bounds?.width && bounds.height) {
        const availableWidth = Math.min(620, window.innerWidth - 32, next.width - 32);
        const scale = Math.min(1, availableWidth / bounds.width);
        const overlap = Math.min(42, Math.max(0, next.top - 16));
        nextPanel.style.setProperty('--canact-lifted-card-clearance', `${Math.ceil(24 + bounds.height * scale - overlap + 16)}px`);
      }
      setPopupBounds((current) => current
        && Math.abs(current.left - next.left) < .5
        && Math.abs(current.top - next.top) < .5
        && Math.abs(current.width - next.width) < .5
        && Math.abs(current.height - next.height) < .5
        ? current
        : next);
    };
    const mutationObserver = new MutationObserver(syncPanel);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    const frame = requestAnimationFrame(() => requestAnimationFrame(syncPanel));
    window.addEventListener('resize', syncPanel);
    return () => {
      cancelAnimationFrame(frame);
      panel?.style.removeProperty('--canact-lifted-card-clearance');
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', syncPanel);
    };
  }, [active, bounds, exiting]);

  const isDragging = dragY !== 0;
  const viewportWidth = typeof window === 'undefined' ? 430 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 844 : window.innerHeight;
  const availableWidth = Math.min(620, viewportWidth - 32, (popupBounds?.width ?? viewportWidth) - 32);
  const liftScale = bounds ? Math.min(1, availableWidth / bounds.width) : 1;
  const anchorCenter = popupBounds ? popupBounds.left + (popupBounds.width / 2) : viewportWidth / 2;
  const liftX = bounds ? anchorCenter - (bounds.left + bounds.width / 2) : 0;
  const scaledHeight = bounds ? bounds.height * liftScale : 0;
  const viewportLiftTop = Math.max(20, Math.min(72, viewportHeight * .06));
  const sheetOverlap = popupBounds ? Math.min(42, Math.max(0, popupBounds.top - 16)) : 0;
  const liftTop = popupBounds ? Math.max(16, popupBounds.top - sheetOverlap) : viewportLiftTop;
  const scaleTopOffset = bounds ? (bounds.height - scaledHeight) / 2 : 0;
  const liftY = bounds ? liftTop - bounds.top - scaleTopOffset : 0;
  const dragProgress = Math.min(1, Math.max(0, -dragY / 110));
  const dragScale = 1 + dragProgress * .055;
  const lifted = active && !!popupBounds;
  const floating = isDragging || lifted || exiting || sending;
  const cardTransform = lifted
      ? `translate3d(${liftX}px, ${liftY}px, 0) scale(${liftScale}) rotateX(-1.5deg)`
      : active
        ? 'translate3d(0, -54px, 0) scale(1.025) rotateX(-1deg)'
        : `translate3d(0, ${dragY}px, 0) scale(${dragScale}) rotateX(${-dragProgress * 2.5}deg)`;

  const card = (
    <article
      className={styles.card}
      data-lifetime-card-source={sourceKey}
      data-kind={kind}
      data-family={family}
      data-connection-card-style={family === 'connection' ? connectionCardStyle : undefined}
      data-sent={sent}
      data-sending={sending}
      data-reward={enabled ? 'true' : undefined}
      data-disabled={!enabled ? 'true' : undefined}
      data-dragging={isDragging}
      data-lifted={active}
      data-exiting={exiting}
      style={{
        ...(floating && bounds ? {
          position: 'fixed',
          left: bounds.left,
          top: bounds.top,
          zIndex: 2147483002,
          width: bounds.width,
          height: bounds.height,
          margin: 0,
          pointerEvents: 'none',
          transformOrigin: 'center center',
          transform: cardTransform,
          transition: isDragging ? 'none' : 'transform 320ms cubic-bezier(.22,.85,.3,1), opacity 200ms ease',
        } : {}),
      }}
    >
      {children}
    </article>
  );

  return (
    <div
      ref={placeholderRef}
      className={styles.rewardCardPlaceholder}
      style={floating && bounds ? { height: bounds.height } : undefined}
    >
      {floating && bounds && typeof document !== 'undefined' ? createPortal(card, document.body) : card}
    </div>
  );
}

function RecipientPicker({ open, kind, sourceGift, profile, fixedRecipient, onClose, onExited, onSendingChange, onSent }: { open: boolean; kind: LifetimeCardKind | null; sourceGift: LifetimeCardGift | null; profile: UserProfile; fixedRecipient?: GiftCandidate | null; onClose: () => void; onExited: () => void; onSendingChange: (sending: boolean) => void; onSent: () => void }) {
  const [candidates, setCandidates] = useState<GiftCandidate[]>([]);
  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [phase, setPhase] = useState<'message' | 'people'>('people');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendAnimation, setSendAnimation] = useState<{ kind: LifetimeCardKind; customText: string; rect: SendAnimationRect } | null>(null);
  const animationResolveRef = useRef<(() => void) | null>(null);
  const selected = useMemo(() => candidates.find((candidate) => candidate.uid === selectedUid) ?? null, [candidates, selectedUid]);

  useEffect(() => {
    if (!open) { setSelectedUid(null); setQuery(''); setFilter('all'); setCustomText(''); setPhase('people'); return; }
    setCustomText(sourceGift?.customText ?? '');
    setPhase(kind === 'custom' && !sourceGift ? 'message' : 'people');
    if (fixedRecipient) {
      setCandidates([fixedRecipient]);
      setSelectedUid(fixedRecipient.uid);
      setLoading(false);
      return;
    }
    setSelectedUid(null);
    setLoading(true);
    loadGiftCandidates(profile).then(setCandidates).catch(() => toast('Could not load people', 'error')).finally(() => setLoading(false));
  }, [fixedRecipient?.uid, kind, open, profile.uid, sourceGift?.customText, sourceGift?.id]);

  const wordCount = customText.trim() ? customText.trim().split(/\s+/).length : 0;
  const messageValid = wordCount > 0 && wordCount <= 24;

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return candidates.filter((candidate) => (filter === 'all' || candidate.categories.includes(filter)) && (!search || `${candidate.name} ${candidate.city || ''}`.toLowerCase().includes(search)));
  }, [candidates, filter, query]);

  const finishSendAnimation = useCallback(() => {
    animationResolveRef.current?.();
    animationResolveRef.current = null;
    setSendAnimation(null);
  }, []);

  useEffect(() => () => {
    animationResolveRef.current?.();
    animationResolveRef.current = null;
  }, []);

  async function send() {
    if (!kind || !selected || sending || (!sourceGift && kind === 'custom' && !customText.trim())) return;
    const sourceKey = sourceGift ? `received:${sourceGift.id}` : `inventory:${kind}`;
    const animationDone = new Promise<void>((resolve) => {
      animationResolveRef.current = resolve;
      setSendAnimation({
        kind,
        customText,
        rect: getSendAnimationRect(sourceKey),
      });
    });
    setSending(true);
    onSendingChange(true);
    try {
      await Promise.all([sendLifetimeCard(selected.uid, kind, customText, sourceGift?.id), animationDone]);
      toast(`${LIFETIME_CARD_LABELS[kind]} was ${sourceGift ? 'passed on' : 'given'} to ${selected.name}`, 'success');
      onSent();
    } catch (error: any) {
      finishSendAnimation();
      toast(error?.message || 'Could not send card', 'error');
    } finally {
      onSendingChange(false);
      setSending(false);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={sending ? () => {} : onClose} onExited={onExited} title={kind === 'custom' && phase === 'message' ? 'Write your card' : kind ? `Give ${LIFETIME_CARD_LABELS[kind]}` : 'Give card'} hideTitle hideClose topmost>
        <div className={`${styles.picker} ${kind ? styles.pickerWithCard : ''}`} data-fixed-recipient={fixedRecipient ? 'true' : undefined}>
          <div className={styles.warning}>{sourceGift ? 'Passing this card on removes it from your collection forever. It can return only if a future owner chooses to send it back.' : 'This is one of only three cards you can originate. Once sent, it leaves your collection forever unless someone gives a lifetime card back to you.'}</div>
          {kind === 'custom' && !sourceGift && phase === 'message' ? (
            <div className={styles.messageStep}>
              <textarea className={styles.message} maxLength={140} value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="Write the words they should keep forever…" autoFocus />
              <div className={styles.wordCount} data-invalid={wordCount > 24}><span>Keep it meaningful and concise.</span><strong>{wordCount}/24 words</strong></div>
              <button type="button" className={styles.sendButton} disabled={!messageValid} onClick={() => setPhase('people')}>Next <ChevronRight size={18} /></button>
            </div>
          ) : (
            <>
              {kind === 'custom' && !sourceGift ? <button type="button" className={styles.editMessage} onClick={() => setPhase('message')}><ChevronLeft size={16} /> Edit message</button> : null}
              {!fixedRecipient ? <div className={styles.filters}>{FILTERS.map((item) => <button key={item.id} type="button" className={filter === item.id ? styles.activeFilter : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div> : null}
              {!fixedRecipient ? <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></label> : null}
              <div className={styles.people}>
                {loading ? <div className={styles.empty}><Loader2 className="animate-spin" /></div> : visible.length ? visible.map((candidate) => (
                  <button key={candidate.uid} type="button" className={styles.person} data-selected={selectedUid === candidate.uid} aria-pressed={selectedUid === candidate.uid} onClick={() => setSelectedUid(candidate.uid)}>
                    <Avatar src={candidate.photoURL} name={candidate.name} size={44} />
                    <span><strong>{candidate.name}</strong><small>{candidate.city || candidate.categories.map((value) => FILTERS.find((item) => item.id === value)?.label).filter(Boolean).join(' · ')}</small></span>
                    {selectedUid === candidate.uid ? <Check size={18} className="text-brand" /> : null}
                  </button>
                )) : <div className={styles.empty}>No people found in this filter.</div>}
              </div>
              <button type="button" className={styles.sendButton} disabled={!selected || sending} onClick={send}>{sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} {sourceGift ? 'Pass on' : 'Give forever'}{selected ? ` to ${selected.name}` : ''}</button>
            </>
          )}
        </div>
      </Sheet>
      {sendAnimation ? (
        <LifetimeCardSendAnimation
          sourceRect={sendAnimation.rect}
          tone="lifetime"
          onComplete={finishSendAnimation}
          renderCard={(layerClassName, style) => (
            <article className={`${styles.card} ${layerClassName}`} data-kind={sendAnimation.kind} style={style} aria-hidden="true">
              <span className={styles.cardIcon}><CardIcon kind={sendAnimation.kind} /></span>
              <div className={styles.cardCopy}>
                <small>One of your three lifetime gifts</small>
                <h3>{LIFETIME_CARD_LABELS[sendAnimation.kind]}</h3>
                <p>{sendAnimation.kind === 'custom' && sendAnimation.customText.trim() ? sendAnimation.customText : CARD_DESCRIPTIONS[sendAnimation.kind]}</p>
              </div>
              <div className={styles.giftHint}><span><Send size={17} /> Sending forever</span></div>
            </article>
          )}
        />
      ) : null}
    </>
  );
}

function ConnectionRecipientPicker({ open, kind, profile, fixedRecipient, onClose, onExited, onSendingChange, onSent }: { open: boolean; kind: CardKey | null; profile: UserProfile; fixedRecipient?: GiftCandidate | null; onClose: () => void; onExited: () => void; onSendingChange: (sending: boolean) => void; onSent: () => void }) {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<GiftCandidate[]>([]);
  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendAnimation, setSendAnimation] = useState<{ kind: CardKey; rect: SendAnimationRect } | null>(null);
  const animationResolveRef = useRef<(() => void) | null>(null);
  const selected = useMemo(() => candidates.find((candidate) => candidate.uid === selectedUid) ?? null, [candidates, selectedUid]);

  useEffect(() => {
    if (!open) { setSelectedUid(null); setQuery(''); setFilter('all'); return; }
    if (fixedRecipient) {
      setCandidates([fixedRecipient]);
      setSelectedUid(fixedRecipient.uid);
      setLoading(false);
      return;
    }
    setSelectedUid(null);
    setLoading(true);
    loadGiftCandidates(profile).then(setCandidates).catch(() => toast('Could not load people', 'error')).finally(() => setLoading(false));
  }, [fixedRecipient?.uid, kind, open, profile.uid]);

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return candidates.filter((candidate) => (filter === 'all' || candidate.categories.includes(filter)) && (!search || `${candidate.name} ${candidate.city || ''}`.toLowerCase().includes(search)));
  }, [candidates, filter, query]);

  const finishAnimation = useCallback(() => {
    animationResolveRef.current?.();
    animationResolveRef.current = null;
    setSendAnimation(null);
  }, []);

  useEffect(() => () => {
    animationResolveRef.current?.();
    animationResolveRef.current = null;
  }, []);

  async function send() {
    if (!kind || !selected || !user || sending) return;
    const sourceKey = `connection:${kind}`;
    const animationDone = new Promise<void>((resolve) => {
      animationResolveRef.current = resolve;
      setSendAnimation({ kind, rect: getSendAnimationRect(sourceKey) });
    });
    setSending(true);
    onSendingChange(true);
    try {
      const sendRequest = sendConnectionCard(selected.uid, kind);
      await Promise.all([sendRequest, animationDone]);
      toast(`${CARD_LABELS[kind]} sent to ${selected.name}`, 'success');
      onSent();
    } catch (error: any) {
      finishAnimation();
      toast(error?.message || 'Could not send connection card', 'error');
    } finally {
      onSendingChange(false);
      setSending(false);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={sending ? () => {} : onClose} onExited={onExited} title={kind ? `Send ${CARD_LABELS[kind]}` : 'Send connection card'} hideTitle hideClose topmost nearFullscreen>
        <div className={`${styles.picker} ${kind ? styles.pickerWithCard : ''}`} data-fixed-recipient={fixedRecipient ? 'true' : undefined}>
          <div className={styles.connectionNote}>Connection cards celebrate a quality you genuinely experienced. Each card type can be sent once to the same person.</div>
          {!fixedRecipient ? <div className={styles.filters}>{FILTERS.map((item) => <button key={item.id} type="button" className={filter === item.id ? styles.activeFilter : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div> : null}
          {!fixedRecipient ? <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></label> : null}
          <div className={styles.people}>
            {loading ? <div className={styles.empty}><Loader2 className="animate-spin" /></div> : visible.length ? visible.map((candidate) => (
              <button key={candidate.uid} type="button" className={styles.person} data-selected={selectedUid === candidate.uid} aria-pressed={selectedUid === candidate.uid} onClick={() => setSelectedUid(candidate.uid)}>
                <Avatar src={candidate.photoURL} name={candidate.name} size={44} />
                <span><strong>{candidate.name}</strong><small>{candidate.city || candidate.categories.map((value) => FILTERS.find((item) => item.id === value)?.label).filter(Boolean).join(' · ')}</small></span>
                {selectedUid === candidate.uid ? <Check size={18} className="text-brand" /> : null}
              </button>
            )) : <div className={styles.empty}>No people found in this filter.</div>}
          </div>
          <button type="button" className={styles.sendButton} disabled={!selected || sending} onClick={send}>{sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Send card{selected ? ` to ${selected.name}` : ''}</button>
        </div>
      </Sheet>
      {sendAnimation ? (
        <LifetimeCardSendAnimation sourceRect={sendAnimation.rect} onComplete={finishAnimation} ariaLabel="Sending connection card" renderCard={(layerClassName, style) => (
          <article className={`${styles.card} ${styles.connectionCard} ${layerClassName}`} data-connection-kind={sendAnimation.kind} style={style} aria-hidden="true">
            <ConnectionCardContent cardKey={sendAnimation.kind} givenBy="YOU" date={new Date().toLocaleDateString()} />
          </article>
        )} />
      ) : null}
    </>
  );
}

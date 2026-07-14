'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { onValue, ref } from 'firebase/database';
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
  Laugh,
  Minus,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Sparkles,
  Users,
  Zap,
} from './icons';
import { ATTR_LABELS, CARD_KEYS, CARD_LABELS, LIFETIME_CARD_KINDS, LIFETIME_CARD_LABELS, NEGATIVE_ATTRS, POSITIVE_ATTRS, type AttrKey, type CardKey, type ConnectionCardGift, type GiftCandidate, type GiftCandidateCategory, type LifetimeCardGift, type LifetimeCardKind, type LifetimeCardSlot, type UserProfile } from '@/lib/types';
import { defaultLifetimeInventory, listenLifetimeInventory, listenReceivedLifetimeCards, loadGiftCandidates, sendLifetimeCard } from '@/lib/services/lifetimeCards';
import { listenReceivedConnectionCards, sendConnectionCard } from '@/lib/services/connectionCards';
import { removeAttribute, setAttribute, SIX_HOURS } from '@/lib/services/votes';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import styles from './ProfileRecognitionFolders.module.css';
import { CardsFolderSVG, ConnectionCardsFolderSVG } from './FolderSVGs';
import { LifetimeCardSendAnimation } from './LifetimeCardSendAnimation';
import { RocketLaunchOverlay } from './RocketLaunchOverlay';

type Folder = 'connections' | 'cards';
type CardMode = 'received' | 'reward';
type ConnectionMode = 'received' | 'send';
type CandidateFilter = 'all' | GiftCandidateCategory;
type SendAnimationRect = { left: number; top: number; width: number; height: number; naturalWidth: number; naturalHeight: number };

function useCardSwipe() {
  const [dragY, setDragY] = useState(0);
  const launchRef = useRef<(() => void) | null>(null);
  const onDrag = useCallback((dy: number, phase: 'move' | 'end') => {
    const next = Math.max(-180, Math.min(0, dy));
    if (phase === 'move') return setDragY(next);
    setDragY(0);
    if (next <= -54) launchRef.current?.();
  }, []);
  return { dragY, launchRef, onDrag };
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

const CONNECTION_CARD_DESCRIPTIONS: Record<CardKey, string> = {
  understanding: 'For someone who truly sees and understands others.',
  humour: 'For the person who brings lightness and laughter.',
  goodVibes: 'For someone whose energy makes every room better.',
  confidence: 'For someone who inspires belief and courage.',
  cooperative: 'For someone who makes working together effortless.',
  intelligence: 'For the person who notices what others miss.',
  creativity: 'For someone who turns ideas into possibilities.',
  daring: 'For someone brave enough to take the meaningful leap.',
};

export function ProfileRecognitionFolders({ profile, isSelf, communityLeadersHref }: { profile: UserProfile; isSelf: boolean; communityLeadersHref?: string }) {
  const { user } = useAuth();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [mode, setMode] = useState<CardMode>('received');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('received');
  const [received, setReceived] = useState<LifetimeCardGift[]>([]);
  const [receivedConnections, setReceivedConnections] = useState<ConnectionCardGift[]>([]);
  const [inventory, setInventory] = useState<Record<LifetimeCardKind, LifetimeCardSlot>>(defaultLifetimeInventory);
  const [slide, setSlide] = useState(0);
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
  const [directConnectionKind, setDirectConnectionKind] = useState<CardKey | null>(null);
  const [directConnectionSending, setDirectConnectionSending] = useState(false);
  const [directGiftKind, setDirectGiftKind] = useState<LifetimeCardKind | null>(null);
  const [directGiftCustomText, setDirectGiftCustomText] = useState('');
  const [directGiftPhase, setDirectGiftPhase] = useState<'message' | 'confirm'>('message');
  const [directGiftSending, setDirectGiftSending] = useState(false);
  const [directSendAnimation, setDirectSendAnimation] = useState<
    | { family: 'connection'; kind: CardKey; rect: SendAnimationRect }
    | { family: 'lifetime'; kind: LifetimeCardKind; customText: string; rect: SendAnimationRect }
    | null
  >(null);
  const directAnimationResolveRef = useRef<(() => void) | null>(null);
  const [attributePopupOpen, setAttributePopupOpen] = useState(false);
  const [myAttrVotes, setMyAttrVotes] = useState<Record<string, { at: number }>>({});
  const [attributeBusy, setAttributeBusy] = useState<AttrKey | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [launchLabel, setLaunchLabel] = useState<string | null>(null);
  const [launchKind, setLaunchKind] = useState<'give' | 'take' | null>(null);

  useEffect(() => listenReceivedLifetimeCards(profile.uid, setReceived), [profile.uid]);
  useEffect(() => listenReceivedConnectionCards(profile.uid, setReceivedConnections), [profile.uid]);
  useEffect(() => {
    if (isSelf) return listenLifetimeInventory(profile.uid, setInventory);
    if (user?.uid) return listenLifetimeInventory(user.uid, setInventory);
  }, [isSelf, profile.uid, user?.uid]);
  useEffect(() => { setSlide(0); }, [folder, mode, connectionMode]);
  useEffect(() => {
    if (!user || isSelf) { setMyAttrVotes({}); return; }
    return onValue(ref(db, `votes/${profile.uid}/${user.uid}/attrs`), (snapshot) => {
      const map: Record<string, { at: number }> = {};
      snapshot.forEach((child) => { const v = child.val(); if (v) map[child.key!] = v; });
      setMyAttrVotes(map);
    });
  }, [isSelf, profile.uid, user?.uid]);
  useEffect(() => {
    if (!attributePopupOpen) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [attributePopupOpen]);

  const attributeCards = useMemo(() => [...POSITIVE_ATTRS, ...NEGATIVE_ATTRS].map((key) => ({
    key,
    count: Number(profile.attrs?.[key]) || 0,
    positive: POSITIVE_ATTRS.includes(key as typeof POSITIVE_ATTRS[number]),
  })), [profile.attrs]);
  const positiveAttrs = useMemo(() => attributeCards.filter((a) => a.positive), [attributeCards]);
  const negativeAttrs = useMemo(() => attributeCards.filter((a) => !a.positive), [attributeCards]);
  const rewardCards = LIFETIME_CARD_KINDS.map((kind) => inventory[kind]);
  const availableCount = rewardCards.filter((item) => item.status === 'available').length;
  const connectionCards = CARD_KEYS.map((key) => ({ key }));
  const connectionCount = receivedConnections.length;
  const giftSourceKey = receivedGift ? `received:${receivedGift.id}` : giftKind ? `inventory:${giftKind}` : null;
  const attributeCooldown = (key: AttrKey): number => {
    const v = myAttrVotes[key];
    if (!v?.at) return 0;
    return Math.max(0, SIX_HOURS - (clock - v.at));
  };

  /** Shortest cooldown across all given attributes (for the info line). */
  const minCooldown = useMemo(() => {
    const keys = Object.keys(myAttrVotes);
    if (!keys.length) return 0;
    return Math.min(...keys.map((k) => attributeCooldown(k as AttrKey)));
  }, [myAttrVotes, clock]); // eslint-disable-line react-hooks/exhaustive-deps

  const givenAttrKeys = useMemo(() => new Set(Object.keys(myAttrVotes)), [myAttrVotes]);

  const finishDirectAnimation = useCallback(() => {
    directAnimationResolveRef.current?.();
    directAnimationResolveRef.current = null;
    setDirectSendAnimation(null);
  }, []);

  useEffect(() => () => directAnimationResolveRef.current?.(), []);

  function startDirectAnimation(animation: NonNullable<typeof directSendAnimation>) {
    return new Promise<void>((resolve) => {
      directAnimationResolveRef.current = resolve;
      setDirectSendAnimation(animation);
    });
  }

  function openFolder(next: Folder) {
    setPickerOpen(false); setClosingGift(false); setGiftKind(null); setReceivedGift(null);
    setConnectionPickerOpen(false); setClosingConnection(false); setConnectionKind(null);
    setFolder(next);
    if (next === 'cards') setMode('received');
    if (next === 'connections') setConnectionMode('received');
  }

  function closeFolder() {
    setFolder(null);
    setPickerOpen(false); setClosingGift(false); setGiftKind(null); setReceivedGift(null);
    setConnectionPickerOpen(false); setClosingConnection(false); setConnectionKind(null);
  }

  async function addAttribute(key: AttrKey) {
    if (!user || isSelf || attributeBusy) return;

    // Already given and past cooldown → take it back (minus).
    if (givenAttrKeys.has(key) && attributeCooldown(key) === 0) {
      setAttributeBusy(key);
      const label = ATTR_LABELS[key];
      setLaunchKind('take');
      setLaunchLabel(label);
      try {
        const r = await removeAttribute(profile.uid, user.uid, key);
        if (!r.ok) toast(`Wait before taking back ${label}`, 'error');
        else toast(`${label} taken back`, 'success');
      } catch (error: any) {
        toast(error?.message || 'Could not take back attribute', 'error');
      } finally {
        setAttributeBusy(null);
      }
      return;
    }

    // Already given but still in cooldown → explain why.
    if (givenAttrKeys.has(key)) {
      const hrs = Math.ceil(attributeCooldown(key) / 3_600_000);
      toast(`You gave ${ATTR_LABELS[key]}. You can take it back in ${hrs}h.`, 'error');
      return;
    }

    // Giving a new (different) attribute — per-attribute cooldown only
    // applies if the exact same key was given already (handled by setAttribute).
    setAttributeBusy(key);
    const label = ATTR_LABELS[key];
    setLaunchKind('give');
    setLaunchLabel(label);
    try {
      const result = await setAttribute(profile.uid, user.uid, key);
      if (!result.ok) toast(`You already gave ${label} · available again in ${Math.ceil((result.waitMs ?? 0) / 3_600_000)}h`, 'error');
      else toast(`${label} added`, 'success');
    } catch (error: any) {
      toast(error?.message || 'Could not update attribute', 'error');
    } finally {
      setAttributeBusy(null);
    }
  }

  function openGiftPicker(kind: LifetimeCardKind, gift: LifetimeCardGift | null = null) {
    if (!isSelf) { setDirectGiftKind(kind); setDirectGiftPhase(kind === 'custom' ? 'message' : 'confirm'); return; }
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
    if (!isSelf) { setDirectConnectionKind(kind); return; }
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
    setConnectionMode('send');
  }

  async function sendDirectConnection() {
    if (!directConnectionKind || !user || directConnectionSending) return;
    const kind = directConnectionKind;
    const animationDone = startDirectAnimation({ family: 'connection', kind, rect: getSendAnimationRect(`connection:${kind}`) });
    setDirectConnectionSending(true);
    setSendingConnection(kind);
    try {
      await Promise.all([sendConnectionCard(profile.uid, kind), animationDone]);
      toast(`${CARD_LABELS[kind]} sent to ${profile.firstName || profile.fullName}`, 'success');
      setDirectConnectionKind(null);
    } catch (error: any) {
      finishDirectAnimation();
      toast(error?.message || 'Could not send connection card', 'error');
    } finally {
      setDirectConnectionSending(false);
      setSendingConnection(null);
    }
  }

  async function sendDirectGift() {
    if (!directGiftKind || !user || directGiftSending) return;
    if (directGiftKind === 'custom' && !directGiftCustomText.trim()) return;
    const kind = directGiftKind;
    const customText = directGiftCustomText.trim();
    const animationDone = startDirectAnimation({ family: 'lifetime', kind, customText, rect: getSendAnimationRect(`inventory:${kind}`) });
    setDirectGiftSending(true);
    setSendingSource(`inventory:${kind}`);
    try {
      await Promise.all([sendLifetimeCard(profile.uid, kind, customText || undefined), animationDone]);
      toast(`${LIFETIME_CARD_LABELS[kind]} given to ${profile.firstName || profile.fullName}`, 'success');
      setDirectGiftKind(null);
      setDirectGiftCustomText('');
      setDirectGiftPhase('message');
    } catch (error: any) {
      finishDirectAnimation();
      toast(error?.message || 'Could not send lifetime card', 'error');
    } finally {
      setDirectGiftSending(false);
      setSendingSource(null);
    }
  }

  return (
    <>
      <div className={styles.folderGrid}>
        <button type="button" className={styles.folderCard} aria-label="Open connection cards" onClick={() => openFolder('connections')}>
          <ConnectionCardsFolderSVG count={connectionCount} />
        </button>
        <button type="button" className={styles.folderCard} aria-label="Open lifetime cards" onClick={() => openFolder('cards')}>
          <CardsFolderSVG count={received.length} label="Cards received" />
        </button>
      </div>

      {communityLeadersHref ? (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className={styles.attributeAction} onClick={() => setAttributePopupOpen(true)}>
            <span><strong>{isSelf ? 'Your attributes' : 'Know this person?'}</strong><small>Tap to view &amp; manage</small></span>
            <ChevronRight size={20} />
          </button>
          <Link href={communityLeadersHref} className={styles.attributeAction}>
            <span><strong>Community leaders</strong><small>Top trusted people</small></span>
            <ChevronRight size={20} />
          </Link>
        </div>
      ) : (
        <button type="button" className={styles.attributeAction} onClick={() => setAttributePopupOpen(true)}>
          <span className={styles.attributeActionIcon}>{isSelf ? <Sparkles size={21} /> : <Users size={21} />}</span>
          <span><strong>{isSelf ? 'How people know you' : 'Know this person?'}</strong><small>{isSelf ? 'Open your six community attributes' : `Add what stands out about ${profile.firstName || profile.fullName.split(' ')[0]}`}</small></span>
          <ChevronRight size={20} />
        </button>
      )}

      <Sheet open={folder !== null} onClose={closeFolder} title={folder === 'connections' ? 'Connection cards' : 'Lifetime cards'} hideClose topmost>
        {folder === 'connections' ? (
          <div className={styles.gallery}>
            <div className={styles.tabs}>
              <button type="button" className={connectionMode === 'received' ? styles.activeTab : ''} onClick={() => setConnectionMode('received')}>Received · {connectionCount}</button>
              <button type="button" className={connectionMode === 'send' ? styles.activeTab : ''} onClick={() => setConnectionMode('send')}>Give · {CARD_KEYS.length}</button>
            </div>
            {connectionMode === 'received' ? (
              <CardGallery items={receivedConnections} index={slide} setIndex={setSlide} empty="No connection cards received yet." render={(gift) => <ConnectionCard gift={gift} />} />
            ) : (
              <CardGallery items={connectionCards} index={slide} setIndex={setSlide} empty="No connection cards available." onDragY={connectionSwipe.onDrag} render={(item) => (
                <SendableConnectionCard
                  cardKey={item.key}
                  active={(connectionPickerOpen && connectionKind === item.key) || directConnectionKind === item.key}
                  exiting={closingConnection && connectionKind === item.key}
                  sending={sendingConnection === item.key}
                  dragY={connectionSwipe.dragY}
                  launchRef={connectionSwipe.launchRef}
                  onSend={() => openConnectionPicker(item.key)}
                />
              )} />
            )}
          </div>
        ) : folder === 'cards' ? (
          <div className={styles.gallery}>
            <div className={styles.tabs}>
              <button type="button" className={mode === 'received' ? styles.activeTab : ''} onClick={() => setMode('received')}>Received · {received.length}</button>
              <button type="button" className={mode === 'reward' ? styles.activeTab : ''} onClick={() => setMode('reward')}>Give · {availableCount}/3</button>
            </div>
            {mode === 'received' ? (
              <CardGallery items={received} index={slide} setIndex={setSlide} empty="No lifetime cards received yet." onDragY={isSelf ? rewardSwipe.onDrag : undefined} render={(gift) => (
                isSelf ? (
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
              <CardGallery items={rewardCards} index={slide} setIndex={setSlide} empty="All three lifetime cards have been given." onDragY={rewardSwipe.onDrag} render={(slot) => <RewardCard slot={slot} active={(pickerOpen && !receivedGift && giftKind === slot.kind) || directGiftKind === slot.kind} exiting={closingGift && !receivedGift && giftKind === slot.kind} sending={sendingSource === `inventory:${slot.kind}`} dragY={rewardSwipe.dragY} launchRef={rewardSwipe.launchRef} onGift={() => { if (slot.status === 'available') openGiftPicker(slot.kind); }} />} />
            )}
          </div>
        ) : null}
      </Sheet>

      <RecipientPicker
        open={pickerOpen}
        kind={giftKind}
        sourceGift={receivedGift}
        profile={profile}
        onClose={closeGiftPicker}
        onExited={finishGiftClose}
        onSendingChange={(sending) => setSendingSource(sending ? giftSourceKey : null)}
        onSent={finishGift}
      />

      <ConnectionRecipientPicker
        open={connectionPickerOpen}
        kind={connectionKind}
        profile={profile}
        onClose={closeConnectionPicker}
        onExited={finishConnectionClose}
        onSendingChange={(sending) => setSendingConnection(sending ? connectionKind : null)}
        onSent={finishConnectionSend}
      />

      <Sheet open={attributePopupOpen} onClose={() => setAttributePopupOpen(false)} title={isSelf ? 'Your attributes' : `Know ${profile.firstName || profile.fullName.split(' ')[0]}`} topmost>
        <div className={styles.attributePopup}>
          <p>{isSelf ? 'These are the community signals people have shared about you.' : minCooldown > 0 ? `You gave ${[...givenAttrKeys].map((k) => ATTR_LABELS[k as AttrKey]).join(', ')} · next update in ${Math.ceil(minCooldown / 3_600_000)}h.` : 'Choose the attributes that best reflect your experience with this person.'}</p>
          <AttributePickerGroup title="Positive traits" items={positiveAttrs} selected={givenAttrKeys} isSelf={isSelf} disabled={!!attributeBusy} busy={attributeBusy} onPick={addAttribute} />
          <AttributePickerGroup title="Concerns" items={negativeAttrs} selected={givenAttrKeys} isSelf={isSelf} disabled={!!attributeBusy} busy={attributeBusy} onPick={addAttribute} />
        </div>
      </Sheet>

      {/* Direct send — connection card to profile owner (non-self profiles) */}
      <Sheet open={directConnectionKind !== null} onClose={() => setDirectConnectionKind(null)} title="Send connection card" hideClose topmost>
        {directConnectionKind && (
          <div className={styles.picker}>
            <div className={styles.connectionNote}>Connection cards celebrate a quality you genuinely experienced. This card will be sent to <strong>{profile.firstName || profile.fullName}</strong>.</div>
            <div className="flex items-center gap-4 rounded-2xl bg-brand-light/40 p-4">
              <Avatar src={profile.photoURL} name={profile.fullName} size={48} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-extrabold text-ink">{profile.fullName}</div>
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold text-brand">{CARD_LABELS[directConnectionKind]}</div>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink/55">{CONNECTION_CARD_DESCRIPTIONS[directConnectionKind]}</p>
            <button type="button" className={styles.sendButton} disabled={directConnectionSending} onClick={sendDirectConnection}>
              {directConnectionSending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Send to {profile.firstName || profile.fullName}
            </button>
          </div>
        )}
      </Sheet>

      {/* Direct send — lifetime card to profile owner (non-self profiles) */}
      <Sheet open={directGiftKind !== null} onClose={() => { setDirectGiftKind(null); setDirectGiftCustomText(''); setDirectGiftPhase('message'); }} title={directGiftKind === 'custom' && directGiftPhase === 'message' ? 'Write your card' : `Give ${directGiftKind ? LIFETIME_CARD_LABELS[directGiftKind] : 'card'}`} hideClose topmost>
        {directGiftKind && (
          <div className={styles.picker}>
            <div className={styles.warning}>This lifetime card will be sent to <strong>{profile.firstName || profile.fullName}</strong>. Once given, it leaves your collection forever.</div>
            {directGiftKind === 'custom' && directGiftPhase === 'message' ? (
              <div className={styles.messageStep}>
                <textarea className={styles.message} maxLength={140} value={directGiftCustomText} onChange={(e) => setDirectGiftCustomText(e.target.value)} placeholder="Write the words they should keep forever…" autoFocus />
                <div className={styles.wordCount} data-invalid={(directGiftCustomText.trim() ? directGiftCustomText.trim().split(/\s+/).length : 0) > 24}><span>Keep it meaningful and concise.</span><strong>{(directGiftCustomText.trim() ? directGiftCustomText.trim().split(/\s+/).length : 0)}/24 words</strong></div>
                <button type="button" className={styles.sendButton} disabled={!directGiftCustomText.trim() || (directGiftCustomText.trim().split(/\s+/).length > 24)} onClick={() => setDirectGiftPhase('confirm')}>Next <ChevronRight size={18} /></button>
              </div>
            ) : (
              <>
                {directGiftKind === 'custom' ? <button type="button" className={styles.editMessage} onClick={() => setDirectGiftPhase('message')}><ChevronLeft size={16} /> Edit message</button> : null}
                <div className="flex items-center gap-4 rounded-2xl bg-brand-light/40 p-4">
                  <Avatar src={profile.photoURL} name={profile.fullName} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-extrabold text-ink">{profile.fullName}</div>
                    <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold text-brand">{LIFETIME_CARD_LABELS[directGiftKind]}</div>
                  </div>
                </div>
                {directGiftKind === 'custom' && directGiftCustomText.trim() ? <p className="mt-3 rounded-xl bg-brand-light/40 px-3 py-2 text-sm italic text-ink/70">"{directGiftCustomText.trim()}"</p> : null}
                <p className="mt-3 text-xs leading-relaxed text-ink/55">{CARD_DESCRIPTIONS[directGiftKind]}</p>
                <button type="button" className={styles.sendButton} disabled={directGiftSending} onClick={sendDirectGift}>
                  {directGiftSending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Give to {profile.firstName || profile.fullName}
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>

      {directSendAnimation ? (
        <LifetimeCardSendAnimation
          sourceRect={directSendAnimation.rect}
          tone={directSendAnimation.family}
          onComplete={finishDirectAnimation}
          ariaLabel={directSendAnimation.family === 'lifetime' ? 'Sending lifetime card' : 'Sending connection card'}
          renderCard={(layerClassName, style) => directSendAnimation.family === 'connection' ? (
            <article className={`${styles.card} ${styles.connectionCard} ${layerClassName}`} data-connection-kind={directSendAnimation.kind} style={style} aria-hidden="true">
              <ConnectionCardContent cardKey={directSendAnimation.kind} eyebrow="Connection card" footer="Sending with appreciation" trailing={null} />
            </article>
          ) : (
            <article className={`${styles.card} ${layerClassName}`} data-kind={directSendAnimation.kind} style={style} aria-hidden="true">
              <span className={styles.cardIcon}><CardIcon kind={directSendAnimation.kind} /></span>
              <div className={styles.cardCopy}>
                <small>One of your three lifetime gifts</small>
                <h3>{LIFETIME_CARD_LABELS[directSendAnimation.kind]}</h3>
                <p>{directSendAnimation.kind === 'custom' && directSendAnimation.customText ? directSendAnimation.customText : CARD_DESCRIPTIONS[directSendAnimation.kind]}</p>
              </div>
              <div className={styles.giftHint}><span>Sending forever</span></div>
            </article>
          )}
        />
      ) : null}

      {launchLabel && launchKind ? <RocketLaunchOverlay label={launchLabel} kind={launchKind} onDone={() => { setLaunchLabel(null); setLaunchKind(null); }} /> : null}
    </>
  );
}

function CardGallery<T>({ items, index, setIndex, empty, render, onDragY }: { items: T[]; index: number; setIndex: (index: number) => void; empty: string; render: (item: T) => React.ReactNode; onDragY?: (dy: number, phase: 'move' | 'end') => void }) {
  const safeIndex = Math.min(index, Math.max(items.length - 1, 0));
  const dragRef = useRef<{ startX: number; startY: number; idx: number; dir: 'h' | 'v' | null } | null>(null);
  const dragXRef = useRef(0);
  const dragYRef = useRef(0);
  const [dragX, setDragX] = useState(0);
  const [animDir, setAnimDir] = useState<'left' | 'right' | null>(null);

  useEffect(() => { setAnimDir(null); setDragX(0); dragXRef.current = 0; }, [safeIndex]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, idx: safeIndex, dir: null };
    dragXRef.current = 0;
    dragYRef.current = 0;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    // Determine direction once threshold passed
    if (!dragRef.current.dir && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      dragRef.current.dir = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      if (dragRef.current.dir === 'h') (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (dragRef.current.dir === 'h') {
      dragXRef.current = dx;
      setDragX(dx);
    } else if (dragRef.current.dir === 'v' && onDragY) {
      dragYRef.current = dy;
      onDragY(dy, 'move');
    }
  };
  const finishPointer = (cancelled = false) => {
    if (!dragRef.current) return;
    if (dragRef.current.dir === 'h') {
      const x = dragXRef.current;
      const threshold = 60;
      if (x < -threshold && safeIndex < items.length - 1) { setAnimDir('left'); setIndex(safeIndex + 1); }
      else if (x > threshold && safeIndex > 0) { setAnimDir('right'); setIndex(safeIndex - 1); }
    } else if (dragRef.current.dir === 'v' && onDragY) {
      onDragY(cancelled ? 0 : dragYRef.current, 'end');
    }
    dragRef.current = null; setDragX(0); dragXRef.current = 0; dragYRef.current = 0;
  };

  if (!items.length) return <div className={styles.empty}>{empty}</div>;
  return (
    <div className={styles.gallery}>
      <div className={styles.slider}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={() => finishPointer()} onPointerCancel={() => finishPointer(true)}>
        <div className={`${styles.cardWrap} ${animDir ? styles[`slide${animDir === 'left' ? 'Out' : 'In'}Left`] : ''}`}
          style={{ transform: dragX ? `translateX(${dragX * 0.6}px)` : undefined }}>
          {render(items[safeIndex]!)}
        </div>
        <div className={styles.galleryNav}>
          <button type="button" aria-label="Previous card" disabled={safeIndex === 0} onClick={() => { setAnimDir('right'); setIndex(safeIndex - 1); }}><ChevronLeft size={19} /></button>
          <div className={styles.dots}>{items.map((_, dot) => <button key={dot} type="button" aria-label={`Show card ${dot + 1}`} className={dot === safeIndex ? styles.activeDot : ''} onClick={() => { setAnimDir(dot > safeIndex ? 'left' : 'right'); setIndex(dot); }} />)}</div>
          <button type="button" aria-label="Next card" disabled={safeIndex === items.length - 1} onClick={() => { setAnimDir('left'); setIndex(safeIndex + 1); }}><ChevronRight size={19} /></button>
        </div>
      </div>
    </div>
  );
}

function AttributePickerGroup({ title, items, selected, isSelf, disabled, busy, onPick }: { title: string; items: Array<{ key: AttrKey; count: number; positive: boolean }>; selected: Set<string>; isSelf: boolean; disabled: boolean; busy: AttrKey | null; onPick: (key: AttrKey) => void }) {
  return (
    <section className={styles.attributeGroup}>
      <h3>{title}</h3>
      <div>{items.map((item) => {
        const chosen = selected.has(item.key);
        return (
          <button key={item.key} type="button" data-positive={item.positive} data-selected={chosen} disabled={isSelf || disabled} onClick={() => onPick(item.key)}>
            <span><strong>{ATTR_LABELS[item.key]}</strong><small>{item.count} received</small></span>
            {isSelf ? <b>{item.count}</b> : busy === item.key ? <Loader2 size={18} className="animate-spin" /> : chosen ? <i aria-hidden data-remove><Minus size={17} /></i> : <i aria-hidden><Plus size={17} /></i>}
          </button>
        );
      })}</div>
    </section>
  );
}

function ConnectionCardIcon({ cardKey }: { cardKey: CardKey }) {
  if (cardKey === 'confidence') return <ShieldCheck size={30} />;
  if (cardKey === 'goodVibes') return <Smile size={30} />;
  if (cardKey === 'humour') return <Laugh size={30} />;
  if (cardKey === 'cooperative' || cardKey === 'understanding') return <Users size={30} />;
  if (cardKey === 'daring') return <Zap size={30} />;
  return <Sparkles size={30} />;
}

function ConnectionCardContent({ cardKey, eyebrow, footer, trailing }: { cardKey: CardKey; eyebrow: string; footer: React.ReactNode; trailing: React.ReactNode }) {
  return (
    <>
      <span className={styles.cardIcon}><ConnectionCardIcon cardKey={cardKey} /></span>
      <div className={styles.cardCopy}><small>{eyebrow}</small><h3>{CARD_LABELS[cardKey]}</h3><p>{CONNECTION_CARD_DESCRIPTIONS[cardKey]}</p></div>
      <div className={styles.giftHint}><span>{footer}</span>{trailing}</div>
    </>
  );
}

function ConnectionCard({ gift }: { gift: ConnectionCardGift }) {
  return (
    <article className={`${styles.card} ${styles.connectionCard}`} data-kind={gift.kind} data-family="connection" data-connection-kind={gift.kind}>
      <ConnectionCardContent
        cardKey={gift.kind}
        eyebrow={`Given by ${gift.fromName}`}
        footer={`Received ${new Date(gift.sentAt).toLocaleDateString()}`}
        trailing={<Check size={18} />}
      />
    </article>
  );
}

function SendableConnectionCard({ cardKey, active, exiting, sending, dragY, launchRef, onSend }: { cardKey: CardKey; active: boolean; exiting: boolean; sending: boolean; dragY: number; launchRef: React.MutableRefObject<(() => void) | null>; onSend: () => void }) {
  return (
    <SwipeableLifetimeCard kind={cardKey} family="connection" sourceKey={`connection:${cardKey}`} enabled active={active} exiting={exiting} sending={sending} dragY={dragY} launchRef={launchRef} onGift={onSend}>
      <ConnectionCardContent
        cardKey={cardKey}
        eyebrow="Connection card"
        footer={<>{active || exiting ? null : <ArrowUp size={17} />} {active || exiting ? 'Choose a connection' : 'Swipe up to give'}</>}
        trailing={<Send size={18} />}
      />
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
      const nextPanel = Array.from(document.querySelectorAll<HTMLElement>('[data-canact-sheet-panel="true"]')).at(-1) ?? null;
      if (!nextPanel) return;
      if (panel !== nextPanel) {
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
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', syncPanel);
    };
  }, [active, exiting]);

  const isDragging = dragY !== 0;
  const viewportWidth = typeof window === 'undefined' ? 430 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 844 : window.innerHeight;
  const availableWidth = Math.min(620, viewportWidth - 32, (popupBounds?.width ?? viewportWidth) - 32);
  const liftScale = bounds ? Math.max(.68, Math.min(1.16, availableWidth / bounds.width)) : 1;
  const anchorCenter = popupBounds ? popupBounds.left + (popupBounds.width / 2) : viewportWidth / 2;
  const liftX = bounds ? anchorCenter - (bounds.left + bounds.width / 2) : 0;
  const scaledHeight = bounds ? bounds.height * liftScale : 0;
  const viewportLiftTop = Math.max(20, Math.min(72, viewportHeight * .06));
  const liftTop = popupBounds ? Math.max(16, popupBounds.top + 24) : viewportLiftTop;
  const scaleTopOffset = bounds ? (bounds.height - scaledHeight) / 2 : 0;
  const liftY = bounds ? liftTop - bounds.top - scaleTopOffset : 0;
  const dragProgress = Math.min(1, Math.max(0, -dragY / 110));
  const dragScale = 1 + dragProgress * .055;
  const lifted = active;
  const floating = isDragging || lifted || exiting || sending;
  const cardTransform = lifted
      ? `translate3d(${liftX}px, ${liftY}px, 0) scale(${liftScale}) rotateX(-1.5deg)`
      : `translate3d(0, ${dragY}px, 0) scale(${dragScale}) rotateX(${-dragProgress * 2.5}deg)`;

  const card = (
    <article
      className={styles.card}
      data-lifetime-card-source={sourceKey}
      data-kind={kind}
      data-family={family}
      data-sent={sent}
      data-sending={sending}
      data-reward="true"
      data-dragging={isDragging}
      data-lifted={lifted}
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
    <div ref={placeholderRef} className={styles.rewardCardPlaceholder}>
      {floating && bounds && typeof document !== 'undefined' ? createPortal(card, document.body) : card}
    </div>
  );
}

function RecipientPicker({ open, kind, sourceGift, profile, onClose, onExited, onSendingChange, onSent }: { open: boolean; kind: LifetimeCardKind | null; sourceGift: LifetimeCardGift | null; profile: UserProfile; onClose: () => void; onExited: () => void; onSendingChange: (sending: boolean) => void; onSent: () => void }) {
  const [candidates, setCandidates] = useState<GiftCandidate[]>([]);
  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GiftCandidate | null>(null);
  const [customText, setCustomText] = useState('');
  const [phase, setPhase] = useState<'message' | 'people'>('people');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendAnimation, setSendAnimation] = useState<{ kind: LifetimeCardKind; customText: string; rect: SendAnimationRect } | null>(null);
  const animationResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) { setSelected(null); setQuery(''); setFilter('all'); setCustomText(''); setPhase('people'); return; }
    setCustomText(sourceGift?.customText ?? '');
    setPhase(kind === 'custom' && !sourceGift ? 'message' : 'people');
    setLoading(true);
    loadGiftCandidates(profile).then(setCandidates).catch(() => toast('Could not load people', 'error')).finally(() => setLoading(false));
  }, [kind, open, profile, sourceGift?.customText, sourceGift?.id]);

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
        <div className={`${styles.picker} ${kind ? styles.pickerWithCard : ''}`}>
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
              <div className={styles.filters}>{FILTERS.map((item) => <button key={item.id} type="button" className={filter === item.id ? styles.activeFilter : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
              <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></label>
              <div className={styles.people}>
                {loading ? <div className={styles.empty}><Loader2 className="animate-spin" /></div> : visible.length ? visible.map((candidate, i) => (
                  <button key={`${candidate.uid}-${i}`} type="button" className={styles.person} data-selected={selected?.uid === candidate.uid} onClick={() => setSelected(candidate)}>
                    <Avatar src={candidate.photoURL} name={candidate.name} size={44} />
                    <span><strong>{candidate.name}</strong><small>{candidate.city || candidate.categories.map((value) => FILTERS.find((item) => item.id === value)?.label).filter(Boolean).join(' · ')}</small></span>
                    {selected?.uid === candidate.uid ? <Check size={18} className="text-brand" /> : null}
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

function ConnectionRecipientPicker({ open, kind, profile, onClose, onExited, onSendingChange, onSent }: { open: boolean; kind: CardKey | null; profile: UserProfile; onClose: () => void; onExited: () => void; onSendingChange: (sending: boolean) => void; onSent: () => void }) {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<GiftCandidate[]>([]);
  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GiftCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendAnimation, setSendAnimation] = useState<{ kind: CardKey; rect: SendAnimationRect } | null>(null);
  const animationResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) { setSelected(null); setQuery(''); setFilter('all'); return; }
    setLoading(true);
    loadGiftCandidates(profile).then(setCandidates).catch(() => toast('Could not load people', 'error')).finally(() => setLoading(false));
  }, [kind, open, profile]);

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
      <Sheet open={open} onClose={sending ? () => {} : onClose} onExited={onExited} title={kind ? `Send ${CARD_LABELS[kind]}` : 'Send connection card'} hideTitle hideClose topmost>
        <div className={`${styles.picker} ${kind ? styles.pickerWithCard : ''}`}>
          <div className={styles.connectionNote}>Connection cards celebrate a quality you genuinely experienced. Each card type can be sent once to the same person.</div>
          <div className={styles.filters}>{FILTERS.map((item) => <button key={item.id} type="button" className={filter === item.id ? styles.activeFilter : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
          <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></label>
          <div className={styles.people}>
            {loading ? <div className={styles.empty}><Loader2 className="animate-spin" /></div> : visible.length ? visible.map((candidate, i) => (
              <button key={`${candidate.uid}-${i}`} type="button" className={styles.person} data-selected={selected?.uid === candidate.uid} onClick={() => setSelected(candidate)}>
                <Avatar src={candidate.photoURL} name={candidate.name} size={44} />
                <span><strong>{candidate.name}</strong><small>{candidate.city || candidate.categories.map((value) => FILTERS.find((item) => item.id === value)?.label).filter(Boolean).join(' · ')}</small></span>
                {selected?.uid === candidate.uid ? <Check size={18} className="text-brand" /> : null}
              </button>
            )) : <div className={styles.empty}>No people found in this filter.</div>}
          </div>
          <button type="button" className={styles.sendButton} disabled={!selected || sending} onClick={send}>{sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Send card{selected ? ` to ${selected.name}` : ''}</button>
        </div>
      </Sheet>
      {sendAnimation ? (
        <LifetimeCardSendAnimation sourceRect={sendAnimation.rect} onComplete={finishAnimation} ariaLabel="Sending connection card" renderCard={(layerClassName, style) => (
          <article className={`${styles.card} ${styles.connectionCard} ${layerClassName}`} data-connection-kind={sendAnimation.kind} style={style} aria-hidden="true">
            <span className={styles.cardIcon}><ConnectionCardIcon cardKey={sendAnimation.kind} /></span>
            <div className={styles.cardCopy}><small>Connection card</small><h3>{CARD_LABELS[sendAnimation.kind]}</h3><p>{CONNECTION_CARD_DESCRIPTIONS[sendAnimation.kind]}</p></div>
            <div className={styles.giftHint}><span><Send size={17} /> Sending with appreciation</span></div>
          </article>
        )} />
      ) : null}
    </>
  );
}

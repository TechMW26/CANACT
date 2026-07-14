'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { toast } from './Toaster';
import {
  ArrowUp,
  Award,
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
import { ATTR_LABELS, LIFETIME_CARD_KINDS, LIFETIME_CARD_LABELS, type AttrKey, type GiftCandidate, type GiftCandidateCategory, type LifetimeCardGift, type LifetimeCardKind, type LifetimeCardSlot, type UserProfile } from '@/lib/types';
import { defaultLifetimeInventory, listenLifetimeInventory, listenReceivedLifetimeCards, loadGiftCandidates, sendLifetimeCard } from '@/lib/services/lifetimeCards';
import styles from './ProfileRecognitionFolders.module.css';

type Folder = 'attributes' | 'cards';
type CardMode = 'received' | 'reward';
type CandidateFilter = 'all' | GiftCandidateCategory;

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

export function ProfileRecognitionFolders({ profile, isSelf }: { profile: UserProfile; isSelf: boolean }) {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [mode, setMode] = useState<CardMode>('received');
  const [received, setReceived] = useState<LifetimeCardGift[]>([]);
  const [inventory, setInventory] = useState<Record<LifetimeCardKind, LifetimeCardSlot>>(defaultLifetimeInventory);
  const [slide, setSlide] = useState(0);
  const [giftKind, setGiftKind] = useState<LifetimeCardKind | null>(null);

  useEffect(() => listenReceivedLifetimeCards(profile.uid, setReceived), [profile.uid]);
  useEffect(() => isSelf ? listenLifetimeInventory(profile.uid, setInventory) : undefined, [isSelf, profile.uid]);
  useEffect(() => { setSlide(0); }, [folder, mode]);

  const attributeCards = useMemo(() => Object.entries(profile.attrs ?? {}).map(([key, count]) => ({ key: key as AttrKey, count: Number(count) || 0 })), [profile.attrs]);
  const rewardCards = LIFETIME_CARD_KINDS.map((kind) => inventory[kind]);
  const totalAttributes = attributeCards.reduce((sum, item) => sum + item.count, 0);
  const availableCount = rewardCards.filter((item) => item.status === 'available').length;

  function openFolder(next: Folder) {
    setFolder(next);
    if (next === 'cards') setMode('received');
  }

  return (
    <>
      <div className={styles.folderGrid}>
        <FolderButton title="Received attributes" caption={`${totalAttributes} recognitions`} tones={['#b8d9ca', '#dcece5', '#8ab9a5']} onClick={() => openFolder('attributes')} />
        <FolderButton title="Received cards" caption={`${received.length} lifetime cards`} tones={['#d3ac48', '#a74b45', '#7560a8']} onClick={() => openFolder('cards')} />
      </div>

      <Sheet open={folder !== null} onClose={() => setFolder(null)} title={folder === 'attributes' ? 'Received attributes' : 'Lifetime cards'} topmost>
        {folder === 'attributes' ? (
          <CardGallery items={attributeCards} index={slide} setIndex={setSlide} empty="No attributes received yet." render={(item) => <AttributeCard attr={item.key} count={item.count} />} />
        ) : (
          <div className={styles.gallery}>
            {isSelf ? (
              <div className={styles.tabs}>
                <button type="button" className={mode === 'received' ? styles.activeTab : ''} onClick={() => setMode('received')}>Received · {received.length}</button>
                <button type="button" className={mode === 'reward' ? styles.activeTab : ''} onClick={() => setMode('reward')}>My gifts · {availableCount}/3</button>
              </div>
            ) : null}
            {mode === 'received' || !isSelf ? (
              <CardGallery items={received} index={slide} setIndex={setSlide} empty="No lifetime cards received yet." render={(gift) => <LifetimeCard card={gift} />} />
            ) : (
              <CardGallery items={rewardCards} index={slide} setIndex={setSlide} empty="All three lifetime cards have been given." render={(slot) => <RewardCard slot={slot} onGift={() => slot.status === 'available' && setGiftKind(slot.kind)} />} />
            )}
          </div>
        )}
      </Sheet>

      <RecipientPicker open={!!giftKind} kind={giftKind} profile={profile} onClose={() => setGiftKind(null)} onSent={() => { setGiftKind(null); setMode('reward'); }} />
    </>
  );
}

function FolderButton({ title, caption, tones, onClick }: { title: string; caption: string; tones: string[]; onClick: () => void }) {
  return (
    <button type="button" className={styles.folder} onClick={onClick}>
      <span className={styles.folderCards} aria-hidden>{tones.map((tone, index) => <i key={tone} style={{ '--tone': tone, '--turn': `${(index - 1) * 7}deg` } as React.CSSProperties} />)}</span>
      <strong>{title}</strong><span>{caption}<br />Tap to open folder</span>
    </button>
  );
}

function CardGallery<T>({ items, index, setIndex, empty, render }: { items: T[]; index: number; setIndex: (index: number) => void; empty: string; render: (item: T) => React.ReactNode }) {
  const safeIndex = Math.min(index, Math.max(items.length - 1, 0));
  if (!items.length) return <div className={styles.empty}>{empty}</div>;
  return (
    <div className={styles.gallery}>
      <div className={styles.slider}>{render(items[safeIndex]!)}</div>
      <div className={styles.galleryNav}>
        <button type="button" aria-label="Previous card" disabled={safeIndex === 0} onClick={() => setIndex(safeIndex - 1)}><ChevronLeft size={19} /></button>
        <div className={styles.dots}>{items.map((_, dot) => <button key={dot} type="button" aria-label={`Show card ${dot + 1}`} className={dot === safeIndex ? styles.activeDot : ''} onClick={() => setIndex(dot)} />)}</div>
        <button type="button" aria-label="Next card" disabled={safeIndex === items.length - 1} onClick={() => setIndex(safeIndex + 1)}><ChevronRight size={19} /></button>
      </div>
    </div>
  );
}

function AttributeCard({ attr, count }: { attr: AttrKey; count: number }) {
  return (
    <article className={`${styles.card} ${styles.attributeCard}`}>
      <span className={styles.cardIcon}><Award size={28} /></span>
      <strong className={styles.attributeCount}>{count}</strong>
      <div className={styles.cardCopy}><small>Received attribute</small><h3>{ATTR_LABELS[attr]}</h3><p>Community recognition received on your profile. View only.</p></div>
    </article>
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

function RewardCard({ slot, onGift }: { slot: LifetimeCardSlot; onGift: () => void }) {
  const pointerStart = useRef<number | null>(null);
  const dragYRef = useRef(0);
  const launchingRef = useRef(false);
  const launchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [launching, setLaunching] = useState(false);

  useEffect(() => () => {
    if (launchTimer.current) clearTimeout(launchTimer.current);
  }, []);

  function launchGift() {
    if (slot.status !== 'available' || launchingRef.current) return;
    launchingRef.current = true;
    setDragging(false);
    setLaunching(true);
    setDragY(-window.innerHeight);
    launchTimer.current = setTimeout(() => {
      onGift();
      launchingRef.current = false;
      setLaunching(false);
      setDragY(0);
      dragYRef.current = 0;
    }, 300);
  }

  function finishDrag() {
    pointerStart.current = null;
    setDragging(false);
    if (dragYRef.current <= -54) launchGift();
    else { dragYRef.current = 0; setDragY(0); }
  }

  return (
    <article
      className={styles.card}
      data-kind={slot.kind}
      data-sent={slot.status === 'sent'}
      data-reward="true"
      data-dragging={dragging}
      data-launching={launching}
      style={{ transform: `translate3d(0, ${dragY}px, 0) scale(${dragging ? 1.015 : launching ? .96 : 1})` }}
      onPointerDown={(event) => {
        if (slot.status !== 'available') return;
        pointerStart.current = event.clientY;
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (pointerStart.current === null || slot.status !== 'available') return;
        const nextDragY = Math.max(-180, Math.min(0, event.clientY - pointerStart.current));
        dragYRef.current = nextDragY;
        setDragY(nextDragY);
      }}
      onPointerUp={finishDrag}
      onPointerCancel={() => { pointerStart.current = null; dragYRef.current = 0; setDragging(false); setDragY(0); }}
    >
      <span className={styles.cardIcon}><CardIcon kind={slot.kind} /></span>
      <div className={styles.cardCopy}><small>One of your three lifetime gifts</small><h3>{LIFETIME_CARD_LABELS[slot.kind]}</h3><p>{CARD_DESCRIPTIONS[slot.kind]}</p></div>
      {slot.status === 'available' ? (
        <button type="button" className={styles.giftHint} onClick={launchGift}><span><ArrowUp size={17} /> Swipe up to give forever</span><Send size={18} /></button>
      ) : (
        <div className={styles.giftHint}><span>Given forever to {slot.recipientName || 'someone special'}</span><Check size={18} /></div>
      )}
    </article>
  );
}

function RecipientPicker({ open, kind, profile, onClose, onSent }: { open: boolean; kind: LifetimeCardKind | null; profile: UserProfile; onClose: () => void; onSent: () => void }) {
  const [candidates, setCandidates] = useState<GiftCandidate[]>([]);
  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GiftCandidate | null>(null);
  const [customText, setCustomText] = useState('');
  const [phase, setPhase] = useState<'message' | 'people'>('people');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) { setSelected(null); setQuery(''); setFilter('all'); setCustomText(''); setPhase('people'); return; }
    setPhase(kind === 'custom' ? 'message' : 'people');
    setLoading(true);
    loadGiftCandidates(profile).then(setCandidates).catch(() => toast('Could not load people', 'error')).finally(() => setLoading(false));
  }, [kind, open, profile]);

  const wordCount = customText.trim() ? customText.trim().split(/\s+/).length : 0;
  const messageValid = wordCount > 0 && wordCount <= 24;

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return candidates.filter((candidate) => (filter === 'all' || candidate.categories.includes(filter)) && (!search || `${candidate.name} ${candidate.city || ''}`.toLowerCase().includes(search)));
  }, [candidates, filter, query]);

  async function send() {
    if (!kind || !selected || sending || (kind === 'custom' && !customText.trim())) return;
    setSending(true);
    try {
      await sendLifetimeCard(selected.uid, kind, customText);
      toast(`${LIFETIME_CARD_LABELS[kind]} was given to ${selected.name} forever`, 'success');
      onSent();
    } catch (error: any) {
      toast(error?.message || 'Could not send card', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onClose={sending ? () => {} : onClose} title={kind === 'custom' && phase === 'message' ? 'Write your card' : kind ? `Give ${LIFETIME_CARD_LABELS[kind]}` : 'Give card'} topmost>
      <div className={styles.picker}>
        <div className={styles.warning}>This is one of only three cards in your lifetime. Once sent, it permanently belongs to the recipient and cannot be taken back.</div>
        {kind === 'custom' && phase === 'message' ? (
          <div className={styles.messageStep}>
            <textarea className={styles.message} maxLength={140} value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="Write the words they should keep forever…" autoFocus />
            <div className={styles.wordCount} data-invalid={wordCount > 24}><span>Keep it meaningful and concise.</span><strong>{wordCount}/24 words</strong></div>
            <button type="button" className={styles.sendButton} disabled={!messageValid} onClick={() => setPhase('people')}>Next <ChevronRight size={18} /></button>
          </div>
        ) : (
          <>
            {kind === 'custom' ? <button type="button" className={styles.editMessage} onClick={() => setPhase('message')}><ChevronLeft size={16} /> Edit message</button> : null}
            <div className={styles.filters}>{FILTERS.map((item) => <button key={item.id} type="button" className={filter === item.id ? styles.activeFilter : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
            <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></label>
            <div className={styles.people}>
              {loading ? <div className={styles.empty}><Loader2 className="animate-spin" /></div> : visible.length ? visible.map((candidate) => (
                <button key={candidate.uid} type="button" className={styles.person} data-selected={selected?.uid === candidate.uid} onClick={() => setSelected(candidate)}>
                  <Avatar src={candidate.photoURL} name={candidate.name} size={44} />
                  <span><strong>{candidate.name}</strong><small>{candidate.city || candidate.categories.map((value) => FILTERS.find((item) => item.id === value)?.label).filter(Boolean).join(' · ')}</small></span>
                  {selected?.uid === candidate.uid ? <Check size={18} className="text-brand" /> : null}
                </button>
              )) : <div className={styles.empty}>No people found in this filter.</div>}
            </div>
            <button type="button" className={styles.sendButton} disabled={!selected || sending} onClick={send}>{sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Give forever{selected ? ` to ${selected.name}` : ''}</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

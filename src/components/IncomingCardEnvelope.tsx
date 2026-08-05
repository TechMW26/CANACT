'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listenReceivedConnectionCards } from '@/lib/services/connectionCards';
import { listenReceivedLifetimeCards } from '@/lib/services/lifetimeCards';
import { CARD_LABELS, LIFETIME_CARD_LABELS, type ConnectionCardGift, type LifetimeCardGift } from '@/lib/types';
import { Check, Crown, Heart, Sparkles } from './icons';
import { LifetimeCardSendAnimation } from './LifetimeCardSendAnimation';
import cardStyles from './ProfileRecognitionFolders.module.css';
import { ConnectionCardContent } from './ConnectionAttributeCard';

type IncomingGift =
  | { family: 'connection'; gift: ConnectionCardGift }
  | { family: 'lifetime'; gift: LifetimeCardGift };

const LIFETIME_COPY = {
  life_saver: 'For the person who showed up when it truly mattered.',
  golden_person: 'For someone whose presence made life meaningfully better.',
  custom: 'Words chosen especially for you.',
} as const;

export function IncomingCardEnvelope({ uid }: { uid: string }) {
  const [batch, setBatch] = useState<{ id: string; gifts: IncomingGift[] } | null>(null);
  const batchRef = useRef<{ id: string; gifts: IncomingGift[] } | null>(null);
  const queuedRef = useRef(new Set<string>());
  const seenRef = useRef(new Set<string>());
  const cursorRef = useRef(0);
  const storageKey = useMemo(() => `canact:seen-card-envelopes:${uid}`, [uid]);
  const cursorKey = useMemo(() => `canact:card-reveal-cursor:${uid}`, [uid]);

  useEffect(() => {
    setBatch(null);
    batchRef.current = null;
    let connectionCards: ConnectionCardGift[] = [];
    let lifetimeCards: LifetimeCardGift[] = [];
    let connectionReady = false;
    let lifetimeReady = false;
    let initialTimer = 0;
    const stored = window.localStorage.getItem(storageKey);
    try { seenRef.current = new Set(JSON.parse(stored || '[]') as string[]); } catch { seenRef.current = new Set(); }
    const storedCursor = Number(window.localStorage.getItem(cursorKey));
    const seenCursor = Math.max(0, ...[...seenRef.current].map((key) => Number(key.split(':').at(-1)) || 0));
    cursorRef.current = Number.isFinite(storedCursor) && storedCursor > 0 ? storedCursor : seenCursor;
    let cursorReady = cursorRef.current > 0;

    // A lifetime card keeps its identity when it is passed on. Include the
    // transfer timestamp so every new ownership transfer gets its own reveal.
    const giftKey = (item: IncomingGift) => `${item.family}:${item.gift.id}:${item.gift.sentAt}`;
    const flush = () => {
      if (!connectionReady || !lifetimeReady) return;
      const gifts: IncomingGift[] = [
        ...connectionCards.map((gift): IncomingGift => ({ family: 'connection', gift })),
        ...lifetimeCards.map((gift): IncomingGift => ({ family: 'lifetime', gift })),
      ].sort((a, b) => b.gift.sentAt - a.gift.sentAt);

      // The first snapshot establishes a baseline. Existing collection cards
      // are not "newly received" and should never flood a fresh install.
      if (!cursorReady) {
        cursorRef.current = Math.max(Date.now(), ...gifts.map((item) => item.gift.sentAt));
        cursorReady = true;
        try { window.localStorage.setItem(cursorKey, String(cursorRef.current)); } catch { /* storage can be unavailable */ }
        return;
      }

      const incoming = gifts.filter((gift) => {
        const key = giftKey(gift);
        if (gift.gift.sentAt <= cursorRef.current || seenRef.current.has(key) || queuedRef.current.has(key)) return false;
        queuedRef.current.add(key);
        return true;
      });
      if (!incoming.length) return;
      const active = batchRef.current;
      const next = active
        ? { ...active, gifts: [...active.gifts, ...incoming].sort((a, b) => b.gift.sentAt - a.gift.sentAt) }
        : { id: giftKey(incoming[0]!), gifts: incoming };
      batchRef.current = next;
      setBatch(next);
    };

    const scheduleFlush = () => {
      window.clearTimeout(initialTimer);
      initialTimer = window.setTimeout(flush, 80);
    };
    const stopConnections = listenReceivedConnectionCards(uid, (cards) => {
      connectionCards = cards;
      connectionReady = true;
      scheduleFlush();
    });
    const stopLifetime = listenReceivedLifetimeCards(uid, (cards) => {
      lifetimeCards = cards;
      lifetimeReady = true;
      scheduleFlush();
    });
    return () => {
      window.clearTimeout(initialTimer);
      stopConnections();
      stopLifetime();
      queuedRef.current.clear();
    };
  }, [cursorKey, storageKey, uid]);

  const finish = useCallback(() => {
    const completedBatch = batchRef.current;
    if (!completedBatch) return;
    completedBatch.gifts.forEach((item) => {
      const key = `${item.family}:${item.gift.id}:${item.gift.sentAt}`;
      queuedRef.current.delete(key);
      seenRef.current.add(key);
    });
    try { window.localStorage.setItem(storageKey, JSON.stringify([...seenRef.current].slice(-200))); } catch { /* storage can be unavailable */ }
    const completedAt = Math.max(...completedBatch.gifts.map((item) => item.gift.sentAt));
    const previousCursor = Number(window.localStorage.getItem(cursorKey)) || 0;
    cursorRef.current = Math.max(previousCursor, completedAt);
    try { window.localStorage.setItem(cursorKey, String(cursorRef.current)); } catch { /* storage can be unavailable */ }
    batchRef.current = null;
    setBatch(null);
  }, [cursorKey, storageKey]);

  if (!batch || typeof window === 'undefined') return null;
  const viewportWidth = window.innerWidth;
  const displayWidth = Math.min(620, viewportWidth - 32);
  const displayHeight = Math.max(196, displayWidth * .52);
  const sourceRect = {
    left: Math.max(16, (viewportWidth - displayWidth) / 2),
    top: 96,
    width: displayWidth,
    height: displayHeight,
    naturalWidth: displayWidth,
    naturalHeight: displayHeight,
  };
  const renderGift = (item: IncomingGift, layerClassName: string, style: CSSProperties) => {
    const isLifetime = item.family === 'lifetime';
    const title = isLifetime ? LIFETIME_CARD_LABELS[item.gift.kind] : CARD_LABELS[item.gift.kind];
    const copy = isLifetime ? item.gift.customText || LIFETIME_COPY[item.gift.kind] : '';

    return (
      <article
        className={`${cardStyles.card} ${!isLifetime ? cardStyles.connectionCard : ''} ${layerClassName}`}
        data-kind={item.gift.kind}
        data-family={item.family}
        data-connection-kind={!isLifetime ? item.gift.kind : undefined}
        style={style}
        aria-hidden="true"
      >
        {item.family === 'connection' ? (
          <ConnectionCardContent
            cardKey={item.gift.kind}
            footer={<><b>Given by:</b> {item.gift.fromName} · {new Date(item.gift.sentAt).toLocaleDateString()}</>}
            trailing={<Check size={18} />}
          />
        ) : (
          <>
            <span className={cardStyles.cardIcon}>
              {item.gift.kind === 'life_saver' ? <Heart size={28} fill="currentColor" /> : item.gift.kind === 'golden_person' ? <Crown size={29} /> : <Sparkles size={28} />}
            </span>
            <div className={cardStyles.cardCopy}>
              <small>Given forever by {item.gift.fromName}</small>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
            <div className={cardStyles.giftHint}>
              <span>Received {new Date(item.gift.sentAt).toLocaleDateString()}</span>
              <Check size={18} />
            </div>
          </>
        )}
      </article>
    );
  };
  const first = batch.gifts[0]!;
  const firstTitle = first.family === 'lifetime' ? LIFETIME_CARD_LABELS[first.gift.kind] : CARD_LABELS[first.gift.kind];

  return (
    <LifetimeCardSendAnimation
      sourceRect={sourceRect}
      direction="receive"
      tone={first.family === 'lifetime' ? 'lifetime' : 'connection'}
      ariaLabel={batch.gifts.length === 1 ? `${first.gift.fromName} sent you ${firstTitle}` : `You received ${batch.gifts.length} cards`}
      presentationKey={batch.id}
      receiveCards={[...batch.gifts]
        .sort((a, b) => a.family.localeCompare(b.family) || b.gift.sentAt - a.gift.sentAt)
        .map((item) => ({
        id: `${item.family}:${item.gift.id}:${item.gift.sentAt}`,
        group: item.family,
        label: item.family === 'lifetime' ? LIFETIME_CARD_LABELS[item.gift.kind] : CARD_LABELS[item.gift.kind],
        renderCard: (layerClassName, style) => renderGift(item, layerClassName, style),
      }))}
      onComplete={finish}
      renderCard={(layerClassName, style) => renderGift(first, layerClassName, style)}
    />
  );
}

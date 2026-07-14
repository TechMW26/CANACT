'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listenReceivedConnectionCards } from '@/lib/services/connectionCards';
import { listenReceivedLifetimeCards } from '@/lib/services/lifetimeCards';
import { CARD_LABELS, LIFETIME_CARD_LABELS, type ConnectionCardGift, type LifetimeCardGift } from '@/lib/types';
import { Crown, Heart, MessageSquare, Sparkles } from './icons';
import { LifetimeCardSendAnimation } from './LifetimeCardSendAnimation';
import cardStyles from './ProfileRecognitionFolders.module.css';

type IncomingGift =
  | { family: 'connection'; gift: ConnectionCardGift }
  | { family: 'lifetime'; gift: LifetimeCardGift };

const CONNECTION_COPY = 'A quality someone genuinely values in you.';
const LIFETIME_COPY = {
  life_saver: 'For the person who showed up when it truly mattered.',
  golden_person: 'For someone whose presence made life meaningfully better.',
  custom: 'Words chosen especially for you.',
} as const;

export function IncomingCardEnvelope({ uid }: { uid: string }) {
  const [current, setCurrent] = useState<IncomingGift | null>(null);
  const queueRef = useRef<IncomingGift[]>([]);
  const queuedRef = useRef(new Set<string>());
  const seenRef = useRef(new Set<string>());
  const storageKey = useMemo(() => `canact:seen-card-envelopes:${uid}`, [uid]);

  useEffect(() => {
    setCurrent(null);
    let connectionCards: ConnectionCardGift[] = [];
    let lifetimeCards: LifetimeCardGift[] = [];
    let connectionReady = false;
    let lifetimeReady = false;
    let initialized = false;
    let initialTimer = 0;
    const stored = window.localStorage.getItem(storageKey);
    try { seenRef.current = new Set(JSON.parse(stored || '[]') as string[]); } catch { seenRef.current = new Set(); }

    const giftKey = (item: IncomingGift) => `${item.family}:${item.gift.id}`;
    const flush = () => {
      if (!connectionReady || !lifetimeReady) return;
      const gifts: IncomingGift[] = [
        ...connectionCards.map((gift): IncomingGift => ({ family: 'connection', gift })),
        ...lifetimeCards.map((gift): IncomingGift => ({ family: 'lifetime', gift })),
      ].sort((a, b) => b.gift.sentAt - a.gift.sentAt);

      if (!initialized && stored === null && gifts.length > 1) {
        gifts.slice(1).forEach((gift) => seenRef.current.add(giftKey(gift)));
      }
      initialized = true;
      gifts.forEach((gift) => {
        const key = giftKey(gift);
        if (seenRef.current.has(key) || queuedRef.current.has(key)) return;
        queuedRef.current.add(key);
        queueRef.current.push(gift);
      });
      setCurrent((active) => active ?? queueRef.current.shift() ?? null);
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
      queueRef.current = [];
      queuedRef.current.clear();
    };
  }, [storageKey, uid]);

  const finish = useCallback(() => {
    if (!current) return;
    const key = `${current.family}:${current.gift.id}`;
    queuedRef.current.delete(key);
    seenRef.current.add(key);
    try { window.localStorage.setItem(storageKey, JSON.stringify([...seenRef.current].slice(-200))); } catch { /* storage can be unavailable */ }
    setCurrent(queueRef.current.shift() ?? null);
  }, [current, storageKey]);

  if (!current || typeof window === 'undefined') return null;
  const viewportWidth = window.innerWidth;
  const naturalWidth = 620;
  const naturalHeight = 196;
  const sourceRect = {
    left: Math.max(16, (viewportWidth - Math.min(620, viewportWidth - 32)) / 2),
    top: 96,
    width: Math.min(620, viewportWidth - 32),
    height: naturalHeight,
    naturalWidth,
    naturalHeight,
  };
  const isLifetime = current.family === 'lifetime';
  const title = isLifetime ? LIFETIME_CARD_LABELS[current.gift.kind] : CARD_LABELS[current.gift.kind];
  const copy = isLifetime
    ? current.gift.customText || LIFETIME_COPY[current.gift.kind]
    : CONNECTION_COPY;

  return (
    <LifetimeCardSendAnimation
      sourceRect={sourceRect}
      direction="receive"
      tone={isLifetime ? 'lifetime' : 'connection'}
      ariaLabel={`${current.gift.fromName} sent you ${title}`}
      onComplete={finish}
      renderCard={(layerClassName, style) => (
        <article
          className={`${cardStyles.card} ${!isLifetime ? cardStyles.connectionCard : ''} ${layerClassName}`}
          data-kind={current.gift.kind}
          data-family={current.family}
          data-connection-kind={!isLifetime ? current.gift.kind : undefined}
          style={style}
          aria-hidden="true"
        >
          <span className={cardStyles.cardIcon}>
            {isLifetime
              ? current.gift.kind === 'life_saver' ? <Heart size={28} fill="currentColor" /> : current.gift.kind === 'golden_person' ? <Crown size={29} /> : <MessageSquare size={28} />
              : <Sparkles size={29} />}
          </span>
          <div className={cardStyles.cardCopy}>
            <small>{isLifetime ? 'Lifetime gift' : 'Connection card'} from {current.gift.fromName}</small>
            <h3>{title}</h3>
            <p>{copy}</p>
          </div>
          <div className={cardStyles.giftHint}><span>Now part of your collection</span></div>
        </article>
      )}
    />
  );
}

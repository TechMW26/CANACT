'use client';

import { useId } from 'react';

type CardColorDef = { gradientId: string; stops: [string, string] };
type FolderProps = {
  title: string;
  subtitle: string;
  cardColors: [CardColorDef, CardColorDef, CardColorDef];
};

function FolderCardSVG({ title, subtitle, cardColors }: FolderProps) {
  const uid = useId().replace(/:/g, '');
  const backGradId = `bg-${uid}`;
  const frontGradId = `fg-${uid}`;
  const btnGradId = `btng-${uid}`;
  const folderShadowId = `fs-${uid}`;
  const paperShadowId = `ps-${uid}`;
  const btnShadowId = `bs-${uid}`;
  const backShapeId = `bsh-${uid}`;
  const frontShapeId = `fsh-${uid}`;

  return (
    <svg className="folder-svg" viewBox="0 0 650 500" role="img">
      <defs>
        <linearGradient id={backGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4ecd9" />
          <stop offset="1" stopColor="#e8ddc4" />
        </linearGradient>
        <linearGradient id={frontGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffefa" />
          <stop offset="1" stopColor="#f5f1e7" />
        </linearGradient>
        {cardColors.map((c) => (
          <linearGradient key={c.gradientId} id={c.gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c.stops[0]} />
            <stop offset="1" stopColor={c.stops[1]} />
          </linearGradient>
        ))}
        <radialGradient id={btnGradId} cx="32%" cy="24%" r="88%">
          <stop offset="0" stopColor="#285a45" />
          <stop offset="1" stopColor="#103b2b" />
        </radialGradient>

        <filter id={folderShadowId} x="-15%" y="-15%" width="130%" height="145%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#4c3c24" floodOpacity=".17" />
        </filter>
        <filter id={paperShadowId} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#3b3428" floodOpacity=".16" />
        </filter>
        <filter id={btnShadowId} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="#0d3224" floodOpacity=".28" />
        </filter>

        <path id={backShapeId} d="M39 18H229C242 18 251 24 258 36L264 47C269 54 279 59 292 59H609C632 59 649 77 649 99V455C649 476 632 493 611 493H38C17 493 1 476 1 455V56C1 35 18 18 39 18Z" />
        <path id={frontShapeId} d="M41 102H468C494 102 515 123 515 149V327C515 350 534 369 557 369H598C626 369 649 392 649 420V454C649 476 632 493 610 493H40C18 493 1 476 1 454V142C1 120 19 102 41 102Z" />
      </defs>

      <g filter={`url(#${folderShadowId})`}>
        <g className="folder-back">
          <use href={`#${backShapeId}`} fill={`url(#${backGradId})`} stroke="rgba(255,255,255,.96)" strokeWidth="4" />
          <use href={`#${backShapeId}`} fill="none" stroke="rgba(134,111,75,.10)" strokeWidth="2" transform="translate(0 3)" />
          <path d="M42 24H226C239 24 247 29 254 40L260 50C266 59 279 65 293 65H607" fill="none" stroke="rgba(255,255,255,.63)" strokeWidth="2" strokeLinecap="round" />
        </g>

        <g filter={`url(#${paperShadowId})`}>
          <g className="paper paper-1">
            <rect x="470" y="105" width="153" height="240" rx="24" fill={`url(#${cardColors[0].gradientId})`} stroke="rgba(255,255,255,.70)" strokeWidth="3" transform="rotate(-8 546.5 225)" />
          </g>
          <g className="paper paper-2">
            <rect x="492" y="211" width="145" height="180" rx="23" fill={`url(#${cardColors[1].gradientId})`} stroke="rgba(255,255,255,.72)" strokeWidth="3" transform="rotate(-3 564.5 301)" />
          </g>
          <g className="paper paper-3">
            <rect x="512" y="309" width="124" height="124" rx="21" fill={`url(#${cardColors[2].gradientId})`} stroke="rgba(255,255,255,.72)" strokeWidth="3" transform="rotate(2.8 574 371)" />
          </g>
        </g>

        <g className="folder-front">
          <use href={`#${frontShapeId}`} fill={`url(#${frontGradId})`} stroke="rgba(255,255,255,.98)" strokeWidth="4" />
          <use href={`#${frontShapeId}`} fill="none" stroke="rgba(128,108,79,.10)" strokeWidth="2" transform="translate(0 3)" />
          <path d="M42 108H465C489 108 509 127 509 151V328C509 355 531 375 558 375H596" fill="none" stroke="rgba(255,255,255,.68)" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 158C12 130 29 112 55 112H299L267 197" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="46" strokeLinecap="round" opacity=".52" />
        </g>
      </g>

      <g className="folder-copy">
        <text className="folder-title" x="63" y="272">
          {title.split(' ').map((word, i) => (
            <tspan key={i} x="63" dy={i === 0 ? 0 : 76}>{word}</tspan>
          ))}
        </text>
        <text className="folder-subtitle" x="63" y={272 + title.split(' ').length * 76 + 14}>{subtitle}</text>
      </g>

      <g filter={`url(#${btnShadowId})`}>
        <circle className="arrow-disc" cx="577" cy="436" r="37" fill={`url(#${btnGradId})`} />
        <g className="arrow-mark">
          <path d="M558 436H590" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
          <path d="M580 424L592 436L580 448" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
}

const GREEN_CARDS: [CardColorDef, CardColorDef, CardColorDef] = [
  { gradientId: 'g1', stops: ['#b6d4c7', '#8fb8a9'] },
  { gradientId: 'g2', stops: ['#e3f3ed', '#bfded3'] },
  { gradientId: 'g3', stops: ['#b8c9b4', '#93aa8f'] },
];

const GOLD_CARDS: [CardColorDef, CardColorDef, CardColorDef] = [
  { gradientId: 'c1', stops: ['#efd06e', '#cfa83c'] },
  { gradientId: 'c2', stops: ['#d58c72', '#b85f4e'] },
  { gradientId: 'c3', stops: ['#a99cda', '#8274ba'] },
];

export function AttributesFolderSVG({ count }: { count: number }) {
  return <FolderCardSVG title="Attributes" subtitle={`${count} recognition${count !== 1 ? 's' : ''}`} cardColors={GREEN_CARDS} />;
}

export const ConnectionsFolderSVG = AttributesFolderSVG;

export function ConnectionCardsFolderSVG({ count }: { count: number }) {
  return <FolderCardSVG title="Connection cards" subtitle={count === 0 ? 'None received yet' : `${count} received`} cardColors={GREEN_CARDS} />;
}

export function CardsFolderSVG({ count, label }: { count: number; label: string }) {
  return <FolderCardSVG title={label} subtitle={count === 0 ? 'None yet' : `${count} card${count !== 1 ? 's' : ''}`} cardColors={GOLD_CARDS} />;
}

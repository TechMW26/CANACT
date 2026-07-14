'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const STYLES = `
.canact-launch-scene {
  position: fixed; inset: 0; overflow: hidden; background: transparent; isolation: isolate;
  pointer-events: none; z-index: 9999;
}
.canact-launch-scene * { box-sizing: border-box; margin: 0; padding: 0; }

.cl-rocket {
  position: absolute; left: 50%; top: 100%; width: 80px; height: 185px; z-index: 12;
  transform: translate(-50%, 26vh);
  animation: cl-rocketFlight 2.1s cubic-bezier(.22,.78,.18,1) .05s forwards;
}
.cl-rocket-body {
  position: relative; width: 80px; height: 180px;
  animation: cl-rocketShake 90ms linear 13;
}
.cl-body {
  position: relative; width: 80px; height: 180px; background: #dadada;
  border-top: 5px solid #f5f5f5;
  border-top-left-radius: 100%; border-top-right-radius: 100%;
  border-bottom-left-radius: 50%; border-bottom-right-radius: 50%;
  box-shadow: inset -8px 0 10px rgba(32,108,85,.07), 0 5px 10px rgba(37,51,48,.08);
}
.cl-rocket-body::before {
  content: ""; position: absolute; left: calc(50% - 24px); bottom: -13px;
  width: 48px; height: 13px; background: #253330;
  border-bottom-right-radius: 60%; border-bottom-left-radius: 60%; z-index: -1;
}
.cl-window {
  position: absolute; width: 40px; height: 40px; border-radius: 50%;
  background: #206c55; left: calc(50% - 20px); top: 40px; border: 5px solid #b4b2b2;
  box-shadow: inset 0 2px 7px rgba(32,108,85,.25), 0 1px 2px rgba(255,255,255,.28);
}
.cl-window::after {
  content: ""; position: absolute; top: 7px; left: 8px; width: 9px; height: 7px;
  background: rgba(245,245,245,.35); border-radius: 50%; transform: rotate(-25deg);
}
.cl-fin {
  position: absolute; z-index: -1; height: 55px; width: 50px; background: #206c55;
}
.cl-fin-left { left: -30px; top: calc(100% - 55px); border-top-left-radius: 80%; border-bottom-left-radius: 20%; }
.cl-fin-right { right: -30px; top: calc(100% - 55px); border-top-right-radius: 80%; border-bottom-right-radius: 20%; }

.cl-trail {
  position: absolute; top: 155px; left: 50%; width: 30px; height: 300px;
  transform: translateX(-50%); transform-origin: top center; z-index: -3; opacity: .95;
  border-radius: 0 0 50% 50%;
  background: linear-gradient(to bottom, rgba(245,245,245,.98) 0%, rgba(245,245,245,.95) 18%, rgba(63,140,116,.35) 48%, rgba(245,245,245,0) 100%);
  filter: blur(.3px) drop-shadow(0 8px 16px rgba(32,108,85,.15));
  animation: cl-trailPulse 120ms ease-in-out infinite alternate;
}
.cl-trail::before {
  content: ""; position: absolute; top: 18px; left: 50%; width: 12px; height: 180px;
  transform: translateX(-50%); border-radius: 0 0 50% 50%;
  background: linear-gradient(to bottom, rgba(255,255,255,.95), rgba(255,255,255,0));
}
.cl-trail-glow {
  position: absolute; top: 170px; left: 50%; width: 54px; height: 240px;
  transform: translateX(-50%); border-radius: 50%; z-index: -4;
  background: radial-gradient(ellipse at top, rgba(63,140,116,.35) 0%, rgba(245,245,245,.28) 35%, rgba(245,245,245,0) 72%);
  filter: blur(8px);
  animation: cl-trailGlowPulse 150ms ease-in-out infinite alternate;
}

.cl-stars { position: absolute; inset: 0; list-style: none; z-index: -2;
  animation: cl-starsFade 350ms cubic-bezier(.4,0,.2,1) .95s forwards; }
.cl-stars li { list-style: none; position: absolute; }
.cl-stars li::before, .cl-stars li::after { content: ""; position: absolute; background: #f5f5f5; }
.cl-stars li::before { width: 10px; height: 2px; border-radius: 50%; }
.cl-stars li::after { height: 8px; width: 2px; left: 4px; top: -3px; }
.cl-stars li:nth-child(1) { top:-30px; left:-210px; animation: cl-twinkle .4s infinite alternate; }
.cl-stars li:nth-child(2) { top:0; left:60px; animation: cl-twinkle .5s infinite alternate; }
.cl-stars li:nth-child(2)::before, .cl-stars li:nth-child(6)::before { width:5px; height:1px; }
.cl-stars li:nth-child(2)::after, .cl-stars li:nth-child(6)::after { width:1px; height:5px; top:-2px; left:2px; }
.cl-stars li:nth-child(3) { left:120px; top:220px; animation: cl-twinkle 1s infinite alternate; }
.cl-stars li:nth-child(4) { left:-100px; top:200px; animation: cl-twinkle .5s infinite alternate; }
.cl-stars li:nth-child(5) { left:170px; top:100px; animation: cl-twinkle .4s infinite alternate; }
.cl-stars li:nth-child(6) { top:87px; left:-79px; animation: cl-twinkle .2s infinite alternate; }
.cl-stars li:nth-child(7) { top:280px; left:-150px; animation: cl-twinkle .65s infinite alternate; }

.cl-fog-overlay { position: fixed; inset: 0; z-index: 20; pointer-events: none; overflow: hidden; }
.cl-fog-veil {
  position: absolute; inset: 0; background: rgba(245,245,245,0);
  animation: cl-veilIn .45s cubic-bezier(.4,0,.2,1) .92s forwards, cl-veilOut .95s cubic-bezier(.22,.78,.18,1) 2.45s forwards;
}
.cl-fog {
  --cx:0px; --cy:-55vh; --cs:5.5;
  position: absolute; bottom: -240px; width: 180px; height: 180px; border-radius: 50%;
  background: #f5f5f5; opacity: 0;
  box-shadow: 0 0 40px rgba(245,245,245,.9), 0 0 80px rgba(245,245,245,.45);
  filter: blur(1px);
  animation: cl-fogFill 1.15s cubic-bezier(.16,1,.3,1) forwards, cl-fogExit .95s cubic-bezier(.22,.78,.18,1) 2.45s forwards;
}
.cl-fog.f1  { left:-8%;  width:230px; height:230px; --cx:40px;  --cy:-54vh; --cs:5.2; animation-delay:.80s, 2.45s; }
.cl-fog.f2  { left:2%;   width:150px; height:150px; --cx:-20px; --cy:-84vh; --cs:6.2; animation-delay:.92s, 2.45s; }
.cl-fog.f3  { left:12%;  width:210px; height:210px; --cx:15px;  --cy:-60vh; --cs:5.2; animation-delay:.76s, 2.45s; }
.cl-fog.f4  { left:25%;  width:165px; height:165px; --cx:-35px; --cy:-86vh; --cs:6.1; animation-delay:.98s, 2.45s; }
.cl-fog.f5  { left:37%;  width:235px; height:235px; --cx:8px;   --cy:-58vh; --cs:5.0; animation-delay:.72s, 2.45s; }
.cl-fog.f6  { left:50%;  width:170px; height:170px; --cx:35px;  --cy:-90vh; --cs:6.0; animation-delay:.96s, 2.45s; }
.cl-fog.f7  { left:62%;  width:230px; height:230px; --cx:-20px; --cy:-60vh; --cs:5.1; animation-delay:.78s, 2.45s; }
.cl-fog.f8  { left:76%;  width:160px; height:160px; --cx:45px;  --cy:-88vh; --cs:6.0; animation-delay:.93s, 2.45s; }
.cl-fog.f9  { left:90%;  width:200px; height:200px; --cx:-90px; --cy:-64vh; --cs:5.5; animation-delay:.84s, 2.45s; }
.cl-fog.f10 { left:4%;   width:145px; height:145px; --cx:22px;  --cy:-108vh; --cs:6.6; animation-delay:1.03s, 2.45s; }
.cl-fog.f11 { left:22%;  width:150px; height:150px; --cx:10px;  --cy:-110vh; --cs:6.4; animation-delay:1.08s, 2.45s; }
.cl-fog.f12 { left:42%;  width:150px; height:150px; --cx:-12px; --cy:-112vh; --cs:6.5; animation-delay:1.01s, 2.45s; }
.cl-fog.f13 { left:61%;  width:145px; height:145px; --cx:30px;  --cy:-110vh; --cs:6.4; animation-delay:1.07s, 2.45s; }
.cl-fog.f14 { left:80%;  width:150px; height:150px; --cx:-30px; --cy:-109vh; --cs:6.4; animation-delay:1.05s, 2.45s; }

.cl-success {
  position: fixed; top: 50%; left: 50%; z-index: 30; width: min(92%, 560px); text-align: center;
  opacity: 0; visibility: hidden; transform: translate(-50%, -42%) scale(.92);
  animation: cl-msgLifecycle 3.4s both;
}
.cl-mark {
  width: 72px; height: 72px; margin: 0 auto 22px; background: #206c55; border-radius: 50%;
  box-shadow: 0 12px 30px rgba(32,108,85,.18), 0 0 0 9px rgba(32,108,85,.08);
  position: relative; transform: scale(.7);
}
.cl-mark::before {
  content: ""; position: absolute; top: 19px; left: 24px; width: 17px; height: 28px;
  border-right: 5px solid #f5f5f5; border-bottom: 5px solid #f5f5f5; transform: rotate(45deg);
}
.cl-success h1 {
  color: #206c55; font-size: clamp(32px, 5vw, 54px); font-weight: 700;
  line-height: 1.05; letter-spacing: -1.3px; margin-bottom: 10px;
}
.cl-success p { color: rgba(37,51,48,.72); font-size: clamp(15px, 2vw, 18px); line-height: 1.6; }

@keyframes cl-rocketFlight {
  0% { opacity:1; transform: translate(-50%, 26vh) scale(.96); }
  12% { transform: translate(-50%, 4vh) scale(1); }
  28% { transform: translate(-50%, -32vh) scale(1); }
  55% { opacity:1; transform: translate(-50%, -92vh) scale(.98); }
  100% { opacity:0; transform: translate(-50%, -188vh) scale(.88); }
}
@keyframes cl-rocketShake {
  0% { transform: translateX(-1px) rotate(-.22deg); }
  50% { transform: translateX(1px) rotate(.22deg); }
  100% { transform: translateX(-1px) rotate(-.22deg); }
}
@keyframes cl-trailPulse {
  from { opacity:.88; transform: translateX(-50%) scaleX(.88) scaleY(.95); }
  to { opacity:1; transform: translateX(-50%) scaleX(1.07) scaleY(1.06); }
}
@keyframes cl-trailGlowPulse {
  from { opacity:.5; transform: translateX(-50%) scale(.94); }
  to { opacity:.78; transform: translateX(-50%) scale(1.05); }
}
@keyframes cl-twinkle {
  from { opacity:.45; transform: scale(.86); }
  to { opacity:1; transform: scale(1.14); }
}
@keyframes cl-starsFade { to { opacity:0; } }
@keyframes cl-fogFill {
  0% { opacity:0; transform: translate3d(0,0,0) scale(.2); }
  12% { opacity:1; }
  100% { opacity:1; transform: translate3d(var(--cx),var(--cy),0) scale(var(--cs)); }
}
@keyframes cl-fogExit {
  0% { opacity:1; }
  100% { opacity:0; transform: translate3d(var(--cx),calc(var(--cy) - 58vh),0) scale(calc(var(--cs) * 1.03)); }
}
@keyframes cl-veilIn { to { background: rgba(245,245,245,.88); } }
@keyframes cl-veilOut {
  0% { opacity:1; transform: translateY(0); }
  100% { opacity:0; transform: translateY(-36%); }
}
@keyframes cl-msgLifecycle {
  0%,36% { opacity:0; visibility:hidden; transform: translate(-50%,-42%) scale(.92); }
  45%,70% { opacity:1; visibility:visible; transform: translate(-50%,-50%) scale(1); }
  100% { opacity:0; visibility:hidden; transform: translate(-50%,-96%) scale(.96); }
}

@media (max-width:600px) {
  .cl-rocket { transform: translate(-50%, 30vh) scale(.88); }
  .cl-mark { width:64px; height:64px; margin-bottom:18px; }
  .cl-mark::before { top:17px; left:21px; width:14px; height:24px; }
  .cl-success { padding:0 18px; }
}
@media (prefers-reduced-motion:reduce) {
  .cl-rocket,.cl-rocket-body,.cl-trail,.cl-trail-glow,.cl-stars,.cl-stars li,.cl-fog,.cl-fog-veil,.cl-success {
    animation-duration:1ms!important; animation-delay:0ms!important; animation-iteration-count:1!important;
  }
}
`;

export function RocketLaunchOverlay({ label, kind, onDone }: { label: string; kind: 'give' | 'take'; onDone: () => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  if (!mounted || typeof document === 'undefined') return null;

  const verb = kind === 'give' ? 'sent' : 'taken back';
  const subtext = kind === 'give' ? 'Attribute recorded successfully.' : 'Attribute removed successfully.';

  return createPortal(
    <div className="canact-launch-scene" aria-label={`${label} ${verb}`} role="alert">
      <style>{STYLES}</style>

      <div className="cl-rocket">
        <div className="cl-rocket-body">
          <div className="cl-body" />
          <div className="cl-fin cl-fin-left" />
          <div className="cl-fin cl-fin-right" />
          <div className="cl-window" />
        </div>
        <div className="cl-trail" />
        <div className="cl-trail-glow" />
        <ul className="cl-stars">
          <li /><li /><li /><li /><li /><li /><li />
        </ul>
      </div>

      <div className="cl-fog-overlay">
        <div className="cl-fog-veil" />
        <span className="cl-fog f1" /><span className="cl-fog f2" />
        <span className="cl-fog f3" /><span className="cl-fog f4" />
        <span className="cl-fog f5" /><span className="cl-fog f6" />
        <span className="cl-fog f7" /><span className="cl-fog f8" />
        <span className="cl-fog f9" /><span className="cl-fog f10" />
        <span className="cl-fog f11" /><span className="cl-fog f12" />
        <span className="cl-fog f13" /><span className="cl-fog f14" />
      </div>

      <section className="cl-success" role="status" aria-live="polite">
        <div className="cl-mark" />
        <h1>{label} {verb}!</h1>
        <p>{subtext}</p>
      </section>
    </div>,
    document.body,
  );
}

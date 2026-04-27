'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { commentPoll, listenPoll, listenPollComments, reactPoll, votePoll } from '@/lib/services/poll';
import { Poll } from '@/lib/types';
import { timeAgo, timeLeft } from '@/lib/utils';
import { ThumbsUp, ThumbsDown } from '@/components/icons';

export default function PollDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const [p, setP] = useState<Poll | null>(null);
  const [c, setC] = useState<any[]>([]);
  const [t, setT] = useState('');
  useEffect(() => listenPoll(id, setP), [id]);
  useEffect(() => listenPollComments(id, setC), [id]);
  if (!p || !user) return null;
  const options = Array.isArray(p.options) ? p.options : [];
  const total = options.reduce((s, o) => s + (o.votes ?? 0), 0);
  const mine = p.voters?.[user.uid];
  const myReact = p.reactionVoters?.[user.uid];
  const ended = p.endsAt < Date.now();

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-3">
          <Link href={`/profile/${p.uid}`}><Avatar name={p.authorName} /></Link>
          <div>
            <Link href={`/profile/${p.uid}`} className="font-bold">{p.authorName}</Link>
            <div className="text-xs text-muted">{timeAgo(p.createdAt)} • {ended ? 'Ended' : timeLeft(p.endsAt)}</div>
          </div>
        </div>
        <p className="mt-3 font-semibold">{p.question}</p>
        {!p.openEnded && (
          <div className="mt-2 space-y-2">
            {options.map((o) => {
              const pct = total ? Math.round((o.votes / total) * 100) : 0;
              const sel = mine === o.id;
              return (
                <button key={o.id} disabled={ended} onClick={() => votePoll(p.id, user.uid, o.id)}
                  className={`w-full text-left relative overflow-hidden rounded-xl border ${sel ? 'border-brand' : 'border-line'} bg-white px-3 py-2.5`}>
                  <div className="absolute inset-y-0 left-0 bg-brand-light/70" style={{ width: `${pct}%` }} />
                  <div className="relative flex justify-between"><span>{o.text}</span><span className="text-xs text-muted">{pct}% • {o.votes}</span></div>
                </button>
              );
            })}
            <div className="text-xs text-muted">{total} votes</div>
          </div>
        )}
        {p.openEnded && options.length === 0 ? (
          <div className="mt-2 rounded-xl border border-dashed border-line bg-white px-3 py-2 text-xs text-muted">
            Open-ended poll. Add your response in replies below.
          </div>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant={myReact === 'like' ? 'primary' : 'outline'} onClick={() => reactPoll(p.id, user.uid, 'like')}>
            <ThumbsUp size={14} className="mr-1" /> {p.likes ?? 0}
          </Button>
          <Button size="sm" variant={myReact === 'dislike' ? 'danger' : 'outline'} onClick={() => reactPoll(p.id, user.uid, 'dislike')}>
            <ThumbsDown size={14} className="mr-1" /> {p.dislikes ?? 0}
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-bold">Replies</h3>
        <div className="mt-3 space-y-3">
          {c.length === 0 && <p className="text-sm text-muted">No replies yet.</p>}
          {c.map((x) => (
            <div key={x.id} className="flex items-start gap-3">
              <Avatar name={x.name} size={32} />
              <div className="flex-1"><div className="text-sm font-semibold">{x.name} <span className="text-xs text-muted ml-1">{timeAgo(x.createdAt)}</span></div><p className="text-sm whitespace-pre-wrap">{x.text}</p></div>
            </div>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const v = t.trim(); if (!v) return; setT(''); await commentPoll(p.id, user.uid, profile?.fullName ?? 'You', v); }}>
          <Input value={t} onChange={(e) => setT(e.target.value)} placeholder="Reply…" />
          <Button type="submit">Send</Button>
        </form>
      </Card>
    </div>
  );
}

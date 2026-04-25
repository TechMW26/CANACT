'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { addComment, listenComments, listenPost, reactWha, reportPost, deletePost } from '@/lib/services/wha';
import { WhaPost } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/Toaster';
import { Smile, Heart, PartyPopper, Frown, Angry, Send } from '@/components/icons';
import { MediaSlider } from '@/components/MediaSlider';
import type { LucideIcon } from 'lucide-react';

const REACTIONS: { id: 'cool' | 'love' | 'wow' | 'sad' | 'angry'; Icon: LucideIcon }[] = [
  { id: 'cool',  Icon: Smile },
  { id: 'love',  Icon: Heart },
  { id: 'wow',   Icon: PartyPopper },
  { id: 'sad',   Icon: Frown },
  { id: 'angry', Icon: Angry },
];

export default function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const router = useRouter();
  const [post, setPost] = useState<WhaPost | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState('');

  useEffect(() => listenPost(id, setPost), [id]);
  useEffect(() => listenComments(id, setComments), [id]);

  if (!post || !user) return null;
  const myReact = post.reactionVoters?.[user.uid];
  const isMine = post.uid === user.uid;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-3">
          <Link href={`/profile/${post.uid}`}><Avatar src={post.authorPhoto} name={post.authorName} /></Link>
          <div className="flex-1 min-w-0">
            <Link href={`/profile/${post.uid}`} className="font-bold truncate block">{post.authorName}</Link>
            <span className="text-xs text-muted">{timeAgo(post.createdAt)}</span>
          </div>
        </div>
        {post.text && <p className="mt-3 whitespace-pre-wrap">{post.text}</p>}
        {post.mediaUrls?.length ? (
          <div className="mt-3"><MediaSlider urls={post.mediaUrls} /></div>
        ) : null}
        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
          {REACTIONS.map(({ id, Icon }) => (
            <button key={id} onClick={() => reactWha(post.id, user.uid, id)}
              className={`inline-flex items-center gap-1 rounded-full px-3 h-8 text-xs font-semibold border ${myReact === id ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}>
              <Icon size={14} /> {post.reactions?.[id] ?? 0}
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            {!isMine && <Button size="sm" variant="outline" onClick={() => { reportPost(post.id, user.uid, 'inappropriate'); toast('Reported', 'success'); }}>Report</Button>}
            {isMine && <Button size="sm" variant="danger" onClick={async () => { await deletePost(post.id, user.uid); router.replace('/feed'); }}>Delete</Button>}
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-bold">Comments</h3>
        <div className="mt-3 space-y-3">
          {comments.length === 0 && <p className="text-sm text-muted">Be the first to comment.</p>}
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-3">
              <Avatar name={c.name} size={32} />
              <div className="flex-1">
                <div className="text-sm font-semibold">{c.name} <span className="text-xs text-muted ml-1">{timeAgo(c.createdAt)}</span></div>
                <p className="text-sm whitespace-pre-wrap">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const t = text.trim(); if (!t) return;
          setText('');
          await addComment(post.id, user.uid, profile?.fullName ?? 'You', t);
        }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" />
          <Button type="submit" aria-label="Send"><Send size={16} /></Button>
        </form>
      </Card>
    </div>
  );
}

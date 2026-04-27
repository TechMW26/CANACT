'use client';
import { useState } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { Star } from './icons';
import { submitHelpRating } from '@/lib/services/help';

/**
 * Mutual rating popup shown to both asker and confirmed helpers after a help
 * is closed. Submits a 1-5 star rating + optional thank-you note for the
 * counterparty.
 */
export function HelpRatingSheet({
  open,
  onClose,
  helpId,
  fromUid,
  toUid,
  toName,
  toPhoto,
  toRole,
}: {
  open: boolean;
  onClose: () => void;
  helpId: string;
  fromUid: string;
  toUid: string;
  toName: string;
  toPhoto?: string;
  toRole: 'asker' | 'helper';
}) {
  const [stars, setStars] = useState(5);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await submitHelpRating(helpId, fromUid, toUid, stars, note);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Rate ${toRole === 'helper' ? 'your helper' : 'the asker'}`}>
      <div className="flex flex-col items-center gap-3 pb-2">
        <Avatar src={toPhoto} name={toName} size={72} />
        <div className="text-center">
          <div className="font-extrabold text-lg">{toName}</div>
          <div className="text-xs text-muted">How was your experience?</div>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              className="transition-transform active:scale-90"
            >
              <Star
                size={36}
                strokeWidth={n <= stars ? 0 : 1.5}
                fill={n <= stars ? '#F5A623' : 'none'}
                className={n <= stars ? 'text-amber-400' : 'text-ink/30'}
              />
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 240))}
          placeholder={toRole === 'helper' ? 'Say thanks (optional)' : 'Add a quick note (optional)'}
          className="mt-2 w-full rounded-2xl border border-ink/10 bg-brand-light/30 p-3 text-sm outline-none focus:border-brand"
          rows={3}
        />
        <Button onClick={submit} disabled={submitting} className="w-full mt-1">
          {submitting ? 'Sending…' : `Submit ${stars}★ rating`}
        </Button>
        <button type="button" onClick={onClose} className="text-xs text-muted underline">
          Skip for now
        </button>
      </div>
    </Sheet>
  );
}

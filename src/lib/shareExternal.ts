'use client';

export async function shareExternal(input: { title: string; text?: string; url: string }) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    await navigator.share(input);
    return 'shared' as const;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText([input.text, input.url].filter(Boolean).join('\n'));
    return 'copied' as const;
  }
  throw new Error('Sharing is not supported on this device.');
}

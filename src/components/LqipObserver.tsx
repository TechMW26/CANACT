'use client';
import { useEffect } from 'react';

/**
 * Global LQIP blur-up observer. Listens for `load` events on any
 * `img.lqip-img` in the document, then adds the `lqip-loaded` class
 * which triggers the opacity transition from 0 (blur placeholder)
 * to 1 (sharp full-resolution image).
 *
 * Instagram-style: the tiny base64 LQIP paints instantly as a CSS
 * background-image; once the <img> src finishes decoding we fade
 * the sharp image in over ~450ms.
 */
export function LqipObserver() {
  useEffect(() => {
    function onLoad(e: Event) {
      const img = e.target as HTMLImageElement;
      if (img.classList.contains('lqip-img')) {
        img.classList.add('lqip-loaded');
      }
    }
    // Capture phase catches load events on all descendants
    document.addEventListener('load', onLoad, true);
    // Also handle already-loaded (cached) images
    document.querySelectorAll('img.lqip-img').forEach((img) => {
      if ((img as HTMLImageElement).complete) {
        img.classList.add('lqip-loaded');
      }
    });
    // Hydrated sliders and popups can insert an already-cached image after
    // the initial scan, in which case no observable load event is guaranteed.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const images = node.matches('img.lqip-img')
            ? [node]
            : Array.from(node.querySelectorAll('img.lqip-img'));
          images.forEach((image) => {
            if ((image as HTMLImageElement).complete) image.classList.add('lqip-loaded');
          });
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('load', onLoad, true);
      observer.disconnect();
    };
  }, []);
  return null;
}

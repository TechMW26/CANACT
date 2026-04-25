export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  durationSec?: number;
  cover?: string;
  license: string;
}

// Curated free / CC0 / public-domain music tracks served from public CDNs.
// You can swap these URLs for any open-source library you prefer (FMA, Pixabay, etc.).
export const MUSIC_LIBRARY: MusicTrack[] = [
  {
    id: 'sunny',
    title: 'Sunny',
    artist: 'Bensound',
    url: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_22b5ad12cb.mp3',
    license: 'Pixabay Content License',
  },
  {
    id: 'lofi-chill',
    title: 'Lofi Chill',
    artist: 'Pixabay',
    url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3',
    license: 'Pixabay Content License',
  },
  {
    id: 'energetic',
    title: 'Energetic Indie Rock',
    artist: 'Pixabay',
    url: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_5d71d9cea0.mp3',
    license: 'Pixabay Content License',
  },
  {
    id: 'cinematic',
    title: 'Cinematic Inspiration',
    artist: 'Pixabay',
    url: 'https://cdn.pixabay.com/download/audio/2022/03/10/audio_18f37c8d80.mp3',
    license: 'Pixabay Content License',
  },
  {
    id: 'happy-pop',
    title: 'Happy Pop',
    artist: 'Pixabay',
    url: 'https://cdn.pixabay.com/download/audio/2022/08/04/audio_2dde668d05.mp3',
    license: 'Pixabay Content License',
  },
  {
    id: 'dreams',
    title: 'Dreams',
    artist: 'Bensound',
    url: 'https://cdn.pixabay.com/download/audio/2021/11/23/audio_64b2dd1bce.mp3',
    license: 'Pixabay Content License',
  },
  {
    id: 'epic-trailer',
    title: 'Epic Trailer',
    artist: 'Pixabay',
    url: 'https://cdn.pixabay.com/download/audio/2022/05/16/audio_1234aa9295.mp3',
    license: 'Pixabay Content License',
  },
  {
    id: 'corporate',
    title: 'Corporate Uplifting',
    artist: 'Pixabay',
    url: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8e1dec5.mp3',
    license: 'Pixabay Content License',
  },
];

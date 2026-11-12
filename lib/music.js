// Turns a pasted Spotify, SoundCloud, or Apple Music link into an embeddable player.

const SPOTIFY_TYPES = ['playlist', 'album', 'track', 'artist', 'episode', 'show'];

/**
 * @param {string} input  a link copied from the app's Share menu
 * @param {boolean} tall  show the track list instead of the compact player
 * @returns {{ provider: string, src: string, height: number } | { error: string }}
 */
export function musicEmbed(input, tall = false) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return { error: 'Paste a full link, starting with https://' };
  }
  if (url.protocol !== 'https:') return { error: 'Paste a full link, starting with https://' };
  const host = url.hostname.toLowerCase();

  if (host === 'open.spotify.com') {
    // /playlist/ID, /intl-fr/album/ID, or an already-embed link /embed/track/ID
    const parts = url.pathname.split('/').filter((p) => p && !p.startsWith('intl-') && p !== 'embed');
    const [type, id] = parts;
    if (!SPOTIFY_TYPES.includes(type) || !/^[A-Za-z0-9]{10,40}$/.test(id ?? '')) {
      return { error: "That Spotify link doesn't point to a playlist, album, track, or podcast." };
    }
    return {
      provider: 'Spotify',
      src: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`,
      height: tall ? 352 : 152,
    };
  }

  if (host === 'soundcloud.com' || host === 'www.soundcloud.com' || host === 'm.soundcloud.com') {
    if (url.pathname.split('/').filter(Boolean).length < 2) {
      return { error: 'Use a link to a SoundCloud track or playlist, not a profile.' };
    }
    const clean = `https://soundcloud.com${url.pathname}`;
    const q = new URLSearchParams({
      url: clean,
      color: '#8fd0c3',
      auto_play: 'false',
      hide_related: 'true',
      show_comments: 'false',
      show_user: 'true',
      show_reposts: 'false',
      show_teaser: 'false',
      visual: 'false',
    });
    return { provider: 'SoundCloud', src: `https://w.soundcloud.com/player/?${q}`, height: tall ? 352 : 166 };
  }
  if (host === 'on.soundcloud.com') {
    return { error: 'Short SoundCloud links (on.soundcloud.com) can\'t be embedded. Open it and copy the full soundcloud.com link.' };
  }

  if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
    if (!/\/(playlist|album|song|station)\//.test(url.pathname)) {
      return { error: "That Apple Music link doesn't point to a playlist, album, or song." };
    }
    return {
      provider: 'Apple Music',
      src: `https://embed.music.apple.com${url.pathname}${url.search}`,
      height: tall ? 450 : 175,
    };
  }

  return { error: 'Only Spotify, SoundCloud, and Apple Music links work here.' };
}

/** Build the <iframe> for an embed. */
export function musicFrame(embed) {
  const f = document.createElement('iframe');
  f.src = embed.src;
  f.title = `${embed.provider} player`;
  f.height = String(embed.height);
  f.loading = 'lazy';
  f.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  return f;
}

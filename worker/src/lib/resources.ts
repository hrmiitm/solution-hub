export const RESOURCE_TYPES = [
  'youtube',
  'image',
  'slides',
  'pdf',
  'markdown',
  'text',
  'repository',
  'model',
  'demo',
  'documentation',
  'link',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface Resource {
  label: string;
  url: string;
  type: ResourceType;
}

export const MAX_URL_LENGTH = 2048;

/**
 * Parses and validates an external URL. Only absolute http(s) URLs without
 * embedded credentials are accepted, which rules out javascript:, data:,
 * file: and similar dangerous schemes. Returns the normalized URL or null.
 */
export function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.toString();
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const IMAGE_HOSTS = ['images.unsplash.com', 'i.imgur.com', 'upload.wikimedia.org', 'picsum.photos'];
const TEXT_EXT = /\.(txt|log|csv|tsv|json|ya?ml|toml|ini)$/i;
const DEMO_HOST_SUFFIXES = ['.vercel.app', '.netlify.app', '.pages.dev', '.workers.dev', '.streamlit.app', '.hf.space', '.github.io', '.web.app'];

/** Best-effort resource type detection from a URL. Users can override it. */
export function detectResourceType(rawUrl: string): ResourceType {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'link';
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.toLowerCase();

  if (youtubeId(rawUrl)) return 'youtube';
  if (host === 'docs.google.com' && path.startsWith('/presentation/')) return 'slides';
  if (path.endsWith('.pdf') || (host === 'arxiv.org' && path.startsWith('/pdf/'))) return 'pdf';
  if (IMAGE_EXT.test(path) || IMAGE_HOSTS.includes(host)) return 'image';
  if (/\.(md|markdown)$/i.test(path)) return 'markdown';
  if (TEXT_EXT.test(path)) return 'text';
  if (host === 'huggingface.co') {
    return path.startsWith('/spaces/') ? 'demo' : 'model';
  }
  if (['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'].includes(host)) return 'repository';
  if (host.startsWith('docs.') || host.endsWith('.readthedocs.io') || path.startsWith('/docs')) return 'documentation';
  if (DEMO_HOST_SUFFIXES.some((s) => host.endsWith(s))) return 'demo';
  return 'link';
}

/** Extracts a YouTube video id from common URL shapes, or null. */
export function youtubeId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
      id = m?.[2] ?? null;
    }
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

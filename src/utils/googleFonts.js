const GOOGLE_FONT_LINK_ID = 'edit-pdf-google-font';
const GOOGLE_FONT_CACHE_KEY = 'edit-pdf-google-font-settings';

export function parseGoogleFontFamily(url) {
  try {
    const parsedUrl = new URL(url);
    const family = parsedUrl.searchParams.get('family');

    if (!family) return '';

    return family
      .split(':')[0]
      .replace(/\+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

export function getStoredGoogleFontSettings() {
  try {
    const stored = localStorage.getItem(GOOGLE_FONT_CACHE_KEY);
    return stored ? JSON.parse(stored) : { url: '', family: '' };
  } catch {
    return { url: '', family: '' };
  }
}

export function storeGoogleFontSettings(settings) {
  localStorage.setItem(GOOGLE_FONT_CACHE_KEY, JSON.stringify(settings));
}

export function applyGoogleFont(url) {
  const family = parseGoogleFontFamily(url);
  const existing = document.getElementById(GOOGLE_FONT_LINK_ID);

  if (existing) {
    existing.remove();
  }

  if (!url || !family) {
    const emptySettings = { url: '', family: '' };
    storeGoogleFontSettings(emptySettings);
    return emptySettings;
  }

  const link = document.createElement('link');
  link.id = GOOGLE_FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);

  const settings = { url, family };
  storeGoogleFontSettings(settings);
  return settings;
}

export async function fetchGoogleFontBytes(url) {
  if (!url) return null;

  // Try fetching with a User-Agent that requests ttf instead of woff2,
  // because pdf-lib/fontkit cannot embed woff2 fonts.
  // Browsers may block the User-Agent override, so we also handle woff2 fallback.
  let css;

  try {
    const cssResponse = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0)' },
    });
    if (!cssResponse.ok) throw new Error(`HTTP ${cssResponse.status}`);
    css = await cssResponse.text();
  } catch {
    // Fallback: fetch without custom User-Agent
    const cssResponse = await fetch(url);
    if (!cssResponse.ok) {
      throw new Error(`Could not load Google Font CSS: ${cssResponse.status}`);
    }
    css = await cssResponse.text();
  }

  // Prefer .ttf URL, then .otf, then any font URL (may be woff2)
  const ttfUrl = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/)?.[1];
  const otfUrl = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.otf)\)/)?.[1];
  const anyUrl = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
  const fontUrl = ttfUrl || otfUrl || anyUrl;

  if (!fontUrl) {
    throw new Error('Could not find a font file URL in the Google Font CSS.');
  }

  const fontResponse = await fetch(fontUrl);

  if (!fontResponse.ok) {
    throw new Error(`Could not load Google Font file: ${fontResponse.status}`);
  }

  return await fontResponse.arrayBuffer();
}

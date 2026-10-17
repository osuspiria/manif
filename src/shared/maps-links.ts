/**
 * "Abrir na app de mapas": the link depends on the device. iOS does not
 * support `geo:` URIs, so it gets an Apple Maps link; Android gets a `geo:`
 * URI with a labelled pin; elsewhere there is no maps app to open (null).
 * Pure: the caller passes what it read from `navigator`.
 */
export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

export function mapsAppUrl(
  place: { lat: number; lng: number; label: string },
  platform: Platform,
): string | null {
  const ll = `${place.lat},${place.lng}`;
  switch (platform) {
    case 'ios':
      return `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(place.label)}`;
    case 'android': {
      // The label sits inside "(…)" in the geo: query, so it cannot contain parentheses.
      const label = place.label.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
      return `geo:${ll}?q=${ll}(${encodeURIComponent(label)})`;
    }
    default:
      return null;
  }
}

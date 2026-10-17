import { describe, expect, it } from 'vitest';
import { detectPlatform, mapsAppUrl } from '../../src/shared/maps-links';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.0.0 Mobile/15E148 Safari/604.1',
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
  it('iPhone, in Safari or any other iOS browser', () => {
    expect(detectPlatform(UA.iphone, 5)).toBe('ios');
    expect(detectPlatform(UA.iphoneChrome, 5)).toBe('ios');
  });

  it('an iPad that reports itself as a Mac, but a real Mac is not iOS', () => {
    expect(detectPlatform(UA.ipadDesktopMode, 5)).toBe('ios');
    expect(detectPlatform(UA.ipadDesktopMode, 0)).toBe('other');
  });

  it('Android and desktop', () => {
    expect(detectPlatform(UA.android, 5)).toBe('android');
    expect(detectPlatform(UA.windows, 0)).toBe('other');
  });
});

describe('mapsAppUrl', () => {
  const place = { lat: 41.1496, lng: -8.6109, label: 'Desfile na Avenida dos Aliados' };

  it('iOS: an Apple Maps link with the pin and the event name', () => {
    expect(mapsAppUrl(place, 'ios')).toBe(
      'https://maps.apple.com/?ll=41.1496,-8.6109&q=Desfile%20na%20Avenida%20dos%20Aliados',
    );
  });

  it('Android: a geo: URI with a labelled pin', () => {
    expect(mapsAppUrl(place, 'android')).toBe(
      'geo:41.1496,-8.6109?q=41.1496,-8.6109(Desfile%20na%20Avenida%20dos%20Aliados)',
    );
  });

  it('encodes accents and &, and keeps parentheses out of the geo: label', () => {
    const tricky = { lat: 38.7, lng: -9.1, label: 'Ação & vigília (Câmara)' };
    expect(mapsAppUrl(tricky, 'ios')).toBe(
      'https://maps.apple.com/?ll=38.7,-9.1&q=A%C3%A7%C3%A3o%20%26%20vig%C3%ADlia%20(C%C3%A2mara)',
    );
    expect(mapsAppUrl(tricky, 'android')).toBe(
      'geo:38.7,-9.1?q=38.7,-9.1(A%C3%A7%C3%A3o%20%26%20vig%C3%ADlia%20C%C3%A2mara)',
    );
  });

  it('desktop: no maps app to open', () => {
    expect(mapsAppUrl(place, 'other')).toBeNull();
  });
});

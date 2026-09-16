import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatAddress } from '@/lib/maps/client';

/**
 * What happens when the map cannot answer.
 *
 * The interesting cases are all failures. A geocoder that works is a geocoder
 * returning coordinates; a geocoder that is over quota, or refused, or slow, or
 * simply does not recognise a rural address is the normal condition of this
 * feature — and every one of those has to come back as "carry on without
 * coordinates" rather than as an error that stops a lead being converted or a
 * quote being priced.
 *
 * Google itself is never called here. The fetch is replaced with the payload
 * shapes Google documents, including the ones that carry an HTTP 200 and a
 * failure inside the body — which is the case a naive `response.ok` check misses.
 */

const OK_GEOCODE = {
  status: 'OK',
  results: [
    {
      formatted_address: '12 Oak Lane, Austin, TX 78701, USA',
      place_id: 'ChIJExample',
      geometry: { location: { lat: 30.2672, lng: -97.7431 } },
    },
  ],
};

const OK_MATRIX = {
  status: 'OK',
  rows: [
    {
      elements: [
        { status: 'OK', distance: { value: 19_312 }, duration: { value: 1_500 } },
      ],
    },
  ],
};

function mockFetch(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  } as unknown as Response);
}

describe('with a key configured', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key-not-a-real-one');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reads coordinates out of a successful geocode', async () => {
    vi.stubGlobal('fetch', mockFetch(OK_GEOCODE));
    const { geocodeAddress } = await import('@/lib/maps/client');

    await expect(geocodeAddress('12 Oak Lane, Austin TX')).resolves.toEqual({
      latitude: 30.2672,
      longitude: -97.7431,
      formatted: '12 Oak Lane, Austin, TX 78701, USA',
      placeId: 'ChIJExample',
    });
  });

  it('sends the key as a parameter and never in the path', async () => {
    const fetchMock = mockFetch(OK_GEOCODE);
    vi.stubGlobal('fetch', fetchMock);
    const { geocodeAddress } = await import('@/lib/maps/client');

    await geocodeAddress('12 Oak Lane');

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('key')).toBe('test-key-not-a-real-one');
    expect(url.pathname).not.toContain('test-key');
  });

  it.each(['ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED', 'INVALID_REQUEST'])(
    'returns null on %s, which arrives as an HTTP 200',
    async (status) => {
      // The case that matters: Google answers 200 and puts the failure in the
      // body, so anything checking only `response.ok` would read it as success.
      vi.stubGlobal('fetch', mockFetch({ status, results: [] }));
      const { geocodeAddress } = await import('@/lib/maps/client');

      await expect(geocodeAddress('nowhere at all')).resolves.toBeNull();
    },
  );

  it('returns null when the transport itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { geocodeAddress } = await import('@/lib/maps/client');

    await expect(geocodeAddress('12 Oak Lane, Austin TX')).resolves.toBeNull();
  });

  it('converts a drive to whole miles and minutes', async () => {
    vi.stubGlobal('fetch', mockFetch(OK_MATRIX));
    const { driveEstimate } = await import('@/lib/maps/client');

    // 19,312 m is 12.00 miles; 1,500 s is 25 minutes. Rounded on the way out
    // because the underlying figure has a false precision to it.
    await expect(driveEstimate('depot', 'site')).resolves.toEqual({ miles: 12, minutes: 25 });
  });

  it('returns null when there is no route between the two', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] }),
    );
    const { driveEstimate } = await import('@/lib/maps/client');

    await expect(driveEstimate('depot', 'the moon')).resolves.toBeNull();
  });

  it('does not call out for an address too short to be one', async () => {
    const fetchMock = mockFetch(OK_GEOCODE);
    vi.stubGlobal('fetch', fetchMock);
    const { geocodeAddress } = await import('@/lib/maps/client');

    await expect(geocodeAddress('  a ')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('with no key configured', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reports itself as unavailable rather than pretending', async () => {
    const { mapsEnabled } = await import('@/lib/maps/client');
    expect(mapsEnabled()).toBe(false);
  });

  it('returns null instead of throwing into a lead conversion', async () => {
    // Converting a won lead must not fail because a third party is unconfigured.
    const fetchMock = mockFetch(OK_GEOCODE);
    vi.stubGlobal('fetch', fetchMock);
    const { geocodeAddress } = await import('@/lib/maps/client');

    await expect(geocodeAddress('12 Oak Lane, Austin TX')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('formatAddress', () => {
  it('joins the parts a geocoder expects', () => {
    expect(
      formatAddress({ addressLine1: '12 Oak Lane', city: 'Austin', state: 'TX', postalCode: '78701' }),
    ).toBe('12 Oak Lane, Austin, TX, 78701');
  });

  it('drops the empty parts rather than leaving gaps', () => {
    expect(formatAddress({ addressLine1: '12 Oak Lane', city: '', state: null })).toBe(
      '12 Oak Lane',
    );
  });

  it('leaves the country off when it is the default', () => {
    expect(formatAddress({ addressLine1: '12 Oak Lane', country: 'US' })).toBe('12 Oak Lane');
    expect(formatAddress({ addressLine1: '12 Oak Lane', country: 'CA' })).toBe('12 Oak Lane, CA');
  });

  it('is empty when there is nothing worth sending', () => {
    expect(formatAddress({})).toBe('');
  });
});

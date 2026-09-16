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

const OK_AUTOCOMPLETE = {
  status: 'OK',
  predictions: [
    {
      place_id: 'ChIJOne',
      description: '12 Oak Lane, Austin, TX, USA',
      structured_formatting: { main_text: '12 Oak Lane', secondary_text: 'Austin, TX, USA' },
    },
    {
      place_id: 'ChIJTwo',
      description: '12 Oak Street, Austin, TX, USA',
      structured_formatting: { main_text: '12 Oak Street', secondary_text: 'Austin, TX, USA' },
    },
  ],
};

const OK_DETAILS = {
  status: 'OK',
  result: {
    place_id: 'ChIJOne',
    address_components: [
      { types: ['street_number'], long_name: '12', short_name: '12' },
      { types: ['route'], long_name: 'Oak Lane', short_name: 'Oak Ln' },
      { types: ['locality', 'political'], long_name: 'Austin', short_name: 'Austin' },
      {
        types: ['administrative_area_level_1', 'political'],
        long_name: 'Texas',
        short_name: 'TX',
      },
      { types: ['postal_code'], long_name: '78701', short_name: '78701' },
      { types: ['country', 'political'], long_name: 'United States', short_name: 'US' },
    ],
    geometry: { location: { lat: 30.2672, lng: -97.7431 } },
  },
};

/**
 * Address suggestions, and the two things that are easy to get wrong about them.
 *
 * The first is cost. Autocomplete is billed per request unless every keystroke
 * and the final lookup carry one session token, and Place Details is billed by
 * the field groups asked for. Both are asserted below, because neither is
 * visible in the product: get them wrong and everything works, and the bill
 * arrives at the end of the month.
 *
 * The second is the shape of an address. The form stores city, state and postcode
 * separately, so what comes back has to be the structured components rather than
 * a display string split on commas.
 */
describe('address suggestions', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key-not-a-real-one');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('splits each suggestion into the line and the rest', async () => {
    vi.stubGlobal('fetch', mockFetch(OK_AUTOCOMPLETE));
    const { autocompleteAddress } = await import('@/lib/maps/client');

    await expect(autocompleteAddress('12 Oak', 'session-token-aaa')).resolves.toEqual([
      {
        placeId: 'ChIJOne',
        description: '12 Oak Lane, Austin, TX, USA',
        main: '12 Oak Lane',
        secondary: 'Austin, TX, USA',
      },
      {
        placeId: 'ChIJTwo',
        description: '12 Oak Street, Austin, TX, USA',
        main: '12 Oak Street',
        secondary: 'Austin, TX, USA',
      },
    ]);
  });

  it('falls back to the description when Google sends no structured text', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: 'OK',
        predictions: [{ place_id: 'ChIJBare', description: 'Rural Route 3, Bastrop County, TX' }],
      }),
    );
    const { autocompleteAddress } = await import('@/lib/maps/client');

    const [only] = await autocompleteAddress('Rural Route', 'session-token-aaa');
    expect(only?.main).toBe('Rural Route 3, Bastrop County, TX');
    expect(only?.secondary).toBe('');
  });

  it('drops a prediction with no place id, which could not be resolved anyway', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: 'OK',
        predictions: [{ description: 'Somewhere' }, { place_id: 'ChIJReal', description: 'Real' }],
      }),
    );
    const { autocompleteAddress } = await import('@/lib/maps/client');

    const results = await autocompleteAddress('some', 'session-token-aaa');
    expect(results.map((result) => result.placeId)).toEqual(['ChIJReal']);
  });

  it('shows at most five, because the list covers the field on a phone', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: 'OK',
        predictions: Array.from({ length: 12 }, (_value, index) => ({
          place_id: `ChIJ${index}`,
          description: `${index} Oak Lane`,
        })),
      }),
    );
    const { autocompleteAddress } = await import('@/lib/maps/client');

    await expect(autocompleteAddress('Oak', 'session-token-aaa')).resolves.toHaveLength(5);
  });

  it('carries the session token, so a typed address is billed once', async () => {
    // Not a detail: without a shared token Google bills every keystroke as its
    // own request, and the same address costs ten times as much to enter.
    const fetchMock = mockFetch(OK_AUTOCOMPLETE);
    vi.stubGlobal('fetch', fetchMock);
    const { autocompleteAddress } = await import('@/lib/maps/client');

    await autocompleteAddress('12 Oak', 'session-token-aaa', { country: 'us' });

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('sessiontoken')).toBe('session-token-aaa');
    expect(url.searchParams.get('types')).toBe('address');
    expect(url.searchParams.get('components')).toBe('country:us');
  });

  it.each(['ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED', 'INVALID_REQUEST'])(
    'returns nothing on %s rather than an error somebody is typing into',
    async (status) => {
      vi.stubGlobal('fetch', mockFetch({ status, predictions: [] }));
      const { autocompleteAddress } = await import('@/lib/maps/client');

      await expect(autocompleteAddress('12 Oak', 'session-token-aaa')).resolves.toEqual([]);
    },
  );

  it('does not spend a request on two characters', async () => {
    const fetchMock = mockFetch(OK_AUTOCOMPLETE);
    vi.stubGlobal('fetch', fetchMock);
    const { autocompleteAddress } = await import('@/lib/maps/client');

    await expect(autocompleteAddress(' 12 ', 'session-token-aaa')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing when the transport fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { autocompleteAddress } = await import('@/lib/maps/client');

    await expect(autocompleteAddress('12 Oak', 'session-token-aaa')).resolves.toEqual([]);
  });
});

describe('resolving a chosen suggestion', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key-not-a-real-one');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns the components the form stores, not a display string', async () => {
    vi.stubGlobal('fetch', mockFetch(OK_DETAILS));
    const { placeDetails } = await import('@/lib/maps/client');

    await expect(placeDetails('ChIJOne', 'session-token-aaa')).resolves.toEqual({
      addressLine1: '12 Oak Lane',
      city: 'Austin',
      // Short form: an invoice says TX, not Texas.
      state: 'TX',
      postalCode: '78701',
      country: 'US',
      latitude: 30.2672,
      longitude: -97.7431,
      placeId: 'ChIJOne',
    });
  });

  it('finds the town when it is reported as a postal town', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        status: 'OK',
        result: {
          place_id: 'ChIJUk',
          address_components: [
            { types: ['street_number'], long_name: '221B' },
            { types: ['route'], long_name: 'Baker Street' },
            { types: ['postal_town'], long_name: 'London' },
            { types: ['country'], long_name: 'United Kingdom', short_name: 'GB' },
          ],
        },
      }),
    );
    const { placeDetails } = await import('@/lib/maps/client');

    const place = await placeDetails('ChIJUk', 'session-token-aaa');
    expect(place?.city).toBe('London');
    expect(place?.country).toBe('GB');
    // No geometry in the payload: coordinates absent, not zero. A lat/lng of
    // 0,0 is in the Gulf of Guinea and would price a drive there.
    expect(place?.latitude).toBeNull();
    expect(place?.longitude).toBeNull();
  });

  it('asks for the same session and only the fields it uses', async () => {
    // Place Details is billed by field group. Asking for everything would pay
    // for opening hours and photographs on an address lookup.
    const fetchMock = mockFetch(OK_DETAILS);
    vi.stubGlobal('fetch', fetchMock);
    const { placeDetails } = await import('@/lib/maps/client');

    await placeDetails('ChIJOne', 'session-token-aaa');

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('sessiontoken')).toBe('session-token-aaa');
    expect(url.searchParams.get('fields')).toBe('address_component,geometry,place_id');
  });

  it.each(['ZERO_RESULTS', 'NOT_FOUND', 'REQUEST_DENIED'])(
    'returns null on %s so the form keeps what was typed',
    async (status) => {
      vi.stubGlobal('fetch', mockFetch({ status }));
      const { placeDetails } = await import('@/lib/maps/client');

      await expect(placeDetails('ChIJOne', 'session-token-aaa')).resolves.toBeNull();
    },
  );

  it('does not call out for an empty place id', async () => {
    const fetchMock = mockFetch(OK_DETAILS);
    vi.stubGlobal('fetch', fetchMock);
    const { placeDetails } = await import('@/lib/maps/client');

    await expect(placeDetails('   ', 'session-token-aaa')).resolves.toBeNull();
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

  it('suggests nothing, rather than failing the keystroke', async () => {
    const fetchMock = mockFetch(OK_AUTOCOMPLETE);
    vi.stubGlobal('fetch', fetchMock);
    const { autocompleteAddress } = await import('@/lib/maps/client');

    await expect(autocompleteAddress('12 Oak', 'session-token-aaa')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
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

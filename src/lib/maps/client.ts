import { getEnv } from '@/lib/env';

/**
 * Google Maps: turning an address into a point, and two points into a drive.
 *
 * Two calls, both server-side, both optional. The key never reaches the browser —
 * a Maps key in page source is a key anyone can spend, and geocoding is billed per
 * request.
 *
 * **What this deliberately does not do.** It does not measure a lawn. Satellite
 * imagery can be made to produce an area figure, and that figure is a guess with a
 * confident number attached: it cannot tell a lawn from a gravel drive, cannot see
 * under a tree, and is months stale. Quoting from it means quoting a price the
 * crew then has to argue about on the doorstep. `Property.lawnAreaSqFt` carries a
 * `measurementSource` beside it for exactly this reason, and nothing here ever
 * sets it — an area on a property was measured by a person, or it is not there.
 *
 * What it does do is the thing the pricing engine actually needs and an owner
 * genuinely cannot eyeball: how far the truck has to drive.
 */

/** Thrown when this deployment has no Maps key. Expected, not exceptional. */
export class MapsUnavailableError extends Error {
  constructor(message = 'Address lookup is not configured for this workspace.') {
    super(message);
    this.name = 'MapsUnavailableError';
  }
}

export function mapsEnabled(): boolean {
  return Boolean(getEnv().GOOGLE_MAPS_API_KEY);
}

const TIMEOUT_MS = 8_000;

async function callMaps(path: string, params: Record<string, string>): Promise<unknown> {
  const key = getEnv().GOOGLE_MAPS_API_KEY;
  if (!key) throw new MapsUnavailableError();

  const url = new URL(`https://maps.googleapis.com/maps/api/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('key', key);

  // A hung request would hold a serverless invocation open until the platform
  // kills it, so every call carries its own bound.
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Maps returned ${response.status}`);

  return response.json();
}

export type GeocodedAddress = {
  latitude: number;
  longitude: number;
  formatted: string;
  placeId: string;
};

/**
 * An address as Google understands it, or null.
 *
 * Null covers every unhappy path — no match, a timeout, a quota refusal — because
 * to the caller they are the same thing: carry on without coordinates. A property
 * that failed to geocode is a property with an address a human can still read, and
 * refusing to save it would be the tail wagging the dog.
 */
export async function geocodeAddress(address: string): Promise<GeocodedAddress | null> {
  const trimmed = address.trim();
  if (trimmed.length < 4) return null;

  try {
    const payload = (await callMaps('geocode/json', { address: trimmed })) as {
      status?: string;
      results?: {
        formatted_address?: string;
        place_id?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }[];
    };

    // ZERO_RESULTS is an answer, not a failure. OVER_QUERY_LIMIT and
    // REQUEST_DENIED are failures, and they look the same to the caller.
    if (payload.status !== 'OK') return null;

    const best = payload.results?.[0];
    const location = best?.geometry?.location;
    if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') return null;

    return {
      latitude: location.lat,
      longitude: location.lng,
      formatted: best?.formatted_address ?? trimmed,
      placeId: best?.place_id ?? '',
    };
  } catch {
    return null;
  }
}

export type DriveEstimate = {
  miles: number;
  minutes: number;
};

/**
 * How far, and how long, from one address to another by road.
 *
 * Road distance rather than straight-line: a river or a motorway junction is the
 * difference between a ten-minute hop and a forty-minute detour, and the per-mile
 * rule in the pricing engine is charging for fuel and time, not for geometry.
 *
 * Rounded to whole miles and minutes on the way out. The underlying figure has a
 * false precision to it — traffic, the exact driveway — and a quote that says
 * "12 miles" invites less argument than one that says "11.83".
 */
export async function driveEstimate(
  origin: string,
  destination: string,
): Promise<DriveEstimate | null> {
  if (!origin.trim() || !destination.trim()) return null;

  try {
    const payload = (await callMaps('distancematrix/json', {
      origins: origin,
      destinations: destination,
      units: 'imperial',
      mode: 'driving',
    })) as {
      status?: string;
      rows?: {
        elements?: {
          status?: string;
          distance?: { value?: number };
          duration?: { value?: number };
        }[];
      }[];
    };

    if (payload.status !== 'OK') return null;

    const element = payload.rows?.[0]?.elements?.[0];
    // NOT_FOUND and ZERO_RESULTS are both "there is no drive between these".
    if (element?.status !== 'OK') return null;

    const metres = element.distance?.value;
    const seconds = element.duration?.value;
    if (typeof metres !== 'number' || typeof seconds !== 'number') return null;

    return {
      miles: Math.round(metres / 1609.344),
      minutes: Math.round(seconds / 60),
    };
  } catch {
    return null;
  }
}

/** One line, the way a geocoder wants it. Empty when there is not enough to send. */
export function formatAddress(parts: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string {
  return [
    parts.addressLine1,
    parts.addressLine2,
    parts.city,
    parts.state,
    parts.postalCode,
    parts.country && parts.country !== 'US' ? parts.country : null,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

export type AddressSuggestion = {
  /** Google's opaque id, passed back to `placeDetails` to resolve the address. */
  placeId: string;
  /** What to show in the list: "12 Oak Lane, Austin, TX, USA". */
  description: string;
  /** The first line, bolded in Google's own UI. Shown as the primary text. */
  main: string;
  /** The rest — town, state, country. Shown underneath, smaller. */
  secondary: string;
};

/**
 * Address suggestions as somebody types, proxied rather than called from the page.
 *
 * The obvious implementation loads Google's Places JavaScript library in the
 * browser with a `NEXT_PUBLIC_` key. This does not, for the reason the rest of
 * this module does not: a Maps key in page source is a key anyone can spend, and
 * referrer restrictions are a speed bump rather than a lock. Going through the
 * server keeps one key, restricted by IP, never shipped — and it puts the
 * per-organization rate limit in front of a billed endpoint that fires on
 * keystrokes, which is the part that would otherwise be somebody else's invoice.
 *
 * It also means no third-party script in the page at all, which is worth more
 * than it sounds on a page that renders customer data.
 *
 * `sessionToken` is not decoration. Google bills autocomplete per request unless
 * the requests and the final `placeDetails` call share a session token, in which
 * case the whole session is billed once. Typing an address is a dozen requests;
 * without this it is a dozen charges.
 */
export async function autocompleteAddress(
  input: string,
  sessionToken: string,
  options: { country?: string } = {},
): Promise<AddressSuggestion[]> {
  const trimmed = input.trim();
  // Two characters cannot identify an address and would return noise at full
  // price, so the floor is here as well as in the component.
  if (trimmed.length < 3) return [];

  try {
    const payload = (await callMaps('place/autocomplete/json', {
      input: trimmed,
      sessiontoken: sessionToken,
      types: 'address',
      ...(options.country ? { components: `country:${options.country}` } : {}),
    })) as {
      status?: string;
      predictions?: {
        place_id?: string;
        description?: string;
        structured_formatting?: { main_text?: string; secondary_text?: string };
      }[];
    };

    // ZERO_RESULTS is an answer. Everything else that is not OK is a failure, and
    // both mean the same thing to a person typing: no suggestions, carry on.
    if (payload.status !== 'OK') return [];

    return (payload.predictions ?? [])
      .filter((prediction) => prediction.place_id && prediction.description)
      .slice(0, 5)
      .map((prediction) => ({
        placeId: prediction.place_id!,
        description: prediction.description!,
        main: prediction.structured_formatting?.main_text ?? prediction.description!,
        secondary: prediction.structured_formatting?.secondary_text ?? '',
      }));
  } catch {
    return [];
  }
}

export type ResolvedPlace = {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string;
};

/** Pulls one component out of Google's array by type. */
function component(
  components: { types?: string[]; long_name?: string; short_name?: string }[],
  type: string,
  form: 'long' | 'short' = 'long',
): string {
  const found = components.find((candidate) => candidate.types?.includes(type));
  return (form === 'short' ? found?.short_name : found?.long_name) ?? '';
}

/**
 * Turns a chosen suggestion into the fields the form actually stores.
 *
 * The structured components, not the one-line description: a form with separate
 * city, state and postcode inputs needs them separated, and splitting a display
 * string on commas is how an address in a country that orders them differently
 * ends up with the town in the postcode box.
 */
export async function placeDetails(
  placeId: string,
  sessionToken: string,
): Promise<ResolvedPlace | null> {
  if (!placeId.trim()) return null;

  try {
    const payload = (await callMaps('place/details/json', {
      place_id: placeId,
      sessiontoken: sessionToken,
      // Asked for by name: Google bills Place Details by the field groups
      // requested, so taking everything would cost more for data nothing uses.
      fields: 'address_component,geometry,place_id',
    })) as {
      status?: string;
      result?: {
        place_id?: string;
        address_components?: { types?: string[]; long_name?: string; short_name?: string }[];
        geometry?: { location?: { lat?: number; lng?: number } };
      };
    };

    if (payload.status !== 'OK' || !payload.result) return null;

    const components = payload.result.address_components ?? [];
    const streetNumber = component(components, 'street_number');
    const route = component(components, 'route');
    const location = payload.result.geometry?.location;

    return {
      addressLine1: [streetNumber, route].filter(Boolean).join(' '),
      // `locality` is the town in most places; `postal_town` is what the UK uses
      // and `sublocality` catches the cities that report neither.
      city:
        component(components, 'locality') ||
        component(components, 'postal_town') ||
        component(components, 'sublocality'),
      // Short form: forms and invoices want "TX", not "Texas".
      state: component(components, 'administrative_area_level_1', 'short'),
      postalCode: component(components, 'postal_code'),
      country: component(components, 'country', 'short') || 'US',
      latitude: typeof location?.lat === 'number' ? location.lat : null,
      longitude: typeof location?.lng === 'number' ? location.lng : null,
      placeId: payload.result.place_id ?? placeId,
    };
  } catch {
    return null;
  }
}

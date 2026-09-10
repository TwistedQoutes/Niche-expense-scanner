/**
 * The niche taxonomy.
 *
 * A generic expense tracker offers "Supplies" and leaves an artist to guess.
 * This is the actual shape of a tattoo business's spending, down to the brand
 * names that show up on real supplier receipts — which is what makes automatic
 * categorisation possible at all.
 *
 * Each category also carries the IRS Schedule C line it belongs on, so the
 * yearly export drops straight into a tax return instead of needing a second
 * pass. (Guidance, not tax advice — see the disclaimer in the export.)
 */

export const CATEGORY_IDS = [
  'NEEDLES',
  'INK',
  'STENCIL_TRANSFER',
  'GLOVES_PPE',
  'STERILISATION',
  'AFTERCARE',
  'MACHINES',
  'FURNITURE',
  'STUDIO_RENT',
  'LICENCES_INSURANCE',
  'ART_SUPPLIES',
  'MARKETING',
  'SOFTWARE_FEES',
  'TRAVEL_CONVENTIONS',
  'UTILITIES',
  'OTHER',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

/** A literal phrase and how strongly it implies its category. */
type Keyword = readonly [term: string, weight: number];

/**
 * A regular-expression rule, for shapes that no literal list can cover — e.g.
 * needle codes like "3RL", "07 RS", "13MG".
 */
type Pattern = readonly [source: string, weight: number];

export type CategoryDefinition = {
  id: CategoryId;
  label: string;
  /** Shown under the label when an artist picks a category by hand. */
  hint: string;
  /** Tailwind classes for the category chip — kept beside the data so the UI stays consistent. */
  chipClass: string;
  /** Colour used in the breakdown bars. */
  barClass: string;
  /** IRS Schedule C line this normally belongs on. */
  scheduleC: string;
  keywords: readonly Keyword[];
  patterns?: readonly Pattern[];
};

/**
 * Weighting convention:
 *   3  unambiguous multi-word phrase ("stencil paper", "sharps container")
 *   2  a term that essentially only occurs in this context ("cartridges", "autoclave")
 *   1  a suggestive but overloaded word ("chair", "soap", "gloves")
 */
export const CATEGORIES: Record<CategoryId, CategoryDefinition> = {
  NEEDLES: {
    id: 'NEEDLES',
    label: 'Needles & Cartridges',
    hint: 'Cartridges, needle groupings, tubes and grips',
    chipClass: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900',
    barClass: 'bg-rose-500',
    scheduleC: 'Part II, line 22 — Supplies',
    keywords: [
      ['needle cartridge', 3],
      ['tattoo needle', 3],
      ['needle grouping', 3],
      ['cartridge needle', 3],
      ['disposable tube', 3],
      ['disposable grip', 3],
      ['needles', 2],
      ['needle', 2],
      ['cartridges', 2],
      ['cartridge', 2],
      // Standard needle codes: 3RL, 07RL, 11RS, 13MG, 9CM, 15SEM, bugpin.
      ['bugpin', 2],
      ['round liner', 2],
      ['round shader', 2],
      ['magnum', 2],
      ['curved mag', 3],
      ['soft edge mag', 3],
      ['grip', 1],
      ['tube', 1],
    ],
    // Needle codes: "3RL", "07 RS", "13MG", "9CM", "15SEM".
    patterns: [['\\b\\d{1,2}\\s?(?:rl|rs|mg|cm|sem|rm)\\b', 2]],
  },

  INK: {
    id: 'INK',
    label: 'Ink & Pigments',
    hint: 'Colour, black, greywash and pigment sets',
    chipClass:
      'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900',
    barClass: 'bg-violet-500',
    scheduleC: 'Part II, line 22 — Supplies',
    keywords: [
      ['tattoo ink', 3],
      ['ink set', 3],
      ['grey wash', 3],
      ['greywash', 3],
      ['lining black', 3],
      ['shading solution', 3],
      ['pigment', 2],
      ['ink', 2],
      ['inks', 2],
      // Brands that appear on supplier receipts as their own line items.
      ['dynamic black', 3],
      ['world famous', 3],
      ['eternal ink', 3],
      ['intenze', 2],
      ['radiant colors', 3],
      ['fusion ink', 3],
      ['solid ink', 3],
      ['ink cap', 2],
      ['ink cups', 2],
      ['distilled water', 1],
    ],
  },

  STENCIL_TRANSFER: {
    id: 'STENCIL_TRANSFER',
    label: 'Stencil & Transfer',
    hint: 'Thermal paper, transfer gel, stencil primer',
    chipClass: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900',
    barClass: 'bg-sky-500',
    scheduleC: 'Part II, line 22 — Supplies',
    keywords: [
      ['stencil paper', 3],
      ['thermal paper', 3],
      ['transfer paper', 3],
      ['stencil stuff', 3],
      ['stencil primer', 3],
      ['transfer gel', 3],
      ['hectograph', 3],
      ['spirit master', 3],
      ['thermal printer', 3],
      ['stencil', 2],
      ['transfer solution', 3],
      ['freehand ink', 3],
      ['skin marker', 2],
      ['tracing paper', 2],
    ],
  },

  GLOVES_PPE: {
    id: 'GLOVES_PPE',
    label: 'Gloves & PPE',
    hint: 'Nitrile gloves, masks, aprons',
    chipClass: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:ring-teal-900',
    barClass: 'bg-teal-500',
    scheduleC: 'Part II, line 22 — Supplies',
    keywords: [
      ['nitrile glove', 3],
      ['nitrile gloves', 3],
      ['latex glove', 3],
      ['exam glove', 3],
      ['face mask', 3],
      ['face shield', 3],
      ['disposable apron', 3],
      ['gloves', 2],
      ['glove', 2],
      ['nitrile', 2],
      ['respirator', 2],
      ['apron', 1],
      ['mask', 1],
    ],
  },

  STERILISATION: {
    id: 'STERILISATION',
    label: 'Sterilisation & Cleaning',
    hint: 'Green soap, barrier film, autoclave, sharps disposal',
    chipClass:
      'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900',
    barClass: 'bg-emerald-500',
    scheduleC: 'Part II, line 22 — Supplies',
    keywords: [
      ['green soap', 3],
      ['barrier film', 3],
      ['sharps container', 3],
      ['sterilisation pouch', 3],
      ['sterilization pouch', 3],
      ['autoclave', 3],
      ['madacide', 3],
      ['cavicide', 3],
      ['clip cord sleeve', 3],
      ['machine bag', 3],
      ['dental bib', 3],
      ['table cover', 3],
      ['surface disinfectant', 3],
      ['ultrasonic cleaner', 3],
      ['biohazard', 2],
      ['disinfectant', 2],
      ['sanitizer', 2],
      ['sanitiser', 2],
      ['isopropyl', 2],
      ['bleach', 2],
      ['paper towel', 2],
      ['cleaning supplies', 3],
      ['cleaning supply', 3],
      ['soap', 1],
      ['wipes', 1],
    ],
  },

  AFTERCARE: {
    id: 'AFTERCARE',
    label: 'Aftercare & Bandaging',
    hint: 'Second-skin film, ointment, wrap',
    chipClass:
      'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900',
    barClass: 'bg-amber-500',
    scheduleC: 'Part II, line 22 — Supplies',
    keywords: [
      ['second skin', 3],
      ['saniderm', 3],
      ['tegaderm', 3],
      ['dermalize', 3],
      ['hustle butter', 3],
      ['tattoo goo', 3],
      ['after inked', 3],
      ['aquaphor', 3],
      ['healing ointment', 3],
      ['aftercare', 2],
      ['ointment', 2],
      ['petroleum jelly', 2],
      ['bandage', 2],
      ['gauze', 2],
      ['wrap film', 2],
      ['cling film', 2],
      ['numbing cream', 3],
    ],
  },

  MACHINES: {
    id: 'MACHINES',
    label: 'Machines & Power',
    hint: 'Rotary and coil machines, pens, power supplies, cords',
    chipClass:
      'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 dark:bg-fuchsia-950/60 dark:text-fuchsia-300 dark:ring-fuchsia-900',
    barClass: 'bg-fuchsia-500',
    scheduleC: 'Part II, line 22 — Supplies (or line 13 if depreciated)',
    keywords: [
      ['tattoo machine', 3],
      ['rotary machine', 3],
      ['coil machine', 3],
      ['tattoo pen', 3],
      ['power supply', 3],
      ['foot pedal', 3],
      ['foot switch', 3],
      ['clip cord', 3],
      ['rca cord', 3],
      ['wireless battery', 3],
      // Machine manufacturers.
      ['cheyenne', 3],
      ['fk irons', 3],
      ['bishop rotary', 3],
      ['critical power', 3],
      ['ez tattoo', 3],
      ['mast tour', 3],
      ['machine', 1],
      ['rotary', 2],
      ['stroke', 1],
    ],
  },

  FURNITURE: {
    id: 'FURNITURE',
    label: 'Furniture & Fixtures',
    hint: 'Tattoo chairs, beds, armrests, stools, lamps, carts',
    chipClass:
      'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-900',
    barClass: 'bg-indigo-500',
    scheduleC: 'Part II, line 13 — Depreciation (assets over the de minimis threshold)',
    keywords: [
      ['tattoo chair', 3],
      ['tattoo bed', 3],
      ['tattoo table', 3],
      ['client chair', 3],
      ['massage table', 3],
      ['hydraulic chair', 3],
      ['artist stool', 3],
      ['saddle stool', 3],
      ['arm rest', 3],
      ['armrest', 3],
      ['leg rest', 3],
      ['work station', 3],
      ['workstation', 3],
      ['ink tray', 3],
      ['rolling cart', 3],
      ['led lamp', 3],
      ['ring light', 3],
      ['task light', 3],
      ['tattoo lamp', 3],
      ['mirror', 2],
      ['chair', 1],
      ['stool', 2],
      ['table', 1],
      ['shelving', 2],
      ['ikea', 2],
    ],
  },

  STUDIO_RENT: {
    id: 'STUDIO_RENT',
    label: 'Booth & Studio Rent',
    hint: 'Chair rent, booth fees, studio lease',
    chipClass:
      'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:ring-orange-900',
    barClass: 'bg-orange-500',
    scheduleC: 'Part II, line 20b — Rent or lease (other business property)',
    keywords: [
      ['booth rent', 3],
      ['booth fee', 3],
      ['chair rent', 3],
      ['studio rent', 3],
      ['station rent', 3],
      ['shop rent', 3],
      ['monthly rent', 3],
      ['lease payment', 3],
      ['rent', 2],
      ['lease', 2],
      ['sublet', 2],
    ],
  },

  LICENCES_INSURANCE: {
    id: 'LICENCES_INSURANCE',
    label: 'Licences & Insurance',
    hint: 'Bloodborne pathogen certs, health permits, liability cover',
    chipClass: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:ring-cyan-900',
    barClass: 'bg-cyan-500',
    scheduleC: 'Part II, lines 15 & 23 — Insurance and Taxes/Licences',
    keywords: [
      ['bloodborne pathogen', 3],
      ['blood borne pathogen', 3],
      ['bbp certification', 3],
      ['first aid certification', 3],
      ['cpr certification', 3],
      ['tattoo licence', 3],
      ['tattoo license', 3],
      ['artist licence', 3],
      ['artist license', 3],
      ['health department', 3],
      ['health permit', 3],
      ['liability insurance', 3],
      ['professional indemnity', 3],
      ['business insurance', 3],
      ['licence renewal', 3],
      ['license renewal', 3],
      ['permit', 2],
      ['insurance', 2],
      ['licence', 2],
      ['license', 2],
    ],
  },

  ART_SUPPLIES: {
    id: 'ART_SUPPLIES',
    label: 'Art & Design Supplies',
    hint: 'Sketchbooks, markers, tablet and stylus',
    chipClass: 'bg-lime-50 text-lime-700 ring-lime-200 dark:bg-lime-950/60 dark:text-lime-300 dark:ring-lime-900',
    barClass: 'bg-lime-500',
    scheduleC: 'Part II, line 22 — Supplies',
    keywords: [
      ['sketch book', 3],
      ['sketchbook', 3],
      ['drawing pad', 3],
      ['apple pencil', 3],
      ['drawing tablet', 3],
      ['copic', 3],
      ['prismacolor', 3],
      ['fine liner', 3],
      ['micron pen', 3],
      ['light pad', 3],
      ['light box', 3],
      ['ipad', 2],
      ['markers', 2],
      ['marker', 1],
      ['pencil', 1],
      ['sketch', 1],
    ],
  },

  MARKETING: {
    id: 'MARKETING',
    label: 'Marketing & Branding',
    hint: 'Ads, print, photography, merch',
    chipClass: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/60 dark:text-pink-300 dark:ring-pink-900',
    barClass: 'bg-pink-500',
    scheduleC: 'Part II, line 8 — Advertising',
    keywords: [
      ['business card', 3],
      ['business cards', 3],
      ['instagram ads', 3],
      ['meta ads', 3],
      ['facebook ads', 3],
      ['google ads', 3],
      ['flyer printing', 3],
      ['sticker printing', 3],
      ['vistaprint', 3],
      ['photographer', 3],
      ['portfolio print', 3],
      ['merch', 2],
      ['advertising', 2],
      ['flyers', 2],
      ['stickers', 2],
      ['printing', 1],
      ['signage', 2],
    ],
  },

  SOFTWARE_FEES: {
    id: 'SOFTWARE_FEES',
    label: 'Software & Payment Fees',
    hint: 'Booking apps, card processing, subscriptions',
    chipClass:
      'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-900',
    barClass: 'bg-blue-500',
    scheduleC: 'Part V — Other expenses (software, merchant fees)',
    keywords: [
      ['booking software', 3],
      ['square fee', 3],
      ['stripe fee', 3],
      ['processing fee', 3],
      ['merchant fee', 3],
      ['transaction fee', 3],
      ['monthly subscription', 3],
      ['annual subscription', 3],
      ['procreate', 3],
      ['adobe', 2],
      ['squarespace', 3],
      ['domain renewal', 3],
      ['web hosting', 3],
      ['subscription', 2],
      ['saas', 2],
      ['software', 2],
    ],
  },

  TRAVEL_CONVENTIONS: {
    id: 'TRAVEL_CONVENTIONS',
    label: 'Travel & Conventions',
    hint: 'Guest spots, convention booths, flights, fuel',
    chipClass:
      'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:ring-purple-900',
    barClass: 'bg-purple-500',
    scheduleC: 'Part II, lines 9 & 24a — Car and truck expenses, Travel',
    keywords: [
      ['tattoo convention', 3],
      ['convention booth', 3],
      ['guest spot', 3],
      ['booth deposit', 3],
      ['convention', 2],
      ['expo', 2],
      ['flight', 2],
      ['airline', 2],
      ['baggage fee', 3],
      ['hotel', 2],
      ['airbnb', 2],
      ['car rental', 3],
      ['rideshare', 2],
      ['parking', 2],
      ['fuel', 2],
      ['petrol', 2],
      ['gasoline', 2],
      ['mileage', 2],
      ['train ticket', 3],
    ],
  },

  UTILITIES: {
    id: 'UTILITIES',
    label: 'Utilities & Phone',
    hint: 'Electricity, water, internet, mobile',
    chipClass: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
    barClass: 'bg-slate-500',
    scheduleC: 'Part II, line 25 — Utilities',
    keywords: [
      ['electric bill', 3],
      ['electricity bill', 3],
      ['water bill', 3],
      ['gas bill', 3],
      ['internet bill', 3],
      ['phone bill', 3],
      ['mobile bill', 3],
      ['broadband', 2],
      ['utility', 2],
      ['utilities', 2],
      ['electricity', 2],
      ['internet', 1],
    ],
  },

  OTHER: {
    id: 'OTHER',
    label: 'Uncategorised',
    hint: "Anything the scanner couldn't place — review and set it yourself",
    chipClass: 'bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700',
    barClass: 'bg-zinc-400',
    scheduleC: 'Part V — Other expenses',
    keywords: [],
  },
};

export const CATEGORY_LIST: readonly CategoryDefinition[] = CATEGORY_IDS.map((id) => CATEGORIES[id]);

/**
 * Known suppliers, used as a *weak* prior only.
 *
 * A tattoo supply house sells needles, ink, furniture and soap alike, so the
 * merchant name can never outvote an actual line item — it just breaks ties and
 * keeps a receipt whose items failed to OCR out of "Uncategorised".
 */
export const MERCHANT_HINTS: readonly { pattern: string; category: CategoryId }[] = [
  { pattern: 'kingpin tattoo', category: 'NEEDLES' },
  { pattern: 'painful pleasures', category: 'NEEDLES' },
  { pattern: 'tatsoul', category: 'FURNITURE' },
  { pattern: 'eikon', category: 'MACHINES' },
  { pattern: 'element tattoo', category: 'NEEDLES' },
  { pattern: 'superior tattoo', category: 'NEEDLES' },
  { pattern: 'killer ink', category: 'INK' },
  { pattern: 'barber dts', category: 'NEEDLES' },
  { pattern: 'joker tattoo', category: 'NEEDLES' },
  { pattern: 'ink machines', category: 'MACHINES' },
  { pattern: 'cheyenne', category: 'MACHINES' },
  { pattern: 'fk irons', category: 'MACHINES' },
  { pattern: 'bishop', category: 'MACHINES' },
  { pattern: 'saniderm', category: 'AFTERCARE' },
  { pattern: 'hustle butter', category: 'AFTERCARE' },
  { pattern: 'square', category: 'SOFTWARE_FEES' },
  { pattern: 'stripe', category: 'SOFTWARE_FEES' },
  { pattern: 'vistaprint', category: 'MARKETING' },
  { pattern: 'shell', category: 'TRAVEL_CONVENTIONS' },
  { pattern: 'chevron', category: 'TRAVEL_CONVENTIONS' },
  { pattern: 'uber', category: 'TRAVEL_CONVENTIONS' },
  { pattern: 'delta air', category: 'TRAVEL_CONVENTIONS' },
];

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORY_IDS as readonly string[]).includes(value);
}

/** Never throws: an unrecognised value (old data, hand-edited DB) falls back to OTHER. */
export function categoryOf(id: string): CategoryDefinition {
  return isCategoryId(id) ? CATEGORIES[id] : CATEGORIES.OTHER;
}

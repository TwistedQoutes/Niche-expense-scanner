/**
 * The starter service catalogue.
 *
 * A workspace with no services cannot produce a quote, and asking a lawn-care
 * operator to define "Lawn Mowing" from scratch before they can price their
 * first job is the fastest way to lose them during onboarding. So signup
 * installs the templates for their industry, already priced at defaults they
 * can recognise, and every field is editable afterwards.
 *
 * Prices are cents; `estimatedMinutes` is labour for the base job. These are
 * plausible 2026 US residential rates, not a recommendation — the onboarding
 * wizard shows them as a starting point and asks the owner to confirm.
 */

export type ServiceTemplate = {
  /** Stable key, so an upgrade can improve a template without duplicating it. */
  key: string;
  name: string;
  description: string;
  basePriceCents: number;
  minimumPriceCents: number;
  /** Extra charge per `unitSizeSqFt` beyond what the base price covers. */
  unitPriceCents: number;
  unitSizeSqFt: number;
  estimatedMinutes: number;
  materialCostCents: number;
  taxable: boolean;
};

/**
 * Which templates a given industry starts with.
 *
 * A trade not listed here falls back to `GENERAL_TEMPLATES`, which is why
 * `Organization.industry` is free text: selling into a trade we have not
 * thought of should not require a migration.
 */
export const INDUSTRIES = [
  { key: 'lawn_care', label: 'Lawn care' },
  { key: 'landscaping', label: 'Landscaping' },
  { key: 'pressure_washing', label: 'Pressure washing' },
  { key: 'cleaning', label: 'Cleaning' },
  { key: 'junk_removal', label: 'Junk removal' },
  { key: 'handyman', label: 'Handyman' },
  { key: 'painting', label: 'Painting' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'roofing', label: 'Roofing' },
  { key: 'other', label: 'Something else' },
] as const;

export type IndustryKey = (typeof INDUSTRIES)[number]['key'];

export function isIndustryKey(value: string): value is IndustryKey {
  return INDUSTRIES.some((industry) => industry.key === value);
}

export const SERVICE_TEMPLATES: Record<string, ServiceTemplate> = {
  lawn_mowing: {
    key: 'lawn_mowing',
    name: 'Lawn Mowing',
    description: 'Mow, trim, edge and blow down hard surfaces.',
    basePriceCents: 4500,
    minimumPriceCents: 4500,
    unitPriceCents: 1000,
    unitSizeSqFt: 1000,
    estimatedMinutes: 30,
    materialCostCents: 0,
    taxable: false,
  },
  lawn_treatment: {
    key: 'lawn_treatment',
    name: 'Fertilisation & Weed Control',
    description: 'Granular feed and broadleaf weed treatment.',
    basePriceCents: 6500,
    minimumPriceCents: 6500,
    unitPriceCents: 1200,
    unitSizeSqFt: 1000,
    estimatedMinutes: 25,
    materialCostCents: 1800,
    taxable: true,
  },
  landscaping: {
    key: 'landscaping',
    name: 'Landscape Maintenance',
    description: 'Bed maintenance, shrub trimming and general tidy-up.',
    basePriceCents: 12000,
    minimumPriceCents: 9000,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 120,
    materialCostCents: 0,
    taxable: false,
  },
  mulching: {
    key: 'mulching',
    name: 'Mulch Installation',
    description: 'Supply and spread hardwood mulch, beds edged and defined.',
    basePriceCents: 9500,
    minimumPriceCents: 9500,
    unitPriceCents: 3500,
    unitSizeSqFt: 100,
    estimatedMinutes: 90,
    materialCostCents: 4000,
    taxable: true,
  },
  pressure_washing: {
    key: 'pressure_washing',
    name: 'Pressure Washing',
    description: 'Driveway, walkway and patio surface cleaning.',
    basePriceCents: 15000,
    minimumPriceCents: 12500,
    unitPriceCents: 2000,
    unitSizeSqFt: 500,
    estimatedMinutes: 120,
    materialCostCents: 1500,
    taxable: false,
  },
  house_cleaning: {
    key: 'house_cleaning',
    name: 'House Cleaning',
    description: 'Standard interior clean — kitchen, bathrooms, floors, dusting.',
    basePriceCents: 13500,
    minimumPriceCents: 11000,
    unitPriceCents: 1500,
    unitSizeSqFt: 500,
    estimatedMinutes: 150,
    materialCostCents: 800,
    taxable: false,
  },
  junk_removal: {
    key: 'junk_removal',
    name: 'Junk Removal',
    description: 'Load, haul and dispose. Priced by truck volume.',
    basePriceCents: 17500,
    minimumPriceCents: 12500,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 90,
    materialCostCents: 4500,
    taxable: false,
  },
  snow_removal: {
    key: 'snow_removal',
    name: 'Snow Removal',
    description: 'Clear driveway and walkways, salt applied where needed.',
    basePriceCents: 7500,
    minimumPriceCents: 6500,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 45,
    materialCostCents: 1200,
    taxable: false,
  },
  painting: {
    key: 'painting',
    name: 'Interior Painting',
    description: 'Prep, prime and two coats. Materials billed separately.',
    basePriceCents: 45000,
    minimumPriceCents: 25000,
    unitPriceCents: 3000,
    unitSizeSqFt: 100,
    estimatedMinutes: 480,
    materialCostCents: 8000,
    taxable: true,
  },
  handyman: {
    key: 'handyman',
    name: 'Handyman Visit',
    description: 'General repairs, charged hourly with a one-hour minimum.',
    basePriceCents: 9500,
    minimumPriceCents: 9500,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 60,
    materialCostCents: 0,
    taxable: false,
  },
  hvac_tune_up: {
    key: 'hvac_tune_up',
    name: 'HVAC Tune-Up',
    description: 'Seasonal inspection, coil clean and filter change.',
    basePriceCents: 14900,
    minimumPriceCents: 14900,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 75,
    materialCostCents: 2500,
    taxable: true,
  },
  plumbing_call: {
    key: 'plumbing_call',
    name: 'Plumbing Service Call',
    description: 'Diagnosis and first hour of labour. Parts quoted on site.',
    basePriceCents: 16500,
    minimumPriceCents: 16500,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 60,
    materialCostCents: 0,
    taxable: false,
  },
  electrical_call: {
    key: 'electrical_call',
    name: 'Electrical Service Call',
    description: 'Diagnosis and first hour of labour. Parts quoted on site.',
    basePriceCents: 17500,
    minimumPriceCents: 17500,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 60,
    materialCostCents: 0,
    taxable: false,
  },
  roof_inspection: {
    key: 'roof_inspection',
    name: 'Roof Inspection',
    description: 'Full inspection with a photo report and written findings.',
    basePriceCents: 19500,
    minimumPriceCents: 19500,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 90,
    materialCostCents: 0,
    taxable: false,
  },
  custom_service: {
    key: 'custom_service',
    name: 'Custom Service',
    description: 'Anything priced per job. Edit the name and rate to suit.',
    basePriceCents: 0,
    minimumPriceCents: 0,
    unitPriceCents: 0,
    unitSizeSqFt: 1000,
    estimatedMinutes: 60,
    materialCostCents: 0,
    taxable: false,
  },
};

const GENERAL_TEMPLATES = ['handyman', 'custom_service'];

const BY_INDUSTRY: Record<string, string[]> = {
  lawn_care: ['lawn_mowing', 'lawn_treatment', 'mulching', 'snow_removal', 'custom_service'],
  landscaping: ['landscaping', 'mulching', 'lawn_mowing', 'custom_service'],
  pressure_washing: ['pressure_washing', 'custom_service'],
  cleaning: ['house_cleaning', 'custom_service'],
  junk_removal: ['junk_removal', 'custom_service'],
  handyman: ['handyman', 'painting', 'custom_service'],
  painting: ['painting', 'pressure_washing', 'custom_service'],
  hvac: ['hvac_tune_up', 'custom_service'],
  plumbing: ['plumbing_call', 'custom_service'],
  electrical: ['electrical_call', 'custom_service'],
  roofing: ['roof_inspection', 'pressure_washing', 'custom_service'],
  other: GENERAL_TEMPLATES,
};

/** The templates a new workspace in this industry starts with. */
export function templatesForIndustry(industry: string): ServiceTemplate[] {
  const keys = BY_INDUSTRY[industry] ?? GENERAL_TEMPLATES;
  return keys
    .map((key) => SERVICE_TEMPLATES[key])
    .filter((template): template is ServiceTemplate => template !== undefined);
}

// Charts transcribed from the live pages inspected on Nov 11, 2026 (see blueprint "Sources").
// These stand in for saved-page fixtures until the adapters (M1+) save real page snapshots.
// Fields marked PARTIAL only carry the values recorded in the blueprint.

import type { FitProfile, ProductSpec } from '../src/types.ts';
import { tableToRawChart } from '../src/table.ts';
import { inch } from '../src/units.ts';

/** Snitch white slim-fit corduroy shirt. "Measurements are in Inches"; no body/garment label. */
export const snitchSlimCorduroy: ProductSpec = {
  retailer: 'snitch',
  productId: '8519422050466',
  brand: 'Snitch',
  title: 'White Slim Fit Corduroy Shirt',
  category: 'shirt',
  fitTypeRaw: 'Slim Fit',
  chart: tableToRawChart([
    ['Size', 'Chest', 'Shoulder', 'Length'],
    ['XS', '37', '16', '26'],
    ['S', '39.5', '17', '27'],
    ['M', '41.75', '18', '28'],
    ['L', '45', '19', '29'],
    ['XL', '47.5', '20', '30'],
  ], { unit: 'in' }),
};

/** AJIO Alpha Tribe checked regular-fit shirt. Labelled "Garment Measurement", chest only. */
export const ajioAlphaTribeRegular: ProductSpec = {
  retailer: 'ajio',
  productId: '703845948_multi',
  brand: 'Alpha Tribe',
  title: 'Men Checked Regular Fit Spread-Collar Shirt',
  category: 'shirt',
  fitTypeRaw: 'Regular Fit',
  chart: tableToRawChart([
    ['Size', 'Chest (in)'],
    ['M', '41'],
    ['L', '43'],
    ['XL', '45'],
  ], { basisLabel: 'Garment Measurement' }),
};

/** Amazon.in Nobero linen shirt (PARTIAL: chest only; page also lists sleeve/shoulder/length). No basis, no fit. */
export const amazonNoberoLinen: ProductSpec = {
  retailer: 'amazon_in',
  productId: 'B0GWDTTWS9',
  brand: 'Nobero',
  title: 'Linen Shirt',
  category: 'shirt',
  chart: tableToRawChart([
    ['Size', 'Chest'],
    ['S', '41.5'],
    ['M', '43.5'],
    ['L', '46'],
  ], { unit: 'in' }),
};

/** Myntra The Bear House slim shirt (PARTIAL: only size 38 / brand S was recorded). Structured JSON, GARMENT. */
export const myntraBearHouseSlim: ProductSpec = {
  retailer: 'myntra',
  productId: '19347680',
  brand: 'The Bear House',
  title: 'Men Beige Solid Slim Fit Cotton Shirt',
  category: 'shirt',
  fitTypeRaw: 'Slim Fit',
  chart: {
    source: 'structured_json',
    unit: 'in',
    sizes: [{
      label: '38',
      brandLabel: 'S',
      measurements: [
        { name: 'Chest', value: 40.25, basis: 'garment' },
        { name: 'Front Length', value: 29.25, basis: 'garment' },
        { name: 'Across Shoulder', value: 16.75, basis: 'garment' },
      ],
    }],
  },
};

export const ALL_PRODUCTS = { snitchSlimCorduroy, ajioAlphaTribeRegular, amazonNoberoLinen, myntraBearHouseSlim };

/** The blueprint's made-up example user: chest 39, shoulder 17.5, preferred length 28 (inches), tape-measured. */
export const exampleUser: FitProfile = {
  unitPref: 'in',
  fitPref: 'regular',
  body: { source: 'manual', chestCm: inch(39), shoulderCm: inch(17.5) },
  preferredLengthCm: inch(28),
};

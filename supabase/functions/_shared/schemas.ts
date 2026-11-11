// Request validation. Everything from the client is untrusted, including charts the adapter "parsed".

import { z } from 'npm:zod@3.23.8';
import { HttpError } from './http.ts';

export const RETAILERS = ['myntra', 'snitch', 'ajio', 'amazon_in', 'flipkart'] as const;
const category = z.enum(['shirt', 'tshirt']);
const fitType = z.enum(['slim', 'regular', 'relaxed', 'oversized']);
const basis = z.enum(['body', 'garment', 'unknown']);
const unit = z.enum(['in', 'cm']);
const cm = (lo: number, hi: number) => z.number().finite().min(lo).max(hi);

export const RawSizeChartSchema = z.object({
  source: z.enum(['structured_json', 'html_table', 'llm_image', 'brand_default']),
  unit: unit.optional(),
  statedBasis: basis.optional(),
  basisLabel: z.string().max(200).optional(),
  sizes: z.array(z.object({
    label: z.string().trim().min(1).max(24),
    brandLabel: z.string().trim().max(24).optional(),
    measurements: z.array(z.object({
      name: z.string().max(80),
      value: z.union([z.number().finite(), z.string().max(40), z.null()]),
      basis: basis.optional(),
      unit: unit.optional(),
    })).max(24),
  })).min(1).max(40),
});

const httpsUrl = z.string().url().max(2000).refine((u) => u.startsWith('https://'), 'must be https');

export const ResolveChartInput = z.object({
  retailer: z.enum(RETAILERS),
  retailerProductId: z.string().trim().min(1).max(120),
  url: httpsUrl.optional(),
  title: z.string().max(300).optional(),
  brand: z.string().trim().max(100).optional(),
  category,
  fitTypeRaw: z.string().max(80).optional(),
  fabric: z.string().max(120).optional(),
  hasStretch: z.boolean().optional(),
  /** Parsed chart from the page (Myntra JSON, HTML tables). */
  chart: RawSizeChartSchema.optional(),
  /** Unparseable chart: an image (LLM vision) or raw text (LLM text). */
  image: z.object({ url: httpsUrl }).optional(),
  chartText: z.string().max(8000).optional(),
});
export type ResolveChartInput = z.infer<typeof ResolveChartInput>;

export const FitProfileSchema = z.object({
  unitPref: unit,
  fitPref: z.enum(['snug', 'regular', 'relaxed']),
  body: z.object({
    source: z.enum(['manual', 'photo', 'brand_size']),
    heightCm: cm(100, 250).optional(),
    weightKg: cm(25, 300).optional(),
    chestCm: cm(50, 200).optional(),
    waistCm: cm(40, 200).optional(),
    shoulderCm: cm(25, 75).optional(),
    neckCm: cm(20, 70).optional(),
    armCm: cm(30, 110).optional(),
  }).optional(),
  referenceGarments: z.array(z.object({
    category,
    fitType,
    chestCm: cm(60, 220),
    shoulderCm: cm(25, 80).optional(),
    lengthCm: cm(40, 120).optional(),
    sleeveCm: cm(10, 100).optional(),
    brand: z.string().max(100).optional(),
    sizeLabel: z.string().max(24).optional(),
    verdict: z.enum(['perfect', 'slightly_tight', 'slightly_loose']),
  })).max(10).optional(),
  preferredLengthCm: cm(40, 120).optional(),
  feedbackOffsetCm: cm(-10, 10).optional(),
});

export const RecommendInput = z.object({
  chartId: z.string().uuid(),
  /** Omit to use the profile stored in the database. */
  profile: FitProfileSchema.optional(),
  /** What the extension showed, to record whether server and client agree. */
  clientResult: z.object({ size: z.string().max(24), engineVersion: z.string().max(20) }).optional(),
});

const fitWord = z.enum(['tight', 'ok', 'loose']);
export const FeedbackInput = z.object({
  /** Update an earlier "I bought this" row with the "How did it fit?" answer. */
  feedbackId: z.string().uuid().optional(),
  recommendationId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  boughtSize: z.string().trim().min(1).max(24).optional(),
  overall: z.enum(['perfect', 'tight', 'loose', 'returned']).optional(),
  perPoint: z.record(z.enum(['chest', 'shoulder', 'length', 'sleeve', 'waist']), fitWord).optional(),
}).refine((v) => v.feedbackId || ((v.recommendationId || v.productId) && v.boughtSize), {
  message: 'Send feedbackId to update, or boughtSize with recommendationId/productId to create.',
});

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'invalid_input', 'Request did not validate.', r.error.flatten());
  return r.data;
}

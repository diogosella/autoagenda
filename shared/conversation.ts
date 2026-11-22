import { z } from 'zod';
export const conversationSchema = z
  .array(
    z.object({
      role: z.enum(['customer', 'assistant']),
      sent_at: z.iso.datetime().optional(),
      text: z.string().trim().min(1).max(4000),
    }),
  )
  .max(100);
export type ConversationMessage = z.infer<typeof conversationSchema>[number];

const slot = z.object({ starts_at: z.iso.datetime(), ends_at: z.iso.datetime() });
const period = z.enum(['morning', 'afternoon', 'any']);

/**
 * Booking progress of one conversation. The browser keeps it during the demo; the WhatsApp
 * channel will keep it per phone number. It is never trusted: every booking is revalidated.
 */
export const chatStateSchema = z.object({
  stage: z
    .enum(['collecting', 'choosing', 'name', 'vehicle', 'phone', 'confirming', 'booked'])
    .default('collecting'),
  /** Index of the first history message that still belongs to the current request. */
  context_from: z.number().int().min(0).max(102).default(0),
  /** Request resolved before context_from, replayed to the interpreter as one summary message. */
  base: z
    .object({ service_id: z.string(), date: z.string().nullable(), period })
    .nullable()
    .default(null),
  service_id: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  period: period.default('any'),
  price_cents: z.number().int().positive().nullable().default(null),
  duration_minutes: z.number().int().positive().nullable().default(null),
  offered: z.array(slot).max(10).default([]),
  chosen: slot.nullable().default(null),
  customer_name: z.string().max(80).nullable().default(null),
  vehicle: z.string().max(100).nullable().default(null),
  /** Customer phone: given by the WhatsApp channel, or asked in the conversation. */
  phone: z.string().max(25).nullable().default(null),
  booking_id: z.string().nullable().default(null),
});
export type ChatState = z.infer<typeof chatStateSchema>;
export const initialChatState = (): ChatState => chatStateSchema.parse({});

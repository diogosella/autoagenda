import { z } from 'zod';
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const settingsSchema = z
  .object({
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((d) => new Set(d).size === d.length),
    opens: time,
    closes: time,
    interval: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    notice_minutes: z.number().int().min(0).max(10080),
    horizon_days: z.number().int().min(1).max(180),
    delivery_notice: z.string().trim().min(10).max(400),
    /** Free text the assistant may use to answer questions (address, payment, what is included). */
    assistant_info: z.string().trim().max(2000).default(''),
  })
  .refine((s) => s.opens < s.closes, 'O fechamento deve ser após a abertura.');
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  days: [1, 2, 3, 4, 5, 6],
  opens: '08:00',
  closes: '18:00',
  interval: 30,
  notice_minutes: 0,
  horizon_days: 180,
  delivery_notice:
    'O valor e a previsão de entrega podem variar conforme o porte do veículo e o estado da pintura e do interior. A loja avalia o carro na chegada e confirma o valor antes de iniciar o serviço.',
  assistant_info: '',
};

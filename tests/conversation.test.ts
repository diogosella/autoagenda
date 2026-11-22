import { expect, it } from 'vitest';
import { parseConversation } from '../server/intent';
import { seedServices } from '../shared/domain';
const history = [{ role: 'customer' as const, text: 'quero lavar meu carro' }];
it('retains the requested wash when the customer answers only the date', () => {
  const result = parseConversation('segunda que vem', seedServices, history, '2026-11-21');
  expect(result.service_id).toBe(seedServices[0].id);
  expect(result.date).toBe('2026-11-23');
  expect(result.clarification).toBeNull();
});
it('retains date when changing service and period', () => {
  const h = [...history, { role: 'customer' as const, text: 'segunda que vem' }];
  const result = parseConversation('polimento à tarde', seedServices, h, '2026-11-21');
  expect(result.service_id).toBe(seedServices[1].id);
  expect(result.date).toBe('2026-11-23');
  expect(result.period).toBe('afternoon');
});
it('does not reuse a service for unsupported requests or an invalid date', () => {
  expect(
    parseConversation('quero pintar o carro', seedServices, history, '2026-11-21').service_id,
  ).toBeNull();
  expect(
    parseConversation('31/02/2027', seedServices, history, '2026-11-21').clarification,
  ).toBeTruthy();
  expect(
    parseConversation('segunda que vem', seedServices, [], '2026-11-21').service_id,
  ).toBeNull();
});

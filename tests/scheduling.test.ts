import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slots, overlaps, seedServices, bookingSchema, localDate } from '../shared/domain';
import { LocalStore } from '../server/store';
import { parseConversation, parseDemo } from '../server/intent';
const now = new Date('2026-11-21T10:00:00-03:00');
const start = '2026-11-27T13:00:00-03:00';
const input = {
  service_id: seedServices[1].id,
  starts_at: start,
  customer_name: 'Ana Silva',
  phone: '11999999999',
  vehicle: 'Civic prata',
  accepted_estimate: true as const,
  expected_price_cents: 65000,
  expected_duration_minutes: 240,
};
describe('availability for one car', () => {
  it('fits the entire four-hour polishing, including the exact closing boundary', () => {
    const result = slots('2026-11-27', 240, [], 'afternoon', now);
    expect(result.map((s) => s.starts_at)).toEqual([
      '2026-11-27T15:00:00.000Z',
      '2026-11-27T15:30:00.000Z',
      '2026-11-27T16:00:00.000Z',
      '2026-11-27T16:30:00.000Z',
      '2026-11-27T17:00:00.000Z',
    ]);
    expect(result.at(-1)?.ends_at).toBe('2026-11-27T21:00:00.000Z');
  });
  it('rejects every type of overlap, allowing adjacent reservations', () => {
    const busy = { starts_at: '2026-11-27T13:00:00-03:00', ends_at: '2026-11-27T17:00:00-03:00' };
    expect(
      overlaps(busy, {
        starts_at: '2026-11-27T12:00:00-03:00',
        ends_at: '2026-11-27T18:00:00-03:00',
      }),
    ).toBe(true);
    expect(slots('2026-11-27', 60, [busy], 'afternoon', now).map((s) => s.starts_at)).toEqual([
      '2026-11-27T15:00:00.000Z',
      '2026-11-27T20:00:00.000Z',
    ]);
  });
  it('closes Sundays, disallows past starts, rejects impossible dates', () => {
    expect(slots('2026-11-22', 90, [], 'any', now)).toEqual([]);
    expect(slots('2026-02-30', 90, [], 'any', now)).toEqual([]);
    expect(
      slots('2026-11-21', 90, [], 'any', now).every((s) => Date.parse(s.starts_at) > now.getTime()),
    ).toBe(true);
  });
  it('uses the shop timezone independently of host timezone', () => {
    expect(localDate(new Date('2026-11-28T01:00:00Z'))).toBe('2026-11-27');
  });
});
describe('booking persistence and conflicts', () => {
  it('rechecks on write, preserves snapshots and persists across store instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoagenda-'));
    try {
      const path = join(dir, 'state.json');
      const store = new LocalStore(path);
      const b = store.book(input, now);
      expect(b.ends_at).toBe('2026-11-27T20:00:00.000Z');
      expect(() => store.book(input, now)).toThrow('não está mais disponível');
      const reload = new LocalStore(path);
      expect(reload.state.bookings).toHaveLength(1);
      reload.state.services[1].price_cents = 70000;
      expect(reload.state.bookings[0].price_cents).toBe(65000);
      expect(() => reload.book({ ...input, starts_at: '2026-11-28T08:00:00-03:00' }, now)).toThrow(
        'preço ou a duração mudou',
      );
      reload.state.bookings[0].status = 'cancelled';
      reload.state.services[1].price_cents = 65000;
      expect(reload.book(input, now).status).toBe('confirmed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects late and non-grid starts and inactive services', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoagenda-'));
    try {
      const store = new LocalStore(join(dir, 'data.json'));
      expect(() => store.book({ ...input, starts_at: '2026-11-27T15:00:00-03:00' }, now)).toThrow();
      expect(() => store.book({ ...input, starts_at: '2026-11-27T13:15:00-03:00' }, now)).toThrow();
      store.state.services[1].active = false;
      expect(() => store.book(input, now)).toThrow('indisponível');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('requires explicit estimate consent and a quote', () => {
    expect(bookingSchema.safeParse({ ...input, accepted_estimate: false }).success).toBe(false);
    expect(bookingSchema.safeParse(input).success).toBe(true);
  });
});
describe('local language interpretation', () => {
  it('reads Brazilian dates as day/month/year and rejects impossible dates', () => {
    const result = parseDemo('polimento 04/12/2026 à tarde', seedServices, '2026-11-21');
    expect(result.date).toBe('2026-12-04');
    expect(result.clarification).toBeNull();
    expect(parseDemo('polimento 31/02/2027', seedServices, '2026-11-21').date).toBeNull();
    expect(parseDemo('polimento', seedServices, '2026-11-21').clarification).toContain(
      '04/12/2026',
    );
  });
  it('maps the requested example to catalog/date/period', () => {
    expect(
      parseDemo('quero fazer um polimento geral sexta à tarde', seedServices, '2026-11-21'),
    ).toEqual({
      service_id: seedServices[1].id,
      date: '2026-11-27',
      period: 'afternoon',
      clarification: null,
    });
  });
  it('asks for clarification for ambiguity, night and missing date', () => {
    for (const text of ['lavagem e polimento amanhã', 'polimento', 'polimento amanhã à noite'])
      expect(parseDemo(text, seedServices, '2026-11-21').clarification).toBeTruthy();
  });
  it('turns an exact time into its period so the server can offer that slot', () => {
    expect(parseDemo('polimento amanhã às 13h', seedServices, '2026-11-21')).toMatchObject({
      date: '2026-11-22',
      period: 'afternoon',
      clarification: null,
    });
    expect(parseDemo('lavagem amanhã 9h', seedServices, '2026-11-21').period).toBe('morning');
  });
  it('does not invent unsupported services or impossible dates', () => {
    expect(parseDemo('trocar óleo sexta', seedServices, '2026-11-21').service_id).toBeNull();
    expect(
      parseDemo('polimento 2026-02-30', seedServices, '2026-11-21').clarification,
    ).toBeTruthy();
  });
});

describe('following weekday', () => {
  it('reads "na outra quarta" and "sem ser nessa, na outra"', () => {
    // 2026-11-21 is a Saturday: next Wednesday is 25/11, the following one 02/12.
    expect(parseDemo('lavagem na outra quarta', seedServices, '2026-11-21').date).toBe(
      '2026-12-02',
    );
    expect(
      parseConversation(
        'sem ser nessa, na outra',
        seedServices,
        [{ role: 'customer', text: 'lavagem quarta' }],
        '2026-11-21',
      ).date,
    ).toBe('2026-12-02');
  });
});

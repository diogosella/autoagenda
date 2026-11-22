import { describe, it, expect } from 'vitest';
import { slots } from '../shared/domain';
import { defaultSettings, settingsSchema } from '../shared/settings';
describe('custom business rules', () => {
  const now = new Date('2026-11-21T08:00:00-03:00');
  it('opens selected Sundays and anchors slots to opening time', () => {
    const result = slots('2026-11-22', 60, [], 'any', now, {
      ...defaultSettings,
      days: [0],
      opens: '09:15',
      closes: '11:00',
      interval: 15,
    });
    expect(result).toHaveLength(4);
    expect(result[0].starts_at).toBe('2026-11-22T12:15:00.000Z');
    expect(slots('2026-11-23', 60, [], 'any', now, { ...defaultSettings, days: [0] })).toEqual([]);
  });
  it('enforces notice and horizon', () => {
    expect(
      slots('2026-11-21', 60, [], 'any', now, { ...defaultSettings, notice_minutes: 120 })[0]
        .starts_at,
    ).toBe('2026-11-21T13:30:00.000Z');
    expect(
      slots('2026-11-24', 60, [], 'any', now, { ...defaultSettings, horizon_days: 2 }),
    ).toEqual([]);
  });
  it('rejects reversed hours, duplicate days and unsupported intervals', () => {
    for (const patch of [{ opens: '19:00' }, { days: [] }, { days: [1, 1] }, { interval: 0 }])
      expect(settingsSchema.safeParse({ ...defaultSettings, ...patch }).success).toBe(false);
  });
});

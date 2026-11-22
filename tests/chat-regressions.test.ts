import { describe, expect, it } from 'vitest';
import { parseConversation } from '../server/intent';
import { seedServices } from '../shared/domain';
import type { ConversationMessage } from '../shared/conversation';
const customer = (text: string): ConversationMessage => ({ role: 'customer', text });
const history = [customer('quero lavar meu carro'), customer('segunda que vem')];
describe('contextual corrections', () => {
  it('preserves the date meaning of an earlier message after midnight', () => {
    const intent = parseConversation(
      'à tarde',
      seedServices,
      [{ ...customer('lavagem amanhã'), sent_at: '2026-11-21T14:00:00.000Z' }],
      '2026-11-22',
    );
    expect(intent).toMatchObject({
      service_id: seedServices[0].id,
      date: '2026-11-22',
      period: 'afternoon',
    });
  });
  it('does not treat greetings as a change of period', () => {
    for (const greeting of ['boa tarde', 'boa noite'])
      expect(
        parseConversation(
          greeting,
          seedServices,
          [customer('lavagem sexta de manhã')],
          '2026-11-21',
        ),
      ).toMatchObject({ service_id: seedServices[0].id, date: '2026-11-27', period: 'morning' });
  });
  it('understands the exact screenshot correction without discarding the wash', () => {
    const intent = parseConversation(
      'quarta feira da semana depois da que vem',
      seedServices,
      history,
      '2026-11-21',
    );
    expect(intent).toMatchObject({
      service_id: seedServices[0].id,
      date: '2026-12-02',
      clarification: null,
    });
  });
  it('distinguishes next week, subsequent week and dates from the current week', () => {
    expect(
      parseConversation('quarta da próxima semana', seedServices, history, '2026-11-21').date,
    ).toBe('2026-11-25');
    expect(
      parseConversation('quarta desta semana', seedServices, history, '2026-11-21').clarification,
    ).toContain('já passou');
  });
  it('retains service and date while changing only the period', () => {
    expect(
      parseConversation('melhor pela parte da tarde', seedServices, history, '2026-11-21'),
    ).toMatchObject({
      service_id: seedServices[0].id,
      date: '2026-11-23',
      period: 'afternoon',
      clarification: null,
    });
  });
  it('uses the positive service in an explicit correction', () => {
    expect(
      parseConversation('não quero polimento, quero lavagem', seedServices, history, '2026-11-21'),
    ).toMatchObject({ service_id: seedServices[0].id, date: '2026-11-23', clarification: null });
  });
  it('keeps context across acknowledgements and long histories', () => {
    expect(
      parseConversation(
        'sexta',
        seedServices,
        [...history, ...Array.from({ length: 25 }, () => customer('obrigado'))],
        '2026-11-21',
      ),
    ).toMatchObject({ service_id: seedServices[0].id, date: '2026-11-27' });
  });
  it('does not confirm bookings and asks for missing day', () => {
    expect(
      parseConversation('confirmo', seedServices, history, '2026-11-21').clarification,
    ).toContain('horário escolhido');
    expect(
      parseConversation('na próxima semana', seedServices, history, '2026-11-21'),
    ).toMatchObject({ service_id: seedServices[0].id, date: null });
  });
});

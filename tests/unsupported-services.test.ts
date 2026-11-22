import { describe, expect, it } from 'vitest';
import { parseDemo } from '../server/intent';
import { seedServices } from '../shared/domain';
describe('unavailable services', () => {
  it.each([
    'quero pintar meu carro',
    'trocar óleo amanhã',
    'vitrificar sexta',
    'trocar a polia amanhã',
  ])('does not substitute an unsupported request: %s', (text) => {
    const result = parseDemo(text, seedServices, '2026-11-21');
    expect(result.service_id).toBeNull();
    expect(result.clarification).toContain('Não encontrei esse serviço no catálogo');
    for (const service of seedServices) expect(result.clarification).toContain(service.name);
    expect(result.clarification).not.toContain('abaixo');
  });
  it('asks which recognized service to book first', () => {
    const result = parseDemo('lavagem e polimento sexta', seedServices, '2026-11-21');
    expect(result.service_id).toBeNull();
    expect(result.clarification).toContain('mais de um serviço');
    expect(result.clarification).toContain('Lavagem detalhada, Polimento geral');
    expect(result.clarification).not.toContain('Higienização interna');
  });
  it('excludes inactive services and handles empty catalogs', () => {
    const services = seedServices.map((s) => ({ ...s, active: s.name !== 'Polimento geral' }));
    const result = parseDemo('polimento sexta', services, '2026-11-21');
    expect(result.service_id).toBeNull();
    expect(result.clarification).not.toContain('Polimento geral');
    expect(parseDemo('polimento', [], '2026-11-21').clarification).toContain(
      'não tem serviços disponíveis',
    );
  });
  it('recognizes a formerly unsupported service when added to the catalog', () => {
    const service = { ...seedServices[0], name: 'Pintura completa' };
    expect(parseDemo('pintura completa sexta', [service], '2026-11-21').service_id).toBe(
      service.id,
    );
  });
});

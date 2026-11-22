import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { settingsSchema, type Settings } from '../shared/settings';
const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
/** Business week order: Monday first, Sunday last. */
const order = [1, 2, 3, 4, 5, 6, 0];
export default function RulesEditor() {
  const [rules, setRules] = useState<Settings>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stored, setStored] = useState('');
  useEffect(() => {
    api<Settings>('/owner/settings')
      .then((r) => {
        setRules(r);
        setStored(JSON.stringify(r));
      })
      .catch((e) => setError(e.message));
  }, []);
  const dirty = Boolean(rules) && JSON.stringify(rules) !== stored;
  function update(p: Partial<Settings>) {
    setRules((r) => (r ? { ...r, ...p } : r));
    setSaved(false);
    setError('');
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaved(false);
    const parsed = settingsSchema.safeParse(rules);
    if (!parsed.success) {
      setError(
        'Confira os horários, selecione ao menos um dia e preencha todos os campos corretamente.',
      );
      return;
    }
    setSaving(true);
    try {
      const result = await api<Settings>('/owner/settings', {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
      });
      setRules(result);
      setStored(JSON.stringify(result));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (!rules)
    return (
      <p className="empty" role="status">
        {error || 'Carregando regras…'}
      </p>
    );
  return (
    <form onSubmit={submit}>
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="settings-grid">
          <section className="setup-card form-stack">
            <h2>Dias e horários</h2>
            <p>Defina o expediente usado para oferecer novas reservas.</p>
            <fieldset className="weekdays">
              <legend>Dias de atendimento</legend>
              {order.map((i) => (
                <label className="checkbox" key={i}>
                  <input
                    type="checkbox"
                    checked={rules.days.includes(i)}
                    onChange={(e) =>
                      update({
                        days: e.target.checked
                          ? [...rules.days, i].sort((a, b) => a - b)
                          : rules.days.filter((d) => d !== i),
                      })
                    }
                  />
                  {days[i]}
                </label>
              ))}
            </fieldset>
            <div className="form-columns">
              <label>
                Abertura
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="08:00"
                  pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                  maxLength={5}
                  title="Horário em formato 24 horas (HH:MM), por exemplo 08:00 ou 18:30"
                  required
                  value={rules.opens}
                  onChange={(e) => update({ opens: e.target.value })}
                />
              </label>
              <label>
                Fechamento
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="18:00"
                  pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                  maxLength={5}
                  title="Horário em formato 24 horas (HH:MM), por exemplo 08:00 ou 18:30"
                  required
                  value={rules.closes}
                  onChange={(e) => update({ closes: e.target.value })}
                />
              </label>
            </div>
            <label>
              Intervalo entre opções de entrada
              <select
                value={rules.interval}
                onChange={(e) =>
                  update({ interval: Number(e.target.value) as Settings['interval'] })
                }
              >
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={60}>1 hora</option>
              </select>
            </label>
            <p>
              Mesmo expediente para os dias selecionados. Horário de Brasília. Capacidade: 1 veículo
              por vez.
            </p>
          </section>
          <section className="setup-card form-stack">
            <h2>Reservas e comunicação</h2>
            <label>
              Antecedência mínima (minutos)
              <input
                type="number"
                min={0}
                max={10080}
                required
                value={rules.notice_minutes}
                onChange={(e) => update({ notice_minutes: e.target.valueAsNumber })}
              />
            </label>
            <label>
              Permitir agendamentos para os próximos (dias)
              <input
                type="number"
                min={1}
                max={180}
                required
                value={rules.horizon_days}
                onChange={(e) => update({ horizon_days: e.target.valueAsNumber })}
              />
            </label>
            <label>
              Aviso sobre a previsão de entrega
              <textarea
                minLength={10}
                maxLength={400}
                required
                value={rules.delivery_notice}
                onChange={(e) => update({ delivery_notice: e.target.value })}
              />
            </label>
            <label>
              Informações para o assistente responder dúvidas
              <textarea
                maxLength={2000}
                rows={6}
                placeholder="Ex.: Endereço: Rua das Flores, 120. Aceitamos Pix e cartão. A lavagem detalhada inclui aspiração, limpeza de painel e pretinho nos pneus."
                value={rules.assistant_info}
                onChange={(e) => update({ assistant_info: e.target.value })}
              />
            </label>
            <p>
              O assistente responde dúvidas só com o catálogo, o expediente e este texto; o que não
              estiver aqui ele encaminha à equipe. O aviso é exibido nas sugestões do assistente.
              Preços vêm do catálogo; horários sobrepostos continuam bloqueados e a reserva exige
              confirmação.
            </p>
          </section>
        </div>
        <div className={`rules-save ${dirty ? 'dirty' : ''}`}>
          <p role="status">
            {error ? (
              <span className="save-error">{error}</span>
            ) : dirty ? (
              'Alterações não salvas. Elas valem para novas reservas; as existentes são preservadas.'
            ) : saved ? (
              'Regras salvas. Os horários oferecidos já foram atualizados.'
            ) : (
              'Tudo salvo. As alterações valem para novas reservas.'
            )}
          </p>
          <div className="save-actions">
            {dirty && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setRules(JSON.parse(stored));
                  setError('');
                }}
              >
                Descartar
              </button>
            )}
            <button className="primary" disabled={saving || !dirty}>
              {saving ? 'Salvando…' : 'Salvar regras'}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}

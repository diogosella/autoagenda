import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Droplets,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  SprayCan,
  Store,
  X,
} from 'lucide-react';
import Workspace, { type Page } from './Workspace';
import { api, authClient, type Config } from './api';
import {
  type Service,
  type Booking,
  type Busy,
  money,
  duration,
  localDate,
  dayLabel,
  addDays,
  clock,
} from '../shared/domain';

const icons = [Droplets, Sparkles, SprayCan, ShieldCheck];
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const weekdayShort = (date: string) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' })
    .format(new Date(`${date}T12:00:00-03:00`))
    .replace('.', '');
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const weekday = (date: string) => new Date(`${date}T12:00:00-03:00`).getUTCDay();
const REFRESH_MS = 30000;

export default function App() {
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Config>('/config')
      .then((c) => {
        authClient(c);
        setConfig(c);
      })
      .catch((e) => setError(e.message));
  }, []);
  return config ? (
    <>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <Workspace
        config={config}
        owner={(go, tab) => <OwnerPage config={config} go={go} initialTab={tab} />}
      />
    </>
  ) : (
    <div className="empty">{error || 'Carregando painel…'}</div>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="modal"
      aria-labelledby="modal-title"
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button onClick={close} aria-label="Fechar">
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function OwnerPage({
  config,
  go,
  initialTab,
}: {
  config: Config;
  go: (page: Page) => void;
  initialTab: 'agenda' | 'services';
}) {
  const [authorized, setAuthorized] = useState(config.mode === 'demo');
  const [data, setData] = useState<{ services: Service[]; bookings: Booking[] }>();
  const [tab, setTab] = useState<'agenda' | 'services'>(initialTab);
  const [date, setDate] = useState(localDate());
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Service | 'new'>();
  const [booking, setBooking] = useState(false);
  const [cancel, setCancel] = useState<Booking>();
  const [working, setWorking] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const load = useCallback(async () => {
    try {
      setData(await api('/owner'));
      setUpdatedAt(new Date());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // Bookings also arrive from the assistant, so the agenda refreshes on its own.
  useEffect(() => {
    if (!authorized) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [authorized, load]);
  useEffect(() => {
    const client = authClient(config);
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setAuthorized(Boolean(data.session)));
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setAuthorized(Boolean(session));
      if (!session) setData(undefined);
    });
    return () => data.subscription.unsubscribe();
  }, [config]);
  async function updateStatus(target: Booking, status: 'completed' | 'cancelled') {
    setWorking(true);
    setError('');
    try {
      await api(`/owner/bookings/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setCancel(undefined);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const active = useMemo(
    () => (data?.bookings || []).filter((b) => b.status !== 'cancelled'),
    [data],
  );
  const dayBookings =
    data?.bookings
      .filter((b) => localDate(new Date(b.starts_at)) === date)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)) || [];
  const dayActive = dayBookings.filter((b) => b.status !== 'cancelled');
  const today = localDate();
  const weekStart = addDays(date, -((weekday(date) + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const countOn = (day: string) =>
    active.filter((b) => localDate(new Date(b.starts_at)) === day).length;
  const upcoming = active
    .filter((b) => b.status === 'confirmed' && Date.parse(b.starts_at) > Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const next = upcoming[0];
  const nextAfter = upcoming.find((b) => localDate(new Date(b.starts_at)) > date);

  if (!authorized)
    return (
      <main className="login-page" id="conteudo">
        <div className="login-card">
          <Store size={32} />
          <h1>Seu estúdio, organizado.</h1>
          <p>Entre com a conta responsável pela loja.</p>
          <Login config={config} />
        </div>
      </main>
    );
  return (
    <main className="owner-page" id="conteudo">
      <div className="page-head">
        <div>
          <h1>Agenda e serviços</h1>
          <p className="page-description">
            {updatedAt
              ? `Atualizada automaticamente · última às ${clock(updatedAt.toISOString())}`
              : 'Carregando…'}
          </p>
        </div>
        <div className="page-actions">
          {config.mode === 'supabase' && (
            <button className="secondary" onClick={() => authClient(config)?.auth.signOut()}>
              <LogOut size={16} aria-hidden="true" /> Sair
            </button>
          )}
          <button
            className="secondary icon-only"
            onClick={() => void load()}
            aria-label="Atualizar agora"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          {tab === 'agenda' ? (
            <button className="primary" onClick={() => setBooking(true)}>
              <CalendarPlus size={17} aria-hidden="true" /> Novo agendamento
            </button>
          ) : (
            <button className="primary" onClick={() => setEditing('new')}>
              <Plus size={17} aria-hidden="true" /> Novo serviço
            </button>
          )}
        </div>
      </div>
      <div className="metrics">
        <div>
          <span>{date === today ? 'Agendamentos hoje' : `Agendamentos em ${shortDate(date)}`}</span>
          <strong>{dayActive.length}</strong>
        </div>
        <div>
          <span>
            {date === today ? 'Valor previsto hoje' : `Valor previsto em ${shortDate(date)}`}
          </span>
          <strong>{money(dayActive.reduce((n, b) => n + b.price_cents, 0))}</strong>
        </div>
        <div>
          <span>Próximo atendimento</span>
          {next ? (
            <button
              className="metric-link"
              aria-label={`Próximo atendimento: ${next.service_name}, ${next.customer_name}, ${capitalize(dayLabel(localDate(new Date(next.starts_at))))} às ${clock(next.starts_at)}. Abrir o dia.`}
              onClick={() => setDate(localDate(new Date(next.starts_at)))}
            >
              <strong>
                {clock(next.starts_at)}{' '}
                <small>
                  {localDate(new Date(next.starts_at)) === today
                    ? 'hoje'
                    : `${weekdayShort(localDate(new Date(next.starts_at)))}, ${shortDate(localDate(new Date(next.starts_at)))}`}
                </small>
              </strong>
              <small className="metric-detail">
                {next.service_name} · {next.customer_name}
              </small>
            </button>
          ) : (
            <strong className="metric-none">Nenhum</strong>
          )}
        </div>
        <div>
          <span>Serviços ativos</span>
          <strong>{data?.services.filter((s) => s.active).length || 0}</strong>
        </div>
      </div>
      <div className="owner-toolbar">
        <div className="tabs" role="tablist" aria-label="Conteúdo">
          <button
            role="tab"
            aria-selected={tab === 'agenda'}
            className={tab === 'agenda' ? 'active' : ''}
            onClick={() => setTab('agenda')}
          >
            <CalendarDays size={17} aria-hidden="true" /> Agenda
          </button>
          <button
            role="tab"
            aria-selected={tab === 'services'}
            className={tab === 'services' ? 'active' : ''}
            onClick={() => setTab('services')}
          >
            <Sparkles size={17} aria-hidden="true" /> Serviços
          </button>
        </div>
        {tab === 'agenda' && (
          <div className="week-nav">
            <button
              className="secondary icon-only"
              onClick={() => setDate(addDays(date, -7))}
              aria-label="Semana anterior"
            >
              <ChevronLeft size={18} />
            </button>
            <button className="secondary" onClick={() => setDate(today)} disabled={date === today}>
              Hoje
            </button>
            <button
              className="secondary icon-only"
              onClick={() => setDate(addDays(date, 7))}
              aria-label="Próxima semana"
            >
              <ChevronRight size={18} />
            </button>
            <label className="date-jump">
              <span className="sr-only">Ir para a data</span>
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error ? (
        <div className="empty">Carregando painel…</div>
      ) : tab === 'agenda' ? (
        <>
          <div className="week-days" role="group" aria-label="Dias da semana">
            {week.map((day) => {
              const count = countOn(day);
              return (
                <button
                  key={day}
                  aria-label={`${weekdayShort(day)}, ${shortDate(day)}${day === today ? ' (hoje)' : ''}: ${count ? `${count} ${count === 1 ? 'reserva' : 'reservas'}` : 'sem reservas'}`}
                  className={`${day === date ? 'selected' : ''} ${day === today ? 'today' : ''}`}
                  aria-pressed={day === date}
                  onClick={() => setDate(day)}
                >
                  <span>{weekdayShort(day)}</span>
                  <strong>{day.slice(8, 10)}</strong>
                  <small aria-hidden="true">
                    <span className="long">
                      {count ? `${count} ${count === 1 ? 'reserva' : 'reservas'}` : 'livre'}
                    </span>
                    <span className="short">{count ? `${count} res.` : 'livre'}</span>
                  </small>
                </button>
              );
            })}
          </div>
          <section className="agenda-list" aria-labelledby="day-title">
            <div className="list-heading">
              <h2 id="day-title">{capitalize(dayLabel(date))}</h2>
              <span>Horário de Brasília</span>
            </div>
            {!dayBookings.length ? (
              <div className="empty owner-empty">
                <CalendarDays size={32} aria-hidden="true" />
                <h3>Nenhum agendamento neste dia</h3>
                <p>
                  Registre um cliente que ligou ou deixe o assistente preencher a agenda pelo
                  WhatsApp.
                </p>
                <div className="empty-actions">
                  <button className="primary" onClick={() => setBooking(true)}>
                    <CalendarPlus size={16} aria-hidden="true" /> Novo agendamento
                  </button>
                  <button className="secondary" onClick={() => go('whatsapp')}>
                    <MessageCircle size={16} aria-hidden="true" /> Testar no simulador
                  </button>
                  {nextAfter && (
                    <button
                      className="text-button"
                      onClick={() => setDate(localDate(new Date(nextAfter.starts_at)))}
                    >
                      Próxima reserva: {weekdayShort(localDate(new Date(nextAfter.starts_at)))},{' '}
                      {shortDate(localDate(new Date(nextAfter.starts_at)))} às{' '}
                      {clock(nextAfter.starts_at)}
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              dayBookings.map((b) => (
                <article key={b.id} className={`booking-row status-${b.status}`}>
                  <div className="booking-time">
                    <strong>{clock(b.starts_at)}</strong>
                    <span>até {clock(b.ends_at)}</span>
                  </div>
                  <div className="booking-person">
                    <h3>{b.service_name}</h3>
                    <p>
                      {b.customer_name} · {b.vehicle}
                    </p>
                    <a href={`tel:${b.phone.replace(/[^+\d]/g, '')}`}>{b.phone}</a>
                  </div>
                  <div className="booking-value">
                    <strong>{money(b.price_cents)}</strong>
                    <span>{duration(b.duration_minutes)} estimadas</span>
                  </div>
                  <span className={`status ${b.status}`}>
                    {
                      { confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' }[
                        b.status
                      ]
                    }
                  </span>
                  {b.status === 'confirmed' && (
                    <div className="row-actions">
                      <button disabled={working} onClick={() => updateStatus(b, 'completed')}>
                        <CheckCircle2 size={16} aria-hidden="true" /> Concluir
                      </button>
                      <button disabled={working} className="danger" onClick={() => setCancel(b)}>
                        Cancelar
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </section>
        </>
      ) : (
        <section className="owner-services" aria-label="Serviços">
          {data?.services.map((s, i) => {
            const Icon = icons[i % icons.length];
            return (
              <article key={s.id}>
                <span className="service-icon">
                  <Icon size={23} aria-hidden="true" />
                </span>
                <div>
                  <h3>
                    {s.name} {!s.active && <span className="tag">Inativo</span>}
                  </h3>
                  <p>{s.description}</p>
                </div>
                <strong>{money(s.price_cents)}</strong>
                <span>{duration(s.duration_minutes)}</span>
                <button className="secondary" onClick={() => setEditing(s)}>
                  <Pencil size={15} aria-hidden="true" /> Editar
                </button>
              </article>
            );
          })}
        </section>
      )}
      {editing && (
        <ServiceEditor
          service={editing}
          close={() => setEditing(undefined)}
          saved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      )}
      {booking && data && (
        <BookingEditor
          services={data.services.filter((s) => s.active)}
          initialDate={date < today ? today : date}
          close={() => setBooking(false)}
          saved={(created) => {
            setBooking(false);
            setTab('agenda');
            setDate(localDate(new Date(created.starts_at)));
            void load();
          }}
        />
      )}
      {cancel && (
        <Modal
          title="Cancelar este agendamento?"
          close={() => {
            if (!working) setCancel(undefined);
          }}
        >
          <p>
            {cancel.customer_name} · {cancel.service_name}
            <br />
            {clock(cancel.starts_at)} — {clock(cancel.ends_at)}
          </p>
          <p>O horário voltará a ficar disponível para novas reservas.</p>
          <div className="modal-actions">
            <button className="secondary" disabled={working} onClick={() => setCancel(undefined)}>
              Voltar
            </button>
            <button
              className="primary"
              disabled={working}
              onClick={() => updateStatus(cancel, 'cancelled')}
            >
              {working ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </main>
  );
}

/** Manual booking for customers who call or walk in; uses the same validated API as the assistant. */
function BookingEditor({
  services,
  initialDate,
  close,
  saved,
}: {
  services: Service[];
  initialDate: string;
  close: () => void;
  saved: (booking: Booking) => void;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [date, setDate] = useState(initialDate);
  const [slots, setSlots] = useState<Busy[]>();
  const [notice, setNotice] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const service = services.find((s) => s.id === serviceId);
  useEffect(() => {
    if (!serviceId || !date) return;
    let current = true;
    setSlots(undefined);
    setStartsAt('');
    api<{ slots: Busy[]; delivery_notice: string }>(
      `/availability?service_id=${serviceId}&date=${date}`,
    )
      .then((r) => {
        if (!current) return;
        setSlots(r.slots);
        setNotice(r.delivery_notice);
        setError('');
      })
      .catch((e) => current && (setSlots([]), setError((e as Error).message)));
    return () => {
      current = false;
    };
  }, [serviceId, date]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!service || !startsAt) {
      setError('Escolha um horário livre.');
      return;
    }
    const f = new FormData(e.currentTarget);
    setSaving(true);
    setError('');
    try {
      const created = await api<Booking>('/bookings', {
        method: 'POST',
        body: JSON.stringify({
          service_id: service.id,
          starts_at: startsAt,
          customer_name: f.get('name'),
          phone: f.get('phone'),
          vehicle: f.get('vehicle'),
          accepted_estimate: true,
          expected_price_cents: service.price_cents,
          expected_duration_minutes: service.duration_minutes,
        }),
      });
      saved(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Novo agendamento" close={() => !saving && close()}>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-columns">
          <label>
            Serviço
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data
            <input
              type="date"
              required
              min={localDate()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <fieldset className="slot-field">
          <legend>Horário de entrada</legend>
          {!slots ? (
            <p className="muted">Consultando horários livres…</p>
          ) : !slots.length ? (
            <p className="muted">
              Sem horários livres neste dia para {service?.name.toLowerCase()}.
            </p>
          ) : (
            <div className="slot-options">
              {slots.map((s) => (
                <label key={s.starts_at} className={startsAt === s.starts_at ? 'chosen' : ''}>
                  <input
                    type="radio"
                    name="slot"
                    value={s.starts_at}
                    checked={startsAt === s.starts_at}
                    onChange={() => setStartsAt(s.starts_at)}
                  />
                  {clock(s.starts_at)}
                  <small>até {clock(s.ends_at)}</small>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <label>
          Nome do cliente
          <input name="name" required minLength={2} maxLength={80} autoComplete="off" />
        </label>
        <div className="form-columns">
          <label>
            Telefone
            <input
              name="phone"
              type="tel"
              required
              inputMode="tel"
              placeholder="(11) 98888-7777"
              pattern="\+?[\d\s()\-]{10,20}"
              title="Telefone com DDD, por exemplo (11) 98888-7777"
            />
          </label>
          <label>
            Veículo
            <input
              name="vehicle"
              required
              minLength={2}
              maxLength={100}
              placeholder="Civic prata"
            />
          </label>
        </div>
        {service && (
          <p className="booking-summary">
            {service.name} · {money(service.price_cents)} · {duration(service.duration_minutes)}
            {startsAt && (
              <>
                <br />
                Entrada {clock(startsAt)} · entrega prevista{' '}
                {clock(
                  new Date(Date.parse(startsAt) + service.duration_minutes * 60000).toISOString(),
                )}
              </>
            )}
            {notice && <small>{notice}</small>}
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={saving || !startsAt}>
          {saving ? 'Agendando…' : 'Confirmar agendamento'}
        </button>
      </form>
    </Modal>
  );
}

function Login({ config }: { config: Config }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setLoading(true);
    setError('');
    try {
      const result = await authClient(config)!.auth.signInWithPassword({
        email: String(f.get('email')),
        password: String(f.get('password')),
      });
      if (result.error) setError('Não foi possível entrar. Confira e-mail e senha.');
    } catch {
      setError('Não foi possível conectar ao Supabase.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        E-mail
        <input type="email" name="email" required autoComplete="username" />
      </label>
      <label>
        Senha
        <input type="password" name="password" required autoComplete="current-password" />
      </label>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <button className="primary" disabled={loading}>
        {loading ? 'Entrando…' : 'Entrar no painel'}
      </button>
    </form>
  );
}

function ServiceEditor({
  service,
  close,
  saved,
}: {
  service: Service | 'new';
  close: () => void;
  saved: () => void;
}) {
  const s = service === 'new' ? undefined : service;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState(s?.description || '');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaving(true);
    setError('');
    try {
      await api('/owner/services', {
        method: 'POST',
        body: JSON.stringify({
          ...(s ? { id: s.id } : {}),
          name: f.get('name'),
          description,
          price_cents: Math.round(Number(f.get('price')) * 100),
          duration_minutes: Number(f.get('duration')),
          active: f.get('active') === 'on',
        }),
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={s ? 'Editar serviço' : 'Novo serviço'}
      close={() => {
        if (!saving) close();
      }}
    >
      <form className="form-stack" onSubmit={submit}>
        <label>
          Nome do serviço
          <input name="name" required minLength={3} maxLength={80} defaultValue={s?.name} />
        </label>
        <label>
          Descrição
          <textarea
            name="description"
            maxLength={240}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-describedby="description-help"
          />
          <small id="description-help" className="field-help">
            O assistente usa este texto para explicar o serviço aos clientes. Diga o que está
            incluído. {description.length}/240
          </small>
        </label>
        <div className="form-columns">
          <label>
            Preço (R$)
            <input
              name="price"
              type="number"
              min="1"
              max="100000"
              step="0.01"
              required
              defaultValue={s ? s.price_cents / 100 : undefined}
            />
          </label>
          <label>
            Duração (minutos)
            <input
              name="duration"
              type="number"
              min="30"
              max="600"
              step="30"
              required
              defaultValue={s?.duration_minutes || 60}
              aria-describedby="duration-help"
            />
            <small id="duration-help" className="field-help">
              Em blocos de 30 minutos, até 10 horas.
            </small>
          </label>
        </div>
        <label className="checkbox">
          <input type="checkbox" name="active" defaultChecked={s?.active ?? true} />
          Disponível para agendamento
        </label>
        <p className="muted">Reservas existentes mantêm o preço e a duração confirmados.</p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar serviço'}
        </button>
      </form>
    </Modal>
  );
}

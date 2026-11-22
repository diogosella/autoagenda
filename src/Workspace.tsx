import {
  chatStateSchema,
  conversationSchema,
  initialChatState,
  type ChatState,
  type ConversationMessage,
} from '../shared/conversation';
import RulesEditor from './RulesEditor';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  CarFront,
  CalendarDays,
  MessageCircle,
  Settings2,
  Send,
  ShieldCheck,
  RotateCcw,
  Pencil,
} from 'lucide-react';
import { api, type Config } from './api';
import {
  type Service,
  money,
  duration,
  dayLabel,
  localDate,
  workDaysLabel,
} from '../shared/domain';
import type { Settings } from '../shared/settings';
import './workspace.css';

export type Page = 'agenda' | 'whatsapp' | 'settings';
const SUGGESTIONS = [
  'Quero um polimento sexta à tarde',
  'Como funciona a lavagem?',
  'Vocês fazem pintura?',
];

export default function Workspace({
  config,
  owner,
}: {
  config: Config;
  owner: (
    go: (page: Page, tab?: 'agenda' | 'services') => void,
    tab: 'agenda' | 'services',
  ) => ReactNode;
}) {
  const [page, setPage] = useState<Page>('agenda');
  const [ownerTab, setOwnerTab] = useState<'agenda' | 'services'>('agenda');
  const go = (target: Page, tab: 'agenda' | 'services' = 'agenda') => {
    setOwnerTab(tab);
    setPage(target);
  };
  const [knowledge, setKnowledge] = useState<{ services: Service[]; rules: Settings }>();
  useEffect(() => {
    if (page !== 'whatsapp') return;
    Promise.all([api<{ services: Service[] }>('/owner'), api<Settings>('/owner/settings')])
      .then(([o, rules]) => setKnowledge({ services: o.services.filter((s) => s.active), rules }))
      .catch(() => setKnowledge(undefined));
  }, [page]);
  const [draft, setDraft] = useState('');
  // The simulator plays a customer writing from this number, as the WhatsApp channel will.
  const [testPhone, setTestPhone] = useState('(11) 98888-7777');
  const storageKey = 'autoagenda-preview-' + config.shop.id;
  const [messages, setMessages] = useState<ConversationMessage[]>(() => {
    try {
      return conversationSchema.parse(JSON.parse(sessionStorage.getItem(storageKey) || '[]'));
    } catch {
      return [];
    }
  });
  const [chatState, setChatState] = useState<ChatState>(() => {
    try {
      return chatStateSchema.parse(
        JSON.parse(sessionStorage.getItem(storageKey + '-state') || '{}'),
      );
    } catch {
      return initialChatState();
    }
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const messageList = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
      sessionStorage.setItem(storageKey + '-state', JSON.stringify(chatState));
    } catch {}
  }, [messages, chatState, storageKey]);
  useEffect(() => {
    messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    if (messages.length >= 98) {
      setError('Esta conversa atingiu o limite. Inicie uma nova conversa para continuar.');
      return;
    }
    setError('');
    setBusy(true);
    const history = messages;
    const sent: ConversationMessage = { role: 'customer', text, sent_at: new Date().toISOString() };
    setMessages([...history, sent]);
    setDraft('');
    try {
      const result = await api<{ message: string; state: ChatState }>('/owner/chat', {
        method: 'POST',
        body: JSON.stringify({ text, history, state: chatState, phone: testPhone }),
      });
      setChatState(result.state);
      setMessages([
        ...history,
        sent,
        { role: 'assistant', text: result.message, sent_at: new Date().toISOString() },
      ]);
    } catch (e) {
      setMessages(history);
      setDraft(text);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }
  function reset() {
    setMessages([]);
    setChatState(initialChatState());
    setError('');
    setDraft('');
    input.current?.focus();
  }

  const nav = [
    { id: 'agenda', label: 'Agenda e serviços', icon: CalendarDays },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { id: 'settings', label: 'Regras de atendimento', icon: Settings2 },
  ] as const;

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <CarFront size={22} />
          </span>
          autoagenda<span className="brand-dot">.</span>
        </div>
        <div className="store-switch">
          <span className="store-monogram" aria-hidden="true">
            SA
          </span>
          <div>
            <strong>{config.shop.name}</strong>
            <small>Estética automotiva</small>
          </div>
        </div>
        <span className="menu-label">Seu negócio</span>
        <nav aria-label="Seções do painel">
          {nav.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'current' : ''}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => go(item.id)}
            >
              <item.icon size={19} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            Um atendimento.
            <br />
            Cada detalhe organizado.
          </span>
        </div>
      </aside>
      <div className="workspace-content">
        <header className="workspace-header">
          <strong className="header-shop">{config.shop.name}</strong>
          <span className="header-date">{dayLabel(localDate())}</span>
        </header>
        {page === 'agenda' ? (
          owner(go, ownerTab)
        ) : page === 'whatsapp' ? (
          <main className="workspace-main" id="conteudo">
            <div className="page-head">
              <div>
                <h1>Atendimento pelo WhatsApp</h1>
                <p className="page-description">
                  Os clientes conversam com o assistente pelo WhatsApp da loja. Use o simulador para
                  testar as respostas antes de mudar serviços ou regras.
                </p>
              </div>
              {config.whatsapp && <span className="chip chip-ok">Respondendo no WhatsApp</span>}
            </div>
            <div className="whatsapp-layout">
              <section className="conversation-preview" aria-labelledby="chat-title">
                <div className="preview-header">
                  <div>
                    <h2 id="chat-title">Simulador de WhatsApp</h2>
                    <p>Ferramenta de teste. Reservas confirmadas aqui entram na agenda.</p>
                    <label className="sim-phone">
                      Número do cliente simulado
                      <input
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                        inputMode="tel"
                        maxLength={25}
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={busy || !messages.length}
                    onClick={reset}
                  >
                    <RotateCcw size={15} aria-hidden="true" /> Nova conversa
                  </button>
                </div>
                <div className="messages" ref={messageList} aria-live="polite">
                  {!messages.length ? (
                    <div className="chat-empty">
                      <MessageCircle size={30} aria-hidden="true" />
                      <h3>Escreva como um cliente no WhatsApp</h3>
                      <p>Pergunte preços, peça um horário ou tire uma dúvida sobre os serviços.</p>
                      <div className="suggestions">
                        {SUGGESTIONS.map((s) => (
                          <button key={s} type="button" onClick={() => void send(s)}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((m, i) => (
                      <div key={i} className={`bubble ${m.role}`}>
                        {m.text}
                      </div>
                    ))
                  )}
                  {busy && (
                    <div className="bubble assistant typing" role="status">
                      <span className="dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      Consultando a agenda…
                    </div>
                  )}
                </div>
                {error && (
                  <p className="inline-error chat-error" role="alert">
                    {error}
                  </p>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(draft);
                  }}
                >
                  <input
                    ref={input}
                    aria-label="Mensagem do cliente"
                    disabled={busy}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Escreva uma mensagem…"
                    maxLength={500}
                  />
                  <button
                    className="primary"
                    disabled={busy || !draft.trim()}
                    aria-label="Enviar mensagem"
                  >
                    <Send size={18} aria-hidden="true" />
                  </button>
                </form>
              </section>
              <aside className="setup-card knowledge-card" aria-labelledby="knowledge-title">
                <h2 id="knowledge-title">O que o assistente sabe</h2>
                <p>Ele responde só com estas informações. Atualize quando algo mudar.</p>
                <h3>Serviços</h3>
                <ul className="knowledge-list">
                  {knowledge?.services.map((s) => (
                    <li key={s.id}>
                      <span>{s.name}</span>
                      <span>
                        {money(s.price_cents)} · {duration(s.duration_minutes)}
                      </span>
                    </li>
                  )) || <li>Carregando…</li>}
                </ul>
                <h3>Atendimento</h3>
                <p className="knowledge-hours">
                  {knowledge
                    ? `${workDaysLabel(knowledge.rules.days)}, das ${knowledge.rules.opens} às ${knowledge.rules.closes}`
                    : 'Carregando…'}
                </p>
                <div className="knowledge-actions">
                  <button className="secondary small" onClick={() => go('agenda', 'services')}>
                    <Pencil size={14} aria-hidden="true" /> Editar serviços
                  </button>
                  <button className="secondary small" onClick={() => go('settings')}>
                    <Settings2 size={14} aria-hidden="true" /> Editar regras
                  </button>
                </div>
              </aside>
            </div>
          </main>
        ) : (
          <main className="workspace-main" id="conteudo">
            <div className="page-head">
              <div>
                <h1>Regras de atendimento</h1>
                <p className="page-description">
                  Dias, horários e informações que o assistente usa para responder e oferecer
                  horários.
                </p>
              </div>
            </div>
            <RulesEditor />
          </main>
        )}
      </div>
    </div>
  );
}

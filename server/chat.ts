import { aiProvider } from './ai.ts';
import { interpret, normalize } from './intent.ts';
import { AppError, createBooking, getBookings, getServices, getSettings } from './store.ts';
import {
  type Busy,
  type Service,
  bookingSchema,
  duration,
  clock,
  dayLabel,
  localDate,
  addDays,
  money,
  slots,
} from '../shared/domain.ts';
import type { Settings } from '../shared/settings.ts';
import {
  type ChatState,
  type ConversationMessage,
  initialChatState,
} from '../shared/conversation.ts';

/** Formats a Brazilian phone typed in any style; null when it is not a valid number. */
export function parsePhone(text: string) {
  let digits = text.replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const local = digits.slice(2);
  return `(${digits.slice(0, 2)}) ${local.slice(0, local.length - 4)}-${local.slice(-4)}`;
}
const MAX_OPTIONS = 3;
const periodWords = { morning: 'de manhã', afternoon: 'à tarde', any: '' } as const;
const ordinals = [/\bprimeir[oa]\b/, /\bsegundo\b|\bsegunda opcao\b/, /\bterceir[oa]\b/];

const pendingStep = {
  name: 'Para continuar a reserva, qual é o seu nome?',
  vehicle: 'Para continuar a reserva, qual é o veículo?',
  phone: 'Para continuar a reserva, qual é o seu telefone com DDD?',
  confirming: 'Posso confirmar a reserva? Responda “sim” ou “não”.',
} as const;
/** Drops a trailing "Quer agendar?" when the conversation already continues with a question. */
const withoutInvite = (answer: string) =>
  answer.replace(/\s*(?:Quer|Gostaria de|Deseja) (?:agendar|marcar)[\s\S]*$/i, '').trim();
const brDate = (date: string) => date.split('-').reverse().join('/');
const optionList = (offered: Busy[]) =>
  offered
    .map((s, i) => `${i + 1}) Entrada ${clock(s.starts_at)} · entrega prevista ${clock(s.ends_at)}`)
    .join('\n');

/** Detects an explicit time such as "13h", "13:30", "às 14" or "14 horas". */
function requestedTime(value: string): string | null {
  const m =
    value.match(/\b([01]?\d|2[0-3])(?:h|:)([0-5]\d)?\b/) ||
    value.match(/\b(?:as|a partir das)\s+([01]?\d|2[0-3])(?:\s*horas?)?\b/) ||
    value.match(/\b([01]?\d|2[0-3])\s*horas?\b/);
  return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : null;
}

/** Picks one of the offered slots by number, ordinal, explicit time or a plain "yes". */
function pickSlot(value: string, state: ChatState, available: Busy[]) {
  const time = requestedTime(value);
  if (time) {
    const slot = available.find((s) => clock(s.starts_at) === time);
    return slot ? { slot } : { missingTime: time };
  }
  const ordinal = ordinals.findIndex((o) => o.test(value));
  const number = value.match(/^(?:(?:a|o|opcao|numero|horario)\s+)*([1-9])[ºª.!)]*\s*(?:opcao)?$/);
  const index = ordinal >= 0 ? ordinal : number ? Number(number[1]) - 1 : -1;
  if (index >= 0) {
    const offered = state.offered[index];
    if (!offered) return { invalidIndex: true };
    const slot = available.find((s) => s.starts_at === offered.starts_at);
    return slot ? { slot } : { gone: true };
  }
  if (
    state.offered.length === 1 &&
    /^(sim|pode ser|pode|esse|este|esse mesmo|quero esse|ok|fechado|beleza)\b/.test(value)
  ) {
    const slot = available.find((s) => s.starts_at === state.offered[0].starts_at);
    return slot ? { slot } : { gone: true };
  }
  return null;
}

const lowerWords = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
function cleanName(text: string) {
  const name = text
    .trim()
    .replace(
      /^(?:meu nome (?:e|é)|me chamo|eu sou (?:o|a)?|sou (?:o|a)?|aqui (?:e|é)(?: o| a)?)\s+/i,
      '',
    )
    .replace(/[.!,;]+$/, '')
    .trim();
  // "joão da silva" → "João da Silva"; names typed with capitals are kept as written.
  if (name !== name.toLowerCase()) return name;
  return name
    .split(/\s+/)
    .map((w, i) => (i > 0 && lowerWords.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
function cleanVehicle(text: string) {
  return text
    .trim()
    .replace(
      /^(?:(?:o |meu )?(?:carro|veiculo|veículo) (?:e|é)(?: um| uma)?|(?:e|é) (?:um|uma)|tenho (?:um|uma)|um|uma)\s+/i,
      '',
    )
    .replace(/[.!,;]+$/, '')
    .trim();
}

export async function chat(
  text: string,
  history: ConversationMessage[],
  previous: ChatState = initialChatState(),
  /** Sender's number when the channel knows it (WhatsApp); otherwise the assistant asks. */
  channelPhone?: string,
) {
  const services = (await getServices()).filter((s) => s.active);
  const rules = await getSettings();
  const value = normalize(text).trim();
  let state: ChatState = { ...previous };
  const mode = aiProvider() === 'demo' ? 'local' : 'ai';
  const reply = (message: string, extra: Record<string, unknown> = {}) => ({
    message,
    state,
    mode,
    intent: null as unknown,
    ...extra,
  });
  // Index of the message after this turn (this customer message + the reply).
  const nextTurn = history.length + 2;
  const fresh = (context_from: number): ChatState => ({ ...initialChatState(), context_from });

  if (/^(?:recomecar|reiniciar|nova conversa|comecar de novo)[.!?]*$/.test(value)) {
    state = fresh(nextTurn);
    return reply('Claro! Qual serviço você procura?');
  }
  if (
    state.stage !== 'collecting' &&
    state.stage !== 'booked' &&
    /^(?:cancelar|cancela|desisto|desistir|deixa pra la|nao quero mais)\b/.test(value)
  ) {
    state = fresh(nextTurn);
    return reply('Tudo bem, não reservei nada. Se quiser, me diga outro serviço ou dia.');
  }
  // A finished booking starts a new request with this message.
  if (state.stage === 'booked') state = fresh(history.length);

  const service = services.find((s) => s.id === state.service_id);
  const available = () =>
    service && state.date ? freeSlots(state.date, service, rules) : Promise.resolve([]);

  if (state.stage === 'choosing' && service && state.date) {
    const current = await available();
    const pick = pickSlot(value, state, current);
    if (pick && 'slot' in pick && pick.slot) {
      if (state.customer_name && state.vehicle && state.phone) {
        state = { ...state, stage: 'confirming', chosen: pick.slot };
        return reply(summary(state, service, rules));
      }
      state = { ...state, stage: 'name', chosen: pick.slot };
      return reply(
        `Ótimo: entrada às ${clock(pick.slot.starts_at)}, entrega prevista às ${clock(pick.slot.ends_at)}. Para reservar, qual é o seu nome?`,
      );
    }
    if (pick && 'missingTime' in pick)
      return offer(current, `Às ${pick.missingTime} não tenho horário livre nesse dia.`);
    if (pick && 'gone' in pick) return offer(current, 'Esse horário acabou de ser ocupado.');
    if (pick && 'invalidIndex' in pick)
      return reply(
        `Escolha uma das opções de 1 a ${state.offered.length}.\n\n${optionList(state.offered)}`,
      );
    // Anything else is a change of service, day or period: interpret it from the current request.
    state = { ...state, stage: 'collecting', context_from: history.length, base: baseOf(state) };
  }

  // A question in the middle of the booking is answered, then the pending step is asked again.
  if (
    (state.stage === 'name' ||
      state.stage === 'vehicle' ||
      state.stage === 'phone' ||
      state.stage === 'confirming') &&
    text.includes('?')
  ) {
    const base = baseOf(state);
    const asked = await interpret(
      text,
      services,
      base ? [baseMessage(base, services)].filter((m) => m !== null) : [],
      rules,
    );
    if (asked.answer) return reply(`${withoutInvite(asked.answer)}\n\n${pendingStep[state.stage]}`);
  }

  if (state.stage === 'name') {
    const name = cleanName(text);
    if (name.length < 2 || name.length > 80 || /\d{3,}/.test(name))
      return reply('Pode me dizer seu nome para a reserva?');
    state = { ...state, stage: 'vehicle', customer_name: name };
    return reply(`Obrigado, ${name}! Qual é o veículo? Por exemplo: “Civic prata”.`);
  }

  if (state.stage === 'vehicle') {
    const vehicle = cleanVehicle(text);
    if (vehicle.length < 2 || vehicle.length > 100)
      return reply('Qual é o modelo do veículo? Por exemplo: “Civic prata”.');
    const known = state.phone || (channelPhone && parsePhone(channelPhone));
    if (!known) {
      state = { ...state, stage: 'phone', vehicle };
      return reply('Qual é o seu telefone com DDD? Assim a loja consegue falar com você.');
    }
    state = { ...state, stage: 'confirming', vehicle, phone: known };
    return reply(summary(state, service, rules));
  }

  if (state.stage === 'phone') {
    const phone = parsePhone(text);
    if (!phone) return reply('Pode me passar o telefone com DDD? Por exemplo: (11) 98888-7777.');
    state = { ...state, stage: 'confirming', phone };
    return reply(summary(state, service, rules));
  }

  if (state.stage === 'confirming') {
    if (/^(?:nao|n)\b/.test(value)) {
      state = { ...state, chosen: null };
      return offer(await available(), 'Sem problema, não reservei.');
    }
    if (
      !/^(?:sim|s|pode|confirmo|confirmar|confirma|isso|ok|fechado|claro|beleza|pode confirmar)\b/.test(
        value,
      )
    )
      return reply('Responda “sim” para confirmar a reserva ou “não” para escolher outro horário.');
    if (!service || !state.chosen) {
      state = fresh(nextTurn);
      return reply('Esse serviço não está mais disponível. Qual serviço você procura?');
    }
    try {
      const booking = await createBooking(
        bookingSchema.parse({
          service_id: service.id,
          starts_at: state.chosen.starts_at,
          customer_name: state.customer_name,
          phone: state.phone,
          vehicle: state.vehicle,
          accepted_estimate: true,
          expected_price_cents: state.price_cents,
          expected_duration_minutes: state.duration_minutes,
        }),
      );
      const chosen = state.chosen;
      state = { ...state, stage: 'booked', booking_id: booking.id };
      return reply(
        `Pronto, reserva confirmada! ${service.name} para ${dayLabel(state.date!)}, entrada às ${clock(chosen.starts_at)} e entrega prevista às ${clock(chosen.ends_at)}. Até lá, ${state.customer_name}!`,
        { booking },
      );
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 409) throw error;
      state = { ...state, chosen: null };
      return offer(
        await available(),
        'O horário ou o valor mudou antes da confirmação, então não reservei.',
      );
    }
  }

  // Collecting: let the interpreter read the current request.
  const context: ConversationMessage[] = [
    ...(state.base ? [baseMessage(state.base, services)].filter((m) => m !== null) : []),
    ...history.slice(state.context_from),
  ];
  const intent = await interpret(text, services, context, rules);
  const extra = { intent };
  state = { ...state, service_id: intent.service_id, date: intent.date, period: intent.period };
  // A question is answered; with service and day already known, the slots follow the answer.
  // "quais dias disponíveis para polimento?": answer from the agenda, not with a description.
  const askedService = services.find((s) => s.id === intent.service_id);
  if (
    askedService &&
    !intent.date &&
    /disponi|livres?\b|\bvagas?\b|\bquando\b|quais dias|que dias|tem horario|proximos? horarios?|quais horarios|que horarios/.test(
      value,
    )
  ) {
    const days: { date: string; first: Busy; count: number }[] = [];
    const last = addDays(localDate(), rules.horizon_days);
    for (
      let d = localDate();
      d <= last && d <= addDays(localDate(), 21) && days.length < 5;
      d = addDays(d, 1)
    ) {
      const list = await freeSlots(d, askedService, rules, intent.period);
      if (list.length) days.push({ date: d, first: list[0], count: list.length });
    }
    state = {
      ...state,
      stage: 'collecting',
      price_cents: askedService.price_cents,
      duration_minutes: askedService.duration_minutes,
    };
    if (!days.length)
      return reply(
        `Não encontrei horários livres para ${askedService.name.toLowerCase()} nas próximas três semanas. Prefere outro serviço?`,
        extra,
      );
    const lines = days
      .map(
        (d) =>
          `• ${dayLabel(d.date).charAt(0).toUpperCase() + dayLabel(d.date).slice(1)}: a partir das ${clock(d.first.starts_at)}${d.count > 1 ? ` (${d.count} horários)` : ''}`,
      )
      .join('\n');
    return reply(
      `${askedService.name} · ${money(askedService.price_cents)} · cerca de ${duration(askedService.duration_minutes)}\n\nPróximos dias com horário livre${intent.period !== 'any' ? ` ${periodWords[intent.period]}` : ''}:\n${lines}\n\n${rules.delivery_notice}\n\nQual dia prefere?`,
      extra,
    );
  }

  // With service and day known, the slot list itself answers; the model's text is not needed.
  if (intent.answer && (!intent.service_id || !intent.date)) return reply(intent.answer, extra);
  const lead = '';
  if (intent.clarification) return reply(intent.clarification, extra);
  const chosenService = services.find((s) => s.id === intent.service_id);
  if (!chosenService) return reply('Qual serviço você gostaria de agendar?', extra);
  if (!intent.date)
    return reply(
      `Para qual dia você gostaria de agendar ${chosenService.name.toLowerCase()}?`,
      extra,
    );
  if (intent.date > addDays(localDate(), rules.horizon_days))
    return reply(
      `A loja aceita reservas para os próximos ${rules.horizon_days} dias. Qual data nesse período funciona para você?`,
      extra,
    );
  const options = await freeSlots(intent.date, chosenService, rules, intent.period);
  state = {
    ...state,
    price_cents: chosenService.price_cents,
    duration_minutes: chosenService.duration_minutes,
  };
  if (!options.length) {
    // A full day is not a dead end: offer the same day in another period, or the next day with room.
    const day = intent.date;
    const article = [0, 6].includes(new Date(`${day}T12:00:00-03:00`).getUTCDay()) ? 'no' : 'na';
    const full = `Não tenho horário livre para ${chosenService.name.toLowerCase()} ${article} ${dayLabel(day)}${intent.period !== 'any' ? `, ${periodWords[intent.period]}` : ''}.`;
    if (intent.period !== 'any') {
      const sameDay = await freeSlots(day, chosenService, rules, 'any');
      if (sameDay.length) {
        state = { ...state, period: 'any' };
        return { ...offer(sameDay, `${full} No mesmo dia, tenho:`), ...extra };
      }
    }
    const last = addDays(localDate(), rules.horizon_days);
    for (
      let next = addDays(day, 1);
      next <= last && next <= addDays(day, 14);
      next = addDays(next, 1)
    ) {
      const list = await freeSlots(next, chosenService, rules, intent.period);
      if (list.length) {
        state = { ...state, date: next };
        return { ...offer(list, `${full} O próximo dia com horário livre é:`), ...extra };
      }
    }
    return reply(`${full} Não há vagas nas próximas duas semanas. Prefere outro serviço?`, extra);
  }
  // "polimento sexta às 13h" jumps straight to the customer's details when 13h is free.
  const time = requestedTime(value);
  const direct = time && options.find((s) => clock(s.starts_at) === time);
  if (direct) {
    state = { ...state, stage: 'name', offered: [direct], chosen: direct };
    return reply(
      `${lead}${chosenService.name} · ${money(chosenService.price_cents)}\n${dayLabel(intent.date)}, entrada às ${clock(direct.starts_at)} e entrega prevista às ${clock(direct.ends_at)}.\n\nPara reservar, qual é o seu nome?`,
      extra,
    );
  }
  return {
    ...offer(
      options,
      (lead + (time ? `Às ${time} não tenho horário livre nesse dia.` : '')).trim(),
    ),
    ...extra,
  };

  function offer(list: Busy[], prefix: string) {
    const s = services.find((x) => x.id === state.service_id);
    if (!s || !state.date) {
      state = fresh(nextTurn);
      return reply(`${prefix} Qual serviço você procura?`.trim());
    }
    if (!list.length) {
      state = {
        ...state,
        stage: 'collecting',
        offered: [],
        chosen: null,
        context_from: nextTurn,
        base: baseOf(state),
      };
      return reply(
        `${prefix} Não há mais horários livres em ${dayLabel(state.date!)}. Prefere outro dia ou período?`.trim(),
      );
    }
    const offered = list.slice(0, MAX_OPTIONS);
    state = {
      ...state,
      stage: 'choosing',
      offered,
      chosen: null,
      price_cents: s.price_cents,
      duration_minutes: s.duration_minutes,
    };
    return reply(
      `${prefix ? prefix + '\n\n' : ''}${s.name} · ${money(s.price_cents)}\n${dayLabel(state.date!)}\n\n${optionList(offered)}\n\n${rules.delivery_notice}\n\nQual horário prefere? Responda com o número da opção ou peça outro dia ou período.`,
    );
  }
}

async function freeSlots(
  date: string,
  service: Service,
  rules: Settings,
  period: 'morning' | 'afternoon' | 'any' = 'any',
) {
  const bookings = (await getBookings()).filter((b) => b.status !== 'cancelled');
  return slots(date, service.duration_minutes, bookings, period, new Date(), rules);
}
function baseOf(state: ChatState): ChatState['base'] {
  return state.service_id
    ? { service_id: state.service_id, date: state.date, period: state.period }
    : null;
}
/** Summarises the request already resolved, so earlier name/vehicle answers are not reinterpreted. */
function baseMessage(base: NonNullable<ChatState['base']>, services: Service[]) {
  const service = services.find((s) => s.id === base.service_id);
  if (!service) return null;
  return {
    role: 'customer' as const,
    text: [service.name, base.date && brDate(base.date), periodWords[base.period]]
      .filter(Boolean)
      .join(' '),
  };
}
function summary(state: ChatState, service: Service | undefined, rules: Settings) {
  const chosen = state.chosen!;
  return `Confira a reserva:\n\n${service?.name} · ${money(state.price_cents || 0)}\n${dayLabel(state.date!)}\nEntrada ${clock(chosen.starts_at)} · entrega prevista ${clock(chosen.ends_at)}\nCliente: ${state.customer_name} · ${state.phone}\nVeículo: ${state.vehicle}\n\n${rules.delivery_notice}\n\nPosso confirmar? Responda “sim” para reservar ou “não” para escolher outro horário.`;
}

# Autoagenda — painel da loja

## Conversa contextual

A prévia utiliza POST /api/owner/chat, protegido pela mesma autenticação do painel. O servidor interpreta o histórico, valida o catálogo e as regras e monta a resposta com preços e horários reais. O frontend não decide a disponibilidade.

Com OPENAI_API_KEY no .env, a Responses API interpreta o histórico completo, descrições do catálogo, correções e negações com saída estruturada. Sem chave, há um modo local limitado, identificado na interface: ele atualiza serviço, data e período por campos e suporta expressões comuns, mas não substitui compreensão por um modelo. Falhas da API não acionam uma simulação silenciosa.

O histórico fica no sessionStorage desta aba (sobrevive ao recarregamento, não é histórico permanente de clientes). Cada mensagem nova registra sua data para preservar o sentido de datas relativas após meia-noite. Nova conversa limpa esse contexto. O limite é 100 mensagens, sem descarte silencioso do início. Mensagens antigas anteriores à atualização não possuem data de referência: inicie uma nova conversa para testar datas relativas.

### Reserva dentro da conversa

O chat leva o cliente até a reserva: o assistente oferece até três horários numerados; o cliente responde com o número, a ordem (“o segundo”) ou o horário (“às 13h”); o assistente pede nome e veículo, mostra o resumo com preço, entrada, entrega prevista e aviso de entrega, e só reserva após um “sim”. “Não” volta às opções; “cancelar” abandona o pedido; pedir outro dia, período ou serviço refaz a consulta mantendo o resto. Um horário livre pedido direto (“polimento sexta às 13h”) pula a lista.

A reserva passa pela mesma validação do agendamento manual (disponibilidade, expediente, preço e duração cotados); um conflito devolve novas opções. O progresso fica num estado (`state`) que o servidor devolve a cada resposta e o navegador guarda junto do histórico; nada nele é confiado sem nova verificação. No WhatsApp, esse estado e o histórico ficarão no servidor, por número de telefone, e a mesma função `chat()` será usada. O telefone vem do próprio WhatsApp; no chat do painel, o assistente pede o telefone com DDD antes do resumo. Depois de um “não”, ao escolher outro horário, nome, veículo e telefone já informados são reaproveitados.

### Dúvidas do cliente

O assistente também responde perguntas (“como funciona a lavagem?”, “quanto tempo demora?”, “aceitam Pix?”) usando somente o catálogo (descrição, preço, duração), o expediente e o texto **Informações para o assistente**, editável em Atendimento. O modelo recebe os serviços por códigos curtos (S1, S2…), nunca pelos IDs do banco. O servidor confere a resposta: preços que não existem no catálogo, códigos internos ou afirmações de reserva fazem a resposta ser trocada por uma descrição montada a partir do catálogo. Depois da explicação, o serviço fica selecionado para o agendamento; uma pergunta no meio da reserva é respondida e a etapa pendente é repetida. Sem IA, o modo local responde com a descrição do catálogo.

A prévia não envia mensagens ao WhatsApp. A integração real com o canal continua pendente.

## Direção atual do produto

A interface web é exclusiva para a loja. O atendimento ao cliente será pelo WhatsApp. A aplicação abre no painel administrativo com agenda, catálogo, área WhatsApp e regras de atendimento. A antiga página pública de agendamento foi removida.

A área WhatsApp possui uma prévia de conversa que consulta o catálogo e a disponibilidade reais e cria reservas na agenda após confirmação. Ela não envia mensagens. Sem chave OpenAI, usa palavras-chave e informa essa condição. A conexão WhatsApp permanece explicitamente desconectada.

**Ainda pendentes:** webhook verificado da Meta, envio pela Cloud API, histórico persistente de conversas, transferência para atendente. As regras podem ser editadas em Atendimento: dias, abertura/fechamento, intervalo, antecedência, horizonte e aviso de entrega. Capacidade permanece 1 veículo, com fuso de Brasília. Para Supabase existente, aplique também a migração 202611210002_settings.sql. Não existe integração WhatsApp ativa nem cobrança de assinatura implementada.

O painel preserva os serviços e reservas existentes. O backend de reservas e sua proteção contra conflitos continuam disponíveis.

Plataforma de gestão de agendamentos para estética automotiva, em **React + TypeScript + Supabase**, com uma API Node/Express local. A loja de exemplo é o **Studio Auto**, com um veículo por vez, por padrão segunda a sábado, das 08h às 18h, em `America/Sao_Paulo`.

## Executar localmente

Requisito: Node.js 22.12+ (ou 24/26) e npm.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Acesse http://127.0.0.1:5173. API em http://127.0.0.1:3001.

Sem credenciais, funciona como **demonstração local**, persistindo serviços e reservas em `.data/demo.json`. O painel fica aberto nesse modo, identificado na interface. Não há necessidade de conta, Docker, Supabase ou chave de IA para experimentar o fluxo. Execute apenas uma instância da API no modo JSON; sua exclusão de conflitos é garantida pelo processamento síncrono das gravações dentro desse processo. Para múltiplas instâncias, use Supabase.

```powershell
npm test
npm run build
npm start
```

Após o build, `npm start` serve API e frontend em http://127.0.0.1:3001. `npm run dev` usa recarga automática. Os servidores escutam apenas em loopback; este projeto ainda não é uma implantação pública.

## O que está implementado

- Catálogo de serviços com preço em centavos, descrição e duração em blocos de 30 minutos.
- Agenda manual com data, período e horários que comportam **a duração inteira** até o fechamento.
- Revisão com preço, entrada, entrega prevista, identificação do cliente/veículo e aceite obrigatório da estimativa.
- Confirmação com nova validação de disponibilidade no servidor. A chegada exatamente no término de outra reserva é permitida.
- Proteção contra preço ou duração alterados entre a consulta e a confirmação: o cliente deve revisar novamente.
- Painel diário, cadastro/edição e ativação/inativação de serviços, conclusão e cancelamento de reservas. Cancelar libera o horário; concluir conserva o histórico e seu intervalo.
- Preço, nome e duração do serviço são preservados na reserva, independentemente de alterações posteriores no catálogo.
- Interpretação de linguagem natural, seguida pelo **mesmo fluxo manual de disponibilidade e confirmação**. A interpretação nunca confirma uma reserva.

No modo local, `quero fazer um polimento geral sexta à tarde` é interpretado por regras explícitas de palavras-chave — **não é uma chamada a um modelo de IA**. A tela informa essa limitação. Serviços personalizados são reconhecidos pelo nome completo. Pedidos ambíguos ou sem data pedem esclarecimento. Dias da semana significam a próxima ocorrência a partir de amanhã; manhã/tarde se referem ao início do serviço, com tarde a partir das 12h. A entrega pode ocorrer no mesmo dia até as 18h. Não há serviços atravessando dias, feriados, pausas, pagamentos ou notificações nesta versão.

## Supabase local ou remoto

O mesmo código possui um adaptador Supabase real. O modo JSON é uma alternativa para o primeiro uso, e seus dados **não são migrados automaticamente** para o banco.

### Supabase local

Com Docker e Supabase CLI instalados:

```powershell
supabase start
supabase db reset
supabase status
```

`db reset` apaga e recria **o banco Supabase local**; use somente no ambiente de desenvolvimento. As migrações e o seed criam a loja e quatro serviços. Copie a URL local, a chave `anon` e a chave `service_role` apresentadas pelo CLI para o `.env`:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SHOP_ID=10000000-0000-4000-8000-000000000001
```

Reinicie `npm run dev`. Para um projeto Supabase remoto vazio, execute primeiro `supabase/migrations/202611210001_initial.sql` e depois `supabase/seed.sql` no SQL Editor e use as credenciais desse projeto.

### Conta do responsável

Crie um usuário com e-mail confirmado pelo painel Auth do Supabase (Studio no ambiente local). Vincule seu ID à loja usando o SQL Editor:

```sql
insert into public.shop_members(shop_id, user_id)
values ('10000000-0000-4000-8000-000000000001', 'UUID-REAL-DO-USUARIO');
```

O painel passa a exigir login por e-mail e senha. A API verifica o JWT com Supabase Auth e a participação na loja para cada operação administrativa. Clientes fazem reservas sem criar conta. A API responde disponibilidade sem nomes, telefones ou veículos de outras pessoas.

RLS está habilitado em todas as tabelas e os clientes `anon`/`authenticated` não têm acesso direto. A API usa a chave `service_role` exclusivamente no servidor. Não prefixe nenhuma chave privada com `VITE_` e não a coloque no frontend ou no Git. A função SQL `book_service` valida catálogo, horário, expediente e orçamento em uma transação. A restrição PostgreSQL `EXCLUDE` bloqueia sobreposições concorrentes por `shop_id`, inclusive entre instâncias diferentes da API.

As tabelas já distinguem lojas por `shop_id`; nesta primeira versão, cada instância seleciona uma loja via `SHOP_ID`. Provisionamento de novas lojas, seleção pública por URL e múltiplos usuários no frontend ficam para a próxima fase SaaS.

## Ativar IA real

No `.env` do servidor:

```dotenv
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
```

Reinicie a API. A interface passa a indicar **COM IA**. A integração utiliza a Responses API com JSON Schema estrito, valida novamente a resposta com Zod e confere o ID do serviço e a data. São enviados ao modelo o histórico da conversa, o catálogo e o calendário dos próximos dias. Nome e veículo da reserva são coletados pelo servidor e não passam pela interpretação. Evite dados pessoais no pedido em texto livre. Chamadas reais podem gerar custo na conta de API configurada. Em falhas do provedor, o usuário pode continuar manualmente; não há simulação silenciosa de IA real.

## Estrutura

```text
src/                 Interface React e cliente HTTP
shared/domain.ts     Tipos, validações, fuso horário e cálculo de intervalos
server/app.ts        Rotas HTTP, autorização e validação de entrada
server/store.ts      Adaptadores JSON local / Supabase
server/intent.ts     Intérprete por regras e integração OpenAI
supabase/            Configuração local, migração e dados de exemplo
tests/               Regras de agenda e integração HTTP concorrente
```

As rotas públicas são `GET /api/config`, `GET /api/services`, `GET /api/availability`, `POST /api/interpret` e `POST /api/bookings`. Rotas administrativas começam em `/api/owner`. O servidor limita tamanho de corpo, valida entradas, restringe origens de navegador e limita operações de escrita por IP/rota. Esses controles são do MVP local; uma implantação pública precisa de TLS, limite distribuído, proteção antiabuso nas reservas e política de retenção de dados.

## Referências técnicas

- [Intervalos e restrições de exclusão no PostgreSQL](https://www.postgresql.org/docs/17/rangetypes.html#RANGETYPES-CONSTRAINT)
- [Row Level Security no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Structured Outputs na API OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs)

Nenhum repositório remoto ou publicação é necessário nesta etapa. `.env`, `.data`, dependências e build estão no `.gitignore`; `package-lock.json` deve ser versionado junto ao código quando você criar o repositório.

### IA local com Ollama

Execute `ollama pull qwen3:4b` e mantenha o Ollama aberto. Configure no `.env`: `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434` e `OLLAMA_MODEL=qwen3:4b`. Reinicie `npm run dev`. O painel mostra “IA local · Ollama”. Não é necessária chave de API. O histórico e o catálogo são enviados ao modelo local; o servidor valida a resposta e consulta a agenda. Falhas são exibidas sem substituir silenciosamente a IA por regras. Ao iniciar, a API carrega o modelo na memória (`keep_alive` de 30 minutos), e o terminal mostra se o Ollama respondeu. Esta prévia não envia WhatsApp.

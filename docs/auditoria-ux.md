# Autoagenda — Auditoria de UX/UI

Escopo: painel da loja (Agenda, Serviços, editor de serviço, WhatsApp/chat, Atendimento) · modo local com IA Ollama · viewports 1366×768 (notebook) e 390×844 (celular) · 21/11/2026.

Método: scripts de medição no navegador (contraste, alvos de toque, nomes acessíveis, estrutura, heurísticas de Hick/Fitts, consistência visual, foco), capturas de tela em cada tela e leitura de todos os textos. Acessibilidade julgada pela WCAG 2.2 AA; usabilidade pelas heurísticas de Nielsen. A escala de gravidade e a ordem impacto ÷ esforço são critérios desta auditoria, não normas.

## Resumo

| Gravidade | Qtd. |
|---|---|
| Crítico | 0 |
| Maior | 7 |
| Acessibilidade | 3 |
| Nota | 6 |

O fluxo principal funciona de ponta a ponta e a base de acessibilidade é boa (ver "O que funciona"). Os problemas mais caros são de **prioridade visual**: o chat do assistente, que é a demonstração do produto, fica abaixo da dobra; a lista da agenda começa no fim da primeira tela do celular; e o dono da loja não consegue registrar um agendamento feito por telefone.

## Achados

### 01 · Maior · WhatsApp — o campo do chat fica abaixo da dobra
A conversa com o assistente é a função central do produto, mas em um notebook comum é preciso rolar para digitar. No celular, o chat começa depois de 1,4 tela de rolagem.
```
1366×768: campo de mensagem em y = 859–937 px (tela termina em 768)
          área de mensagens: 340 px de altura
390×844:  chat começa em y = 1148 px; campo em y = 1620 px
```
CORREÇÃO: layout com o chat em primeiro lugar, altura ajustada à janela, status "Não conectado" no cabeçalho e passos da Meta numa coluna lateral.

### 02 · Maior · Agenda — a lista de agendamentos começa no fim da primeira tela
Cabeçalho decorativo, quatro cartões e a barra de ferramentas ocupam a tela antes da agenda.
```
390×844:  título da lista em y ≈ 775 px (92% da primeira tela antes da lista)
1366×768: lista começa em y ≈ 490 px
Faixa superior (0–120 px): único conteúdo é "STUDIO AUTO · GESTÃO"
```
CORREÇÃO: cabeçalho compacto, cartões menores e troca do cartão estático "Capacidade da loja · 1 veículo por vez" por "Próximo atendimento".

### 03 · Maior · Agenda — não é possível registrar um agendamento pelo painel
Cliente que liga ou aparece na loja não pode ser agendado pelo dono. A única forma de criar reserva é o chat, embora a API `POST /api/bookings`, com toda a validação, já exista.
```
Ações na aba Agenda: "Atualizar", "Concluir", "Cancelar" — nenhuma cria reserva
```
CORREÇÃO: botão "Novo agendamento" com serviço, data, horários livres reais, cliente e veículo.

### 04 · Maior · Agenda — navegar entre dias exige o seletor nativo, que aparece em formato americano
Não há "hoje", "anterior" ou "próximo", nem visão dos dias com reservas. Os ícones `ChevronLeft`/`ChevronRight` são importados em `App.tsx`, mas não são usados.
```
Campo de data renderizado: "11/21/2026" (navegador em inglês)
Visão disponível: um único dia
```
CORREÇÃO: faixa da semana com contagem de reservas por dia, botões ‹ Hoje › e o seletor mantido para saltos longos.

### 05 · Maior · Agenda — estado vazio sem saída
```
"Espaço para novos cuidados." / "Nenhum agendamento para este dia."
```
Nenhuma ação a partir daqui. CORREÇÃO: botões "Novo agendamento" e "Testar o assistente", além de um atalho para o próximo dia com reserva.

### 06 · Maior · Agenda — reservas feitas pelo chat só aparecem depois de "Atualizar"
Com o WhatsApp ativo, as reservas vão chegar sem o dono estar olhando. A lista só recarrega ao clicar em "Atualizar" ou trocar de aba.
CORREÇÃO: atualizar a cada 30 s e quando a janela volta ao foco.

### 07 · Maior · Atendimento — botão de salvar fora da tela e sem aviso de alteração pendente
```
Altura da página: 1067 px (1,4 tela); "Salvar regras" só no fim
Elementos interativos na primeira tela: 18 (índice de Hick 4,25)
```
CORREÇÃO: barra de salvar fixa, com o texto "Alterações não salvas".

### 08 · Acessibilidade 1.4.3 · Várias telas — texto secundário abaixo de 4,5:1
```
"Serviços" (aba inativa)             rgb(145,145,145) / rgb(247,247,249)  2,95:1
"Horários de Brasília"               rgb(146,146,146) / branco            3,11:1
"Nenhum agendamento para este dia."  rgb(145,145,145) / branco            3,15:1
"1h 30min", "4h"… (duração)          3,23:1
"Acesso local · Nesta máquina" 12px  3,42:1
"IA local · Ollama · sem envio…" 12px 3,51:1
"Reservas confirmadas aqui…" 11px     3,51:1
+ 8 textos entre 4,13 e 4,44:1 (WhatsApp e Atendimento)
```
CORREÇÃO: um único token de texto secundário `#5f5f68` (≥ 5,9:1 em branco e ≥ 5,6:1 no cinza de fundo).

### 09 · Acessibilidade 1.3.1 · Atendimento — dias da semana sem rótulo de grupo
Sete caixas soltas ("Domingo"…"Sábado") sem `fieldset`/`legend`. O leitor de tela anuncia "Segunda, caixa de seleção" sem dizer que se trata dos dias de atendimento. A ordem começa no domingo e alterna em duas colunas.
CORREÇÃO: `fieldset` com a legenda "Dias de atendimento", de segunda a domingo.

### 10 · Acessibilidade 1.4.12 / legibilidade · Barra lateral — rótulo com 10 px
```
"SEU NEGÓCIO" 10px; "ATENDIMENTO AUTOMATIZADO" 11px
```
CORREÇÃO: mínimo de 12 px.

### 11 · Nota · Agenda — "Sábado, 21 De Novembro"
`text-transform: capitalize` (styles.css, `.list-heading h2`) põe "De" em maiúscula, contra a norma do português. A mesma tela usa caixa de frase em todos os outros títulos.
CORREÇÃO: só a primeira letra maiúscula, feita no código.

### 12 · Nota · Global — elementos decorativos com aparência de controle
```
Cabeçalho: "Workspace / Studio Auto" (não clicável) e avatar "SA" (sem ação)
Logo: <a href="#"> — é o primeiro item focado pelo Tab e não leva a lugar nenhum
```
CORREÇÃO: o cabeçalho mostra o estado real (modo de dados e IA); o logo deixa de ser link.

### 13 · Nota · Global — nomes e títulos inconsistentes
```
Sobretítulo "ATENDIMENTO AUTOMATIZADO" nas telas WhatsApp E Atendimento
Menu "Atendimento" → título "Como seu assistente atende." (a tela é de horários e regras)
```
CORREÇÃO: um título por tela, igual ao menu.

### 14 · Nota · Serviços — a descrição alimenta o assistente, mas o editor não diz isso
O assistente explica os serviços aos clientes com essa descrição, que é limitada a 240 caracteres e não tem contador.
CORREÇÃO: texto de ajuda e contador.

### 15 · Nota · Chat — espera de 5 a 10 s sinalizada só por texto cinza
```
"Consultando a agenda…" — 12px, sem animação; 0 transições CSS na página
```
CORREÇÃO: indicador de digitação em bolha e sugestões clicáveis no chat vazio.

### 16 · Nota · Código — CSS morto de uma versão anterior
```
styles.css: 1906 linhas; 57 de 134 classes (43%) não são usadas
:root redefinido duas vezes; 20 cores de texto, 15 espaçamentos, pesos 550/650/750/800
```
Isso vem da página pública removida. Aumenta o risco de regressão e o tamanho do CSS.
CORREÇÃO: remover classes sem uso e consolidar os tokens.

## O que funciona
- **Foco visível**: contorno `3px solid rgb(223,38,51)` com afastamento de 4 px, 3,88:1 sobre a barra lateral. Passa 1.4.11 e a orientação de espessura de 2.4.13.
- **Nomes acessíveis**: 0 controles sem nome em todas as telas; todos os campos do editor e das regras têm rótulo envolvente.
- **Estrutura**: um H1 por tela, sem níveis pulados, `lang="pt-BR"` e link para pular ao conteúdo.
- **Alvos de toque**: nenhum abaixo de 24 px (só a caixa de 17×17 px, que fica dentro de um rótulo clicável).
- **Layout responsivo**: 0 estouro horizontal em 390 px e em 1366 px.
- **Desempenho**: primeira pintura de conteúdo em 236 ms (servidor local).
- **Chat** com `aria-live="polite"`.

## Por onde começar (impacto ÷ esforço)
1. 08, 11, 10, 13 — tokens de cor, capitalização, rótulos e títulos (minutos)
2. 01 — chat em primeiro lugar (a demonstração inteira depende disso)
3. 02, 05, 06 — agenda compacta, estado vazio com ações e atualização automática
4. 04 — navegação por semana
5. 03 — novo agendamento pelo painel
6. 07, 09 — regras com barra de salvar e grupo de dias
7. 12, 14, 15 — cabeçalho real, ajuda da descrição e indicador de digitação
8. 16 — limpeza do CSS

## Resultado após as correções (mesmas medições, 21/11/2026)

| Medição | Antes | Depois |
|---|---|---|
| Campo do chat, 1366×768 | y = 859–937 px (fora da tela) | y = 674–745 px (visível) |
| Início do chat, 390×844 | y = 1148 px | y = 370 px; campo em y = 752–823 px |
| Lista do dia, 390×844 | y ≈ 775 px | y = 581 px (indicadores vão para depois da agenda) |
| Falhas de contraste 1.4.3 (Agenda) | 6 (2,95–3,59:1) | 0 em 56 textos |
| Falhas de contraste (WhatsApp, Regras) | 9 e 5 | 0 e 0* |
| Texto abaixo de 12 px | "SEU NEGÓCIO" 10px, 11px | nenhum |
| Cores de texto distintas | 20 | 14 |
| Transições CSS / regras `:active` | 0 / 0 | 14 / 1 |
| Link para pular ao conteúdo | ausente (o "skip link" detectado era o logo `href="#"`) | "Pular para o conteúdo" → `#conteudo` |
| styles.css | 1906 linhas, 43% de classes sem uso | 841 linhas + bloco "Painel v2" com tokens |
| Estouro horizontal em 390 px | 0 | 0 |
| Controles sem nome acessível | 0 | 0 |

\* O botão "Salvar regras" desativado mede 2,82:1. Componentes inativos são isentos pela 1.4.3.

Implementado: chat em primeiro lugar com sugestões clicáveis e indicador de digitação (01, 15); cabeçalho compacto e "Próximo atendimento" (02); **Novo agendamento** pelo painel com horários livres reais (03); faixa da semana com ‹ Hoje › e contagem por dia (04); estado vazio com ações e atalho para a próxima reserva (05); atualização automática a cada 30 s e ao voltar à janela (06); barra fixa de salvar com "Descartar" (07); token de texto secundário (08); `fieldset` "Dias de atendimento" de segunda a domingo (09); rótulos com no mínimo 12 px (10); capitalização correta (11); cabeçalho com o estado real e logo sem link (12); títulos iguais aos do menu (13); ajuda e contador na descrição do serviço (14); limpeza do CSS (16). Também: nome do cliente digitado em minúsculas é capitalizado no chat ("joão da silva" → "João da Silva").

Observação de julgamento: o estado vazio repete o botão "Novo agendamento" do cabeçalho. É intencional, porque um estado vazio deve oferecer a próxima ação no ponto onde o olhar está.

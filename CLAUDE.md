# CLAUDE.md — Flow Calendar

Arquivo de contexto para o assistente Claude Code. Leia inteiro antes de qualquer sessão.

---

## 1. Stack Completa e Versões

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Framework | Next.js (App Router) | 14.2.29 |
| Linguagem | TypeScript | 5.x |
| UI | React | 18.x |
| Estilo | Tailwind CSS | 3.4.1 |
| Auth | NextAuth v5 beta | 5.0.0-beta.25 |
| Calendar API | googleapis | 144.0.0 |
| Datas | date-fns + date-fns-tz | 3.6.0 / 3.1.3 |
| Agendamento | node-cron | 3.0.3 |
| Imagens | sharp | 0.34.5 |
| Runtime | Node.js | 20 (Alpine no Docker) |
| Deploy | Docker + EasyPanel | — |
| Banco de dados | **Nenhum** (file-based token store) | — |
| Timezone padrão | America/Sao_Paulo | via ENV |

**Variáveis de ambiente obrigatórias:**
```env
NEXTAUTH_URL=https://yourdomain.com
NEXTAUTH_SECRET=<openssl rand -base64 32>
AUTH_USERNAME=admin
AUTH_PASSWORD=suasenha
AUTH_USER_EMAIL=seuemail@gmail.com
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
CRON_SECRET=<openssl rand -base64 32>
DEFAULT_TIMEZONE=America/Sao_Paulo
```

**Variáveis opcionais (notificações):**
```env
# Web Push (PWA) — gere com: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:seuemail@gmail.com

# Telegram — bot via @BotFather; chat_id via /getUpdates
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

---

## 2. Estrutura de Pastas

```
flow/
├── Dockerfile                    # Multi-stage Alpine, output standalone
├── docker-compose.yml            # Dev/prod compose com volume flow-data
├── next.config.mjs               # output: standalone, serverExternalPackages: [node-cron]
├── tailwind.config.ts
├── tsconfig.json                 # path alias @/* → ./src/*
│
└── src/
    ├── instrumentation.ts        # Hook de startup Next.js → chama initCron()
    ├── middleware.ts             # Protege todas as rotas exceto /sign-in, /api/auth/*, /api/health
    ├── auth.ts                   # Config NextAuth: Credentials + Google OAuth, refresh automático
    │
    ├── app/
    │   ├── layout.tsx            # Root layout (metadata, PWA, lang pt-BR)
    │   ├── page.tsx              # Redirect "/" → "/today"
    │   ├── globals.css
    │   ├── (app)/                # Grupo protegido por auth
    │   │   ├── layout.tsx        # Verifica sessão, redireciona se expirada
    │   │   └── today/
    │   │       └── page.tsx      # force-dynamic — renderiza CalendarView
    │   ├── (auth)/
    │   │   └── sign-in/page.tsx  # Formulário login (Credentials + botão Google)
    │   └── api/
    │       ├── auth/[...nextauth]/route.ts   # Handlers NextAuth
    │       ├── health/route.ts              # GET { status: "ok" } — sem auth
    │       ├── google-status/route.ts       # GET — verifica se tokens existem
    │       ├── calendars/route.ts           # GET — lista calendários graváveis
    │       ├── tasks/
    │       │   ├── route.ts                 # GET (por dia/range/busca) · POST (criar)
    │       │   └── [eventId]/route.ts       # PATCH (editar/completar/mover) · DELETE
    │       └── cron/
    │           ├── migrate/route.ts         # POST — migração manual e automática
    │           └── migrate/status/route.ts  # GET — status + config da automação
    │
    ├── components/
    │   ├── calendar/
    │   │   ├── CalendarView.tsx   # Componente principal (client) — toda a lógica de estado
    │   │   ├── DayView.tsx        # View dia: grid / lista / agenda (por calendário)
    │   │   ├── WeekView.tsx       # View semana: grid / lista
    │   │   ├── ThreeDayView.tsx   # View 3 dias: grid / lista
    │   │   ├── MonthView.tsx      # View mês: chips por dia
    │   │   ├── EventPopover.tsx   # Popover de detalhe/edição do evento
    │   │   └── calendarLayout.ts  # Funções de layout (timeToY, computeLayout, etc.)
    │   └── tasks/
    │       ├── TaskBlock.tsx      # Bloco de evento no grid (drag & drop)
    │       ├── TaskItem.tsx       # Item de evento na lista
    │       ├── TaskList.tsx       # Lista de eventos
    │       ├── TaskForm.tsx       # Formulário de criação
    │       └── DateHeader.tsx     # Cabeçalho de data + botão de migração
    │
    ├── lib/
    │   ├── google-calendar.ts    # Wrapper completo da Google Calendar API
    │   ├── migration.ts          # Lógica de migração de eventos
    │   ├── cron.ts               # Agendamento node-cron + catch-up na reinicialização
    │   ├── migration-status.ts   # Estado em memória da última migração
    │   ├── timezone.ts           # Utilitários de timezone (Intl-based, sem lib externa)
    │   ├── token-store.ts        # Persistência de tokens OAuth em arquivo
    │   ├── recurrence-format.ts  # RRULE → texto em português
    │   └── colors.ts             # Cores de eventos (lighten, surface color)
    │
    └── types/
        ├── task.ts               # FlowTask, CreateTaskInput, UpdateTaskInput, etc.
        └── next-auth.d.ts        # Extensões de tipo: accessToken, refreshToken, error
```

---

## 3. Decisões Técnicas Importantes — NÃO REVERTER

### Auth
- **NextAuth v5 beta com Credentials**: Google OAuth é usado **apenas** para acessar a API do Calendar, não para login. O login é feito com usuário/senha via variáveis de ambiente (`AUTH_USERNAME` / `AUTH_PASSWORD`).
- **Tokens salvos em arquivo**: `/app/data/.token-store.json`. Não há banco de dados. O volume Docker `/app/data` é obrigatório para persistência entre reinicializações.
- **Refresh automático com buffer de 5 minutos**: `getValidAccessToken()` verifica expiração antes de cada chamada à API.

### Google Calendar
- **`minAccessRole: "reader"`** em `listCalendarEntries`: A migração usa `reader` (não `writer`) para enxergar todos os calendários, incluindo os compartilhados como `ti@cfcontabilidade.com`. Não reverter para `writer`.
- **`singleEvents: true`** em todas as listagens: Eventos recorrentes são expandidos individualmente.
- **Completion via extended properties + colorId**: `flowCompleted: "true"` em `extendedProperties.private` + `colorId: "2"` (verde). A cor original é salva em `flowOriginalColorId` para restauração ao desmarcar.
- **All-day events usam `date` prefix** (não `dateTime`): Evita UTC drift em fusos como America/Sao_Paulo. `getTaskGridDateKey()` extrai o prefixo literal da string.

### Timezone
- **Nunca usar `new Date("YYYY-MM-DD")` direto**: Causa UTC drift. Sempre usar `getDateKeyInTimeZone()` ou `zonedDateTimeToUtc()`.
- **Fix crítico em `getTimeZoneOffsetMs()`**: Alguns runtimes Node.js (Docker Alpine) retornam `"24"` para meia-noite no Intl.DateTimeFormat com `hour12: false`. O código normaliza com `% 24`. NÃO remover este `% 24`.
- **dateKey format**: `YYYY-MM-DD` como string. Sempre passar pelo `isDateKey()` antes de parsear.

### Migração
- **Filtro automático (cron)**: `MIGRATION_AUTO_FILTER = { includeCompletedTimed: false, includeAllDay: false }`. Só move eventos com horário não concluídos.
- **Filtro manual (UI)**: `MIGRATION_MANUAL_DEFAULT_FILTER = { includeCompletedTimed: true, includeAllDay: true }`.
- **Estado da migração em memória**: `migration-status.ts` guarda o último resultado. Reset ao reiniciar o processo.
- **Arquivo de estado do cron**: `/app/data/.migration-cron-state.json`. Guarda `lastRunDate` para catch-up ao reiniciar.

### Build & Deploy
- **`output: "standalone"`** no next.config.mjs: Necessário para Docker.
- **`serverExternalPackages: ["node-cron", "web-push"]`**: Ambos não podem ser bundled pelo webpack.
- **`experimentalInstrumentationHook: true`**: Habilita `instrumentation.ts` que inicializa o cron no startup.
- **EasyPanel**: Deploy via Dockerfile. Volume `/app/data` deve ser montado como persistente. Secrets injetados como variáveis de ambiente — nunca baked no build.
- **VAPID keys**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — necessárias para Web Push. A chave pública é servida via `/api/push/vapid` (runtime), **não** via `NEXT_PUBLIC_` (que exigiria rebuild). NÃO usar `NEXT_PUBLIC_VAPID_PUBLIC_KEY` para este fim.

### Web Push + Telegram (notificações)
- **Service Worker**: `public/sw.js` — recebe push, exibe notificação nativa, abre `/today` no click.
- **Subscriptions em arquivo**: `/app/data/.push-subscriptions.json` — mesmo padrão do token-store. Sem banco de dados.
- **Deduplicação por arquivo**: `/app/data/.notified-today.json` — `{ date: "YYYY-MM-DD", ids: string[] }`. Chaves no formato `{id}@{startTime}` — inclui horário para rearmar se evento for reagendado. Limpa automaticamente ao virar o dia.
- **Gatilho único por evento**: pré-aviso ~5 min antes (janela 4–6 min). Envia Web Push + Telegram simultaneamente.
- **Telegram**: `src/lib/telegram.ts` — `sendTelegramMessage()` via fetch nativo, lê `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. No-op silencioso se vars não configuradas. Funciona independente do Web Push (guards separados em `notifier.ts`).
- **Cron de notificações**: a cada minuto em `cron.ts`, chama `sendDueNotifications()`. Exclui `isComplete`, `isCancelled`, `declined`. Erro 410/404 do push provider remove a subscription automaticamente.
- **Chave pública em runtime**: `push-client.ts` faz `GET /api/push/vapid` para obter a chave — não depende de build-time env vars.

### UI
- **Dark theme fixo**: Toda a UI usa paleta Google Material Dark (`#202124`, `#2a2b2e`, `#3c4043`, `#e8eaed`, `#9aa0a6`).
- **Português brasileiro**: Todos os textos de UI, mensagens de erro, labels.
- **Otimistic UI**: Complete/incomplete e migração atualizam o estado local antes da resposta da API, com revert em caso de erro.
- **Toast de erro**: `migrateResult` / `scheduleMigrateResultClear` reutilizado para erros de complete (`"Não foi possível salvar. Verifique o acesso ao calendário."`).

---

## 4. Comandos Docker Essenciais

### Desenvolvimento local
```bash
# Instalar dependências
npm install

# Rodar em dev (porta 3001)
npm run dev

# Build de produção
npm run build
```

### Docker
```bash
# Build da imagem
docker build -t flow-app .

# Rodar container com variáveis de ambiente
docker run -p 3000:3000 \
  -v flow-data:/app/data \
  -e NEXTAUTH_URL=http://localhost:3000 \
  -e NEXTAUTH_SECRET=xxx \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=senha \
  -e AUTH_USER_EMAIL=email@gmail.com \
  -e GOOGLE_CLIENT_ID=xxx \
  -e GOOGLE_CLIENT_SECRET=xxx \
  -e CRON_SECRET=xxx \
  -e DEFAULT_TIMEZONE=America/Sao_Paulo \
  flow-app

# Docker Compose
docker compose up -d
docker compose logs -f
docker compose down

# Ver logs do container em produção (EasyPanel)
docker logs <container_id> -f --tail 100

# Inspecionar volume de dados (tokens + cron state)
docker exec <container_id> cat /app/data/.token-store.json
docker exec <container_id> cat /app/data/.migration-cron-state.json
```

### Debug da migração
```bash
# Acionar migração manual via cURL (com CRON_SECRET)
curl -X POST https://yourdomain.com/api/cron/migrate \
  -H "Authorization: Bearer SEU_CRON_SECRET"

# Ver status da migração
curl https://yourdomain.com/api/cron/migrate/status

# Ver health
curl https://yourdomain.com/api/health

# Ver status do Google Calendar
curl https://yourdomain.com/api/google-status \
  -H "Cookie: <session-cookie>"
```

### TypeScript check
```bash
npx tsc --noEmit
```

---

## 5. Regra Obrigatória — Atualização de Sessão

**Ao final de TODA sessão de desenvolvimento**, adicionar uma entrada no histórico abaixo com:

```markdown
### YYYY-MM-DD
**O que foi feito:** resumo das mudanças
**Arquivos modificados:** lista de arquivos
**Decisões tomadas:** o que foi decidido e por quê
**Próximos passos:** o que ficou pendente ou foi sugerido
```

Manter as últimas 10 sessões. Sessões mais antigas podem ser condensadas em uma linha.

---

## 6. Última Sessão

### 2026-07-07

**O que foi feito:**

1. **Reorganizador (auto-fit) não aloca entre 00h e 06h** — Função `packDayEvents()` em `src/components/calendar/calendarLayout.ts` agora respeita piso de 06h para alocação. Âncora (1º evento do dia) desloca para 06h se começar antes, mantendo duração original. Eventos subsequentes seguem naturalmente via `cursor = prev.newEnd`, já ≥ 06h.

**Arquivos modificados:**
- `src/components/calendar/calendarLayout.ts` — constante `WORK_DAY_START_HOUR = 6`, cálculo de piso, lógica de âncora com `Math.max(origStart, floorMs)`

**Decisões tomadas:**
- Piso de 06h aplicado apenas na âncora, não em todos os eventos — simplifica lógica e os subsequentes habilmente cascata
- Grid de renderização (`DAY_START: 0`) mantém 00h–23h — eventos criados manualmente na madrugada ainda aparecem, só o reorganizador respeita piso

**Próximos passos:** nenhum pendente.

---

### 2026-07-06

**O que foi feito:**

1. **Notificações apenas 5 min antes de cada evento** — Removido gatilho duplo (pré-aviso + na hora) mantendo apenas alerta único ~5 min antes do início. Janela ajustada de 9–11 min para 4–6 min em `sendDueNotifications()`. Bloco de notificação "na hora" (±1 min) removido completamente.

**Arquivos modificados:**
- `src/lib/notifier.ts` — janela pré-aviso 4–6 min, texto atualizado, gatilho de início removido
- `CLAUDE.md` — atualizada documentação sobre gatilho único (seção "Web Push + Telegram")

**Decisões tomadas:**
- Gatilho único em 4–6 min (em vez de dois: 9–11 min + ±1 min) — cobrindo dedup por `{id}@{startTime}` apenas
- Chave de dedup `{id}@{startTime}:start` não mais necessária — simplificação da lógica

**Próximos passos:** nenhum pendente.

---

### 2026-06-23

**O que foi feito:**

1. **Notificações via Telegram** — Sistema completo de alertas no Telegram integrado ao cron existente:
   - Novo módulo `src/lib/telegram.ts`: `sendTelegramMessage(text)` via `fetch` nativo, no-op silencioso se vars não configuradas.
   - `src/lib/notifier.ts` reestruturado: guards do Web Push viram flags (`pushEnabled`), não `return` antecipado — Telegram funciona mesmo sem VAPID. Dois gatilhos por evento: **pré-aviso** (9–11 min antes, ⏰) e **na hora** (±1 min do início, 🔔). Ambos enviam Telegram + Web Push.
   - `.env.example` atualizado com `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` e VAPID vars (que faltavam).
   - Vars de ambiente: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` — injetadas no EasyPanel.

2. **Fix: rearmar notificação ao reagendar/mover evento** — A chave de dedup em `.notified-today.json` incluía apenas `task.id`, bloqueando reenvio após move. Corrigido para `{id}@{startTime}` e `{id}@{startTime}:start` — se o horário muda, a chave muda e a notificação rearma.

**Arquivos modificados:**
- `src/lib/telegram.ts` — novo módulo
- `src/lib/notifier.ts` — dois gatilhos, guards como flags, dedup por horário
- `.env.example` — TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, VAPID vars

**Decisões tomadas:**
- Single-user → destino Telegram via env vars (sem UI de cadastro de chat)
- Ambos os gatilhos (pré e início) saem nos dois canais (Telegram + Web Push)
- Chave de dedup inclui `startTime` para rearmar ao reagendar

**Próximos passos:** nenhum pendente.

---

### 2026-06-15

**O que foi feito:**

1. **Bloqueio de criação em horário ocupado** — `TaskForm` recebe `existingTasks?: FlowTask[]` do `CalendarView`. A cada mudança de `startTime`/`endTime`, `findConflicts()` detecta sobreposição. Se houver conflito: aviso vermelho inline com nome do evento ocupado + chips clicáveis `"1h · 14:30"` com próximo slot livre por duração (15m/30m/1h/1,5h/2h via `suggestFreeSlots()`). `handleSubmit` bloqueia a criação enquanto houver conflito. Cobre clique na grade, voz/IA e botão `+`.

2. **Indicador visual de conflito (eventos sobrepostos/migrados)** — Eventos pendentes que se sobrepõem recebem ícone ⚠ âmbar no título em todos os modos do DayView (grid, lista, agenda, prioridade, favoritos) e um banner âmbar no topo do dia. Cálculo centralizado em `getConflictIds(tasks)` no `CalendarView` via `useMemo`. Migração continua preservando horário original — o usuário resolve manualmente.

3. **Conflito no EventPopover** — Ícone ⚠ no título do popover + bloco âmbar "Horário em conflito" com chips de sugestão de horário livre, exibidos no modo leitura. Props `hasConflict` e `existingTasks` adicionadas.

4. **Remoção da aba Prioridade** — Grid de abas do DayView voltou para 4 colunas (Lista / Favoritos / Grade / Agenda). Código do `PriorityView` mantido inativo.

5. **Helpers em `calendarLayout.ts`** — `eventsConflict`, `findConflicts`, `suggestFreeSlots`, `getConflictIds`, `SLOT_DURATIONS` adicionados como funções puras reutilizáveis.

**Arquivos modificados:**
- `src/components/calendar/calendarLayout.ts` — helpers de conflito e sugestão
- `src/components/tasks/TaskForm.tsx` — prop `existingTasks`, detecção + bloqueio + chips de sugestão
- `src/components/calendar/CalendarView.tsx` — `conflictIds` via `useMemo`, props para DayView/EventPopover/TaskForm
- `src/components/calendar/DayView.tsx` — `ConflictIcon`, banner âmbar, ícone por evento em todos os modos, prop `conflictIds`
- `src/components/tasks/TaskBlock.tsx` — prop `hasConflict`, ícone âmbar no card (denso e normal)
- `src/components/calendar/EventPopover.tsx` — props `hasConflict`/`existingTasks`, ícone no título, bloco de conflito com sugestões

**Decisões tomadas:**
- Criação manual bloqueada; migração não é alterada (mantém horário original, sinaliza visualmente)
- `getConflictIds` ignora all-day, cancelados, recusados e concluídos — só eventos acionáveis
- Sugestões de slot usam `suggestFreeSlots` com `excludeId` para ignorar o próprio evento no popover
- Aba Prioridade removida da UI (código mantido para reativar se necessário)

**Próximos passos:** redeploy no EasyPanel para entrar em produção.

---

### 2026-06-12

**O que foi feito:**

1. **Opção de encerrar recorrência ao editar** — Toggle "Repetir" agora aparece para eventos recorrentes no modo edição do `EventPopover` (já estava ligado). Desligar + salvar: trunca a RRULE da master com `UNTIL` inclusivo na ocorrência aberta — ela vira a última, as passadas e seus dados são mantidos, as futuras removidas. Novo campo `removeRecurrence?: boolean` em `UpdateTaskInput`. `updateEvent` trata o `removeRecurrence` antes da lógica de scope normal. O salvar pula o dialog de scope de edição nesse caso (não se aplica).

2. **Ícone de recorrência no header do popover** — Removida a seção "RECORRÊNCIA" do modo leitura. Ícone de repeat (↺) adicionado ao lado do ícone de convidados no título, visível apenas quando `isRecurring`. Ambos os ícones reduzidos de `w-5` para `w-4`.

3. **Fix: evento duplicado ao recusar convite** — `showHiddenInvitations: true` fazia o mesmo convite aparecer em múltiplos calendários (original + cópia sombra no calendário pessoal). `fetchAllCalendarsEvents` refatorado: coleta eventos brutos de todos os calendários, agrupa por `iCalUID` antes de mapear. Regra de dedup: vence a cópia com status RSVP mais específico (`declined=4 > tentative=3 > accepted=2 > needsAction=1 > ausente=0`). Isso garante que a cópia sombra do calendário pessoal (que reflete o RSVP com precisão) prevaleça sobre a cópia do calendário compartilhado (que pode não atualizar o `selfResponseStatus` após RSVP).

**Arquivos modificados:**
- `src/types/task.ts` — `removeRecurrence?: boolean` em `UpdateTaskInput`
- `src/lib/google-calendar.ts` — `updateEvent` com `removeRecurrence`; `fetchAllCalendarsEvents` com dedup por `iCalUID` + prioridade de status RSVP
- `src/components/calendar/EventPopover.tsx` — toggle Repetir para recorrentes; ícone de recorrência no título; remoção da seção Recorrência

**Decisões tomadas:**
- `UNTIL` inclusivo (sem `-1s`) no truncamento de recorrência via `removeRecurrence` — a ocorrência atual é a última da série
- Dedup por `iCalUID` com prioridade de status RSVP em vez de "preferir não-declined" — o status RSVP é refletido com precisão na cópia sombra do calendário pessoal, não na cópia do calendário compartilhado
- Ícone de recorrência no título do popover ao invés de seção dedicada — mais compacto e consistente com o ícone de convidados

**Próximos passos:** redeploy no EasyPanel para entrar em produção.

---

### 2026-06-11 (sessão 4)

**O que foi feito:**

1. **Fix: eventos de convite não apareciam no Flow** — A API do Google Calendar omite por padrão eventos onde o usuário foi convidado mas ainda não respondeu (`needsAction`) e eventos recusados (`declined`). Adicionado `showHiddenInvitations: true` em `listEventsExpandedPage`. Migração atualizada para excluir eventos com `selfResponseStatus === "declined"` e evitar tentar mover eventos de terceiros.

**Arquivos modificados:**
- `src/lib/google-calendar.ts` — `showHiddenInvitations: true` em `listEventsExpandedPage`
- `src/lib/migration.ts` — filtro `selfResponseStatus !== "declined"` em `timedToMove` e `allDayToMove`

**Decisões tomadas:**
- `showHiddenInvitations: true` é necessário para qualquer evento onde o user não é organizador e ainda não aceitou o convite
- Eventos `declined` excluídos da migração pois o usuário não é organizador — a API retornaria 403 ao tentar mover
- Eventos `declined` continuam aparecendo no calendário (com cor cinza via `getEventSurfaceColor`)

**Próximos passos:** redeploy no EasyPanel para entrar em produção.

---

### 2026-06-11 (sessão 3)

**O que foi feito:**

1. **Scope dialog para RSVP em recorrentes** — Sim/Talvez/Não em evento recorrente agora abre dialog "Este evento / Este e os seguintes / Todos os eventos". `updateEventRsvp` em `google-calendar.ts` aceita `scope: "this" | "all"`, reutilizando `resolveEventId` para encontrar a master. "Todos os eventos" faz PATCH na master — todas as instâncias herdam o status.

2. **Divisão visual 12h na Lista (modo plano)** — Separador `——— 12:00 ———` inserido antes do primeiro evento a partir das 12h no modo Lista do DayView.

**Arquivos modificados:**
- `src/lib/google-calendar.ts` — `updateEventRsvp` com scope
- `src/app/api/tasks/[eventId]/route.ts` — `rsvpScope` passado para `updateEventRsvp`
- `src/components/calendar/EventPopover.tsx` — dialog de scope para RSVP
- `src/components/calendar/DayView.tsx` — separador 12h na Lista

**Decisões tomadas:**
- "Este e os seguintes" para RSVP trata como "Este evento" no backend — truncar série para status de presença seria desproporcional
- `resolveEventId` (helper existente) reutilizado para encontrar masterId sem duplicar código

**Próximos passos:** nenhum pendente.

---

### 2026-06-11 (sessão 2)

**O que foi feito:**

1. **Voz IA v2** — Prompt enriquecido com duração estimada por tipo de evento (ligação=15min, reunião=30min, consulta=1h…), match parcial de calendário por substring, exemplos de pilar e categoria. FAB reposicionado acima do `+` (`bottom-[5.5rem] right-4`), ícone trocado para sparkle ✦. Endpoint dividido em dois (`/api/voice-event` Whisper + `/api/voice-event/parse` GPT) para feedback em 2 fases ("Transcrevendo..." → "Analisando..."). `requestData()` antes de `stop()` elimina delay do buffer.

2. **Fix hold-to-record → clique simples** — Hold-to-record quebrava `getUserMedia` no iOS (fora do contexto de gesto), pedindo permissão toda vez. Revertido para clique abre modal, toque na tela para parar.

3. **Métricas de dias em aberto** — `computeDaysOpen` agora usa `startTime` como base em vez de `createdAt`. Evento criado hoje para a semana que vem fica em 0 até lá. Dashboard "Tempo médio até concluir" segue a mesma lógica.

4. **Escopo "este/seguintes/todos" na edição de recorrentes** — Dialog ao salvar qualquer edição em evento recorrente. `updateEvent` com scope `all` faz PATCH na master; `thisAndFollowing` trunca RRULE + cria nova série. Funções de marcador (important, category, pillar, delegable) também aceitam scope. Botões de ação rápida no popover também disparam o dialog para recorrentes.

5. **Divisão visual 12h no calendário** — Label "12" em branco + semibold e linha horizontal mais clara no grid (DayView, WeekView, ThreeDayView). Separador `——— 12:00 ———` na view Lista do DayView (modo plano e modo agenda).

**Arquivos modificados (principais):**
- `src/lib/openai-event-parser.ts` — prompt enriquecido, endpoint parse separado
- `src/app/api/voice-event/route.ts` — só Whisper
- `src/app/api/voice-event/parse/route.ts` — só GPT (novo)
- `src/components/calendar/VoiceCaptureModal.tsx` — 2 fases, requestData, clique simples
- `src/components/calendar/CalendarView.tsx` — FAB sparkle acima do +, scope handlers
- `src/lib/aging.ts` — base startTime
- `src/app/api/stats/route.ts` — avgDaysToComplete com startTime
- `src/lib/google-calendar.ts` — updateEvent com scope, marker functions com scope
- `src/types/task.ts` — scope em UpdateTaskInput
- `src/app/api/tasks/[eventId]/route.ts` — scope propagado
- `src/components/calendar/EventPopover.tsx` — dialog de scope para recorrentes
- `src/components/calendar/DayView.tsx` — separador 12h na lista
- `src/components/calendar/WeekView.tsx`, `ThreeDayView.tsx` — destaque 12h no grid

**Decisões tomadas:**
- `getUserMedia` deve ser chamado em resposta direta a gesto — hold-to-record com setTimeout quebra isso no iOS
- Endpoint de voz dividido para feedback de progresso real (não fake timer)
- Scope `thisAndFollowing` para marcadores cosméticos = equivalente a `this` no backend

**Próximos passos:** nenhum pendente.

---

### 2026-06-11

**O que foi feito:**

1. **Criação de evento por voz + IA** — Segundo FAB roxo (`bg-[#a78bfa]/30`) ao lado esquerdo do FAB `+`. Ao clicar: abre overlay de gravação com microfone pulsante. Clique em qualquer lugar para parar. O áudio é enviado ao endpoint `/api/voice-event` que usa OpenAI Whisper-1 (transcrição PT-BR) + GPT-4o-mini (extrai campos do evento em JSON) e retorna os dados pré-preenchidos no `TaskForm` para revisão antes de salvar. Campos populados: título, startTime, endTime, calendarId, description, isImportant, pillar, category, isDelegable, recurrenceType.

**Arquivos criados:**
- `src/lib/openai-event-parser.ts` — `transcribeAudio()` (Whisper-1) + `extractEventFields()` (GPT-4o-mini), sem SDK, usa `fetch` nativo
- `src/app/api/voice-event/route.ts` — POST multipart/form-data, valida sessão, chama Whisper + GPT, retorna `{ transcript, parsed }`
- `src/components/calendar/VoiceCaptureModal.tsx` — overlay com MediaRecorder, estados recording/processing/error, portal no body

**Arquivos modificados:**
- `src/components/calendar/CalendarView.tsx` — import VoiceCaptureModal + ParsedEvent, estado `showVoiceCapture`, handler `handleVoiceResult`, FAB de voz
- `src/components/tasks/TaskForm.tsx` — interface `VoiceDefaults` com campos extras, pré-população de título, description, isImportant, pillar, category, isDelegable, recurrenceType, calendarId

**Decisões tomadas:**
- Sem SDK OpenAI — fetch nativo, consistente com o restante do projeto
- MediaRecorder com prefer webm/opus, fallback mp4 (Safari) — Whisper aceita ambos
- `calendarId` retornado pela IA é validado contra a lista de calendários carregada — se não bater, usa o primário

**Nova variável de ambiente:**
- `OPENAI_API_KEY=sk-...` — necessária para Whisper + GPT-4o-mini

**Próximos passos:** Adicionar `OPENAI_API_KEY` nas variáveis do EasyPanel e testar no dispositivo.

---

### 2026-06-09

**O que foi feito:**

1. **Fix campo de data no EventPopover (mobile)** — Campos "Início" e "Fim" estavam cortados/vazando em mobile por ficarem lado a lado (`grid-cols-2`). Solução em 3 commits: (1) empilhar em mobile com `grid-cols-1 sm:grid-cols-2`; (2) `overflow-x-hidden` no container + `min-w-0` nos inputs; (3) `appearance-none` + `text-[11px]` — mesma receita do `TaskForm` que já funcionava.

2. **Notificações Web Push via PWA** — Sistema completo de notificações nativas:
   - `public/sw.js`: Service Worker que recebe push e exibe notificação; click abre `/today`
   - `src/lib/push-store.ts`: armazena subscriptions em `/app/data/.push-subscriptions.json`
   - `src/lib/push-client.ts`: `registerPush()`, `unregisterPush()`, `getPushStatus()` — busca VAPID key do servidor via `/api/push/vapid` (não env var de build)
   - `src/lib/notifier.ts`: `sendDueNotifications()` — filtra eventos 9-11 min antes, deduplica via `/app/data/.notified-today.json`
   - `src/lib/cron.ts`: job a cada minuto chamando `sendDueNotifications()`
   - APIs: `/api/push/vapid`, `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test`
   - `CalendarView.tsx`: botão de sino no header com modal (ativar / testar / desativar)
   - `next.config.mjs`: `web-push` adicionado a `serverExternalPackages`

3. **Fix crítico VAPID key** — `NEXT_PUBLIC_` env vars são baked no bundle no build time; em Docker/EasyPanel isso impedia o funcionamento. Corrigido para buscar a chave via `/api/push/vapid` em runtime.

**Arquivos criados:**
- `public/sw.js`, `src/lib/push-store.ts`, `src/lib/push-client.ts`, `src/lib/notifier.ts`
- `src/app/api/push/vapid/route.ts`, `subscribe/route.ts`, `unsubscribe/route.ts`, `test/route.ts`

**Arquivos modificados:**
- `src/lib/cron.ts`, `src/components/calendar/CalendarView.tsx`, `src/components/calendar/EventPopover.tsx`, `next.config.mjs`

**Decisões tomadas:**
- Subscriptions em arquivo JSON (sem banco) — consistente com o restante do projeto
- Deduplicação local (arquivo) ao invés de PATCH no Google Calendar — evita quota de API
- VAPID key servida via endpoint REST, não `NEXT_PUBLIC_` — funciona sem rebuild

**Próximos passos:** Após redeploy no Easypanel com as VAPID vars, testar ativação no Chrome e no iPhone (Safari → Adicionar à Tela de Início antes de ativar).

---

### 2026-06-08 (sessão 2)

**O que foi feito:**

1. **Fix auto-scroll "Agora" no modo Lista** — Substituída lógica manual `offsetTop - 80` por `scrollIntoView({ block: "start" })` com `scrollMarginTop: 80px` no separador vermelho. O browser calcula a posição após layout finalizado, eliminando a race condition com fontes/badges que causava scroll abaixo da âncora. Retry em 250ms como segurança. Ref de chave por `(mode, date)` evita re-scroll após edições. Aplicado em DayView, WeekView e ThreeDayView.

**Arquivos modificados:**
- `src/components/calendar/DayView.tsx` — novo `useEffect` + `scrollMarginTop` no separador
- `src/components/calendar/WeekView.tsx` — idem
- `src/components/calendar/ThreeDayView.tsx` — idem

**Decisões tomadas:**
- `scrollIntoView` + `scrollMarginTop` (APIs nativas) preferidos sobre cálculo manual de `offsetTop` — mais resilientes a layout shifts e variações de altura de card entre dispositivos
- Retry único em 250ms: cobre carga tardia de fonte sem ficar repolicando indefinidamente

**Próximos passos:** nenhum pendente.

---

### 2026-06-08 (sessão 1)

**O que foi feito:**

1. **Recorrência ao editar evento** — Bloco "Repetir" (toggle + 6 opções: Diária, Dias úteis, Semanal, Quinzenal, Mensal, Anual) adicionado ao modo edição do `EventPopover`. Aparece apenas para eventos não-recorrentes com horário definido (`!task.isRecurring && !task.isAllDay`). Ao salvar, envia `recurrence: ["RRULE:…"]` via `UpdateTaskInput` → `updateEvent` → `events.patch`, convertendo o evento em série. Para eventos já recorrentes, mantém apenas o modo leitura do resumo.

2. **Textarea de descrição redimensionável** — Trocado `resize-none` por `resize-y` e `max-h-40` (160px) por `max-h-[60vh]` no textarea de descrição do `EventPopover`. Auto-grow atualizado de `maxH = 160` para `Math.round(window.innerHeight * 0.6)`.

**Arquivos modificados:**
- `src/types/task.ts` — `recurrence?: string[]` em `UpdateTaskInput`
- `src/lib/google-calendar.ts` — `updateEvent` propaga `recurrence` para o PATCH
- `src/components/calendar/EventPopover.tsx` — estados `editRecurring`/`editRecurrenceType`, `buildRRule()`, UI do toggle, propagação no save, textarea redimensionável

**Decisões tomadas:**
- Recorrência na edição limitada a eventos não-recorrentes: adicionar/alterar RRULE em série existente exigiria diálogo "este/seguintes/todos" — deixado para versão futura
- Eventos all-day excluídos do toggle: RRULE com `date` (não `dateTime`) tem comportamento diferente e não está no escopo
- `resize-y` nativo preferido sobre botão "expandir" customizado — mais simples e familiar

**Próximos passos:** nenhum pendente.

---

### 2026-06-05 (sessão 2)

**O que foi feito:**

1. **Diálogo de exclusão de evento recorrente** — Ao excluir evento com `isRecurring === true`, modal com 3 opções radio: "Este evento", "Este e os eventos seguintes", "Todos os eventos". `deleteEvent` em `google-calendar.ts` estendido com `scope: "this" | "thisAndFollowing" | "all"`. `"thisAndFollowing"` trunca a RRULE da master com `UNTIL=originalStart−1s`. API DELETE aceita `?deleteScope=`. `handleDelete` em CalendarView propagado. Fix de z-index: dialog `z-[5000]` acima do backdrop do popover `z-[4000]`.

2. **Ícone de recorrência nos cards** — SVG "repeat" Material Design (`text-white/70`) ao lado do ícone de convidados em todos os cards e listas: DayView (3 locais), WeekView, ThreeDayView, TaskBlock (compacto + normal).

3. **Fix textarea de descrição** — Altura limitada a `max-h-40` (160px) com `overflow-y-auto`; antes crescia sem limite empurrando os botões para fora da tela.

4. **Fix auto-scroll para hora atual** — Substituído single `requestAnimationFrame` por double-rAF em DayView, WeekView e ThreeDayView. Single rAF disparava antes do React commitar o separador "Agora" no DOM, causando falha no scroll em alguns dispositivos.

5. **Cor do calendário DevPoint** — `CALENDAR_COLOR_OVERRIDES["DevPoint"] = "#18c4c4"`.

**Arquivos modificados:**
- `src/lib/google-calendar.ts` — `deleteEvent` com scope, `CALENDAR_COLOR_OVERRIDES` DevPoint
- `src/app/api/tasks/[eventId]/route.ts` — `deleteScope` query param
- `src/components/calendar/CalendarView.tsx` — `handleDelete` com scope
- `src/components/calendar/EventPopover.tsx` — modal exclusão recorrente, z-index fix, textarea max-h
- `src/components/calendar/DayView.tsx`, `WeekView.tsx`, `ThreeDayView.tsx` — ícone recorrência + double-rAF scroll
- `src/components/tasks/TaskBlock.tsx` — ícone recorrência

**Decisões tomadas:**
- `"thisAndFollowing"` usa PATCH na master com `UNTIL=` (não deleta instâncias individualmente) — padrão da Google Calendar API
- Double-rAF é o padrão para garantir layout calculado antes de ler `offsetTop`
- Dialog do modal usa `z-[5000]` + `stopPropagation` para não conflitar com backdrop do popover

**Próximos passos:** nenhum pendente.

---

### 2026-06-05 (sessão 1)

**O que foi feito:**

1. **Tags D/O/E (Fase 1)** — Novos campos `isDelegable`, `category` (`"operational"` | `"strategic"`) e `pillar` em `FlowTask` / `UpdateTaskInput` / `CreateTaskInput`. Funções de mutação: `markEventDelegable/Undelegable`, `setEventCategory`, `setEventPillar` via `extendedProperties.private` (`flowDelegable`, `flowCategory`, `flowPillar`). `EventPopover` ganhou botões O/E/D na linha de ações. Badges com letras D/O/E (O=branco/50, E=roxo #a78bfa, D=cyan #4dd0e1) em todos os cards de evento nas views. `CALENDAR_PILLAR_OVERRIDES` em `google-calendar.ts` para mapear calendário→pilar.

2. **Revisão Semanal (Fase 2)** — Novo ícone 📋 no header (com ponto roxo na sexta-feira). Novo endpoint `GET /api/weekly-review` — busca últimos 7 dias, retorna delegáveis agrupados por título normalizado + razão estratégico/operacional. `WeeklyReviewView.tsx`: lista de delegáveis com badge "N× esta semana" + donut SVG E vs O com alerta de <30% estratégico.

3. **Operacional Repetitivo (Fase 4)** — `stats/route.ts` detecta tarefas `category="operational"` que aparecem em ≥3 semanas ISO distintas → `repetitiveOperational` no payload. `StatsData` atualizado com o campo.

4. **4 Pilares (Fase 3)** — `TaskForm.tsx` com 4 botões segmentados (Trabalho/Saúde/Família/Espiritualidade) ao criar. `EventPopover` no modo edição com `<select>` de pilar. `stats/route.ts` agrega `weeklyPillars` (horas, %, `consecutiveZeroDays` por pilar na semana atual). `DashboardView` exibe card "Equilíbrio da semana" com 4 barras coloridas; borda vermelha quando `consecutiveZeroDays >= 5`.

**Arquivos criados:** `src/app/api/weekly-review/route.ts`, `src/components/dashboard/WeeklyReviewView.tsx`

**Arquivos modificados:** `src/types/task.ts`, `src/lib/google-calendar.ts`, `src/lib/aging.ts`, `src/app/api/tasks/[eventId]/route.ts`, `src/app/api/stats/route.ts`, `src/components/calendar/CalendarView.tsx`, `src/components/calendar/EventPopover.tsx`, `src/components/tasks/TaskForm.tsx`, `src/components/tasks/TaskBlock.tsx`, `TaskItem.tsx`, `src/components/calendar/DayView.tsx`, `WeekView.tsx`, `ThreeDayView.tsx`, `src/components/dashboard/DashboardView.tsx`

**Decisões tomadas:** D independente de O/E; sem `colorId` para D/O/E; `CALENDAR_PILLAR_OVERRIDES` hardcoded; `consecutiveZeroDays` sobre últimos 7 dias no tz da requisição.

**Próximos passos:** nenhum pendente.

---

### 2026-06-04

**O que foi feito:**

1. **Métrica "Dias em aberto"** — Badge exibido em todos os cards de eventos não-concluídos com ≥1 dia desde a criação. Formato curto (`3d`) no Grade/denso; formato longo (`3 dias em aberto`) em Lista, Agenda e Popover. Cor escalonada: branco/60 (1–3 dias), amarelo `#F6BF26` (4–7 dias), vermelho `#ea4335` (>7 dias). Usa `event.created` (Google) como base — preservado durante migrações (PATCH, não recria).

2. **Nova aba "Prioridade"** — 4º modo da view Dia (toggle Lista/Grade/Agenda/Prioridade). Lista todos os eventos não-concluídos do dia em ordem decrescente de dias em aberto. Cada card traz badge de aging destacado.

3. **`flowCompletedAt` em extended properties** — Salvo ao marcar concluído (`markEventComplete`), limpo ao desmarcar (`markEventIncomplete`). Exposto como `completedAt` em `FlowTask`.

4. **Dashboard — Tempo médio até concluir** — Novo 5º card no painel de desempenho (`sm:grid-cols-5`). Calcula média de `completedAt - createdAt` em dias (eventos que têm ambos os campos). Mostra `—` enquanto não há dados com `flowCompletedAt`.

5. **`src/lib/aging.ts`** — Novo utilitário: `computeDaysOpen(task, tz)` e `agingBadgeColor(days)`.

**Arquivos criados:**
- `src/lib/aging.ts`

**Arquivos modificados:**
- `src/types/task.ts` — novo campo `completedAt`
- `src/lib/google-calendar.ts` — `mapEvent`, `markEventComplete`, `markEventIncomplete`
- `src/app/api/stats/route.ts` — cálculo de `avgDaysToComplete`
- `src/components/dashboard/DashboardView.tsx` — novo card + tipo atualizado
- `src/components/calendar/CalendarView.tsx` — toggle 4 modos (grid-cols-4)
- `src/components/calendar/DayView.tsx` — `PriorityView`, badges em Lista e Agenda
- `src/components/calendar/WeekView.tsx` — badge em modo Lista
- `src/components/calendar/ThreeDayView.tsx` — badge em modo Lista
- `src/components/calendar/EventPopover.tsx` — badge após horário
- `src/components/tasks/TaskBlock.tsx` — badge (denso + normal)
- `src/components/tasks/TaskItem.tsx` — badge

**Decisões tomadas:**
- `event.created` (Google, nativo) como fonte do "dias em aberto" — sem campo extra, imutável, preservado por PATCH de migração
- `flowCompletedAt` vazio (não `null`) ao desmarcar — consistente com padrão de `flowOriginalColorId` no projeto
- `avgDaysToComplete` conta apenas eventos que já tinham `flowCompletedAt` gravado (sem backfill) — correto, sem retroagir
- Badge omitido para eventos concluídos, cancelados e com 0 dias em aberto (criado hoje)

**Próximos passos:** nenhum pendente.

---

### 2026-06-01

**O que foi feito:**

1. **Busca insensível a maiúsculas, acentos e espaços** — Implementado `normalizeForSearch()` (NFD + strip diacríticos + lowercase + colapsa espaços). Busca envia duas queries paralelas ao Google (raw + sem acentos) e filtra localmente por tokens normalizados em título, descrição e convidados.

2. **Fix: "dossie" não encontrava "Dossiê"** — Quando a query é ASCII puro, o `q` do Google não retorna eventos acentuados. Adicionado Fetch C paralelo sem `q` sobre ±2 anos (sem limite por calendário) para capturar matches acentuados.

3. **Setas de navegação do header fixas** — Substituído flex variável por `flex items-center` + `w-56 text-center` no texto da data. As setas ficam sempre coladas ao texto independente do tamanho do label.

4. **Auto-scroll para hora atual confiável** — Corrigido `useEffect` com deps vazias `[]` que falhava quando o modo ativo não estava no DOM no mount. Agora ambos os efeitos (grid e lista) dependem de `displayMode` + `requestAnimationFrame` para garantir DOM pronto antes do scroll. Corrigido em `DayView`, `WeekView` e `ThreeDayView`.

**Arquivos modificados:**
- `src/app/api/tasks/route.ts` — busca normalizada, fetch duplo/triplo paralelo
- `src/lib/google-calendar.ts` — exporta `normalizeForSearch()`
- `src/components/calendar/CalendarView.tsx` — header com setas fixas
- `src/components/calendar/DayView.tsx` — auto-scroll com `displayMode` dep
- `src/components/calendar/WeekView.tsx` — auto-scroll com `displayMode` dep
- `src/components/calendar/ThreeDayView.tsx` — auto-scroll com `displayMode` dep

**Decisões tomadas:**
- Fetch C (sem `q`, ±2 anos) sem `maxResults` por calendário para não cortar eventos acentuados
- `requestAnimationFrame` nos scrolls para garantir layout pintado antes de ler `offsetTop`
- Texto da data com `w-56` fixo — suficiente para o label mais longo ("Hoje • Quarta-Feira, 31 De Dezembro")

**Próximos passos:** nenhum pendente.

---

### 2026-05-26

**O que foi feito:**

1. **Auto-scroll para hora atual no modo Lista** — Ao abrir o app em modo Lista (Dia, Semana ou 3 Dias), a lista rola automaticamente até o separador "Agora HH:MM", posicionando o próximo evento imediatamente visível. Funciona em desktop e mobile.

**Arquivos modificados:**
- `src/components/calendar/DayView.tsx`
- `src/components/calendar/WeekView.tsx`
- `src/components/calendar/ThreeDayView.tsx`

**Decisões tomadas:**
- Adicionado `listScrollRef` (container) e `listNowSepRef` (separador) em cada view. `useEffect` com dependência em `tasks.length` garante que o scroll só ocorre após os eventos carregarem (fetch assíncrono).
- `scrollTop = offsetTop - 80` para deixar 1–2 eventos passados visíveis acima do separador, seguindo o mesmo padrão do modo Grade (`-120`/`-100`).
- Não usou `scrollIntoView` para evitar scroll no `<html>` ao invés do container correto.
- Auto-scroll não repete a cada 30s (só na entrada) para não atrapalhar o usuário lendo eventos antigos.

**Commit:** `068e152`

**Próximos passos:** nenhum pendente.

---

### 2026-04-18 (sessão 2)

**O que foi feito:**

1. **Estrela branca para eventos marcados como importante** — Alterado o ícone de estrela de dourado (`text-[#F6BF26]`) para branco (`text-white`) em todas as views quando `task.isImportant` é verdadeiro. A estrela outline permanece em `text-white/30` quando não marcado.

2. **Nome do calendário em branco** — `text-[#9aa0a6]` substituído por `text-white/70` no nome do calendário exibido abaixo do horário nos modos lista de DayView, WeekView e ThreeDayView.

**Arquivos modificados:**
- `src/components/calendar/DayView.tsx`
- `src/components/calendar/WeekView.tsx`
- `src/components/calendar/ThreeDayView.tsx`
- `src/components/calendar/MonthView.tsx`
- `src/components/calendar/EventPopover.tsx`
- `src/components/tasks/TaskBlock.tsx`
- `src/components/tasks/TaskItem.tsx`

**Decisões tomadas:**
- Estrela branca (não dourada) quando marcado como destaque — o fundo dourado do evento já indica o estado; a estrela branca contrasta melhor sobre ele
- Nome do calendário em `text-white/70` — cor universal legível sobre qualquer cor de fundo de evento, sem depender de `calendarBgColor`

**Próximos passos:** nenhum pendente.

---

## 7. Histórico de Sessões Anteriores

- **2026-04-18 (s1)** — Dashboard de desempenho (heatmap anual, barras mensais, streak), endpoint `/api/stats`, toggle calendário/dashboard no header, recorrência no formulário de criação (RRULE).
- **2026-04-17** — Flag "Importante" com estrela dourada (`colorId: "5"`, `flowImportant` em extendedProperties), ícone de estrela em todas as views, UI otimista. Fix deploy: commit manual necessário.
- **2026-04-13** — Fix migração com calendários compartilhados (`reader`), fix timezone Alpine (`% 24`), Cache-Control no-store, ícone de convidados em todas as views, view "Agenda" no DayView (agrupada por calendário com colapso).
- **Até 2026-04-12** — Criação do projeto, auth por usuário/senha substituindo Google OAuth login, views de calendário (dia/semana/3dias/mês), grade e lista, busca, migração automática e manual de eventos, drag & drop, RSVP, recurrence display, toggle grade/lista por view, FAB, auto-expand de descrições, filtros de busca case/accent insensitive.

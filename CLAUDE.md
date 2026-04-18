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
- **`serverExternalPackages: ["node-cron"]`**: node-cron não pode ser bundled pelo webpack, deve rodar no Node nativo.
- **`experimentalInstrumentationHook: true`**: Habilita `instrumentation.ts` que inicializa o cron no startup.
- **EasyPanel**: Deploy via Dockerfile. Volume `/app/data` deve ser montado como persistente. Secrets injetados como variáveis de ambiente — nunca baked no build.

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

### 2026-04-18 (sessão 1)

**O que foi feito:**

1. **Dashboard de desempenho** — Novo painel acessível via ícone de gráfico no header do CalendarView. Mostra: 4 cards de resumo (concluídos, taxa, sequência atual, melhor dia), heatmap anual estilo GitHub (53 semanas × 7 dias, cores em roxo #a78bfa), gráfico de barras mensais com total (cinza) e concluídos (roxo), e tabela de detalhamento mensal (visível em sm+). Sem bibliotecas externas — tudo CSS + Tailwind + SVG inline.

2. **Endpoint `/api/stats`** — `GET ?year=2026&tz=...` busca todos os eventos do ano via `getEventsInRange`, agrega server-side por dia e por mês, calcula streak atual/melhor e melhor dia. Retorna JSON compacto sem objetos de evento completos.

3. **Toggle calendário/dashboard no header** — Dois ícones individuais (📅 calendário, 📊 dashboard) com estado ativo destacado (`bg-[#3c4043]`). Ordem: calendário → dashboard → ⋮ migração → sair. Ícones soltos, sem agrupamento com borda.

4. **Recorrência no formulário de criação** — Seção "Repetir" com toggle e 6 opções: Diária, Dias úteis, Semanal, Quinzenal, Mensal, Anual. Gera RRULE correto (ex: `RRULE:FREQ=WEEKLY;BYDAY=MO`). "Semanal" e "Quinzenal" detectam o dia da semana automaticamente pelo horário de início. Passa `recurrence: string[]` para `createEvent()` → Google Calendar API. Só disponível na criação (não edição).

5. **Ajustes de UI no dashboard** — Números dos cards em branco, cores em roxo (#a78bfa), fix de barras mensais (altura em pixels absolutos para evitar bug de `height: X%` em flex containers sem altura explícita).

**Arquivos criados:**
- `src/app/api/stats/route.ts`
- `src/components/dashboard/DashboardView.tsx`

**Arquivos modificados:**
- `src/components/calendar/CalendarView.tsx`
- `src/components/tasks/TaskForm.tsx`
- `src/lib/google-calendar.ts`
- `src/types/task.ts`

**Decisões tomadas:**
- Dashboard sem bibliotecas de gráficos (recharts, chart.js etc.) — tudo inline para manter bundle enxuto e tema escuro consistente
- Barras mensais usam `style={{ height: px }}` com valor absoluto calculado (não `height: X%`) — percentagem não funciona em `flex-1` sem altura explícita no pai
- Cor roxa (#a78bfa) escolhida por não conflitar com nenhum calendário existente (dourado = importante, verde = concluído, azul = Google Calendar primário)
- Recorrência apenas na criação: editar recorrência de evento existente é operação complexa (afeta todas vs esta instância) — deixado para versão futura
- `NEXTAUTH_URL` no `.env.local` corrigido de `localhost:3001` para `localhost:3000`

**Commit:** `bd5158c`

**Próximos passos:** nenhum pendente.

---

### 2026-04-17

**O que foi feito:**

1. **Feature: flag "Importante" com estrela dourada** — Novo campo `isImportant?: boolean` em `FlowTask` e `UpdateTaskInput`. Clicar na estrela marca/desmarca o evento como importante. Quando marcado, o evento fica com fundo dourado (#F6BF26, Google Banana). O estado persiste via `extendedProperties.private.flowImportant` no Google Calendar.

2. **Persistência via Google Calendar extended properties** — `markEventImportant()`: salva colorId="5" e `flowImportant: "true"`, preservando colorId original em `flowOriginalImportantColorId`. `markEventUnimportant()`: restaura colorId original.

3. **Cor dourada na `getEventSurfaceColor()`** — Adicionado 5º parâmetro `isImportant` (opcional, backward-compatible). Prioridade: `cancelled > declined > isComplete > isImportant > calendarColor`.

4. **API PATCH estendida** — `/api/tasks/[eventId]` agora aceita `isImportant: boolean` e chama `markEventImportant/Unimportant`. Branch separado dos outros campos.

5. **UI otimista em CalendarView** — `handleImportant()` espelha `handleComplete()`: toggle local imediato, PATCH assíncrono, revert+toast em caso de erro.

6. **Ícone de estrela em todas as views**:
   - `TaskBlock`: compact/full mode (outline/filled, w-2.5 ou w-3). Dense mode: sem estrela.
   - `DayView`: lista (timed), agenda/calendar mode
   - `WeekView`, `ThreeDayView`: lista (timed)
   - `MonthView`: indicador visual dourado no chip (botão clicável quando importante)
   - `EventPopover`: estrela no título + botão "Marcar como importante" nas ações

**Arquivos modificados:**
- `src/types/task.ts`
- `src/lib/google-calendar.ts`
- `src/lib/colors.ts`
- `src/app/api/tasks/[eventId]/route.ts`
- `src/components/calendar/CalendarView.tsx`
- `src/components/tasks/TaskBlock.tsx`
- `src/components/tasks/TaskItem.tsx`
- `src/components/calendar/DayView.tsx`
- `src/components/calendar/WeekView.tsx`
- `src/components/calendar/ThreeDayView.tsx`
- `src/components/calendar/MonthView.tsx`
- `src/components/calendar/EventPopover.tsx`

**Decisões tomadas:**
- `colorId: "5"` (Google Banana) para estado importante — mesmo mecanismo do colorId "2" para completo
- Dense mode no TaskBlock: sem estrela (espaço crítico)
- Conflito complete+important resolvido naturalmente: completar evento dourado salva "5" em `flowOriginalColorId`, ao desmarcar volta ao dourado
- `isImportant` como 5º parâmetro opcional em `getEventSurfaceColor()` — backward-compatible
- MonthView: chip mostra estrela dourada apenas quando importante (botão clicável para desmarcar), sem estrela outline por falta de espaço

**Problema de deploy:** As mudanças ficaram apenas como arquivos modificados localmente — o commit/push inicial não foi executado pelo assistente. Foi necessário fazer `git add` + `git commit` + `git push` manualmente na sessão para o código chegar ao EasyPanel. Commit final: `e3a8af7`.

**Lição:** Ao final de sessões de implementação, sempre verificar com `git status` se as mudanças foram de fato commitadas antes de encerrar.

**Próximos passos:** nenhum pendente.

---

### 2026-04-13

**O que foi feito:**

1. **Fix: migração não via eventos de todos os calendários** — `getEventsForDateKey` chamado sem `writableOnly: true` na migração, permitindo ver calendários compartilhados (ex: `ti@cfcontabilidade.com`).

2. **Fix: timezone Docker** — `getTimeZoneOffsetMs()` em `timezone.ts` retornava hour=24 para meia-noite em runtimes Alpine, causando offset errado de 1 dia. Corrigido com `% 24`.

3. **Fix: Cache API** — `Cache-Control: no-store` adicionado ao GET `/api/tasks` para evitar dados stale após migração.

4. **Fix: UI otimista pós-migração** — eventos da data de origem são removidos imediatamente do estado local após migração bem-sucedida. Refresh diferido extendido para 2500ms.

5. **Fix: toast de erro ao marcar completo** — catch block de `handleComplete` em `CalendarView.tsx` agora exibe toast usando o sistema `migrateResult` existente.

6. **Feature: ícone de convidados** — ícone de pessoas (SVG inline, Material Design) exibido ao lado do título em todas as views (grid compacto, denso, lista dia/semana/3dias) e no `EventPopover` ao lado do título. Cor branca. Só aparece quando `task.attendees && task.attendees.length > 0`.

7. **Feature: view "Agenda"** — terceiro modo de exibição na view Dia (toggle: Lista / Grade / Agenda). Agrupa eventos por calendário com cabeçalho colorido, contagem e seta de colapso/expansão por seção. Cada seção pode ser retraída/expandida individualmente.

**Arquivos modificados:**
- `src/lib/migration.ts` — removido `writableOnly`
- `src/lib/timezone.ts` — fix `% 24` no hour
- `src/app/api/tasks/route.ts` — `Cache-Control: no-store`
- `src/components/calendar/CalendarView.tsx` — otimismo pós-migração, toast de erro, novo modo "Agenda" no toggle, `dayDisplayMode` type atualizado
- `src/components/calendar/DayView.tsx` — componente `AgendaView` (colapso/expansão), prop type atualizado
- `src/components/calendar/WeekView.tsx` — ícone de convidados
- `src/components/calendar/ThreeDayView.tsx` — ícone de convidados
- `src/components/calendar/EventPopover.tsx` — ícone de convidados no título
- `src/components/tasks/TaskBlock.tsx` — ícone de convidados (todos os modos: dense, compact, full)
- `src/lib/google-calendar.ts` — log de diagnóstico adicionado

**Decisões tomadas:**
- `minAccessRole: "reader"` (não `"writer"`) na migração para enxergar todos os calendários
- Ícone de convidados sempre branco (`text-white`) para consistência com o tema escuro
- View "Agenda" extrai `calendarId` como chave de agrupamento, com fallback `"primary"`
- `AgendaView` extraído como componente separado dentro de `DayView.tsx` para ter seu próprio estado de colapso (`useState<Set<string>>`)
- Estado de colapso inicializa vazio (todas seções expandidas por padrão)

**Próximos passos sugeridos pelo usuário:** nenhum pendente explicitamente — sessão encerrada com commit e push.

---

## 7. Histórico de Sessões Anteriores

*(Sessões anteriores a 2026-04-13 condensadas — projeto criado e evolui neste período)*

- **Até 2026-04-12** — Criação do projeto, auth por usuário/senha substituindo Google OAuth login, views de calendário (dia/semana/3dias/mês), grade e lista, busca, migração automática e manual de eventos, drag & drop, RSVP, recurrence display, toggle grade/lista por view, FAB, auto-expand de descrições, filtros de busca case/accent insensitive.

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
- **Deduplicação por arquivo**: `/app/data/.notified-today.json` — `{ date: "YYYY-MM-DD", ids: string[] }`. Chaves no formato `{id}@{startTime}#{minutos}` — inclui horário e minutos do lembrete para rearmar se o evento for reagendado ou o lembrete alterado. Limpa automaticamente ao virar o dia.
- **Lembrete configurável por evento** (`src/lib/reminder.ts`): `reminderMinutes` no `FlowTask`/`CreateTaskInput`/`UpdateTaskInput`, persistido em `extendedProperties.private.flowReminderMinutes` (`"none"` = sem lembrete, ausente = default 5 min). Escolhido no `TaskForm` (criação) e no `EventPopover` (edição), com opções pré-definidas (5/10/15/30min, 1h/2h/1dia) + campo "Outro…" em minutos. **Não** usa o `reminders` nativo do Google — o gatilho é só do notifier do Flow, para não duplicar aviso.
- **Gatilho por evento**: `sendDueNotifications()` busca eventos de hoje e amanhã (`shiftDateKey`) e dispara no minuto exato de `startTime - reminderMinutes` (janela ±1min, cron roda a cada minuto). Envia Web Push + Telegram simultaneamente. Evento sem `reminderMinutes` gravado usa o default de 5 min (comportamento antigo preservado).
- **Telegram**: `src/lib/telegram.ts` — `sendTelegramMessage()` via fetch nativo, lê `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. No-op silencioso se vars não configuradas. Funciona independente do Web Push (guards separados em `notifier.ts`).
- **Cron de notificações**: a cada minuto em `cron.ts`, chama `sendDueNotifications()`. Exclui `isComplete`, `isCancelled`, `declined`. Erro 410/404 do push provider remove a subscription automaticamente.
- **Chave pública em runtime**: `push-client.ts` faz `GET /api/push/vapid` para obter a chave — não depende de build-time env vars.

### API da secretária (leitura)
- **Base**: `/api/secretaria/*` — API REST de leitura para a "secretária de IA" (Claude/MCP). Escreita só na Fase 4, com token separado.
- **Auth**: header `Authorization: Bearer <FLOW_API_TOKEN>` (env). 401 sem token ou com token errado; 503 se `FLOW_API_TOKEN` não estiver configurado. Comparação por `crypto.timingSafeEqual`.
- **Rate limit**: 120 req/min por IP, em memória (`src/lib/secretaria-auth.ts`). Log de acesso em `[SECRETARIA]` (method, path, status, duração, ip).
- **Rota fora do NextAuth**: `api/secretaria` está na allowlist do `src/middleware.ts` — a autenticação é o bearer, não a sessão.
- **Token do Google nunca sai do servidor**: a rota usa `getValidAccessToken()` (token-store). Quem consome a API nunca vê credencial do Google.
- **Endpoints**: `GET /agendas` · `GET /eventos?de=&ate=&agenda=&status=&limite=&offset=` · `GET /eventos/proximos?minutos=` · `GET /eventos/em-aberto?dias_parado=` · `GET /eventos/por-responsavel?pessoa=` · `GET /eventos/{id}`
- **Formato do evento**: `id`, `titulo`, `agenda`, `agenda_id`, `inicio`, `fim`, `dia`, `dia_inteiro`, `status` (aberto|concluido|cancelado|recusado — derivado, não existe no Google), `responsavel`, `responsavel_email`, `atualizado_em`, `dias_em_aberto`, `descricao`, `local`, `importante`, `delegavel`, `recorrente`, `categoria`, `pilar`, `convidados`. Resposta: `{ dados: [...], paginacao: { total, limite, offset } }`.
- **Limites**: máximo 500 itens por página, janela máxima de 366 dias por consulta (acima disso, 400). Sem `de`/`ate`, o padrão é de 7 dias atrás a 60 dias à frente.
- **Feriados e datas comemorativas ficam de fora** por padrão (calendário "Feriados no Brasil" e afins) — mesmo critério do `/api/tasks/kanban`. Opt-in com `?incluir_feriados=true`. Sem isso, "Dia do Trabalho" e companhia entravam na lista de pendências e na cobrança.
- **Lógica pura** em `src/lib/secretaria.ts` (status derivado, filtros, paginação) — testável isolado.
- **Testes**: `npm run test:secretaria` — sobe o dev server com token de teste e exercita cada endpoint (token ausente/inválido, filtros, paginação, 400/404, portão de escrita, validação das tags). 31 testes, sem dependência nova (runner nativo do Node).
- **Escrita (Fase 4)**: `POST /api/secretaria/eventos` e `PATCH /api/secretaria/eventos/{id}` — `titulo`, `data`, `horaInicio`, `horaFim`, `duracaoMinutos`, `agenda`, `descricao`, `lembreteMinutos`, `pilar`, `categoria`, `delegavel`, `importante`, `responsavel`, `convidados`, `recorrencia`, `acao`. Exigem `FLOW_API_WRITE_TOKEN`.
- **D/O/E são um slot só** (como o controle segmentado do popover): `categoria` (operacional/estrategico) e `delegavel` (tag D) são **mutuamente exclusivos**. `categoria` + `delegavel: true` na mesma chamada → 400, não sobrescrita silenciosa. Escolher a categoria desliga o D; marcar o D limpa a categoria. `importante` (estrela) é independente das três.
- **Validação**: valor não-booleano em `delegavel`/`importante` → 400 (não é ignorado em silêncio). Categoria fora do enum → 400 (antes, uma categoria inválida era apagada sem aviso).

### Secretária de IA (MCP + monitoramento)
- **Servidor MCP** com as mesmas ferramentas em dois transportes: **stdio** (`mcp/server.ts`, pro Claude Code/Desktop) e **HTTP** (`/mcp` no app, pro Claude no celular via conector do claude.ai). As ferramentas são compartilhadas em `src/lib/secretaria-mcp.ts` — um só lugar, sem duplicar.
- **8 ferramentas**: 6 de leitura (`listar_eventos`, `eventos_proximos`, `eventos_em_aberto`, `eventos_por_responsavel`, `listar_agendas`, `detalhe_evento`) + 2 de escrita (`criar_evento`, `atualizar_evento`). Config: `FLOW_API_URL` + `FLOW_API_TOKEN` (+ `FLOW_API_WRITE_TOKEN` para escrita).
- **Rota `/mcp`**: `WebStandardStreamableHTTPServerTransport` (SDK 1.32) em modo **stateless** (servidor+transporte novos por requisição) → o app pode reiniciar sem quebrar o conector. `server.connect(transport)` **antes** de `handleRequest` — sem isso a resposta sai vazia. Auth por `Authorization: Bearer <FLOW_API_TOKEN>` (mesmo token da API) e CORS liberado.
- **O `Accept` é normalizado antes do transporte**: o SDK exige `application/json` **e** `text/event-stream` no POST e responde 406 se faltar um dos dois — o conector do claude.ai reporta isso como "fetch failed". A rota ainda responde no formato que o cliente pediu (JSON ou SSE) e delega GET/DELETE ao transporte.
- **Backend direto no app**: as ferramentas do `/mcp` consultam a agenda no mesmo processo (`src/lib/secretaria-service.ts`), sem hop HTTP — dentro do container `localhost:3000` não é confiável. O servidor stdio usa o backend HTTP (roda fora do app). Regra única de negócio, dois caminhos.
- **Escrita (Fase 4)**: `criar_evento` e `atualizar_evento`, liberadas só com `FLOW_API_WRITE_TOKEN`. Toda escrita exige `confirmar: true` — sem ele, a ferramenta devolve só a prévia e não grava. **Sem ferramenta de apagar** (excluir por IA não volta).
- **Marcações nas ferramentas de escrita**: `delegavel` (tag D), `importante` (estrela) e `categoria` (O/E). O `inputSchema` descreve o que cada uma é e que `responsavel` (quem entrega) ≠ `delegavel` (tag de candidata a delegação permanente, que alimenta a Revisão Semanal). `categoria` e `delegavel` são mutuamente exclusivos — pedir os dois dá 400.
- **Guarda da API**: `checkToken` aceita o token de leitura **ou** o de escrita; `guardSecretaria(req, startedAt, { exigirEscrita: true })` exige o de escrita. A API REST exige o prefixo `Bearer` — a rota `/mcp` é a única que aceita outras formas de header (limitação do conector do claude.ai).
- **Eventos de dia inteiro**: `createEvent` detecta início só-data (`YYYY-MM-DD`) e manda `start.date`/`end.date` (fim exclusivo = dia seguinte), como o Google espera.
- **`/mcp` está fora do middleware NextAuth** (igual a `/api/secretaria`) — a rota faz a própria checagem do bearer.
- **No celular**: em claude.ai, *Settings → Connectors → Add custom connector* → URL `https://flow.sitecnologia.tec.br/mcp`, autenticação **Sem login**, cabeçalho `authorization` = `Bearer <FLOW_API_WRITE_TOKEN>`. Exige **plano pago**. O app do celular usa os mesmos conectores da conta. Detalhes na seção 5.
- **Node roda o TS direto** (type stripping, Node 22.18+). Sem build — mas o `node --experimental-strip-types` **não aceita parameter properties** (`constructor(public x: number)`) nem enums. Imports entre arquivos do MCP precisam da extensão `.ts` (o `tsconfig.json` do app exclui `mcp/` por causa disso).
- **Dependências do MCP ficam na raiz** do `package.json` (SDK + zod); `mcp/package.json` só marca `"type": "module"`.
- **Monitoramento roda dentro do Flow** (decidido com o Felipe), não no n8n: o app já tem cron, Telegram e Web Push.
- **Quatro avisos** (`src/lib/secretaria-monitor.ts`, roda a cada minuto pelo cron):
  1. **Proximidade** — 1 dia antes, 1 hora antes, 10 min antes (janela de ±2 min).
  2. **Cobrança** (diária, 08:00) — delegações atrasadas, escalonando em 3/7/14 dias.
  3. **Resumo da manhã** (diária, 07:30) — o dia por agenda + conflitos de horário.
  4. **Fechamento do dia** (diário, 20:00) — pendências e o que vem amanhã.
- **Atraso é medido por `dias_em_aberto`** (computeDaysOpen/openSince), **não pela data do evento** — a migração noturna empurra as pendências pra hoje todo dia, então a data nunca "vence".
- **Janelas por agenda** (`src/lib/secretaria-regras.ts`): CF só em horário comercial (dias úteis), Pessoal fora do expediente, SI/DevPoint/YFLume o dia todo. Silêncio padrão 21:30→07:00. Tudo por env (ver `.env.example`).
- **Disparo manual** pra teste: `POST /api/cron/secretaria` com `{"qual":"resumo|cobranca|fechamento|proximidade"}` e `{"dryRun":true}` devolve o texto sem enviar.
- **Uma única ida ao Google por minuto**: o cron busca hoje+amanhã uma vez e entrega a mesma lista pro notifier e pra secretária (dobrar as buscas estourou o rate limit da API do Google).

### Delegação e cobrança
- **`delegateTo` é o responsável pela entrega**: `{ name, email }`, gravado em `extendedProperties.private` (`flowDelegateName` / `flowDelegateEmail`). **O nome é a chave**; o e-mail é opcional (só existe quando o responsável é um convidado do evento) e serve como info extra.
- **`isDelegable` é independente** — significa "pode ser delegado", não "foi delegado para X".
- **Marcação**: no `EventPopover` (edição) e no `TaskForm` (criação). Sugestões = convidados do evento (pelo nome) + os nomes já usados; o campo fica livre pra digitação.
- **Nomes já usados ficam registrados** em `/app/data/.delegate-contacts.json` (`src/lib/delegate-contacts.ts`) — contagem + última vez. Alimentados por `rememberDelegateName()` no `setEventDelegate`/`createEvent`. Lidos por `GET /api/delegates`.
- **Prazo = dia do início do evento**: evento de dia inteiro usa o prefixo literal da data, com hora usa o timezone (`getTaskGridDateKey`). Atrasado = `dueDateKey < hoje`; vence hoje = igual.
- **Painel de Cobrança**: `src/components/dashboard/CobrancaView.tsx`, alimentado por `GET /api/tasks/delegated` (180 dias atrás → 60 à frente). Recarrega toda vez que a aba é aberta. Agrupamento por nome normalizado (sem acento, minúscula) em `src/lib/delegation.ts`.
- **`extendedProperties.private` no `patch` do Google faz MERGE** (omitir mantém a chave; `null` remove). O helper `patchPrivateProps()` em `google-calendar.ts` faz GET e reenvia o mapa inteiro — não depender do merge.
- **Resumo diário no Telegram**: 08:00 em `cron.ts` → `sendDelegationDigest()`; dedup por dia em `/app/data/.delegation-digest-state.json`.

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

### 2026-10-30 — Marcações delegável/importante na escrita da secretária

**O que foi feito:**

1. **Diagnóstico**: o Claude no celular criou uma tarefa com responsável, categoria e pilar — e o evento voltou com `delegavel: false` e `importante: false`. A causa não era o Flow calculando nada: **`delegavel` e `importante` não existiam no caminho de escrita**. O `inputSchema` da `criar_evento` não tinha os campos, e o `criarEvento` só repassava `pilar`, `categoria` e `responsavel` — o `createEvent` do Google aceita `isDelegable`, mas nada na rota da secretária o preenchia. Sem parâmetro, "false" é a única saída possível, e o modelo respondeu como se fosse valor computado.
2. **`delegavel` e `importante` abertos para escrita** — MCP (`criar_evento`/`atualizar_evento`) e API REST (que usa o mesmo contrato). No `criarEvento` viram `isDelegable`/`isImportant` do `createEvent`; no `atualizarEvento` são operações próprias (`markEventDelegable`/`markEventUndelegable`/`markEventImportant`/`markEventUnimportant`), no mesmo padrão de `pilar`/`categoria`/`responsavel`.
3. **D/O/E são um slot só**, espelhando o controle segmentado do popover (decidido com o Felipe): `categoria` (O/E) e `delegavel` (D) são **mutuamente exclusivos**. Escolher a categoria desliga o D; marcar o D limpa a categoria. Pedir os dois na mesma chamada é **400 com mensagem explicativa**, não sobrescrita silenciosa.
4. **O `inputSchema` das ferramentas explica a diferença**: `responsavel` é quem fica com a entrega; `delegavel` é a tag de "candidata a delegação permanente", que alimenta a aba "Tarefas para delegar" da Revisão Semanal. As duas marcações novas também entram na prévia (o bloco sem `confirmar`).
5. **Validação que não engole erro**: valor não-booleano em `delegavel`/`importante` → 400. Categoria fora do enum → 400 (antes era apagada em silêncio — e, com a regra de exclusividade, teria derrubado o D junto).

**Arquivos modificados:** `src/lib/secretaria-backend.ts` (contrato) · `src/lib/secretaria-service.ts` (validação + gravação dos marcadores) · `src/lib/secretaria-mcp.ts` (schema, descrição e prévia) · `tests/secretaria.test.mjs` (5 casos novos) · `CLAUDE.md`

**Bug do servidor stdio (achado depois):** `mcp/server.ts` chamava `criarServidorSecretaria()` sem opções, e `podeEscrever` tem default `false` — ou seja, **o Claude Code/Desktop nunca conseguiu escrever**, com ou sem `FLOW_API_WRITE_TOKEN`. Toda escrita respondia "Este conector está com o token de LEITURA". Agora `mcp/server.ts` deriva `podeEscrever` da presença de `FLOW_API_WRITE_TOKEN`, como o README já prometia.

**Verificação:** `npx tsc --noEmit` limpo (app e mcp), `npm run build` OK, `npm run test:secretaria` → 31/31. A verificação viva contra a agenda real (criar evento de teste com as tags, conferir no popover e apagar) ficou pendente — o classificador de comandos bloqueou a escrita via curl na agenda compartilhada.

**Verificação do caminho de escrita (local, sem tocar na agenda):** contra o app local com `FLOW_API_WRITE_TOKEN`, `PATCH /api/secretaria/eventos/{id}` com id inexistente devolve — `categoria` + `delegavel: true` → **400** "mutuamente exclusivos"; `delegavel: "sim"` → **400** "deve ser booleano"; token de leitura → **401** "Token sem permissão de escrita"; `delegavel: true` válido → **404 "Evento não encontrado"**, ou seja, passou pela validação e chegou ao Google. Pelo MCP (stdio, apontado para o app local) o `listTools` expõe `delegavel` e `importante` em `criar_evento` e `atualizar_evento`, e a prévia da `atualizar_evento` mostra "• delegavel: true".

**Deploy:** o push para `main` **não** dispara build — o serviço `sintel/full_flow` está com `source.autoDeploy: false`. O deploy precisa ser acionado no EasyPanel.

**API do EasyPanel mudou** (isso quebrou todas as ferramentas do MCP `easypanel-mcp-multi`, que devolviam 404): a base deixou de ser `/api/trpc` e passou a ser `/api/rpc`; o procedimento vai no caminho com **"/"** (`projects/listProjects`), e não com ponto — o `rpc.method` com ponto é só etiqueta de telemetria; o corpo é `{ json: <input> }` e a resposta vem como `{ json: <dado> }`. Os procedimentos também mudaram de nome: `projects.list` → `projects.listProjects`, `projects.get` → `projects.inspectProject`, `services.get` → `services.app.inspectService` (o serviço é qualificado pelo tipo: app, compose, box, mysql…), `deployments.create` → `services.app.deployService`, `monitor.getServiceLogs` → `logs.queryServiceLogs`.

**Decisões:**
- **Espelhar a UI na API** (decidido com o Felipe): D/O/E exclusivos, em vez de deixar a IA marcar "operacional + delegável" ao mesmo tempo — que o popover não representa e que o próximo salvamento pela interface apagaria.
- **Erro explícito em vez de precedência silenciosa**: quando a IA erra a combinação, ela recebe o 400 e escolhe de novo, em vez de o app adivinhar o que ela quis dizer.

**Próximos passos:**
1. **Redeploy** do serviço `sintel/full_flow` no EasyPanel (o push para `main` não basta — `autoDeploy: false`).
2. **Dar `FLOW_API_WRITE_TOKEN` ao conector do Claude Code** — o `~/.claude.json` atual só tem o token de leitura, e é por isso que `atualizar_evento` responde "este conector só lê".
3. **Marcar o evento do Chrome** (`5mq9q3n9cvf09u4r9bragv0jao`) com `delegavel: true` — **atenção**: pela exclusividade, isso limpa a categoria "operacional" dele; se preferir manter "operacional", o evento fica como está (a tag D é inacessível por design).

O script `mcp/aplica-delegavel.mjs` faz o passo 3 pelo mesmo caminho que o Claude no celular usa (servidor MCP → API de escrita): primeiro mostra a prévia, depois grava com `confirmar: true`. Ele só funciona depois do redeploy (é o servidor de produção que precisa conhecer o campo `delegavel`) e com o token de escrita no ambiente.

---

### 2026-10-29 (c) — Fase 4: escrita no Flow pelo Claude (MCP)

**O que foi feito:**

1. **Duas ferramentas de escrita** no MCP: `criar_evento` e `atualizar_evento` (com `acao: "concluir"`). O Claude no celular agora cria e edita eventos direto no Flow, em vez de usar o Google Calendar dele — o que perderia migração, pilares, lembrete e cobrança.
2. **Token de escrita separado** (`FLOW_API_WRITE_TOKEN`). O token de leitura continua só leitura: com ele, as ferramentas de escrita respondem "este conector não tem permissão de escrita". O token de escrita também lê (é superconjunto). No conector do claude.ai, é o token de escrita que dá poder de criar.
3. **Confirmação obrigatória**: toda escrita exige `confirmar: true`. Sem o campo, a ferramenta devolve **só a prévia** do que vai acontecer — a descrição da ferramenta manda o Claude mostrar a prévia e só repetir a chamada depois que o usuário autorizar. É o que segura a escrita no celular, onde o conector roda em "sempre permitir".
4. **Endpoints HTTP de escrita**: `POST /api/secretaria/eventos` e `PATCH /api/secretaria/eventos/{id}`, com `exigirEscrita` na guarda. O `checkToken` passou a aceitar token de leitura **ou** de escrita; a exigência de escrita é opt-in por rota.
5. **Payload tolerante**: as funções de escrita aceitam camelCase **e** snake_case (as ferramentas MCP falam snake_case, a API HTTP camelCase). Sem normalizar, um campo em snake_case era ignorado em silêncio — o pior tipo de bug numa escrita.
6. **`createEvent` passou a criar evento de dia inteiro** quando o início é só data (`YYYY-MM-DD`), com fim exclusivo (dia seguinte), como o Google espera.

**Bugs achados no caminho:**
- `acao: "concluir"` encerrava o fluxo e descartava os outros campos da mesma chamada (o título não era alterado). Concluir passou a ser a última etapa.
- A API REST passou a aceitar token sem o prefixo `Bearer` (quebrava o contrato documentado) — a tolerância ficou só na rota `/mcp`, que é onde o conector do claude.ai limita os cabeçalhos.

**Arquivos novos:** (nenhum — a Fase 4 cabia nos arquivos da Fase 1/2)
**Arquivos modificados:** `src/lib/secretaria-service.ts` (escrita) · `src/lib/secretaria-backend.ts` (contrato) · `src/lib/secretaria-mcp.ts` (ferramentas) · `src/lib/secretaria-auth.ts` (token de escrita) · `src/lib/secretaria-route.ts` · `src/lib/google-calendar.ts` (dia inteiro) · `src/app/mcp/route.ts` · `src/app/api/secretaria/eventos/route.ts` · `src/app/api/secretaria/eventos/[id]/route.ts` · `tests/secretaria.test.mjs` · `.env.example` · `mcp/README.md`

**Verificação:** `npx tsc --noEmit` limpo, `npm run build` OK, `npm run test:secretaria` → 26/26 (5 novos: portão de escrita e validação — sem gravar nada na agenda real). À mão, contra a agenda real: criação com hora, criação de dia inteiro, mover (data + hora), alterar título + concluir em uma chamada; token de leitura barrado na escrita; prévia **sem** `confirmar` não gravou nada. Eventos de teste apagados no fim.

**Decisões:**
- **Fase 4 liberada com o Felipe** ("Implementar Fase 4 agora") — antes estava adiada por decisão do plano
- **Confirmação no schema (`confirmar: true`)**, e não um diálogo do app: é o que funciona num conector remoto que não tem UI de aprovação
- **Sem ferramenta de apagar**: excluir evento por IA é o tipo de operação que não volta — fica fora

**Próximos passos:** no EasyPanel, gerar `FLOW_API_WRITE_TOKEN` e trocar o header do conector do claude.ai para esse token; aí o Claude cria eventos no Flow.

---

### 2026-10-29 (b) — Conector do claude.ai: "fetch failed" no /mcp

**O que foi feito:**

1. **Compatibilidade do protocolo MCP na rota `/mcp`** — o SDK oficial exige que o POST traga `Accept` com `application/json` **E** `text/event-stream`; cliente que manda só um dos dois levava 406, e o conector da Anthropic reportava isso como o genérico "fetch failed". A rota agora normaliza o `Accept`, responde no formato que o cliente pediu (JSON ou SSE), delega GET/DELETE ao transporte (o protocolo permite stream SSE via GET) e derruba o keep-alive do stream de 15s pra 1s (os headers saem na hora).
2. **Fim do hop interno de rede** — a lógica de consulta da secretária saiu das rotas e foi pra `src/lib/secretaria-service.ts`. O MCP do app agora usa um backend **direto** (mesmo processo, sem HTTP): dentro do container, `localhost:3000` não era alcançável (o erro real era 504/fetch failed do MCP pra API). O servidor stdio continua pelo backend HTTP, porque ele roda fora do app.
3. **Contrato do backend** em `src/lib/secretaria-backend.ts` (só tipos, sem import — o MCP roda TypeScript direto pelo Node e não resolve o alias `@/`).
4. **Timeout de 30s** nas chamadas do MCP pra API, com mensagem clara; **log `[MCP]`** em toda requisição (method, status, duração, accept, protocolo, sessão, IP, UA).

**Arquivos novos:** `src/lib/secretaria-service.ts` · `src/lib/secretaria-backend.ts`
**Arquivos modificados:** `src/app/mcp/route.ts` · `src/lib/secretaria-mcp.ts` · as 6 rotas de `src/app/api/secretaria/**` · `mcp/README.md`
**Decisões:**
- **Backend direto no app, HTTP no stdio** — o token do Google já está no processo do app; o hop só trazia risco de porta/DNS/proxy
- **Uma implementação da regra de negócio** (serviço) consumida pelas rotas HTTP e pelo MCP — resposta idêntica nos dois caminhos, sem cópia

**Verificação:** `npx tsc --noEmit` limpo (app e mcp), `npm run build` OK, `npm run test:secretaria` → 21/21, `mcp/smoke-test.mjs` (stdio, backend HTTP) OK, e as 6 ferramentas do `/mcp` (backend direto) devolvendo a agenda real.

**Próximos passos:** redeploy no EasyPanel e reteste no conector do claude.ai (celular).

---

### 2026-10-29 — Secretária de IA: MCP (fase 2) + monitoramento (fase 3)

**O que foi feito:**

1. **Servidor MCP** em `mcp/` — TypeScript no stdio, 6 ferramentas de leitura, chamando a API REST do Flow. `mcp/README.md` traz o registro no Claude Code e no Claude Desktop. Dependências isoladas no `mcp/package.json` (SDK oficial + zod 4).
2. **Monitoramento dentro do Flow** (sem n8n, como decidido): lembretes de proximidade (1 dia/1h/10min), cobrança escalonada das delegações atrasadas (3/7/14 dias), resumo da manhã e fechamento do dia — tudo no Telegram.
3. **Disparo manual** `POST /api/cron/secretaria` — com `dryRun` devolve o texto sem enviar, pra testar na hora.
4. **O digest antigo (`delegation-digest.ts`) foi removido** — a cobrança nova faz o mesmo trabalho, com escalonamento.

**Bugs achados e corrigidos no caminho:**
- **A busca da agenda duplicava** entre notifier e secretária → o Google estourou o rate limit. Agora o cron busca uma vez e entrega a mesma lista pros dois.
- **"Atrasada" era medida pela data do evento** — sem sentido aqui, porque a migração noturna empurra tudo pra hoje. Agora usa `dias_em_aberto` (openSince).
- **Conflitos de horário inúteis** (listavam todos os pares) → agrupados por union-find, e eventos com mais de 4h (tempo aberto/marcador) não bloqueiam horário.
- **Janela de ±1,2 min no degrau de 10 min** era apertada demais pro cron → ±2 min.
- **`secretariaAtiva()` exigia `TELEGRAM_CHAT_ID`** → em ambiente sem Telegram, o monitor inteiro nem rodava (e o disparo manual não funcionava).

**Verificação:** `npx tsc --noEmit` limpo (app e mcp), `npm run build` OK, `npm run test:secretaria` → 21/21. Testado ao vivo contra a agenda real: os quatro tipos de mensagem foram montados e conferidos (resumo, cobrança, fechamento e proximidade — o de proximidade disparou de verdade num evento de teste, e o dedup segurou o segundo disparo). Os 6 eventos de teste foram apagados.

**Decisões:**
- **Fase 3 dentro do Flow, não n8n** (decidido com o Felipe) — o app já tem cron, Telegram e Web Push; n8n seria mais uma peça.
- **Canal: só Telegram** (decidido).
- **MCP em TypeScript no repo** (decidido) — uma pasta à parte, com `package.json` e `tsconfig.json` próprios; o `tsconfig.json` do app exclui `mcp/` (imports com extensão `.ts`).
- **Janela por agenda** implementada conforme o plano (CF só em horário comercial, Pessoal fora do expediente, SI/DevPoint/YFLume o dia todo).

**Arquivos novos:** `mcp/` (server.ts, flow-api.ts, smoke-test.mjs, README.md, package.json, tsconfig.json) · `src/lib/secretaria-monitor.ts` · `src/lib/secretaria-regras.ts` · `src/app/api/cron/secretaria/route.ts`
**Arquivos alterados:** `src/lib/cron.ts` · `src/lib/notifier.ts` · `tsconfig.json` · `.env.example` · `.gitignore` · `CLAUDE.md`
**Removidos:** `src/lib/delegation-digest.ts`

**Próximos passos:** Fase 4 (ações de escrita com confirmação) — só depois de alguns dias de uso do monitoramento.

---

### 2026-10-28 (b) — API da secretária (Fase 1)

**O que foi feito:**

1. **API REST de leitura** em `/api/secretaria/*` — base pra secretária de IA (Claude/MCP). Seis endpoints: `agendas`, `eventos`, `eventos/proximos`, `eventos/em-aberto`, `eventos/por-responsavel`, `eventos/{id}`.
2. **Auth por bearer token** (`FLOW_API_TOKEN` no env), com comparação timing-safe, rate limit de 120 req/min por IP e log de acesso. `api/secretaria` foi pra allowlist do middleware — a sessão NextAuth não vale pra ela.
3. **Dois campos que o plano pedia e o app não tinha**: `status` (derivado: aberto/concluído/cancelado/recusado) e `atualizado_em` (mapeado do `updated` do Google — novo `updatedAt` no `FlowTask`).
4. **Normalização de texto compartilhada** — `normalizeText` saiu do `google-calendar.ts` pra `src/lib/text.ts` (o `normalizeForSearch` virou wrapper, sem quebrar quem usava).
5. **Testes** — `npm run test:secretaria`: 19 testes de integração HTTP (sobe o dev server com token de teste). Sem dependência nova: runner nativo do Node (`node --test`), arquivo em JS puro.

**Decisões tomadas:**
- **Monitoramento vai DENTRO do Flow, não no n8n** (decidido com o Felipe) — o app já tem cron a cada minuto, Telegram e Web Push; n8n seria mais uma peça sem ganho
- **Canal de aviso: Telegram** (decidido) — já integrado, sem cadastro nem custo
- **MCP em TypeScript no próprio repo** (decidido) — mesma stack, tipagem compartilhada com a API
- **Lógica pura isolada em `src/lib/secretaria.ts`** — status/filtros/paginação testáveis sem HTTP
- **Janela máxima de 366 dias por consulta** — sem isso, uma query de 100 anos no Google demorava 30s
- **`getEventFromAnyCalendar` paraleliza** as buscas entre agendas — em série, o detalhe de um evento levava dezenas de segundos
- **Agendas da secretária são as "reader"**, não só as graváveis — a API é de leitura e precisa enxergar as compartilhadas só-leitura

**Divergência com o plano:** o plano cita as agendas CF, Pessoal, Infotec e DevPoint — as reais são **TI CF Contabilidade, Soluções Inteligentes, Felipe Oliveira, DevPoint e YFLume** (não existe Infotec).

**Arquivos modificados/novos:**
- `src/lib/secretaria.ts` (novo) — lógica pura da API
- `src/lib/secretaria-auth.ts` (novo) — bearer token, rate limit, log
- `src/lib/secretaria-route.ts` (novo) — envelope comum das rotas (guarda, token do Google, erro, log)
- `src/lib/text.ts` (novo) — normalização de texto
- `src/app/api/secretaria/**` (novo) — 6 rotas
- `src/lib/google-calendar.ts` — `mapEvent` mapeia `updated`; `listReadableCalendars` e `getEventFromAnyCalendar` novos; `normalizeForSearch` delegando pro `text.ts`
- `src/types/task.ts` — `updatedAt`
- `src/middleware.ts` — `api/secretaria` na allowlist
- `src/lib/delegation.ts` — `normalizeDelegateName` movido pra cá (o `delegate-contacts.ts` importava, mas ele usa `fs` e não pode entrar no bundle do cliente)
- `tests/secretaria.test.mjs` (novo) + `package.json` (script `test:secretaria`)
- `.env.example` — `FLOW_API_TOKEN`

**Verificação:** `npx tsc --noEmit` limpo, `npm run build` OK (6 rotas registradas), `npm run test:secretaria` → 19/19 passando.

**Próximos passos:** Fase 2 (servidor MCP em TypeScript) e Fase 3 (monitoramento no Flow com Telegram), aguardando o OK.

---

### 2026-10-28

**O que foi feito:**

1. **Responsável pela entrega (`delegateTo`)** — Novo campo na tarefa: quem você delegou. Persistido em `extendedProperties.private` (`flowDelegateEmail` + `flowDelegateName`), sem banco de dados. Marcável na edição do evento (bloco "Delegar para" no `EventPopover`) e na criação (`TaskForm`). A lista de responsáveis vem dos **convidados do próprio evento** (clicar num convidado define o responsável) ou digitando o e-mail, com as sugestões de `/api/attendees/frequent`. Aparece no modo leitura do popover e como ícone 👤 ciano nos cards do calendário.
2. **Painel de Cobrança** — Nova visão no header (ícone de alerta, badge vermelho com o nº de atrasadas). Agrupa as delegações por pessoa, com atrasadas no topo (`venceu 12/10`, `venceu há 3 dias`), vence hoje em âmbar e as em dia em branco. Botão ✓ pra concluir direto do painel. Abas "Atrasadas" / "Todas".
3. **Endpoint `/api/tasks/delegated`** — Devolve os eventos com responsável numa janela de 180 dias atrás a 60 dias à frente (já concluídos/cancelados fora). O `CalendarView` carrega em background pra alimentar o badge do header.
4. **Resumo diário no Telegram (opcional, ativo)** — Job às 08:00 no `cron.ts` manda as delegações atrasadas agrupadas por pessoa. Estado de dedup em `/app/data/.delegation-digest-state.json` (um envio por dia).

**Arquivos modificados:**
- `src/types/task.ts` — `TaskDelegate` + `delegateTo` em `FlowTask`/`CreateTaskInput`/`UpdateTaskInput`
- `src/lib/google-calendar.ts` — `mapEvent` lê a delegação; `createEvent` grava; nova `setEventDelegate`; helper `patchPrivateProps` (GET + reenvia o `private` map inteiro) aplicado nos marcadores de importante/delegável/categoria/pilar e na gravação do lembrete
- `src/lib/delegation.ts` — novo: prazo do evento, status (atrasado/hoje/futuro) e agrupamento por responsável
- `src/lib/delegation-digest.ts` — novo: resumo diário pro Telegram
- `src/app/api/tasks/delegated/route.ts` — novo
- `src/app/api/tasks/[eventId]/route.ts` — branch `delegateTo` no PATCH
- `src/components/dashboard/CobrancaView.tsx` — novo
- `src/components/calendar/EventPopover.tsx` — leitura + edição da delegação
- `src/components/tasks/TaskForm.tsx` — delegação na criação
- `src/components/calendar/CalendarView.tsx` — modo de visualização unificado (`mode`), badge + painel de cobrança, PATCH separado da delegação
- `src/components/tasks/TaskBlock.tsx`, `TaskItem.tsx` — ícone 👤
- `src/lib/cron.ts` — job diário das 08:00

**Decisões tomadas:**
- `isDelegable` ("isto é delegável") e `delegateTo` ("isto foi delegado para X") são independentes — um não implica o outro
- A delegação é uma operação de PATCH dedicada (igual `isImportant`/`pillar`), não entra no payload geral do `updateEvent` — o `PATCH` da API tem branches exclusivos e o campo novo seria ignorado no caminho genérico
- Prazo = dia do início do evento; evento de dia inteiro usa o prefixo literal da data, com hora usa o timezone do app (regra de `getTaskGridDateKey`)
- `extendedProperties.private` no `patch` do Google faz **merge** (omitir = manter, `null` = remover) — confirmado na doc oficial. O helper `patchPrivateProps` reenvia o mapa inteiro pra não depender do comportamento de merge
- Recorrentes: a delegação vale só para a ocorrência editada (scope `this`), como as outras marcações
- Badge no header em vez de só o painel: o painel exige abrir o app, o badge te puxa pra cobrar

**Verificação:** `npx tsc --noEmit` limpo e `npm run build` OK. Testado ao vivo contra o Google Calendar real (dev local com token válido): criação com `delegateTo` grava e devolve, `/api/tasks/delegated` lista, PATCH troca o responsável, marcar como importante não apaga a delegação, `delegateTo: null` remove (preservando o "importante"), evento de teste apagado no final.

**Ajustes na mesma sessão (feedback do Felipe):**
- **Painel de cobrança recarrega sozinho** ao abrir a aba (`useEffect` no `mode === "cobranca"`), não só no boot.
- **Ícone da cobrança trocado** — era o triângulo de alerta, já usado pra evento em atraso/conflito. Agora é o ícone de pessoas (`user-group`), sem colisão com o triângulo nem com o clipboard da Revisão Semanal.
- **Responsável passa a ser identificado pelo NOME**, não pelo e-mail. `TaskDelegate` continua com `name` + `email`, mas o nome é a chave: o e-mail vira informação extra (só existe quando o responsável é um convidado do evento). `delegateTo` sem e-mail é válido.
- **Nomes já usados ficam registrados** em `/app/data/.delegate-contacts.json` (contagem + última vez), alimentados por `rememberDelegateName()` no `setEventDelegate`/`createEvent`. O seletor "Delegar para" sugere esses nomes + os convidados do evento (pelo nome), e o campo fica livre pra digitação quando a pessoa não estiver na lista.
- **Agrupamento do painel por nome normalizado** (sem acento, minúsculo) — "Maria" e "maria silva" caem no mesmo grupo.

**Arquivos modificados (ajustes):** `src/types/task.ts`, `src/lib/delegation.ts`, `src/lib/delegate-contacts.ts` (novo), `src/lib/google-calendar.ts`, `src/lib/delegation-digest.ts`, `src/app/api/delegates/route.ts` (novo), `src/app/api/tasks/delegated/route.ts`, `src/components/calendar/CalendarView.tsx`, `src/components/calendar/EventPopover.tsx`, `src/components/tasks/TaskForm.tsx`, `.gitignore`

**Verificação (ajustes):** `npx tsc --noEmit` limpo e `npm run build` OK. Ao vivo: evento criado com `delegateTo` só com nome (sem e-mail) é gravado e listado; `/api/delegates` registra "Maria Silva"; trocar a caixa do nome ("maria silva") mantém a mesma pessoa no contador; evento de teste apagado no fim.

**Próximos passos:** conferir visualmente o painel de cobrança e o bloco "Delegar para" no `npm run dev`; redeploy no EasyPanel.

---

### 2026-10-26

**O que foi feito:**

1. **Calendário começa no domingo** — As views semanal e mensal passaram a ordenar as colunas de domingo a sábado (antes começavam na segunda). A grade do mês agora mostra os cabeçalhos `Dom Seg Ter Qua Qui Sex Sáb`, com os dias de overflow do mês anterior/Seguinte esmaecidos nas pontas.
2. **Fim de semana da semana em uma constante** — Criado `WEEK_STARTS_ON = 0` em `src/lib/timezone.ts` (módulo que já é dono da semântica de data/dia-da-semana do projeto, com a convenção `0 = domingo`). A constante é usada em `MonthView`, `WeekView` e `CalendarView`, evitando `0` mágico espalhado — voltar pra segunda no futuro é uma edição de uma linha só.
3. **Janela de fetch e cabeçalho sincronizados** — `CalendarView` passou a calcular a faixa de busca do mês/semana com o mesmo `weekStartsOn` da grade. Sem isso, mudar só as colunas visuais cortaria ou duplicaria eventos nas bordas da semana.
4. **Consistência no dashboard e nas estatísticas** — O heatmap anual do dashboard (colunas D S T Q Q S S) e os "Pilares da semana atual" do endpoint `/api/stats` passaram a usar domingo como início da semana.
5. **Verificação** — `npx tsc --noEmit` limpo e `npm run build` OK. Validação visual não foi feita (decidido pular): não há biblioteca de automação de browser no projeto e o `npm run dev` foi encerrado ao fim da sessão.

**Arquivos modificados:**
- `src/lib/timezone.ts` — nova constante exportada `WEEK_STARTS_ON`
- `src/components/calendar/MonthView.tsx` — `DAY_NAMES` reordenado (Dom→Sáb) + `startOfWeek`/`endOfWeek` com `WEEK_STARTS_ON`
- `src/components/calendar/WeekView.tsx` — `weekStart`/`weekDays` com `WEEK_STARTS_ON`
- `src/components/calendar/CalendarView.tsx` — faixa de fetch e rótulo do header da semana/mês com `WEEK_STARTS_ON`
- `src/app/api/stats/route.ts` — "Pilares da semana atual" agora começa no domingo
- `src/components/dashboard/DashboardView.tsx` — heatmap anual em colunas Dom→Sáb

**Decisões tomadas:**
- Constante centralizada em `src/lib/timezone.ts` em vez de exportar de `calendarLayout.ts` — segue o mesmo raciocínio de `isBusinessHoursCalendar` (vindo de `pillar-config.ts`), que já virou export único compartilhado
- Escopo além das duas views pedidas (dashboard + `/api/stats`) — a ordem de semana ficaria incoerente entre telas se só a grade mudasse
- Nenhuma biblioteca nova instalada (regra do projeto); validação visual deixada para o usuário

**Próximos passos:** conferir visualmente as views semanal e mensal no `npm run dev`; redeploy no EasyPanel.

---

### 2026-10-13

**O que foi feito:**

1. **Bot Telegram com caminho de ENTRADA** — Webhook em `/api/telegram/webhook` (POST) que recebe updates do Telegram, valida `X-Telegram-Bot-Api-Secret-Token` + `TELEGRAM_USER_ID`, e despacha `message`/`callback_query`. O bot pode ler agenda (`/hoje`, `/amanha`, `/semana`, `/buscar`), criar eventos (`/criar` literal ou frase livre via Claude), confirmar criação com botões inline (`[✅ Criar] [✏ Editar] [❌ Cancelar]`), concluir (`/concluir` ou "já fiz X") e apagar (`/cancelar` ou "apaga X"). `/undo` desfaz o último batch (TTL 60s, em memória).
2. **NLP via Claude (`parseChatIntent`)** — Wrapper separado do `extractEventFieldsFromMedia` com prompt otimizado pra frases curtas de chat. Modelo `claude-opus-5` com `output_config.effort: "low"`, schema JSON estruturado retornando `kind ∈ {create, query, complete, delete, unknown}`. Manda `sendChatAction("typing")` antes pra dar feedback enquanto processa.
3. **Auto-setWebhook idempotente no `instrumentation.ts`** — `ensureTelegramWebhook` só chama `setWebhook` se `getWebhookInfo.url` divergir da `TELEGRAM_WEBHOOK_URL`. `ensureMyCommands` registra o menu de comandos (uma vez).
4. **`src/lib/telegram.ts` estendido** — `sendTelegramMessage` aceita `reply_markup` (InlineKeyboardMarkup), adicionados `editTelegramMessage`, `answerTelegramCallbackQuery`, `sendTelegramChatAction`, `ensureTelegramWebhook`, `ensureMyCommands`. API única via `callTelegram(method, body)`, sem dependência nova.
5. **Segurança** — `TELEGRAM_USER_ID` obrigatório (se ausente, bot rejeita TUDO). Dedup de `update_id` em `Set` com cap 1000 (replay defense). Resposta 200 imediata, processamento em background.
6. **Allowlist no middleware** — `api/telegram` adicionado ao matcher para o webhook não ser barrado pelo NextAuth.

**Arquivos modificados:**
- `src/lib/telegram.ts` — reescrito: `callTelegram`, `sendTelegramMessage` (com `replyMarkup`), `editTelegramMessage`, `answerTelegramCallbackQuery`, `sendTelegramChatAction`, `ensureTelegramWebhook`, `ensureMyCommands`
- `src/middleware.ts` — `api/telegram` na allowlist
- `src/instrumentation.ts` — `ensureTelegramWebhook` + `ensureMyCommands` no boot
- `.env.example` — documentadas `TELEGRAM_USER_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL`
- **Criados** (bot):
  - `src/app/api/telegram/webhook/route.ts` — POST handler com validação de secret
  - `src/lib/telegram-bot/types.ts` — `TgUpdate`, `TgMessage`, `TgCallbackQuery`, `ChatIntent`, `UndoBatch`, `PendingCreate`
  - `src/lib/telegram-bot/security.ts` — `isAuthorizedUpdate` (user_id + dedup)
  - `src/lib/telegram-bot/formatter.ts` — `escapeHtml`, `formatDateBr`, `formatTimeRange`, `formatTaskLine`, `formatTaskList`
  - `src/lib/telegram-bot/undo.ts` — `undoStore` + `pendingCreates` em memória com cleanup
  - `src/lib/telegram-bot/intent.ts` — `parseChatIntent` (Claude com prompt próprio)
  - `src/lib/telegram-bot/commands.ts` — handlers de `/hoje`, `/amanha`, `/semana`, `/buscar`, `/criar`, `/concluir`, `/cancelar`, `/undo`, `/help`, `/start`
  - `src/lib/telegram-bot/index.ts` — dispatcher + handler de `callback_query` (preview inline)

**Decisões tomadas:**
- **Fetch puro, sem telegraf** — já tínhamos `fetch` em `telegram.ts`; manter consistência e zero dep nova
- **NLP com Claude em vez de regex/keywords** — coerente com a stack (já usado em file/voice event); `parseChatIntent` é separado de `extractEventFieldsFromMedia` porque prompt otimizado pra conteúdo colado não serve pra frases curtas de chat
- **Preview com botões inline** — `callback_query` handler adicionado no v1 a pedido do Felipe (em vez de criar-direto + /undo)
- **`TELEGRAM_USER_ID` obrigatório** — se a env sumir, bot para tudo (default seguro)
- **`X-Telegram-Bot-Api-Secret-Token` nativo** — header padrão do `setWebhook`, em vez de inventar header custom
- **Estado de undo/pending em memória** — TTL curto (60s/5min), restart perde (aceitável)
- **`createEvent` sem `isAllDay`** — campo derivado do `startTime`/`endTime` (date vs dateTime) em `CreateTaskInput`; removido na chamada
- **Set/Map iter trocados por `forEach`** — tsconfig do Next sem `target` (defaulta es5); iteração direta falhava type-check

**Próximos passos:**
- Testar localmente com `ngrok` + `npm run dev` (validar `/hoje`, criação por NLP, undo)
- Em produção: adicionar envs no EasyPanel, fazer commit+push, verificar `[TELEGRAM] webhook registrado: <url>` nos logs do boot
- Pegar `TEGRAM_USER_ID` via `https://api.telegram.org/bot<TOKEN>/getUpdates` antes do primeiro `setWebhook`
- Possíveis melhorias (segundo corte): edição via NLP depois do preview, paginação de listas grandes, mover entre calendários, recorrência via chat, undo persistente em arquivo

---

**O que foi feito:**

1. **Lembrete configurável por evento** — Campo de lembrete na criação (`TaskForm`) e edição (`EventPopover`), com opções 5/10/15/30min, 1h/2h/1dia + "Outro…" em minutos personalizados. Persistido em `extendedProperties.private.flowReminderMinutes` (não usa o `reminders` nativo do Google, para não duplicar aviso com o notifier próprio do Flow).
2. **Notificador do Flow respeita o lembrete por evento** — `sendDueNotifications()` deixou de ter janela fixa (4–6 min antes de todo evento) e agora dispara no minuto exato de `startTime - reminderMinutes` de cada evento (janela ±1min, cron roda a cada minuto). Passou a buscar eventos de hoje **e amanhã** (`shiftDateKey`) para cobrir o lembrete de 1 dia antes. Chave de dedup em `.notified-today.json` ganhou o sufixo `#{minutos}`.
3. Eventos sem `reminderMinutes` gravado continuam notificando a 5 min antes (default preservado — sem regressão nos eventos já existentes).

**Arquivos modificados:**
- `src/lib/reminder.ts` — novo módulo: `DEFAULT_REMINDER_MINUTES`, `REMINDER_OPTIONS`, `parseReminderProp`, `serializeReminder`, `formatReminderLead`
- `src/types/task.ts` — `reminderMinutes?: number | null` em `FlowTask`, `CreateTaskInput`, `UpdateTaskInput`
- `src/lib/google-calendar.ts` — `mapEvent` lê `flowReminderMinutes`; `createEvent`, `updateEvent` (incluindo o caminho `thisAndFollowing`) gravam
- `src/app/api/tasks/[eventId]/route.ts` — `reminderMinutes` incluído no gate `hasUpdateFields`
- `src/components/tasks/TaskForm.tsx` — UI de lembrete (grid de chips + campo "Outro…"), só na criação
- `src/components/calendar/EventPopover.tsx` — UI de lembrete no modo edição; linha "🔔 X antes" no modo leitura
- `src/lib/notifier.ts` — gatilho por evento em vez de janela fixa global

**Decisões tomadas:**
- Notificador do Flow (Web Push + Telegram) em vez do `reminders` nativo do Google — evita dois avisos para o mesmo evento e reaproveita o canal Telegram já existente
- `undefined` = default do Flow (5min, comportamento antigo), `null` = lembrete desligado — evita reescrever `extendedProperties` em todos os eventos já criados

**Próximos passos:** testar manualmente no `npm run dev` — criar/editar evento com cada opção de lembrete e confirmar chegada (ou ausência) do aviso no Telegram; não testado contra o Google Calendar real nesta sessão, só validação de tipos e build.

---

### 2026-08-10

**O que foi feito:**

1. **Migração pula fim de semana para o TI CF Contabilidade** — Eventos pendentes desse calendário não são mais empurrados pela migração automática/manual para sábado ou domingo: se a origem é dia útil, o destino avança direto para a próxima segunda (`toNextBusinessDateKey`). Se o evento já estava no fim de semana (colocado lá manualmente), o fluxo segue normal (sábado→domingo, domingo→segunda) — colocar evento desse calendário no fim de semana continua permitido manualmente.
2. Predicado `isBusinessHoursCalendar()` (antes privado em `calendarLayout.ts`, usado só pelo auto-fit 08h-18h) virou export único em `pillar-config.ts`, reaproveitado pela migração.
3. Também atualizado o Claude Code CLI (`2.1.220` → `2.1.227`).

**Arquivos modificados:**
- `src/lib/pillar-config.ts` — export `isBusinessHoursCalendar()`
- `src/components/calendar/calendarLayout.ts` — importa de `pillar-config` em vez de definir localmente
- `src/lib/timezone.ts` — `getWeekdayForDateKey`, `isWeekendDateKey`, `toNextBusinessDateKey`
- `src/lib/migration.ts` — `resolveTargetDateKey()` por evento nos loops timed/all-day; `MigrationDiagnostics.deferredToBusinessDay`; anotação "(dia útil, YYYY-MM-DD)" no `details` do toast quando o evento desvia

**Decisões tomadas:**
- Regra restrita ao match `"cf contabilidade"` (mesmo predicado do horário comercial) — outros calendários seguem +1 dia corrido
- Vale também no botão manual de migrar da UI (que sempre manda `fromDate`/`toDate`) — "manual" na regra do usuário significa criar/arrastar evento direto no calendário, não o botão de migração
- `cron.ts` e a rota `/api/cron/migrate` não mudaram — a regra fica isolada dentro de `runMigration`

**Próximos passos:** testar manualmente no `npm run dev` com um evento pendente do TI CF Contabilidade numa sexta-feira (não testado contra o Google Calendar real nesta sessão — só validação de tipos, build e lógica isolada).

**Commits:** `43b868b`

---

### 2026-08-04

**O que foi feito:**

1. **Registrar vários eventos a partir de um único print/texto/voz** — `extractEventFieldsFromMedia()` (`claude-event-parser.ts`) agora retorna uma lista de eventos (schema `{ events: [...] }`) em vez de um único objeto; a IA extrai todos os eventos presentes em um print (ex.: post de divulgação com várias datas), com regra explícita para "21 e 22 de agosto, 08h às 20h" virar 2 itens (um por dia). Vale tanto pro fluxo de arquivo/imagem/texto (FAB ciano) quanto pro de voz (FAB roxo) — ditar mais de um evento na mesma gravação também extrai a lista.
2. **Fluxo de revisão: fila de `TaskForm`, não lista com checkbox** — Primeira versão mostrava uma tela de revisão em lista (checkbox + campos básicos inline); trocada por uma fila de modais `TaskForm` completos (duração rápida, pilar, categoria O/E/D, convidados, recorrência, importante, descrição, detecção de conflito) — um evento por vez, com "Novo evento — N de M" + bolinhas de progresso no cabeçalho e rodapé "Pular" / "Criar e próximo". `key={queue-${queueIndex}}` no `TaskForm` garante remontagem entre eventos (sem vazar estado de um pro outro). X no topo encerra a fila inteira; toast final reporta criados + descartados.
3. **Fix produção: `maxItems` rejeitado pela API da Anthropic** — `output_config.format.schema` não aceita `maxItems` em propriedade `array`; causava 400 em toda extração (print e texto) em produção. Removido do schema.

**Arquivos modificados:**
- `src/lib/claude-event-parser.ts` — schema em lista (`EVENT_OBJECT_SCHEMA` + wrapper `events`), prompt com regra de eventos múltiplos/multi-dia (mídia e voz)
- `src/app/api/file-event/parse/route.ts`, `src/app/api/voice-event/parse/route.ts` — retornam `{ events, parsed: events[0] }`
- `src/components/calendar/FileCaptureModal.tsx` — `onMultipleResults` no lugar da revisão em lista
- `src/components/calendar/VoiceCaptureModal.tsx` — `onMultipleResults`, mesmo tratamento do file capture
- `src/components/tasks/TaskForm.tsx` — props `queue`/`onSkip`, cabeçalho e rodapé em modo fila
- `src/components/calendar/CalendarView.tsx` — `startEventQueue`/`advanceQueue`/`cancelQueue`/`finishQueue` compartilhados entre print/texto e voz

**Decisões tomadas:**
- Fila de `TaskForm` em vez de lista com checkbox — lista só expunha 4 campos, o form tem todas as opções
- Voz reaproveita a mesma infraestrutura de fila do file capture (`startEventQueue` genérico) — sem duplicar lógica
- "Pular" descarta só aquele evento e avança; só o X do topo encerra a fila inteira

**Próximos passos:** testar manualmente a fila de voz com mais de um evento ditado (não testado ao vivo nesta sessão).

**Commits:** `a25f94a`, `279638c`, `3d0ec84`, `84e4590`

---

### 2026-08-03

**O que foi feito:**

1. **Criação de evento por texto colado + drag&drop/paste de arquivo** — `FileCaptureModal` reescrito de "recebe File e já dispara upload" para modal de captura completo com estado inicial (`idle`): dropzone com `onDragOver/onDrop`, botão "Escolher arquivo" (abre `<input type="file">` que migrou do `CalendarView` pra dentro do modal), `onPaste` no container captura imagem colada (Ctrl+V) do clipboard, e textarea para colar texto (mensagem, e-mail, convite). Preview de imagem via `URL.createObjectURL` ou chip com extensão para outros tipos. Validação client-side (10 MB, tipos aceitos) antes de enviar. "Tentar de novo" no erro volta ao `idle` preservando o conteúdo, em vez de reenviar cego.
2. **API `/api/file-event/parse`** — aceita `text` no `FormData` como alternativa a `file`; monta `MediaInput{ kind: "text" }` (trim + teto de 20.000 chars) sem passar pelas checagens de arquivo.
3. **Prompt do Claude** (`claude-event-parser.ts`) — `intro` do modo `"media"` ajustado para mencionar "texto colado" como origem possível, além de imagem/PDF/arquivo.
4. **`CalendarView.tsx`** — FAB ciano agora abre o modal direto (`showCapture: boolean` substitui `capturingFile: File | null` + `fileCaptureInputRef`), sem mais seletor de arquivo nativo direto no clique.

**Arquivos modificados:**
- `src/components/calendar/FileCaptureModal.tsx` — reescrito
- `src/components/calendar/CalendarView.tsx` — estado `showCapture`, FAB, remoção do input solto
- `src/app/api/file-event/parse/route.ts` — suporte a `text` no FormData
- `src/lib/claude-event-parser.ts` — ajuste de prompt

**Decisões tomadas:**
- Um único ponto de entrada (FAB ciano) para arquivo/imagem/texto, em vez de FAB novo dedicado a texto — evita poluir a pilha de FABs
- `onPaste` no container do modal (não no `document`) — evita captura de paste em outros contextos da app quando o modal não está aberto
- Arquivo tem precedência sobre texto se os dois estiverem preenchidos no submit
- Sem suporte a múltiplas imagens/anexo real no evento — fora de escopo, `extractEventFieldsFromMedia` monta um único bloco de mídia

**Próximos passos:** testar manualmente no `npm run dev` (colar texto, colar print, arrastar arquivo, seletor, inclusive no iPhone) — não testado nesta sessão.

---

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

---

## 7. Histórico de Sessões Anteriores

- **2026-06-11 (s4)** — Fix: eventos de convite não apareciam (`showHiddenInvitations: true`); migração exclui `declined`.
- **2026-06-11 (s3)** — Scope dialog para RSVP em recorrentes (este/seguintes/todos); divisão visual 12h na Lista.
- **2026-06-11 (s2)** — Voz IA v2 (prompt enriquecido, FAB sparkle, endpoint em 2 fases); métricas de dias em aberto por `startTime`; escopo este/seguintes/todos na edição de recorrentes; divisão visual 12h no calendário.
- **2026-06-11 (s1)** — Criação de evento por voz + IA (Whisper-1 + GPT-4o-mini), FAB roxo, `VoiceCaptureModal`.
- **2026-06-09** — Fix campo de data no `EventPopover` (mobile); notificações Web Push via PWA (`sw.js`, push-store, push-client, notifier, cron); fix VAPID key servida em runtime (não `NEXT_PUBLIC_`).
- **2026-06-08 (s2)** — Fix auto-scroll "Agora" no modo Lista com `scrollIntoView` + `scrollMarginTop`.
- **2026-06-08 (s1)** — Recorrência ao editar evento (toggle "Repetir" no `EventPopover`); textarea de descrição redimensionável.
- **2026-06-05 (s2)** — Diálogo de exclusão de evento recorrente (este/seguintes/todos); ícone de recorrência nos cards; fix auto-scroll double-rAF; cor do calendário DevPoint.
- **2026-06-05 (s1)** — Tags D/O/E; Revisão Semanal; detecção de Operacional Repetitivo; 4 Pilares no dashboard.
- **2026-06-04** — Métrica "Dias em aberto"; aba Prioridade; `flowCompletedAt`; card "Tempo médio até concluir" no dashboard.
- **2026-06-01** — Busca insensível a acentos/maiúsculas; fix "dossie" não encontrava "Dossiê"; setas de navegação fixas no header; auto-scroll confiável.
- **2026-05-26** — Auto-scroll para hora atual no modo Lista.
- **2026-04-18 (s2)** — Estrela branca para eventos importantes; nome do calendário em branco (`text-white/70`).
- **2026-04-18 (s1)** — Dashboard de desempenho (heatmap anual, barras mensais, streak), endpoint `/api/stats`, toggle calendário/dashboard no header, recorrência no formulário de criação (RRULE).
- **2026-04-17** — Flag "Importante" com estrela dourada (`colorId: "5"`, `flowImportant` em extendedProperties), ícone de estrela em todas as views, UI otimista. Fix deploy: commit manual necessário.
- **2026-04-13** — Fix migração com calendários compartilhados (`reader`), fix timezone Alpine (`% 24`), Cache-Control no-store, ícone de convidados em todas as views, view "Agenda" no DayView (agrupada por calendário com colapso).
- **Até 2026-04-12** — Criação do projeto, auth por usuário/senha substituindo Google OAuth login, views de calendário (dia/semana/3dias/mês), grade e lista, busca, migração automática e manual de eventos, drag & drop, RSVP, recurrence display, toggle grade/lista por view, FAB, auto-expand de descrições, filtros de busca case/accent insensitive.

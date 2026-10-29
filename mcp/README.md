# Secretária do Flow — servidor MCP

Ferramentas MCP que expõem a agenda do Flow para o Claude. **Só leitura**: nenhuma
ferramenta cria, altera ou apaga evento.

O MCP não fala com o Google Calendar. Ele chama a API REST (`/api/secretaria/*`) do
Flow, que roda no EasyPanel e guarda o token do Google no servidor. O MCP só conhece
o token de leitura (`FLOW_API_TOKEN`).

## Onde roda

| Onde | Transporte | Pra quê |
|---|---|---|
| `https://flow.sitecnologia.tec.br/mcp` | Streamable HTTP | **Claude no celular** (e desktop) via conector do claude.ai |
| `mcp/server.ts` | stdio | Claude Code e Claude Desktop (registro local) |

As ferramentas são as mesmas nos dois casos — o módulo compartilhado é
`src/lib/secretaria-mcp.ts`.

## Ferramentas

| Ferramenta | Pra quê |
|---|---|
| `listar_eventos` | Eventos por período, agenda e status — *"o que tenho hoje"*, *"o que tem na agenda DevPoint essa semana"* |
| `eventos_proximos` | O que começa na próxima janela — *"qual é a minha próxima reunião"* |
| `eventos_em_aberto` | Pendências (vencidas ou paradas há X dias) — *"o que está atrasado"* |
| `eventos_por_responsavel` | Eventos delegados a uma pessoa — *"o que está com o André"* |
| `listar_agendas` | Nome e id de cada agenda |
| `detalhe_evento` | Um evento pelo id, com descrição e convidados |

## Requisitos

- **Node 22.18+** (o servidor stdio roda TypeScript direto, sem build — o Node faz o strip dos tipos)
- Dependências instaladas **na raiz do repo**: `npm install` (SDK oficial do MCP + zod)

## Configuração

```bash
export FLOW_API_URL="https://flow.sitecnologia.tec.br"
export FLOW_API_TOKEN="<token de leitura>"
```

## Claude Code e Claude Desktop (stdio)

```bash
claude mcp add flow-secretaria --scope user \
  -e FLOW_API_URL=https://flow.sitecnologia.tec.br \
  -e FLOW_API_TOKEN=<token> \
  -- node --experimental-strip-types /caminho/absoluto/para/flow/mcp/server.ts
```

Para o Claude Desktop, no `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flow-secretaria": {
      "command": "node",
      "args": ["--experimental-strip-types", "/caminho/absoluto/para/flow/mcp/server.ts"],
      "env": {
        "FLOW_API_URL": "https://flow.sitecnologia.tec.br",
        "FLOW_API_TOKEN": "<token>"
      }
    }
  }
}
```

## Claude no celular (HTTP)

1. **No app do Flow** (EasyPanel): o `FLOW_API_TOKEN` já é env var do serviço.
2. **Em claude.ai** (desktop ou navegador, na mesma conta): *Settings → Connectors →
   Add custom connector*
   - **URL**: `https://flow.sitecnologia.tec.br/mcp`
   - **Header**: `Authorization: Bearer <FLOW_API_TOKEN>`
3. **No celular**: o app do Claude (iOS/Android) usa os mesmos conectores da conta —
   abra e pergunte *"o que tenho hoje na agenda?"*

> Conector customizado exige **plano pago** do Claude (Pro ou Max).

## Teste rápido

```bash
# stdio
FLOW_API_URL=... FLOW_API_TOKEN=... node mcp/smoke-test.mjs

# http
curl -s -X POST https://flow.sitecnologia.tec.br/mcp \
  -H "Authorization: Bearer $FLOW_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Regras

- **Janela máxima de 366 dias** por consulta e **500 itens** por página.
- **Feriados e datas comemorativas ficam de fora** por padrão
  (`?incluir_feriados=true` traz de volta).
- O token do Google **nunca** chega no MCP — só o token de leitura da API.

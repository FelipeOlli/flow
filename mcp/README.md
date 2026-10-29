# Secretária do Flow — servidor MCP

Servidor MCP que expõe a agenda do Flow como ferramentas do Claude. **Só leitura**:
nenhuma ferramenta cria, altera ou apaga evento — quem escreve é a API do Flow,
e ela ainda só lê.

O MCP não fala com o Google Calendar. Ele chama a API REST (`/api/secretaria/*`) do
Flow, que roda no EasyPanel e guarda o token do Google no servidor. O MCP só conhece
o token de leitura (`FLOW_API_TOKEN`).

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

- **Node 22.18+** (o servidor roda TypeScript direto, sem build — o Node faz o strip dos tipos)
- API do Flow no ar (EasyPanel) com `FLOW_API_TOKEN` configurado
- Dependências: `cd mcp && npm install`

## Configuração

```bash
export FLOW_API_URL="https://flow.sitecnologia.tec.br"
export FLOW_API_TOKEN="<token de leitura>"
```

## Rodar

```bash
cd mcp
npm install
npm start          # sobe o servidor MCP no stdio
```

## Registrar no Claude Code

```bash
claude mcp add flow-secretaria \
  --env FLOW_API_URL=https://flow.sitecnologia.tec.br \
  --env FLOW_API_TOKEN=<token> \
  -- node /caminho/absoluto/para/flow/mcp/server.ts
```

Depois de registrar, confere com `claude mcp list` e pergunta no Claude:
*"o que tenho hoje na agenda?"*

## Registrar no Claude Desktop

No `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Reinicie o Claude Desktop depois de editar.

## Teste rápido

Sobe o servidor e chama as ferramentas de verdade, contra a API configurada:

```bash
FLOW_API_URL=... FLOW_API_TOKEN=... node mcp/smoke-test.mjs
```

## Regras

- **Janela máxima de 366 dias** por consulta e **500 itens** por página.
- **Feriados e datas comemorativas ficam de fora** por padrão
  (`?incluir_feriados=true` traz de volta).
- O token do Google **nunca** chega no MCP — só o token de leitura da API.

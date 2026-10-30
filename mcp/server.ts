#!/usr/bin/env node
/**
 * Servidor MCP da secretária do Flow — transporte stdio.
 *
 * Usado no Claude Code e no Claude Desktop. As ferramentas são as mesmas
 * servidas por HTTP em /mcp (ver src/app/mcp/route.ts) — o módulo compartilhado
 * é src/lib/secretaria-mcp.ts.
 *
 * Configuração:
 *   FLOW_API_URL=https://flow.sitecnologia.tec.br
 *   FLOW_API_TOKEN=<token de leitura>
 *   FLOW_API_WRITE_TOKEN=<token de escrita> — habilita as ferramentas de escrita
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { criarServidorSecretaria } from "../src/lib/secretaria-mcp.ts";

// A escrita só liga com o token de escrita configurado. Sem ele, as
// ferramentas de escrita respondem "este conector só lê" — é o mesmo portão
// da rota /mcp, que classifica o token apresentado no pedido.
const podeEscrever = Boolean(process.env.FLOW_API_WRITE_TOKEN?.trim());

const server = criarServidorSecretaria(undefined, { podeEscrever });
await server.connect(new StdioServerTransport());
console.error("[flow-secretaria-mcp] servidor MCP iniciado (stdio)");

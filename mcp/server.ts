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
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { criarServidorSecretaria } from "../src/lib/secretaria-mcp.ts";

const server = criarServidorSecretaria();
await server.connect(new StdioServerTransport());
console.error("[flow-secretaria-mcp] servidor MCP iniciado (stdio)");

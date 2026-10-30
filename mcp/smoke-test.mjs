/**
 * Smoke test do servidor MCP: sobe o servidor, conecta como cliente MCP
 * e chama as ferramentas contra a API real.
 *
 * Uso: FLOW_API_URL=... FLOW_API_TOKEN=... node mcp/smoke-test.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

const transporte = new StdioClientTransport({
  command: "node",
  args: ["--experimental-strip-types", path.join(here, "server.ts")],
  env: { ...process.env },
  stderr: "inherit",
});

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transporte);

const { tools } = await client.listTools();
console.log(`\n✅ ferramentas: ${tools.map((t) => t.name).join(", ")}\n`);

/**
 * O schema é o que o modelo enxerga: campo ausente aqui é campo que o Claude
 * nunca vai poder pedir. Verificar pela lista de tools evita depender de uma
 * escrita real na agenda.
 */
let schemaOk = true;
for (const nome of ["criar_evento", "atualizar_evento"]) {
  const tool = tools.find((t) => t.name === nome);
  const props = tool?.inputSchema?.properties ?? {};
  const faltando = ["delegavel", "importante"].filter((c) => !(c in props));
  if (faltando.length > 0) {
    console.log(`✗ ${nome}: faltam ${faltando.join(", ")}`);
    schemaOk = false;
  } else {
    console.log(`✅ ${nome}: delegavel + importante expostos`);
  }
}
console.log();

async function chamar(nome, args = {}) {
  const res = await client.callTool({ name: nome, arguments: args });
  const texto = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  console.log(`── ${nome}(${JSON.stringify(args)})`);
  console.log(texto.split("\n").slice(0, 6).join("\n"));
  console.log();
  return texto;
}

await chamar("listar_agendas");
await chamar("listar_eventos", { de: "2026-10-27", ate: "2026-10-29", limite: 5 });
await chamar("eventos_proximos", { minutos: 240 });
await chamar("eventos_em_aberto", { dias_parado: 7 });
await chamar("eventos_por_responsavel", { pessoa: "palmeiro" });

await client.close();
console.log(schemaOk ? "✅ smoke test do MCP ok" : "✗ smoke test do MCP com problema no schema");
process.exit(schemaOk ? 0 : 1);

/**
 * Aplica a tag D no evento do Chrome, pelo mesmo caminho que o Claude no
 * celular usa (servidor MCP → API de escrita).
 *
 * Precisa do ambiente configurado:
 *   FLOW_API_URL=https://flow.sitecnologia.tec.br
 *   FLOW_API_TOKEN=<token de leitura>
 *   FLOW_API_WRITE_TOKEN=<token de escrita>
 *
 * O servidor precisa estar com a versão que conhece o campo `delegavel` —
 * depois do redeploy do app.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.FLOW_API_WRITE_TOKEN?.trim()) {
  console.error(
    "Falta FLOW_API_WRITE_TOKEN — sem ele o servidor MCP só habilita a leitura."
  );
  process.exit(1);
}

const transporte = new StdioClientTransport({
  command: "node",
  args: ["--experimental-strip-types", path.join(here, "server.ts")],
  env: { ...process.env },
  stderr: "inherit",
});

const client = new Client({ name: "marca-delegavel", version: "1.0.0" });
await client.connect(transporte);

const ID = "5mq9q3n9cvf09u4r9bragv0jao";

// 1. Prévia (sem confirmar): mostra ao usuário o que vai mudar.
const previa = await client.callTool({
  name: "atualizar_evento",
  arguments: { id: ID, delegavel: true },
});
console.log("── prévia");
console.log(previa.content.map((c) => c.text).join("\n"));
console.log();

// 2. Gravar.
const gravacao = await client.callTool({
  name: "atualizar_evento",
  arguments: { id: ID, delegavel: true, confirmar: true },
});
console.log("── gravação");
console.log(gravacao.content.map((c) => c.text).join("\n"));

await client.close();

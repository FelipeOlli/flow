import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { criarServidorSecretaria } from "@/lib/secretaria-mcp";
import { criarBackendDireto } from "@/lib/secretaria-service";

/**
 * Servidor MCP da secretária do Flow, servido por HTTP (Streamable HTTP).
 *
 * É o endereço que o Claude no celular usa: em claude.ai, cadastre um
 * conector apontando pra esta URL, com o header
 * `Authorization: Bearer <FLOW_API_TOKEN>`.
 *
 * Sem sessão (stateless): cada requisição cria seu próprio servidor e
 * transporte, então o app pode reiniciar sem quebrar o conector.
 */

// O runtime Node é obrigatório: o app usa fs no token-store.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

/**
 * Token válido no pedido.
 *
 * O conector do claude.ai só deixa usar nomes de cabeçalho aprovados pela
 * Anthropic — por isso aceitamos os nomes comuns, não só `Authorization`.
 */
function autorizado(req: NextRequest): boolean {
  const configured = process.env.FLOW_API_TOKEN?.trim();
  if (!configured) return false;

  const authorization = req.headers.get("authorization") ?? "";
  const candidatos = [
    authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : authorization.trim(),
    req.headers.get("x-api-key")?.trim() ?? "",
    req.headers.get("x-flow-token")?.trim() ?? "",
  ];

  return candidatos.some((token) => token.length > 0 && token === configured);
}

function log(req: NextRequest, status: number, duracaoMs: number, extra?: string) {
  console.log(
    `[MCP] ${req.method} ${req.nextUrl.pathname} status=${status} ${duracaoMs}ms ` +
      `accept=${req.headers.get("accept") ?? "-"} ` +
      `protocolo=${req.headers.get("mcp-protocol-version") ?? "-"} ` +
      `sessao=${req.headers.get("mcp-session-id") ?? "-"} ` +
      `ip=${req.headers.get("x-forwarded-for") ?? "-"} ` +
      `ua=${req.headers.get("user-agent") ?? "-"}${extra ? ` ${extra}` : ""}`
  );
}

/**
 * Endpoint único pro protocolo MCP.
 *
 * Detalhes de compatibilidade (a diferença entre "funciona no meu curl" e
 * "funciona no conector do claude.ai" mora aqui):
 *
 * 1. O SDK exige que o POST traga `Accept` com **os dois** tipos
 *    (`application/json` e `text/event-stream`). Cliente que manda só um
 *    levaria 406 — e o cliente da Anthropic reporta isso como "fetch failed".
 *    Normalizamos o header antes de entregar a request ao transporte.
 * 2. A resposta sai no formato que o cliente pediu: JSON se ele aceita JSON,
 *    SSE se ele pediu só SSE. `enableJsonResponse` é por transporte, e a
 *    gente cria um transporte por requisição — então dá pra decidir por request.
 * 3. GET e DELETE são delegados ao transporte (como no exemplo de referência
 *    do SDK) em vez de devolvemos 405: o protocolo MCP permite o cliente abrir
 *    um stream SSE por GET.
 */
async function tratar(req: NextRequest): Promise<Response> {
  const inicio = Date.now();

  if (!autorizado(req)) {
    log(req, 401, Date.now() - inicio);
    return NextResponse.json(
      { erro: "Token inválido ou ausente. Use: Authorization: Bearer <FLOW_API_TOKEN>" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const accept = req.headers.get("accept") ?? "";

  // GET só faz sentido como stream SSE; sem ele, não há o que escutar.
  if (req.method === "GET" && !accept.includes("text/event-stream")) {
    log(req, 405, Date.now() - inicio, "motivo=accept-sem-sse");
    return NextResponse.json(
      { erro: "Use POST (JSON-RPC do protocolo MCP). Conector: POST em /mcp." },
      { status: 405, headers: CORS_HEADERS }
    );
  }

  // Servidor e transporte novos a cada requisição (stateless).
  //
  // O backend é **direto**: as ferramentas consultam a agenda dentro deste
  // processo, sem passar por HTTP. Dentro do container, `localhost:3000` nem
  // sempre é alcançável (IPv6, porta trocada pelo proxy) — e o token do Google
  // já está aqui, então o hop interno só trazia risco.
  const server = criarServidorSecretaria(criarBackendDireto());
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Responde no formato que o cliente aceitou.
    enableJsonResponse: accept.includes("application/json"),
    // O SDK só emite bytes no stream SSE a cada 15s (keep-alive padrão).
    // Com 1s o cliente recebe os headers na hora, em vez de esperar o
    // timeout e desistir.
    keepAliveMs: 1_000,
  });
  await server.connect(transport);

  // Normaliza os headers que o SDK valida.
  const headers = new Headers(req.headers);
  headers.set("accept", "application/json, text/event-stream");
  if (req.method === "POST") headers.set("content-type", "application/json");

  const body = req.method === "POST" ? await req.text() : undefined;
  const reqNormalizada = new Request(req.url, { method: req.method, headers, body });

  const resposta = await transport.handleRequest(reqNormalizada);
  for (const [chave, valor] of Object.entries(CORS_HEADERS)) {
    resposta.headers.set(chave, valor);
  }
  resposta.headers.set("Cache-Control", "no-store");

  log(req, resposta.status, Date.now() - inicio, `resposta=${resposta.headers.get("content-type")}`);
  return resposta;
}

export async function POST(req: NextRequest) {
  return tratar(req);
}

export async function GET(req: NextRequest) {
  return tratar(req);
}

export async function DELETE(req: NextRequest) {
  return tratar(req);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

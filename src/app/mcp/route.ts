import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { criarServidorSecretaria } from "@/lib/secretaria-mcp";

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

export async function POST(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json(
      { erro: "Token inválido ou ausente. Use: Authorization: Bearer <FLOW_API_TOKEN>" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  // Servidor e transporte novos a cada requisição (stateless).
  const server = criarServidorSecretaria();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const resposta = await transport.handleRequest(req);
  for (const [chave, valor] of Object.entries(CORS_HEADERS)) {
    resposta.headers.set(chave, valor);
  }
  resposta.headers.set("Cache-Control", "no-store");
  return resposta;
}

export async function GET() {
  return NextResponse.json(
    { erro: "Use POST (JSON-RPC do protocolo MCP). Conector: POST em /mcp." },
    { status: 405, headers: CORS_HEADERS }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { erro: "Sessão sem estado (stateless)." },
    { status: 405, headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

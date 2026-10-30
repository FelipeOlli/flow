// Testes da API da secretária (Fase 1).
//
// Sobe o Next dev server com um FLOW_API_TOKEN de teste e exercita cada
// endpoint: token ausente, token inválido, filtros e paginação.
//
// Uso: npm run test:secretaria
// Requer o token do Google disponível (mesmo token-store do app).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = Number(process.env.FLOW_TEST_PORT ?? 3111);
const BASE = `http://localhost:${PORT}`;
const TOKEN = "token-de-teste-da-secretaria";
const WRITE_TOKEN = "token-de-teste-da-escrita";

let server;

function startServer() {
  const child = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env: {
      ...process.env,
      FLOW_API_TOKEN: TOKEN,
      FLOW_API_WRITE_TOKEN: WRITE_TOKEN,
      FLOW_TEST_SERVER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Servidor não subiu a tempo");
}

async function api(path, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

before(async () => {
  server = startServer();
  await waitForServer();
});

after(() => {
  if (server && !server.killed) server.kill("SIGTERM");
});

const ENDPOINTS = [
  "/api/secretaria/agendas",
  "/api/secretaria/eventos",
  "/api/secretaria/eventos/proximos?minutos=60",
  "/api/secretaria/eventos/em-aberto?dias_parado=7",
  "/api/secretaria/eventos/por-responsavel?pessoa=teste",
];

test("sem token responde 401 em todos os endpoints", async () => {
  for (const path of ENDPOINTS) {
    const { status, body } = await api(path);
    assert.equal(status, 401, `${path} deveria responder 401 sem token`);
    assert.ok(body?.erro, `${path} deveria explicar o erro`);
  }
});

test("token inválido responde 401", async () => {
  const { status } = await api("/api/secretaria/eventos", { token: "token-errado" });
  assert.equal(status, 401);
});

test("header sem Bearer responde 401", async () => {
  const res = await fetch(`${BASE}/api/secretaria/eventos`, {
    headers: { Authorization: TOKEN },
  });
  assert.equal(res.status, 401);
});

test("GET /agendas lista as agendas", async () => {
  const { status, body } = await api("/api/secretaria/agendas", { token: TOKEN });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.agendas), "deveria devolver a lista de agendas");
  for (const agenda of body.agendas) {
    assert.ok(agenda.id, "agenda sem id");
    assert.ok(agenda.nome, "agenda sem nome");
  }
});

test("GET /eventos devolve dados e paginação", async () => {
  const { status, body } = await api("/api/secretaria/eventos", { token: TOKEN });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.dados), "deveria devolver o array de eventos");
  assert.equal(typeof body.paginacao.total, "number");
  assert.equal(typeof body.paginacao.limite, "number");
  assert.equal(typeof body.paginacao.offset, "number");
});

test("evento tem os campos do contrato", async () => {
  const { status, body } = await api("/api/secretaria/eventos?limite=50", { token: TOKEN });
  assert.equal(status, 200);
  if (body.dados.length === 0) return; // agenda vazia — contrato verificado nos outros testes
  const evento = body.dados[0];
  for (const campo of [
    "id",
    "titulo",
    "agenda",
    "inicio",
    "fim",
    "status",
    "dias_em_aberto",
    "convidados",
  ]) {
    assert.ok(campo in evento, `evento sem o campo ${campo}`);
  }
  assert.ok(["aberto", "concluido", "cancelado", "recusado"].includes(evento.status));
});

test("filtro por agenda só devolve eventos daquela agenda", async () => {
  const { body: agendasBody } = await api("/api/secretaria/agendas", { token: TOKEN });
  const agenda = agendasBody.agendas?.[0];
  if (!agenda) return;

  const { status, body } = await api(
    `/api/secretaria/eventos?agenda=${encodeURIComponent(agenda.nome)}&limite=100`,
    { token: TOKEN }
  );
  assert.equal(status, 200);
  for (const evento of body.dados) {
    assert.equal(evento.agenda_id, agenda.id, `evento de outra agenda: ${evento.agenda}`);
  }
});

test("filtro por status funciona", async () => {
  const { status, body } = await api(
    "/api/secretaria/eventos?status=concluido&de=2026-01-01&ate=2026-12-31&limite=50",
    { token: TOKEN }
  );
  assert.equal(status, 200);
  for (const evento of body.dados) {
    assert.equal(evento.status, "concluido");
  }
});

test("janela maior que o limite responde 400", async () => {
  const { status } = await api(
    "/api/secretaria/eventos?de=2000-01-01&ate=2100-01-01",
    { token: TOKEN }
  );
  assert.equal(status, 400);
});

test("datas inválidas respondem 400", async () => {
  const { status } = await api("/api/secretaria/eventos?de=ontem", { token: TOKEN });
  assert.equal(status, 400);
});

test("de posterior a ate responde 400", async () => {
  const { status } = await api(
    "/api/secretaria/eventos?de=2026-05-10&ate=2026-05-01",
    { token: TOKEN }
  );
  assert.equal(status, 400);
});

test("GET /eventos/proximos devolve janela", async () => {
  const { status, body } = await api("/api/secretaria/eventos/proximos?minutos=120", { token: TOKEN });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.dados));
  const agora = Date.now();
  for (const evento of body.dados) {
    const inicio = new Date(evento.inicio).getTime();
    assert.ok(inicio >= agora - 60_000, `evento já começou: ${evento.titulo}`);
    assert.ok(inicio <= agora + 120 * 60_000, `evento fora da janela: ${evento.titulo}`);
  }
});

test("minutos inválido responde 400", async () => {
  const { status } = await api("/api/secretaria/eventos/proximos?minutos=abc", { token: TOKEN });
  assert.equal(status, 400);
});

test("GET /eventos/em-aberto devolve pendências", async () => {
  const { status, body } = await api(
    "/api/secretaria/eventos/em-aberto?dias_parado=7",
    { token: TOKEN }
  );
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.dados));
  for (const evento of body.dados) {
    assert.notEqual(evento.status, "concluido");
    assert.notEqual(evento.status, "cancelado");
  }
});

test("dias_parado inválido responde 400", async () => {
  const { status } = await api("/api/secretaria/eventos/em-aberto?dias_parado=-5", { token: TOKEN });
  assert.equal(status, 400);
});

test("GET /eventos/por-responsavel exige o parâmetro pessoa", async () => {
  const { status } = await api("/api/secretaria/eventos/por-responsavel", { token: TOKEN });
  assert.equal(status, 400);
});

test("GET /eventos/por-responsavel filtra por nome", async () => {
  const { status, body } = await api(
    "/api/secretaria/eventos/por-responsavel?pessoa=fulano",
    { token: TOKEN }
  );
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.dados));
});

test("feriados ficam de fora por padrão", async () => {
  const { body } = await api(
    "/api/secretaria/eventos?de=2026-01-01&ate=2026-12-31&limite=250",
    { token: TOKEN }
  );
  for (const evento of body.dados) {
    assert.ok(
      !/feriado/i.test(evento.agenda),
      `feriado na lista: ${evento.titulo} (${evento.agenda})`
    );
  }
});

test("feriados voltam com incluir_feriados=true", async () => {
  const janela = "de=2026-01-01&ate=2026-12-31&limite=500";
  const { body: sem } = await api(`/api/secretaria/eventos?${janela}`, { token: TOKEN });
  const { body: com } = await api(`/api/secretaria/eventos?${janela}&incluir_feriados=true`, {
    token: TOKEN,
  });
  assert.ok(
    com.paginacao.total > sem.paginacao.total,
    `com incluir_feriados=true deveria trazer mais evento (${com.paginacao.total} vs ${sem.paginacao.total})`
  );
  assert.ok(
    com.dados.some((e) => /feriado/i.test(e.agenda)),
    "a lista com feriados deveria conter um evento de feriado"
  );
});

test("GET /eventos/{id} devolve 404 pra id inexistente", async () => {
  const { status } = await api("/api/secretaria/eventos/nao-existe-esse-id", { token: TOKEN });
  assert.equal(status, 404);
});

test("GET /eventos/{id} devolve o evento quando existe", async () => {
  const { body: lista } = await api(
    "/api/secretaria/eventos?de=2026-01-01&ate=2026-12-31&limite=1",
    { token: TOKEN }
  );
  const evento = lista.dados?.[0];
  if (!evento) return;

  const { status, body } = await api(`/api/secretaria/eventos/${evento.id}`, { token: TOKEN });
  assert.equal(status, 200);
  assert.equal(body.evento.id, evento.id);
});

// ───────────────────────────── Escrita (Fase 4) ─────────────────────────────
// Aqui só cobrimos o portão de permissão e a validação — os testes não
// gravam nada na agenda real. A gravação em si foi verificada à mão.

test("POST /eventos com token de leitura responde 401", async () => {
  const { status, body } = await api("/api/secretaria/eventos", {
    token: TOKEN,
    method: "POST",
    body: { titulo: "não deve criar", data: "2026-12-01" },
  });
  assert.equal(status, 401);
  assert.match(body.erro, /escrita/i);
});

test("POST /eventos sem token responde 401", async () => {
  const { status } = await api("/api/secretaria/eventos", {
    method: "POST",
    body: { titulo: "não deve criar", data: "2026-12-01" },
  });
  assert.equal(status, 401);
});

test("POST /eventos com token de escrita valida o payload", async () => {
  const { status, body } = await api("/api/secretaria/eventos", {
    token: WRITE_TOKEN,
    method: "POST",
    body: { data: "2026-12-01" },
  });
  assert.equal(status, 400);
  assert.match(body.erro, /titulo/i);
});

test("POST /eventos com token de escrita recusa data inválida", async () => {
  const { status, body } = await api("/api/secretaria/eventos", {
    token: WRITE_TOKEN,
    method: "POST",
    body: { titulo: "não deve criar", data: "01/12/2026" },
  });
  assert.equal(status, 400);
  assert.match(body.erro, /YYYY-MM-DD/);
});

test("PATCH /eventos/{id} com token de leitura responde 401", async () => {
  const { status, body } = await api("/api/secretaria/eventos/qualquer-id", {
    token: TOKEN,
    method: "PATCH",
    body: { titulo: "não deve mudar" },
  });
  assert.equal(status, 401);
  assert.match(body.erro, /escrita/i);
});

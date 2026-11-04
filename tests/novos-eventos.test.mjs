// Testes da lógica de chegadas externas (classificação, dedup e registro).
//
// Importa o módulo TypeScript direto — o Node roda TS sem build. Por isso o
// módulo não tem import relativo: o Node não resolve caminho sem extensão.
//
// Uso: npm run test:secretaria (o glob já pega este arquivo)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorIcalUid,
  classificarChegada,
  foiConvidado,
  mesclarCopias,
  montarMensagem,
  organizadoPeloUsuario,
  podarVistos,
  registrarVisto,
  selecionarConvitesPendentes,
  selecionarNovas,
  seriesRespondidas,
  vistoEmAlgumaAgenda,
  vistoNaAgenda,
} from "../src/lib/novos-eventos.ts";

const FELIPE = "felipeoliveiravl@gmail.com";
const CF = "ti@cfcontabilidade.com";
const TZ = "America/Sao_Paulo";

function evento(over = {}) {
  return {
    id: "evt1",
    iCalUid: "uid1",
    summary: "Reunião de planning",
    inicio: "2026-11-05T17:00:00Z",
    fim: "2026-11-05T18:00:00Z",
    diaInteiro: false,
    status: "confirmed",
    organizerEmail: "fulana@cf.com",
    organizerNome: "Fulana",
    organizerEhUsuario: false,
    participantes: [],
    agendaId: CF,
    agendaNome: "TI CF Contabilidade",
    ...over,
  };
}

function registroDe(...eventos) {
  const registro = {};
  for (const e of eventos) registrarVisto(registro, e, "2026-11-01T00:00:00.000Z");
  return registro;
}

test("evento criado pelo Flow é ignorado", () => {
  const e = evento({ flowOrigem: "flow" });
  assert.equal(classificarChegada(e, { emailUsuario: FELIPE }), null);
});

test("evento que o Felipe já marcou no Flow é ignorado", () => {
  // Eventos criados antes do marcador `flowOrigem` existir ainda carregam os
  // outros marcadores — a prova de que o Flow já mexeu neles.
  const e = evento({
    marcadoresFlow: ["flowPillar", "flowImportant", "flowDelegateName"],
  });
  assert.equal(classificarChegada(e, { emailUsuario: FELIPE }), null);
});

test("evento só com flowOpenSince NÃO é considerado do Flow", () => {
  // A migração carimba `flowOpenSince` em qualquer evento pendente —
  // inclusive nos que vieram de fora. Só esse marcador não basta.
  const e = evento({ marcadoresFlow: ["flowOpenSince"] });
  const chegada = classificarChegada(e, { emailUsuario: FELIPE });
  assert.ok(chegada);
  assert.equal(chegada.tipo, "externo");
});

test("no agenda compartilhada, organizador com self=true não é o usuário", () => {
  // `self` no organizador significa "o organizador é o dono desta agenda".
  // Numa agenda compartilhada, isso é a conta da agenda (ti@cfcontabilidade.com),
  // não o Felipe — o evento é externo.
  const e = evento({
    organizerEmail: CF,
    organizerNome: "TI CF Contabilidade",
    organizerEhUsuario: true,
  });
  const chegada = classificarChegada(e, { emailUsuario: FELIPE });
  assert.ok(chegada);
  assert.equal(chegada.tipo, "externo");
});

test("evento cancelado é ignorado", () => {
  const e = evento({ status: "cancelled" });
  assert.equal(classificarChegada(e, { emailUsuario: FELIPE }), null);
});

test("agenda de feriado é ignorada", () => {
  const e = evento({ agendaNome: "Feriados no Brasil", agendaId: "feriados" });
  assert.equal(
    classificarChegada(e, { emailUsuario: FELIPE, agendasIgnoradas: ["feriado"] }),
    null
  );
});

test("evento de outro organizador é externo", () => {
  const chegada = classificarChegada(evento(), { emailUsuario: FELIPE });
  assert.ok(chegada);
  assert.equal(chegada.tipo, "externo");
  assert.equal(chegada.autorEmail, "fulana@cf.com");
});

test("convite em aberto é classificado como convite", () => {
  const e = evento({
    agendaId: FELIPE,
    agendaNome: "Felipe Oliveira",
    agendaPessoal: true,
    participantes: [
      { email: FELIPE, nome: "Felipe", responseStatus: "needsAction", self: true },
      { email: "fulana@cf.com", nome: "Fulana", responseStatus: "accepted" },
    ],
  });
  const chegada = classificarChegada(e, { emailUsuario: FELIPE });
  assert.ok(chegada);
  assert.equal(chegada.tipo, "convite");
});

test("convite já respondido não é classificado como convite", () => {
  const e = evento({
    agendaId: FELIPE,
    agendaNome: "Felipe Oliveira",
    agendaPessoal: true,
    participantes: [{ email: FELIPE, responseStatus: "accepted", self: true }],
  });
  const chegada = classificarChegada(e, { emailUsuario: FELIPE });
  assert.ok(chegada);
  assert.equal(chegada.tipo, "externo");
});

test("no agenda compartilhada o self é a conta da agenda, não o usuário", () => {
  // A agenda TI CF aparece como participante "self" — não é o Felipe.
  const e = evento({
    agendaId: CF,
    agendaNome: "TI CF Contabilidade",
    participantes: [{ email: CF, responseStatus: "needsAction", self: true }],
  });
  assert.equal(foiConvidado(e, FELIPE), false);
  assert.equal(organizadoPeloUsuario(e, FELIPE), false);
});

test("evento do próprio usuário é ignorado por padrão", () => {
  const e = evento({ organizerEmail: FELIPE, organizerNome: "Felipe", organizerEhUsuario: true });
  assert.equal(classificarChegada(e, { emailUsuario: FELIPE }), null);
});

test("evento do próprio usuário avisa quando avisarProprios está ligado", () => {
  const e = evento({ organizerEmail: FELIPE, organizerNome: "Felipe", organizerEhUsuario: true });
  const chegada = classificarChegada(e, { emailUsuario: FELIPE, avisarProprios: true });
  assert.ok(chegada);
  assert.equal(chegada.tipo, "externo");
});

test("mesma série recorrente vira uma chegada só", () => {
  const serie = evento({ id: "serie_20261105", iCalUid: "serie1" });
  const outraOcorrencia = evento({ id: "serie_20261112", iCalUid: "serie1" });
  const novas = selecionarNovas([serie, outraOcorrencia], {}, { emailUsuario: FELIPE });
  assert.equal(novas.length, 1);
});

test("convite duplicado (compartilhada + cópia pessoal) vira uma chegada só", () => {
  const naCompartilhada = evento({ agendaNome: "TI CF Contabilidade", agendaPessoal: false });
  const naPessoal = evento({
    id: "evt2",
    agendaId: FELIPE,
    agendaNome: "Felipe Oliveira",
    agendaPessoal: true,
    participantes: [{ email: FELIPE, responseStatus: "needsAction", self: true }],
  });
  const agrupados = agruparPorIcalUid([naPessoal, naCompartilhada]);
  assert.equal(agrupados.size, 1);

  // A agenda mostrada é a compartilhada; o RSVP vem da cópia pessoal.
  const mesclado = mesclarCopias(agrupados.get("uid1"));
  assert.equal(mesclado.agendaNome, "TI CF Contabilidade");
  assert.equal(foiConvidado(mesclado, FELIPE), true);
});

test("evento já visto não é notificado de novo", () => {
  const registro = registroDe(evento());
  assert.equal(selecionarNovas([evento()], registro, { emailUsuario: FELIPE }).length, 0);
});

test("selecionarNovas devolve só as chegadas novas", () => {
  const registro = registroDe(evento());
  const novo = evento({ id: "evt2", iCalUid: "uid2", summary: "Novo" });
  const novas = selecionarNovas([evento(), novo], registro, { emailUsuario: FELIPE });
  assert.equal(novas.length, 1);
  assert.equal(novas[0].evento.summary, "Novo");
});

test("evento que só mudou de agenda não é chegada nova", () => {
  // Já visto na agenda compartilhada, agora apareceu na pessoal.
  const registro = registroDe(evento());
  const naPessoal = evento({
    id: "evt2",
    agendaId: FELIPE,
    agendaNome: "Felipe Oliveira",
    agendaPessoal: true,
  });
  const novas = selecionarNovas([naPessoal], registro, { emailUsuario: FELIPE });
  assert.equal(novas.length, 0);
});

test("convite novo de um evento já conhecido na agenda compartilhada avisa", () => {
  const registro = registroDe(evento());
  const naPessoal = evento({
    id: "evt2",
    agendaId: FELIPE,
    agendaNome: "Felipe Oliveira",
    agendaPessoal: true,
    participantes: [{ email: FELIPE, responseStatus: "needsAction", self: true }],
  });
  const novas = selecionarNovas([naPessoal], registro, { emailUsuario: FELIPE });
  assert.equal(novas.length, 1);
  assert.equal(novas[0].tipo, "convite");
});

test("registro guarda as agendas onde o evento apareceu", () => {
  const registro = {};
  registrarVisto(registro, evento(), "2026-11-01T00:00:00.000Z");
  const naPessoal = evento({ id: "evt2", agendaId: FELIPE, agendaNome: "Felipe Oliveira" });
  registrarVisto(registro, naPessoal, "2026-11-02T00:00:00.000Z");

  assert.equal(vistoNaAgenda(registro, evento()), true);
  assert.equal(vistoNaAgenda(registro, naPessoal), true);
  assert.equal(vistoEmAlgumaAgenda(registro, naPessoal), true);
  // A data da primeira aparição é preservada.
  assert.equal(registro.uid1.iso, "2026-11-01T00:00:00.000Z");
});

test("podarVistos remove entradas antigas e mantém as recentes", () => {
  const agora = new Date("2026-11-01T00:00:00.000Z");
  const antigos = new Date(agora.getTime() - 400 * 24 * 3600 * 1000).toISOString();
  const recentes = new Date(agora.getTime() - 5 * 24 * 3600 * 1000).toISOString();
  const podados = podarVistos(
    { velho: { iso: antigos, agendas: [CF] }, novo: { iso: recentes, agendas: [CF] } },
    agora
  );
  assert.deepEqual(Object.keys(podados), ["novo"]);
});

test("mensagem de convite traz quem convidou e a agenda", () => {
  const e = evento({
    agendaId: FELIPE,
    agendaNome: "Felipe Oliveira",
    agendaPessoal: true,
    participantes: [{ email: FELIPE, responseStatus: "needsAction", self: true }],
  });
  const classificacao = classificarChegada(e, { emailUsuario: FELIPE });
  assert.ok(classificacao);
  const msg = montarMensagem({ ...classificacao, evento: e, agendas: [FELIPE] }, TZ);
  assert.match(msg.telegram, /te convidou/);
  assert.match(msg.telegram, /Fulana/);
  assert.match(msg.telegram, /Felipe Oliveira/);
  assert.match(msg.pushTitulo, /Convite:/);
});

test("mensagem de evento externo traz a agenda e o autor", () => {
  const e = evento();
  const classificacao = classificarChegada(e, { emailUsuario: FELIPE });
  assert.ok(classificacao);
  const msg = montarMensagem({ ...classificacao, evento: e, agendas: [CF] }, TZ);
  assert.match(msg.telegram, /Novo evento em/);
  assert.match(msg.telegram, /TI CF Contabilidade/);
  assert.match(msg.telegram, /Criado por Fulana/);
});

test("mensagem escapa HTML do título", () => {
  const e = evento({ summary: "Reunião <script> & \"aspas\"" });
  const classificacao = classificarChegada(e, { emailUsuario: FELIPE });
  assert.ok(classificacao);
  const msg = montarMensagem({ ...classificacao, evento: e, agendas: [CF] }, TZ);
  assert.ok(!msg.telegram.includes("<script>"));
  assert.match(msg.telegram, /&lt;script&gt;/);
});

test("nome do autor vem do participante organizador quando falta no organizer", () => {
  // O Google nem sempre preenche o `displayName` do organizador — mas o
  // participante marcado com `organizer: true` costuma ter o nome.
  const e = evento({
    organizerEmail: "rachel.souza@mpt.mp.br",
    organizerNome: undefined,
    participantes: [
      { email: "rachel.souza@mpt.mp.br", nome: "Rachel Afonso", responseStatus: "accepted", organizador: true },
      { email: FELIPE, responseStatus: "needsAction", self: true },
    ],
  });
  const classificacao = classificarChegada(e, { emailUsuario: FELIPE });
  assert.ok(classificacao);
  assert.equal(classificacao.autorNome, "Rachel Afonso");
  const msg = montarMensagem({ ...classificacao, evento: e, agendas: [CF] }, TZ);
  assert.match(msg.telegram, /Rachel Afonso/);
});

test("mesclar cópias completa o nome do participante", () => {
  const semNome = evento({
    id: "a",
    agendaId: CF,
    participantes: [{ email: "yasmim@x.com", responseStatus: "accepted", organizador: true }],
  });
  const comNome = evento({
    id: "b",
    agendaId: FELIPE,
    agendaNome: "Felipe Oliveira",
    agendaPessoal: true,
    participantes: [{ email: "yasmim@x.com", nome: "Yasmim Lopes", responseStatus: "accepted", organizador: true }],
  });
  const mesclado = mesclarCopias([semNome, comNome]);
  assert.equal(mesclado.participantes.length, 1);
  assert.equal(mesclado.participantes[0].nome, "Yasmim Lopes");
});

test("mesclar cópias une os marcadores do Flow de todas", () => {
  // A cópia sombra pode não ter o marcador que a original tem.
  const comMarcador = evento({ id: "a", marcadoresFlow: ["flowPillar"] });
  const semMarcador = evento({ id: "b", agendaId: FELIPE, agendaNome: "Felipe Oliveira", agendaPessoal: true });
  const mesclado = mesclarCopias([semMarcador, comMarcador]);
  assert.deepEqual(mesclado.marcadoresFlow, ["flowPillar"]);
  // E o evento inteiro é ignorado — o Flow já conhece.
  assert.equal(classificarChegada(mesclado, { emailUsuario: FELIPE }), null);
});

// --- Convites pendentes -----------------------------------------------------
// O bootstrap da varredura de chegadas registra tudo como visto, então um
// convite que já estava em aberto nunca passa por ela. A varredura de
// convites pendentes é a que pega esses casos.

test("convite pendente é selecionado pela varredura de convites", () => {
  const e = evento({
    summary: "Consulta Dr Adriano",
    participantes: [
      { email: FELIPE, nome: "Felipe", responseStatus: "needsAction" },
      { email: "yasminloopesfraaga@gmail.com", nome: "Yasmin", responseStatus: "accepted", organizador: true },
    ],
  });
  const convites = selecionarConvitesPendentes([e], { emailUsuario: FELIPE });
  assert.equal(convites.length, 1);
  assert.equal(convites[0].tipo, "convite");
  assert.equal(convites[0].evento.summary, "Consulta Dr Adriano");
});

test("convite já respondido não é selecionado", () => {
  const e = evento({
    participantes: [
      { email: FELIPE, nome: "Felipe", responseStatus: "accepted" },
    ],
  });
  assert.equal(selecionarConvitesPendentes([e], { emailUsuario: FELIPE }).length, 0);
});

test("convite do Flow é ignorado na varredura de convites", () => {
  const e = evento({
    flowOrigem: "flow",
    participantes: [
      { email: FELIPE, nome: "Felipe", responseStatus: "needsAction" },
    ],
  });
  assert.equal(selecionarConvitesPendentes([e], { emailUsuario: FELIPE }).length, 0);
});

test("mesma série recorrente vira um convite só", () => {
  const a = evento({
    id: "occ1",
    iCalUid: "serie1",
    summary: "Pagar conta de luz",
    participantes: [{ email: FELIPE, nome: "Felipe", responseStatus: "needsAction" }],
  });
  const b = evento({
    id: "occ2",
    iCalUid: "serie1",
    summary: "Pagar conta de luz",
    inicio: "2026-12-25T13:00:00Z",
    participantes: [{ email: FELIPE, nome: "Felipe", responseStatus: "needsAction" }],
  });
  const convites = selecionarConvitesPendentes([a, b], { emailUsuario: FELIPE });
  assert.equal(convites.length, 1);
});

// --- Data de evento de dia inteiro -----------------------------------------
// O Google devolve o início de dia inteiro como data literal ("2026-11-05").
// Passar por new Date() entende como meia-noite UTC — em São Paulo isso é
// 21h do dia ANTERIOR, e a mensagem anunciava o evento na data errada.

test("evento de dia inteiro mostra a data certa", () => {
  const e = evento({
    diaInteiro: true,
    inicio: "2026-11-05",
    fim: "2026-11-06",
    participants: [],
    participantes: [
      { email: FELIPE, nome: "Felipe", responseStatus: "needsAction" },
      { email: "yasminloopesfraaga@gmail.com", nome: "Yasmin", responseStatus: "accepted", organizador: true },
    ],
  });
  const msg = montarMensagem(
    { ...classificarChegada(e, { emailUsuario: FELIPE }), evento: e, agendas: [CF] },
    TZ
  );
  assert.match(msg.telegram, /05\/11\/2026/);
  assert.doesNotMatch(msg.telegram, /04\/11\/2026/);
});

test("série já respondida é liberada pro re-convite", () => {
  const respondido = evento({
    iCalUid: "serie1",
    participantes: [{ email: FELIPE, nome: "Felipe", responseStatus: "accepted" }],
  });
  const pendente = evento({
    iCalUid: "serie2",
    participantes: [{ email: FELIPE, nome: "Felipe", responseStatus: "needsAction" }],
  });
  const liberadas = seriesRespondidas([respondido, pendente], FELIPE);
  assert.deepEqual(liberadas, ["serie1"]);
});

test("série recorrente com uma ocorrência respondida e outra pendente NÃO é liberada", () => {
  // Se liberasse, o aviso voltaria a cada 30 minutos, pra sempre.
  const novembro = evento({
    id: "occ-nov",
    iCalUid: "serie1",
    participantes: [{ email: FELIPE, nome: "Felipe", responseStatus: "accepted" }],
  });
  const dezembro = evento({
    id: "occ-dez",
    iCalUid: "serie1",
    participantes: [{ email: FELIPE, nome: "Felipe", responseStatus: "needsAction" }],
  });
  assert.deepEqual(seriesRespondidas([novembro, dezembro], FELIPE), []);
});

test("convite pendente não é liberado", () => {
  const pendente = evento({
    iCalUid: "serie1",
    participantes: [{ email: FELIPE, nome: "Felipe", responseStatus: "needsAction" }],
  });
  assert.deepEqual(seriesRespondidas([pendente], FELIPE), []);
});

import fs from "fs";
import path from "path";
import { normalizeDelegateName } from "./delegation";

/**
 * Contatos de delegação — nomes de pessoas que você já delegou.
 * Guardados em arquivo (mesmo padrão do token-store), sem banco de dados.
 * Serve pra oferecer os nomes já usados no seletor "Delegar para".
 */

const DATA_DIR = process.env.NODE_ENV === "production" ? "/app/data" : process.cwd();
const CONTACTS_FILE = path.join(DATA_DIR, ".delegate-contacts.json");

export interface DelegateContact {
  name: string;
  count: number;
  lastUsed: string;
}

/** Chave de comparação: sem acento, minúscula. */
export { normalizeDelegateName };

function readContacts(): DelegateContact[] {
  try {
    const data = JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf-8"));
    return Array.isArray(data?.names) ? data.names : [];
  } catch {
    return [];
  }
}

function writeContacts(list: DelegateContact[]): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify({ names: list }, null, 2), "utf-8");
  } catch (err) {
    console.error("[DELEGATE CONTACTS] Falha ao salvar contatos:", err);
  }
}

/** Nomes já usados, mais frequentes primeiro. */
export function listDelegateContacts(): DelegateContact[] {
  return readContacts().sort(
    (a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed)
  );
}

/** Registra o nome de quem recebeu a delegação. */
export function rememberDelegateName(name?: string | null): void {
  const clean = name?.trim();
  if (!clean) return;
  const list = readContacts();
  const key = normalizeDelegateName(clean);
  const existing = list.find((c) => normalizeDelegateName(c.name) === key);
  if (existing) {
    existing.count += 1;
    existing.name = clean;
    existing.lastUsed = new Date().toISOString();
  } else {
    list.push({ name: clean, count: 1, lastUsed: new Date().toISOString() });
  }
  writeContacts(list);
}

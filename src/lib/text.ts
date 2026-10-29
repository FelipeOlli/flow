/**
 * Normalização de texto pra busca/comparação: sem acento, minúsculo,
 * espaços colapsados. Compartilhado entre a API e a busca do app.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

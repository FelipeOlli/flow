// Segurança do webhook: valida user_id e dedup de update_id.
// Falha de TELEGRAM_USER_ID = bot rejeita TUDO. Default seguro.

import type { TgUpdate } from "./types";

const SEEN_MAX = 1000;
const seenUpdateIds = new Set<number>();

export function isAuthorizedUpdate(update: TgUpdate): boolean {
  const expectedUserId = process.env.TELEGRAM_USER_ID;
  if (!expectedUserId) {
    console.error("[TELEGRAM-BOT] TELEGRAM_USER_ID ausente — update rejeitado");
    return false;
  }

  if (typeof update.update_id === "number") {
    if (seenUpdateIds.has(update.update_id)) return false;
    seenUpdateIds.add(update.update_id);
    if (seenUpdateIds.size > SEEN_MAX) {
      // remove metade mais antiga (insertion order em Sets é preservado).
      const dropCount = SEEN_MAX / 2;
      let dropped = 0;
      seenUpdateIds.forEach((id) => {
        if (dropped >= dropCount) return;
        seenUpdateIds.delete(id);
        dropped++;
      });
    }
  }

  const fromId = update.message?.from?.id ?? update.callback_query?.from?.id;
  if (fromId === undefined) return false;
  return String(fromId) === expectedUserId;
}

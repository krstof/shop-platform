// Verbindungsprüfungen je Anbindung (21.11.2026).
//
// Eine Prüfung ruft den fremden Dienst einmal auf und beantwortet eine einzige Frage: Funktioniert
// das, was der Händler hier eingetragen hat? Die Antwort ist ein Satz in Alltagssprache, den das
// Backoffice unverändert anzeigt. Eine Prüfung darf außerdem offene Einstellungen zurückgeben, die
// sie unterwegs herausgefunden hat — bei Telegram die Chat-Nummer.
import type { IntegrationState } from "./store.js";
import { ExternalServiceError, fetchExternal } from "./outbound.js";

export interface CheckResult {
  readonly ok: boolean;
  readonly message: string;
  /** Offene Einstellungen, die die Prüfung herausgefunden hat. */
  readonly settings?: Readonly<Record<string, string>>;
}

interface TelegramUser {
  readonly ok: boolean;
  readonly result?: { readonly username?: string; readonly first_name?: string };
}

interface TelegramUpdates {
  readonly ok: boolean;
  readonly result?: readonly { readonly message?: { readonly chat?: { readonly id?: number } } }[];
}

async function checkTelegram(state: IntegrationState): Promise<CheckResult> {
  const token = state.secrets["botToken"] ?? "";
  if (token === "") return { ok: false, message: "Es ist kein Schlüssel hinterlegt." };
  const base = `https://api.telegram.org/bot${encodeURIComponent(token)}`;
  const me = await fetchExternal<TelegramUser>({ url: `${base}/getMe`, service: "Telegram" });
  if (!me.ok) return { ok: false, message: "Telegram kennt diesen Schlüssel nicht." };
  const name = me.result?.username ?? me.result?.first_name ?? "dein Bot";
  const known = state.settings["chatId"] ?? "";
  if (known !== "") {
    await fetchExternal({
      url: `${base}/sendMessage`,
      method: "POST",
      body: { chat_id: known, text: "Test aus deinem Shop: Die Verbindung steht." },
      service: "Telegram",
    });
    return { ok: true, message: `Verbunden mit ${name}. Eine Testnachricht ist unterwegs.` };
  }
  // Noch keine Chat-Nummer: Sie steht in der ersten Nachricht, die der Händler dem Bot geschickt hat.
  const updates = await fetchExternal<TelegramUpdates>({ url: `${base}/getUpdates`, service: "Telegram" });
  const chatId = updates.result?.find((u) => u.message?.chat?.id !== undefined)?.message?.chat?.id;
  if (chatId === undefined)
    return {
      ok: false,
      message: `Der Schlüssel stimmt (${name}), aber ich weiß noch nicht, wohin. Schreibe deinem Bot in Telegram einmal „Hallo“ und prüfe dann noch einmal.`,
    };
  await fetchExternal({
    url: `${base}/sendMessage`,
    method: "POST",
    body: { chat_id: chatId, text: "Test aus deinem Shop: Die Verbindung steht." },
    service: "Telegram",
  });
  return {
    ok: true,
    message: `Verbunden mit ${name}. Eine Testnachricht ist unterwegs.`,
    settings: { chatId: String(chatId) },
  };
}

async function checkUnsplash(state: IntegrationState): Promise<CheckResult> {
  const key = state.secrets["accessKey"] ?? "";
  if (key === "") return { ok: false, message: "Es ist kein Access Key hinterlegt." };
  const found = await fetchExternal<{ results?: readonly unknown[] }>({
    url: "https://api.unsplash.com/search/photos?query=tee&per_page=1",
    headers: { authorization: `Client-ID ${key}` },
    service: "Unsplash",
  });
  return found.results === undefined
    ? { ok: false, message: "Unsplash hat unerwartet geantwortet." }
    : { ok: true, message: "Verbunden. Die Bildersuche im Editor sucht ab jetzt auch bei Unsplash." };
}

async function checkPhoton(): Promise<CheckResult> {
  const answer = await fetchExternal<{ features?: readonly unknown[] }>({
    url: "https://photon.komoot.io/api/?q=Mönckebergstra%C3%9Fe%20Hamburg&limit=1&lang=de",
    service: "Der Adressdienst",
    timeoutMs: 6000,
  });
  return (answer.features ?? []).length > 0
    ? { ok: true, message: "Der Adressdienst antwortet. Die Kasse schlägt ab jetzt Adressen vor." }
    : { ok: false, message: "Der Adressdienst antwortet, findet aber nichts. Das ist ungewöhnlich." };
}

const CHECKS: Readonly<Record<string, (state: IntegrationState) => Promise<CheckResult>>> = {
  telegram: checkTelegram,
  unsplash: checkUnsplash,
  photon: checkPhoton,
};

/** Führt die Prüfung einer Anbindung aus und fängt Fehler des fremden Dienstes ab. */
export async function runCheck(provider: string, state: IntegrationState): Promise<CheckResult> {
  const check = CHECKS[provider];
  if (check === undefined) return { ok: false, message: "Diese Anbindung lässt sich nicht prüfen." };
  try {
    return await check(state);
  } catch (error) {
    if (error instanceof ExternalServiceError) return { ok: false, message: error.message };
    throw error;
  }
}

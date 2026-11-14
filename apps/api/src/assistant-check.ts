// Prüft nach dem Einrichten des Testservers, ob der KI-Assistent mit dem echten Modell antwortet:
// eine Frage mit den echten Anweisungen und Werkzeugen, Ausgabe nur eine kurze Zusammenfassung
// (nie der Schlüssel). Kostet einen Bruchteil eines Cents. Aufruf: node dist/assistant-check.js
import { anthropicModel, SYSTEM_PROMPT, TOOLS } from "@shop/ai";
import { loadApiConfig } from "./config.js";

const config = loadApiConfig();
if (config.SHOP_ASSISTANT_API_KEY === undefined) {
  console.log("KI-Assistent: kein Schlüssel, nichts zu prüfen.");
  process.exit(0);
}
const model = anthropicModel({
  apiKey: config.SHOP_ASSISTANT_API_KEY,
  model: config.SHOP_ASSISTANT_MODEL,
  ...(config.SHOP_ASSISTANT_BASE_URL === undefined ? {} : { baseUrl: config.SHOP_ASSISTANT_BASE_URL }),
  maxTokens: 300,
});
try {
  const reply = await model.reply({
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: [
      { role: "user", content: [{ type: "text", text: "Welche Bestellungen muss ich noch versenden?" }] },
    ],
  });
  const calls = reply.content.flatMap((b) =>
    b.type === "tool_use" ? [`${b.name} ${JSON.stringify(b.input)}`] : [],
  );
  const text = reply.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join(" ")
    .slice(0, 200);
  console.log(
    `KI-Assistent: Modell ${model.name} antwortet (${reply.inputTokens} + ${reply.outputTokens} Tokens).`,
  );
  console.log(`  Text: ${text || "(keiner)"}`);
  console.log(`  Werkzeuge: ${calls.join("; ") || "(keine)"}`);
} catch (error) {
  console.log(`KI-Assistent: FEHLER ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// 1) Cargar el JSON del motor (el primero que empiece por "supermanager" o cualquier .json que no sea package*.json)
function loadEngine() {
  const files = fs.readdirSync(__dirname).filter((f) => f.toLowerCase().endsWith(".json") && !f.startsWith("package"));
  const file = files.find((f) => f.toLowerCase().startsWith("supermanager")) || files[0];
  if (!file) return { file: null, text: "Eres un asistente útil.", name: "Supermanager" };
  const raw = fs.readFileSync(path.join(__dirname, file), "utf8");
  let data;
  try { data = JSON.parse(raw); } catch { return { file, text: raw, name: "Supermanager" }; }
  const direct = data.system_prompt || data.systemPrompt || data.instructions || data.prompt;
  const text = typeof direct === "string"
    ? direct
    : "Actúa como el asistente definido por esta especificación JSON. Sigue sus reglas, módulos y estilo:\n\n" + JSON.stringify(data, null, 2);
  return { file, text, name: data.name || data.title || "Supermanager" };
}
const engine = loadEngine();
console.log("Motor cargado desde:", engine.file);

// 2) Llamada al modelo (Anthropic u OpenAI según la clave que configures)
async function askModel(messages) {
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-sonnet-5",
        max_tokens: 1500,
        system: engine.text,
        messages,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "Error de Anthropic");
    return d.content.map((b) => b.text || "").join("");
  }
  if (process.env.OPENAI_API_KEY) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: process.env.MODEL || "gpt-4o-mini",
        messages: [{ role: "system", content: engine.text }, ...messages],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "Error de OpenAI");
    return d.choices[0].message.content;
  }
  throw new Error("Falta ANTHROPIC_API_KEY u OPENAI_API_KEY en Environment.");
}

app.get("/api/info", (_req, res) => res.json({ name: engine.name }));

app.post("/api/chat", async (req, res) => {
  try {
    const messages = (req.body.messages || [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-30);
    if (!messages.length) return res.status(400).json({ error: "Sin mensajes." });
    res.json({ reply: await askModel(messages) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Servidor listo"));

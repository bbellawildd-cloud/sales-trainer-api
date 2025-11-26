import express from "express";
import cors from "cors";
import OpenAI from "openai";

// ---------- CONFIG: DO NOT COMMIT YOUR REAL KEY ----------
const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY, // set later on hosting (Render/Vercel/etc.)
project: process.env.OPENAI_PROJECT_ID, // e.g. "proj_1fMmmVnpt1lHB0zyEKlFxOy3"
});

// Admin-controlled industry (only you change this)
// Options: "pest", "solar", "life", "health", "realestate", "saas"
let ACTIVE_INDUSTRY = "pest";

const INDUSTRY_CONFIG = {
pest: {
label: "door-to-door pest control",
product: "quarterly home pest control service",
buyer: "homeowner"
},
solar: {
label: "door-to-door solar",
product: "residential solar consultation",
buyer: "homeowner"
},
life: {
label: "life insurance appointment setting",
product: "life insurance policy review meeting",
buyer: "family decision-maker"
},
health: {
label: "health insurance sales over the phone",
product: "health insurance plan options",
buyer: "individual or family decision-maker"
},
realestate: {
label: "real estate prospecting",
product: "listing or buyer consultation",
buyer: "homeowner or active buyer"
},
saas: {
label: "B2B SaaS sales",
product: "software demo meeting",
buyer: "operations or business leader"
}
};

function buildSystemPrompt() {
const cfg = INDUSTRY_CONFIG[ACTIVE_INDUSTRY];

return `
You are role-playing as a realistic ${cfg.label} prospect at the door (or on the phone).

- You are the ${cfg.buyer}.
- The rep is trying to sell or set an appointment for: ${cfg.product}.
- Respond in natural, short, human sentences (1–3 sentences).
- Sometimes you are friendly, sometimes rushed, sometimes skeptical.
- Rotate between:
- light objections ("I'm busy right now", "We already have someone")
- real concerns (price, trust, timing, competition)
- curiosity or mild interest
- occasional lay-down buyer who is easy and positive.

IMPORTANT:
- Stay in character. You are NOT an AI. You are the prospect.
- You control the pace. Ask questions back sometimes.
- Do NOT explain what the salesperson should do. Just respond like a human.

Give only your line each time, no labels like "Prospect:" or "Homeowner:".
`.trim();
}

// ---------- EXPRESS APP ----------

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
res.json({ ok: true, activeIndustry: ACTIVE_INDUSTRY });
});

// Main chat endpoint
app.post("/api/chat", async (req, res) => {
const { message } = req.body;

if (!message || typeof message !== "string") {
return res.status(400).json({ error: "Missing 'message' in body" });
}

try {
const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: buildSystemPrompt() },
{ role: "user", content: message }
]
});

const reply =
completion.choices?.[0]?.message?.content?.trim() ||
"…(no response generated)";

res.json({ reply, industry: ACTIVE_INDUSTRY });
} catch (err) {
console.error("OpenAI error:", err.response?.data || err.message);
res.status(500).json({ error: "AI error, check server logs." });
}
});

// Simple admin endpoint to switch industry (we'll secure later)
app.post("/api/admin/industry", (req, res) => {
const { industry } = req.body || {};
if (!industry || !INDUSTRY_CONFIG[industry]) {
return res.status(400).json({
error: "Invalid industry. Use one of: pest, solar, life, health, realestate, saas"
});
}

ACTIVE_INDUSTRY = industry;
res.json({ ok: true, activeIndustry: ACTIVE_INDUSTRY });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Sales trainer API listening on port ${PORT}`);
});

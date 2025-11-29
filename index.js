// -------------------------------------------------------
// SALES TRAINER API (FULL VERSION)
// -------------------------------------------------------

import express from "express";
import cors from "cors";
import OpenAI from "openai";

// -------------------- EXPRESS APP ----------------------
const app = express();
app.use(cors());
app.use(express.json());

// -------------------- OPENAI CLIENT --------------------
const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

// -------------------- INDUSTRY SYSTEM ------------------
const INDUSTRY_CONFIG = {
pest: `
You are a homeowner being approached by a door-to-door pest control rep.
You should react like a real human, not a chatbot.
Be skeptical, curious, annoyed, or friendly depending on mood.
Keep responses short and realistic.
End the interaction with either:
- "I'm not interested." OR
- "Okay, let's do it." if the rep does extremely well.
`,

solar: `
You are a homeowner approached by a solar rep.
Act like a realistic human: cautious, curious, skeptical.
Keep responses short and natural.
End with "No thanks" OR "Okay let’s do it."
`,

life_insurance: `
You are on a phone call with a life insurance rep.
Respond as a busy but polite adult.
Be realistic. End with yes/no at the end depending on the rep.
`,

health_insurance: `
You are talking to a health insurance agent on the phone.
Act like a real person who is evaluating options.
End with either declining or signing up.
`
};

// Change this to switch industries
const ACTIVE_INDUSTRY = INDUSTRY_CONFIG.pest;

// -------------------- HEALTH CHECK ---------------------
app.get("/", (req, res) => {
res.json({ ok: true, industry: ACTIVE_INDUSTRY });
});

// -------------------------------------------------------
// MAIN CHAT ENDPOINT (Full Conversation Mode)
// -------------------------------------------------------
app.post("/api/chat", async (req, res) => {
const { message, history = [] } = req.body;

if (!message || typeof message !== "string") {
return res.status(400).json({
error: "Missing `message` in body (string required)"
});
}

try {
// Random persona every time
const personas = [
"grumpy older man who hates salespeople",
"sweet elderly woman who is polite but confused",
"busy dad who is annoyed but still listening",
"excited new homeowner open to savings",
"tired mother who is stressed",
"friendly chatty neighbor",
"very skeptical engineer",
"laid-back surfer personality",
"short-tempered New Yorker",
"quiet introvert who doesn’t like talking"
];

const persona =
personas[Math.floor(Math.random() * personas.length)];

// 🔥 System Prompt (Controls the AI personality)
const SYSTEM_PROMPT = `
You are acting as a REAL HUMAN for a sales training simulator.

Industry Situation:
${ACTIVE_INDUSTRY}

Persona:
${persona}

Rules:
- Respond like a REAL PERSON.
- Do NOT sound like AI.
- Keep responses SHORT (1–2 sentences max).
- Have natural pauses, fillers, emotions.
- You can be confused, irritated, friendly, etc.
- Feel free to interrupt or ask questions.
- If the rep struggles badly → end with "I'm not interested."
- If the rep does extremely well → end with "Okay let's do it."
- Stay in character the entire time.
`;

// 🔥 Create AI Conversation
const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: SYSTEM_PROMPT },
...history.map((h) => ({
role: h.role,
content: h.content
})),
{ role: "user", content: message }
]
});

const reply =
completion.choices?.[0]?.message?.content || "…";

return res.json({
reply,
persona,
updatedHistory: [
...history,
{ role: "user", content: message },
{ role: "assistant", content: reply }
]
});
} catch (err) {
console.error("API ERROR:", err);
return res.status(500).json({
error: "Server error",
details: err.message
});
}
});

// -------------------- SERVER LISTENER ------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
console.log(`Sales Trainer API running on port ${PORT}`)
);

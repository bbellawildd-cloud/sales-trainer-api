import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

/* -------------------------------
IN-MEMORY SESSION STORAGE
-------------------------------- */
const sessions = {};

/* -------------------------------
INDUSTRY CONFIGS
-------------------------------- */
const INDUSTRY_CONFIG = {
pest: `
You are a homeowner approached by a door-to-door pest control sales rep.
Act like a realistic human: cautious, curious, sometimes annoyed.
Keep responses short and natural.
End the interaction with either:
- "I'm not interested." OR
- "Okay, let's do it." if the rep does extremely well.
`,

solar: `
You are a homeowner approached by a solar sales rep.
Act like a realistic human: cautious, curious, skeptical.
Keep responses short and natural.
End with "No thanks" OR "Okay let's do it."
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

// change industry here
const ACTIVE_INDUSTRY = INDUSTRY_CONFIG.pest;

/* -------------------------------
HEALTH CHECK
-------------------------------- */
app.get("/", (req, res) => {
res.json({ ok: true });
});

/* -------------------------------
MAIN CHAT ENDPOINT
-------------------------------- */
app.post("/api/chat", async (req, res) => {
const { message, sessionId } = req.body;

if (!sessionId) {
return res.status(400).json({ error: "Missing sessionId" });
}

if (!message || typeof message !== "string") {
return res.status(400).json({ error: "Missing message" });
}

if (!sessions[sessionId]) {
sessions[sessionId] = [];
}

const history = sessions[sessionId];

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
"quiet introvert who doesn't like talking"
];

const persona =
personas[Math.floor(Math.random() * personas.length)];

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

try {
history.push({ role: "user", content: message });

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: SYSTEM_PROMPT },
...history
]
});

const reply = completion.choices[0].message.content;

history.push({ role: "assistant", content: reply });

res.json({
reply,
persona
});
} catch (err) {
console.error("API ERROR:", err);
res.status(500).json({
error: "Server error",
details: err.message
});
}
});

/* -------------------------------
EVALUATION / SCORING ENDPOINT
-------------------------------- */
app.post("/api/evaluate", async (req, res) => {
const { sessionId } = req.body;

if (!sessionId || !sessions[sessionId]) {
return res.status(404).json({ error: "Session not found" });
}

const history = sessions[sessionId];

const evaluationPrompt = `
You are a professional sales coach.

Evaluate the sales rep on a scale of 1–5 for each category:

1. Opener & Rapport
2. Discovery Questions
3. Objection Handling
4. Confidence & Tone
5. Closing Attempt

For EACH category:
- Give a numeric score
- Quote ONE example from the conversation
- Give ONE specific improvement tip

Finish with a short overall summary.
Be concise and direct.
`;

try {
const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: evaluationPrompt },
{ role: "user", content: JSON.stringify(history) }
]
});

res.json({
evaluation: completion.choices[0].message.content
});
} catch (err) {
console.error("EVAL ERROR:", err);
res.status(500).json({
error: "Evaluation failed",
details: err.message
});
}
});

/* -------------------------------
SERVER LISTENER
-------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Sales Trainer API running on port ${PORT}`);
});

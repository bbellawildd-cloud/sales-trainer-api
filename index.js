// index.js — Sales Trainer API (multi-industry + personas + XP)

import express from "express";
import cors from "cors";
import OpenAI from "openai";

// ---------- EXPRESS APP ----------
const app = express();
app.use(cors());
app.use(express.json());

// ---------- OPENAI CLIENT ----------
const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

// ---------- INDUSTRY CONFIG ----------
const INDUSTRY_CONFIG = {
pest: {
label: "Door-to-door pest control",
channel: "door",
typicalCustomer: "Suburban homeowner who gets pests in/around the house.",
goals:
"Decide if they trust the rep enough to let them treat the home. Price sensitivity, but also cares about safety, spouse approval, and convenience.",
},
solar: {
label: "Door-to-door solar",
channel: "door",
typicalCustomer:
"Homeowner who has heard of solar but is skeptical about cost, contracts, or roof impact.",
goals:
"Figure out if switching to solar makes financial sense and whether they trust the rep.",
},
life: {
label: "Life insurance (phone)",
channel: "phone",
typicalCustomer:
"Working adult with family responsibilities, busy schedule, and some skepticism about insurance pitches.",
goals:
"Understand if the coverage is worth the cost; avoid being pressured; protect family income.",
},
health: {
label: "Health insurance (phone)",
channel: "phone",
typicalCustomer:
"Individual or family looking for coverage, but confused about deductibles, networks, and subsidies.",
goals:
"Avoid surprise bills, make sure doctors are in network, and not overpay for coverage.",
},
saas: {
label: "Warehouse SaaS / Rufus-style",
channel: "phone",
typicalCustomer:
"Ops / warehouse manager evaluating new tech while juggling fires all day.",
goals:
"Save time and money, but avoid risky rollouts and vaporware. Needs clear ROI.",
},
};

// default industry if none provided
let ACTIVE_INDUSTRY = "pest";

// ---------- SYSTEM PROMPT BUILDER ----------
function buildSystemPrompt(industryKey) {
const cfg =
INDUSTRY_CONFIG[industryKey] || INDUSTRY_CONFIG[ACTIVE_INDUSTRY];

const channelText =
cfg.channel === "door"
? "You are speaking to a door-to-door sales rep at the front door."
: "You are speaking to a sales rep over the phone.";

return `
You are a realistic ${cfg.label} customer for a sales training simulator.

${channelText}
You have natural human emotions, a backstory, and a personality. Sometimes you're annoyed or busy, sometimes curious, sometimes very interested.

You are training the rep. Your job:
- Respond like a real customer in short, natural sentences.
- Ask questions, raise objections, and react to the rep's tone and wording.
- Avoid giving in too easily. Make them EARN the close.
- Sometimes be skeptical, distracted, or price-sensitive.
- Sometimes be open, friendly, or excited.
- Use normal everyday language, not corporate-speak.

CONVERSATION RULES:
- Keep each reply 1–3 sentences max, like a real back-and-forth.
- Stay in character (you are the customer, not a coach).
- Do NOT explain that this is training.
- Do NOT talk about "AI" or "simulation" in the reply.

ENDING THE CONVERSATION:
Eventually, decide if the rep wins or loses:
- If they do poorly, end with a clear "no" (politely or firmly).
- If they do well, you can end with a clear "yes" or "let's move forward".
- When you feel the pitch has logically run its course, mark "done": true in your JSON.

SCORING & FEEDBACK:
For every reply you send back, you must also output:
- A short 1–2 sentence feedback summary for the rep.
- A numeric score from 0–100 for how well they did so far.
- An XP delta (how many XP points they should gain this turn).
- Your persona details (name, age, mood, short description).

OUTPUT FORMAT (VERY IMPORTANT):
Always respond as a single JSON object with this exact shape:

{
"reply": "what you say out loud to the rep",
"done": false,
"score": 78,
"xpDelta": 12,
"feedback": "Short coaching feedback for the rep.",
"persona": {
"name": "Customer name",
"age": 34,
"mood": "annoyed but listening",
"description": "1–2 sentences about who this customer is."
}
}

- "reply" is what the rep hears from you.
- "done" is true ONLY when the pitch is clearly over (win or lose).
- "score" is your current rating of the rep's performance (0–100).
- "xpDelta" is how much XP they earn from THIS turn.
- "feedback" is direct advice as if you're a coach AFTER the call.
- "persona" stays consistent during the conversation.

DO NOT return anything that is not valid JSON.
`;
}

// ---------- ROUTES ----------

// Health check
app.get("/", (req, res) => {
res.json({
ok: true,
activeIndustry: ACTIVE_INDUSTRY,
industries: Object.keys(INDUSTRY_CONFIG),
});
});

// Simple admin endpoint to switch active industry (optional)
app.post("/api/admin/industry", (req, res) => {
const { industry } = req.body || {};
if (!industry || !INDUSTRY_CONFIG[industry]) {
return res
.status(400)
.json({ error: "Invalid industry", allowed: Object.keys(INDUSTRY_CONFIG) });
}
ACTIVE_INDUSTRY = industry;
res.json({ ok: true, activeIndustry: ACTIVE_INDUSTRY });
});

// Main chat endpoint
app.post("/api/chat", async (req, res) => {
try {
const { message, history = [], industry } = req.body || {};

if (!message || typeof message !== "string") {
return res
.status(400)
.json({ error: "Missing 'message' in body (string required)" });
}

const activeIndustry = industry || ACTIVE_INDUSTRY;
const systemPrompt = buildSystemPrompt(activeIndustry);

// build chat history (optional)
const historyMessages = Array.isArray(history)
? history.map((h) => ({
role: h.role === "assistant" ? "assistant" : "user",
content: String(h.content || ""),
}))
: [];

const messages = [
{ role: "system", content: systemPrompt },
...historyMessages,
{ role: "user", content: message },
];

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
response_format: { type: "json_object" },
messages,
});

const content = completion.choices[0]?.message?.content || "{}";

let data;
try {
data = JSON.parse(content);
} catch (err) {
console.error("JSON parse error from OpenAI:", content);
return res.status(500).json({
error: "Failed to parse AI response JSON",
raw: content,
});
}

// basic safety defaults
if (typeof data.reply !== "string") {
data.reply = "Sorry, something went wrong generating a reply.";
}
if (typeof data.done !== "boolean") data.done = false;
if (typeof data.score !== "number") data.score = 0;
if (typeof data.xpDelta !== "number") data.xpDelta = 0;
if (typeof data.feedback !== "string") data.feedback = "";
if (typeof data.persona !== "object" || !data.persona) {
data.persona = {
name: "Unknown",
age: null,
mood: "neutral",
description: "",
};
}

return res.json({
...data,
industry: activeIndustry,
});
} catch (err) {
console.error("Error in /api/chat:", err);
return res.status(500).json({ error: "Server error" });
}
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Sales trainer API listening on port ${PORT}`);
});

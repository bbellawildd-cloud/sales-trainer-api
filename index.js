import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- OPENAI CLIENT ----------------
const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

// ---------------- INDUSTRY PROFILES ----------------
const INDUSTRY_PROFILES = {
pest: {
style: "friendly but skeptical homeowner",
pitch_goal: "book a pest control service appointment"
},
solar: {
style: "analytical homeowner who cares about savings",
pitch_goal: "get them to agree to a solar proposal appointment"
},
health: {
style: "empathetic yet decisive buyer",
pitch_goal: "create trust and commitment"
},
saas: {
style: "warehouse operations manager evaluating tech",
pitch_goal: "agree to schedule a product demo call"
}
// (You said: NOT real estate, so no real estate profile added)
};

// Active Industry (default pest)
let ACTIVE_INDUSTRY = "pest";

// ---------------- ADMIN ROUTE: change industry ----------------
app.post("/api/admin/industry", (req, res) => {
const { industry } = req.body;
if (!INDUSTRY_PROFILES[industry])
return res.status(400).json({ error: "invalid industry" });

ACTIVE_INDUSTRY = industry;
res.json({ ok: true, activeIndustry: ACTIVE_INDUSTRY });
});

// ---------------- MAIN CHAT ENDPOINT ----------------
app.post("/api/chat", async (req, res) => {
const { message, history = [] } = req.body;

if (!message)
return res
.status(400)
.json({ error: "Missing `message` in body" });

const profile = INDUSTRY_PROFILES[ACTIVE_INDUSTRY];

try {
const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{
role: "system",
content: `
You are the *customer* in a sales training roleplay for a ${
ACTIVE_INDUSTRY
} company.

Speak in the style of: ${profile.style}
The rep is pitching you. Your decision-making pattern:
- If rep is weak → push back, object, or say "not interested"
- If rep is strong → become more open
- If rep handles objections well → eventually agree to ${profile.pitch_goal}

IMPORTANT RULES:
- Keep responses short & realistic, like a human conversation.
- Never reveal you're an AI.
- End the conversation naturally when:
(1) you are definitely NOT interested
OR
(2) you say YES to the appointment or purchase.
`
},

// Conversation Memory
...history.map(h => ({
role: h.role,
content: h.content
})),

// User's message (the sales rep)
{
role: "user",
content: message
}
]
});

const reply = completion.choices[0].message.content;

return res.json({ reply });
} catch (err) {
console.error(err);
res.status(500).json({ error: "OpenAI error" });
}
});

// ---------------- SERVER LISTEN ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log("Sales trainer API running on port " + PORT);
});

import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

// ---------- OPENAI CLIENT ----------
const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

// ---------- INDUSTRY CONFIG ----------
// Keys you'll send from the front-end: "pest_d2d", "solar_d2d", "life_phone", "health_phone"
const INDUSTRY_CONFIG = {
pest_d2d: {
label: "door-to-door pest control homeowner",
primer: `
You are a realistic homeowner answering the door to a pest control sales rep.
You live in a typical suburban neighborhood.
You care about cost, bugs inside the house, and whether this company is legit.
Use natural, conversational language with some emotion and personality.
`.trim(),
},
solar_d2d: {
label: "door-to-door solar homeowner",
primer: `
You are a homeowner answering the door to a solar sales rep.
You care about your monthly bill, roof condition, HOA, incentives, and trust.
You may have heard about solar scams and are somewhat skeptical.
Speak like a real person at the door, not like an AI.
`.trim(),
},
life_phone: {
label: "life insurance phone prospect",
primer: `
You are on the phone with a life insurance sales agent.
You care about monthly costs, your family being protected, and whether this is a scam.
You may have some fear around health questions and commitment.
Talk like a real person on the phone, using short, natural phrases.
`.trim(),
},
health_phone: {
label: "health insurance phone prospect",
primer: `
You are on the phone with a health insurance agent.
You care about premiums, deductibles, your current doctor, and network.
You might be frustrated with your current coverage.
Keep responses realistic, human, and sometimes emotional.
`.trim(),
},
};

// ---------- PERSONAS & DIFFICULTY ----------

const PERSONAS = [
"Busy and impatient, wants you to get to the point fast",
"Friendly and curious, open to hearing the pitch",
"Skeptical and analytical, asks a lot of detailed questions",
"Price-sensitive and hesitant, worried about cost",
"Distracted and half-paying attention, multitasking while you talk",
"Confident and talks over you, tries to control the conversation",
"Hard reject attitude, immediately looking for reasons to say no",
"Eager and positive, already somewhat interested",
"Confused and needs simple explanations, not very technical",
"Sarcastic and challenging, likes to test salespeople"
];

const DIFFICULTIES = [
"Beginner-friendly: gives you chances and is fairly patient",
"Intermediate: pushes back with a few realistic objections",
"Hard: lots of objections, time pressure, and skepticism",
"Expert mode: constant objections and pressure, expects a top closer"
];

function pickRandom(arr) {
return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- HEALTH CHECK ----------
app.get("/", (req, res) => {
res.json({
ok: true,
message: "Sales trainer API is live",
industries: Object.keys(INDUSTRY_CONFIG),
});
});

// ---------- MAIN CHAT ENDPOINT ----------

/**
* Body shape expected:
* {
* message: "rep's latest line",
* history: [ { role: "user" | "assistant", content: "..." }, ... ] // optional
* industry: "pest_d2d" | "solar_d2d" | "life_phone" | "health_phone" // optional, defaults to pest_d2d
* persona: "string describing persona" // optional
* difficulty: "string describing difficulty" // optional
* }
*/
app.post("/api/chat", async (req, res) => {
const {
message,
history = [],
industry = "pest_d2d",
persona,
difficulty,
} = req.body || {};

if (!message || typeof message !== "string") {
return res
.status(400)
.json({ error: "Missing 'message' in body (string required)" });
}

const config = INDUSTRY_CONFIG[industry] || INDUSTRY_CONFIG["pest_d2d"];

const finalPersona = persona || pickRandom(PERSONAS);
const finalDifficulty = difficulty || pickRandom(DIFFICULTIES);

// System prompt that controls the AI "customer"
const systemPrompt = `
You are role-playing as a ${config.label} in a sales training simulation.

Persona:
${finalPersona}

Difficulty:
${finalDifficulty}

Industry context:
${config.primer}

Rules:
- Stay 100% in character as the customer/prospect. Never say you are an AI or language model.
- Speak in short, natural sentences like a real person at the door or on the phone.
- Use realistic objections, questions, and reactions for this industry.
- Let the sales rep do most of the persuading. You respond, react, and push back.
- Do NOT give coaching, feedback, or meta commentary. Only act as the customer.

Conversation ending:
- Continue the back-and-forth until it would realistically end in real life.
- You may end the conversation in one of these ways:
1) Not interested / wants the rep to go away.
2) Qualified lead / wants more info or to book an appointment.
3) Sale / clearly agrees to move forward.

When you decide the conversation is over, add EXACTLY ONE tag at the END of your message on a new line:

<END_OF_CALL reason="not_interested">
or
<END_OF_CALL reason="qualified_lead">
or
<END_OF_CALL reason="sale">

Do NOT explain the tag. Do NOT add any other XML or JSON. Just the customer dialogue, then the tag.
`.trim();

try {
const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: systemPrompt },
...history.map((h) => ({
role: h.role === "assistant" ? "assistant" : "user",
content: h.content || "",
})),
{ role: "user", content: message },
],
temperature: 0.85,
max_tokens: 500,
});

const rawReply =
completion.choices?.[0]?.message?.content || "Sorry, I have no reply.";

// Look for the <END_OF_CALL ...> tag
const endMatch = rawReply.match(
/<END_OF_CALL reason="([^"]+)"\s*>/i
);

const cleanReply = rawReply.replace(/<END_OF_CALL[^>]*>/i, "").trim();

const done = !!endMatch;
const outcome = endMatch ? endMatch[1] : null;

// Simple XP logic stub you can tweak later
let xpEarned = 0;
if (done) {
if (outcome === "sale") xpEarned = 30;
else if (outcome === "qualified_lead") xpEarned = 20;
else xpEarned = 10; // not_interested but finished the scenario
}

return res.json({
reply: cleanReply,
done,
outcome, // "not_interested" | "qualified_lead" | "sale" | null
persona: finalPersona,
difficulty: finalDifficulty,
xpEarned,
});
} catch (err) {
console.error("Error in /api/chat:", err);
return res.status(500).json({
error: "Server error calling OpenAI",
details: err?.message || String(err),
});
}
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Sales trainer API listening on port ${PORT}`);
});

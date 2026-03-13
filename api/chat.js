import OpenAI from "openai";

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({ error: "Method not allowed" });
}

const { message, userId, sessionId } = req.body || {};

if (!message?.trim()) {
return res.status(400).json({ error: "Missing message" });
}

const SYSTEM_PROMPT = `
You are a REAL HUMAN prospect in a sales training simulator.

Respond naturally like a real person.
Keep responses short, conversational, and in character.

Return ONLY valid JSON in this exact format:

{
"reply": "your response here",
"emotion": "idle"
}

Allowed emotions:
idle
skeptical
annoyed
happy
confused
thinking
not_interested
surprised

Emotion guidance:
- skeptical = doubts, price pushback, trust concerns
- annoyed = rep is too pushy, awkward, or repetitive
- happy = rep is connecting well
- confused = rep explained something poorly
- thinking = prospect is considering the offer
- not_interested = prospect is mentally checking out
- surprised = prospect hears something unexpectedly strong
- idle = neutral/default
`.trim();

try {
const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: SYSTEM_PROMPT },
{ role: "user", content: message.trim() }
]
});

const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";

let parsed;
try {
parsed = JSON.parse(raw);
} catch (e) {
parsed = {
reply: raw,
emotion: "idle"
};
}

const allowed = [
"idle",
"skeptical",
"annoyed",
"happy",
"confused",
"thinking",
"not_interested",
"surprised"
];

const reply = parsed.reply || "...";
const emotion = allowed.includes(parsed.emotion) ? parsed.emotion : "idle";

return res.status(200).json({ reply, emotion, userId, sessionId });
} catch (error) {
return res.status(500).json({
error: "AI request failed",
details: error.message
});
}
}

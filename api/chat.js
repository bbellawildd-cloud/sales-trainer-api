import OpenAI from "openai";

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {

if (req.method !== "POST") {
return res.status(405).json({ error: "Method not allowed" });
}

const { message } = req.body;

const SYSTEM_PROMPT = `
You are a REAL HUMAN prospect in a sales training simulator.

Respond naturally like a real person.

Return ONLY valid JSON like this:

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
`;

try {

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: SYSTEM_PROMPT },
{ role: "user", content: message }
]
});

const raw = completion.choices?.[0]?.message?.content || "{}";

let parsed;

try {
parsed = JSON.parse(raw);
} catch {
parsed = {
reply: raw,
emotion: "idle"
};
}

res.json({
reply: parsed.reply,
emotion: parsed.emotion
});

} catch (error) {

res.status(500).json({
error: "AI request failed"
});

}

}

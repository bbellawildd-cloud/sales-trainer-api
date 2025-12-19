import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabaseAdmin = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -------- XP/Level config --------
const LEVELS = [
{ level: 1, xp: 0 },
{ level: 2, xp: 50 },
{ level: 3, xp: 125 },
{ level: 4, xp: 250 },
{ level: 5, xp: 450 },
{ level: 6, xp: 700 },
{ level: 7, xp: 1000 },
{ level: 8, xp: 1400 },
{ level: 9, xp: 1850 },
{ level: 10, xp: 2350 }
];

const DIFFICULTY_MULT = { 1: 1.0, 2: 1.1, 3: 1.25, 4: 1.4, 5: 1.6 };

function getLevel(totalXp) {
let cur = 1;
for (const l of LEVELS) if (totalXp >= l.xp) cur = l.level;
return cur;
}

// -------- Industry prompts --------
const INDUSTRY_CONFIG = {
pest: `You are a homeowner approached by a door-to-door pest control sales rep.`,
solar: `You are a homeowner approached by a solar sales rep.`,
insurance: `You are a consumer on a call with an insurance rep.`
};

const PERSONAS = [
"grumpy older man who hates salespeople",
"sweet elderly woman who is polite but confused",
"busy dad who is annoyed but still listening",
"very skeptical engineer",
"friendly chatty neighbor",
"short-tempered New Yorker"
];

// -------- Helper: verify user + get profile (company) --------
async function getProfileOrThrow(userId) {
const { data, error } = await supabaseAdmin
.from("profiles")
.select("user_id, company_id, rep_name, total_xp, level, is_manager")
.eq("user_id", userId)
.single();

if (error || !data) {
const msg = error?.message || "Profile not found";
throw new Error(msg);
}
return data;
}

app.get("/", (req, res) => res.json({ ok: true }));

// -------- Start session --------
// Body: { userId, industry, difficulty }
app.post("/api/session/start", async (req, res) => {
try {
const { userId, industry = "pest", difficulty = 2 } = req.body;
if (!userId) return res.status(400).json({ error: "Missing userId" });

const profile = await getProfileOrThrow(userId);

const { data: session, error } = await supabaseAdmin
.from("sessions")
.insert({
user_id: userId,
company_id: profile.company_id,
industry,
difficulty
})
.select("id, industry, difficulty, created_at")
.single();

if (error) throw error;

res.json({ session });
} catch (e) {
res.status(500).json({ error: "Failed to start session", details: e.message });
}
});

// -------- Chat --------
// Body: { userId, sessionId, message }
app.post("/api/chat", async (req, res) => {
try {
const { userId, sessionId, message } = req.body;
if (!userId || !sessionId || !message) {
return res.status(400).json({ error: "Missing userId/sessionId/message" });
}

const profile = await getProfileOrThrow(userId);

// Fetch session and verify ownership/company
const { data: session, error: sErr } = await supabaseAdmin
.from("sessions")
.select("id, company_id, user_id, industry, difficulty")
.eq("id", sessionId)
.single();

if (sErr || !session) throw new Error(sErr?.message || "Session not found");
if (session.company_id !== profile.company_id) {
return res.status(403).json({ error: "Forbidden (wrong company)" });
}
if (session.user_id !== userId) {
return res.status(403).json({ error: "Forbidden (wrong user)" });
}

// Load recent transcript (last 30 messages)
const { data: msgs, error: mErr } = await supabaseAdmin
.from("session_messages")
.select("role, content")
.eq("session_id", sessionId)
.order("id", { ascending: true })
.limit(30);

if (mErr) throw mErr;

const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
const industryPrompt = INDUSTRY_CONFIG[session.industry] || INDUSTRY_CONFIG.pest;

const SYSTEM_PROMPT = `
You are acting as a REAL HUMAN for a sales training simulator.

Industry:
${industryPrompt}

Persona:
${persona}

Rules:
- Respond like a REAL PERSON. Not an AI.
- Keep responses SHORT (1–2 sentences).
- Natural emotion. Can be skeptical/annoyed/friendly.
- If rep struggles badly: end with "I'm not interested."
- If rep does extremely well: end with "Okay let's do it."
- Stay in character.
`;

// Save user message
await supabaseAdmin.from("session_messages").insert({
session_id: sessionId,
role: "user",
content: message
});

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [{ role: "system", content: SYSTEM_PROMPT }, ...(msgs || []), { role: "user", content: message }]
});

const reply = completion.choices[0].message.content;

// Save assistant reply
await supabaseAdmin.from("session_messages").insert({
session_id: sessionId,
role: "assistant",
content: reply
});

res.json({ reply });
} catch (e) {
res.status(500).json({ error: "Chat failed", details: e.message });
}
});

// -------- Evaluate + XP --------
// Body: { userId, sessionId }
app.post("/api/evaluate", async (req, res) => {
try {
const { userId, sessionId } = req.body;
if (!userId || !sessionId) {
return res.status(400).json({ error: "Missing userId/sessionId" });
}

const profile = await getProfileOrThrow(userId);

const { data: session, error: sErr } = await supabaseAdmin
.from("sessions")
.select("id, company_id, user_id, industry, difficulty")
.eq("id", sessionId)
.single();

if (sErr || !session) throw new Error(sErr?.message || "Session not found");
if (session.company_id !== profile.company_id || session.user_id !== userId) {
return res.status(403).json({ error: "Forbidden" });
}

const { data: msgs, error: mErr } = await supabaseAdmin
.from("session_messages")
.select("role, content")
.eq("session_id", sessionId)
.order("id", { ascending: true });

if (mErr) throw mErr;

const evalPrompt = `
Return STRICT JSON only.

Score the rep 1–5:
- opener
- discovery
- objections
- confidence
- close

Format:
{
"scores": { "opener": 3, "discovery": 2, "objections": 4, "confidence": 3, "close": 2 },
"summary": "short, direct coaching recap"
}
`;

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: evalPrompt },
{ role: "user", content: JSON.stringify(msgs || []) }
]
});

const parsed = JSON.parse(completion.choices[0].message.content);
const scores = parsed.scores;

const baseXp = Object.values(scores).reduce((a, b) => a + b, 0) * 2;
const mult = DIFFICULTY_MULT[session.difficulty] ?? 1.1;
const xpEarned = Math.round(baseXp * mult);

const newTotal = profile.total_xp + xpEarned;
const newLevel = getLevel(newTotal);

// Write evaluation (unique per session)
const { error: eErr } = await supabaseAdmin.from("evaluations").insert({
session_id: sessionId,
company_id: profile.company_id,
user_id: userId,
scores,
summary: parsed.summary,
xp_earned: xpEarned
});

if (eErr) throw eErr;

// End session
await supabaseAdmin.from("sessions").update({ ended_at: new Date().toISOString() }).eq("id", sessionId);

// Update profile XP/level
const { error: pErr } = await supabaseAdmin
.from("profiles")
.update({ total_xp: newTotal, level: newLevel })
.eq("user_id", userId);

if (pErr) throw pErr;

res.json({
scores,
summary: parsed.summary,
xpEarned,
totalXp: newTotal,
level: newLevel
});
} catch (e) {
res.status(500).json({ error: "Evaluate failed", details: e.message });
}
});

// -------- Leaderboard (same company) --------
// Query: /api/leaderboard?userId=...
app.get("/api/leaderboard", async (req, res) => {
try {
const { userId } = req.query;
if (!userId) return res.status(400).json({ error: "Missing userId" });

const profile = await getProfileOrThrow(userId);

const { data, error } = await supabaseAdmin
.from("profiles")
.select("rep_name, total_xp, level")
.eq("company_id", profile.company_id)
.order("level", { ascending: false })
.order("total_xp", { ascending: false })
.limit(50);

if (error) throw error;

res.json({ leaderboard: data || [] });
} catch (e) {
res.status(500).json({ error: "Leaderboard failed", details: e.message });
}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));

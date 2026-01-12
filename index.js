import express from "express";
import cors from "cors";
import crypto from "crypto";
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

// Random persona pool (session-level randomization)
const PERSONAS = [
"grumpy older man who hates salespeople",
"sweet elderly woman who is polite but confused",
"busy dad who is annoyed but still listening",
"very skeptical engineer",
"friendly chatty neighbor",
"short-tempered New Yorker"
];

function pickRandom(arr) {
return arr[Math.floor(Math.random() * arr.length)];
}

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

// Randomize ONCE per session
const persona = pickRandom(PERSONAS);
const faceSeed = crypto.randomUUID();

const { data: session, error } = await supabaseAdmin
.from("sessions")
.insert({
user_id: userId,
company_id: profile.company_id,
industry,
difficulty,
persona,
face_seed: faceSeed
})
.select("id, industry, difficulty, persona, face_seed, created_at")
.single();

if (error) throw error;

const faceUrl = `https://api.dicebear.com/8.x/notionists/png?seed=${faceSeed}`;

res.json({ session, faceUrl });
} catch (e) {
res.status(500).json({ error: "Failed to start session", details: e.message });
}
});

// -------- Chat (ROLEPLAY ONLY; NO SCORING) --------
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
.select("id, company_id, user_id, industry, difficulty, persona, face_seed")
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

const persona = session.persona || pickRandom(PERSONAS);
const industryPrompt = INDUSTRY_CONFIG[session.industry] || INDUSTRY_CONFIG.pest;

// IMPORTANT: roleplay only. no grading. keep short.
const SYSTEM_PROMPT = `
You are acting as a REAL HUMAN for a sales training simulator.

Industry:
${industryPrompt}

Persona:
${persona}

Rules:
- Respond like a REAL PERSON, not an AI.
- Keep responses SHORT (1–2 sentences).
- Natural emotion. Can be skeptical/annoyed/friendly.
- NEVER grade or coach.
- If rep struggles badly: end with "I'm not interested."
- If rep does extremely well: end with "Okay let's do it."
- Stay in character.
`.trim();

// Save user message
await supabaseAdmin.from("session_messages").insert({
session_id: sessionId,
role: "user",
content: message
});

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: SYSTEM_PROMPT },
...(msgs || []),
{ role: "user", content: message }
]
});

const reply = completion.choices?.[0]?.message?.content?.trim() || "";

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

// -------- Evaluate + XP (ONLY AT END) --------
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
.select("id, company_id, user_id, industry, difficulty, persona")
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

// More reliable evaluator: strict JSON output
const evalSystem = `
You are a strict sales conversation evaluator.
You MUST output ONLY valid JSON. No markdown. No extra text.
`.trim();

const evalUser = `
Context:
Industry: ${session.industry}
Persona: ${session.persona || "unknown"}

Score the rep 1–5 (integers only):
- opener
- discovery
- objections
- confidence
- close

Return JSON in EXACT format:
{
"scores": { "opener": 3, "discovery": 2, "objections": 4, "confidence": 3, "close": 2 },
"summary": "short, direct coaching recap (2-4 sentences)",
"topFixes": ["...", "...", "..."],
"betterClose": "one improved closing line"
}

Conversation transcript (array of messages):
${JSON.stringify(msgs || [], null, 0)}
`.trim();

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: evalSystem },
{ role: "user", content: evalUser }
],
response_format: { type: "json_object" }
});

const raw = completion.choices?.[0]?.message?.content || "{}";

let parsed;
try {
parsed = JSON.parse(raw);
} catch {
// fallback if model ever misbehaves
parsed = {
scores: { opener: 3, discovery: 3, objections: 3, confidence: 3, close: 3 },
summary: "Evaluator output failed to parse. Defaulted to neutral scores.",
topFixes: ["Ask more discovery questions", "Quantify value", "Close with a clear next step"],
betterClose: "If I can show you how this saves time, are you open to a quick 15-min follow up?"
};
}

const scores = parsed.scores || {};
const safeScores = {
opener: Number(scores.opener) || 1,
discovery: Number(scores.discovery) || 1,
objections: Number(scores.objections) || 1,
confidence: Number(scores.confidence) || 1,
close: Number(scores.close) || 1
};

const baseXp = Object.values(safeScores).reduce((a, b) => a + b, 0) * 2;
const mult = DIFFICULTY_MULT[session.difficulty] ?? 1.1;
const xpEarned = Math.round(baseXp * mult);

const newTotal = (profile.total_xp || 0) + xpEarned;
const newLevel = getLevel(newTotal);

// Write evaluation (unique per session)
const { error: eErr } = await supabaseAdmin.from("evaluations").insert({
session_id: sessionId,
company_id: profile.company_id,
user_id: userId,
scores: safeScores,
summary: parsed.summary || "",
xp_earned: xpEarned
});

if (eErr) throw eErr;

// End session
await supabaseAdmin
.from("sessions")
.update({ ended_at: new Date().toISOString() })
.eq("id", sessionId);

// Update profile XP/level
const { error: pErr } = await supabaseAdmin
.from("profiles")
.update({ total_xp: newTotal, level: newLevel })
.eq("user_id", userId);

if (pErr) throw pErr;

res.json({
scores: safeScores,
summary: parsed.summary,
topFixes: parsed.topFixes || [],
betterClose: parsed.betterClose || "",
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

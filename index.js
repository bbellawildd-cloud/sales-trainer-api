import express from "express";
import cors from "cors";
import crypto from "crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

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

function clamp(n, min, max) {
const x = Number(n);
if (!Number.isFinite(x)) return null;
return Math.max(min, Math.min(max, x));
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

const persona = session.persona || pickRandom(PERSONAS);
const industryPrompt = INDUSTRY_CONFIG[session.industry] || INDUSTRY_CONFIG.pest;

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

await supabaseAdmin.from("session_messages").insert({
session_id: sessionId,
role: "user",
content: message
});

const { data: msgs, error: mErr } = await supabaseAdmin
.from("session_messages")
.select("role, content")
.eq("session_id", sessionId)
.order("id", { ascending: true })
.limit(30);

if (mErr) throw mErr;

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [{ role: "system", content: SYSTEM_PROMPT }, ...(msgs || [])]
});

const reply = completion.choices?.[0]?.message?.content?.trim() || "";

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

const transcript = JSON.stringify(msgs || [], null, 0);

const evalSystem = `
You are an elite sales coach + evaluator.

Return ONLY valid JSON. No markdown. No extra commentary.

You are grading a sales rep roleplay conversation with a prospect.

You MUST output:
- stage reached
- where rep got stuck
- delivery metrics: confidence, tone, pacing, clarity, energy
- rubric breakdown by skill category
- wins, coaching points, next best action
- an overall score 0-100

Scoring rules:
- All score fields are numbers 0 to 100.
- If unsure, estimate reasonably.
- Be consistent: higher = better.

Stages:
opener, rapport, discovery, value_prop, objection_handling, closing, follow_up

Rubric keys:
opener, discovery, value_proposition, objection_handling, closing, clarity, conciseness, curiosity_questions, active_listening, control_of_call

Delivery keys:
confidence, tone, pacing, clarity, energy

Return JSON with EXACT keys:
{
"overall_score": number,
"stage_reached": string,
"wins": string[],
"fixes": string[],
"stuck_points": string[],
"delivery": {
"confidence": number,
"tone": number,
"pacing": number,
"clarity": number,
"energy": number,
"wpm": number | null,
"talk_ratio": number | null
},
"rubric": {
"opener": number,
"discovery": number,
"value_proposition": number,
"objection_handling": number,
"closing": number,
"clarity": number,
"conciseness": number,
"curiosity_questions": number,
"active_listening": number,
"control_of_call": number
},
"next_best_action": string,
"headline": string
}
`.trim();

const evalUser = `
Industry: ${session.industry}
Persona: ${session.persona || "unknown"}

Conversation transcript (array of messages):
${transcript}
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

let parsed = {};
try {
parsed = typeof raw === "string" ? JSON.parse(raw) : (raw || {});
} catch (e) {
parsed = {
overall_score: 55,
stage_reached: "discovery",
wins: [],
fixes: ["Evaluator output failed to parse. Re-run evaluation."],
stuck_points: ["bad_json"],
delivery: {
confidence: 55,
tone: 55,
pacing: 55,
clarity: 55,
energy: 55,
wpm: null,
talk_ratio: null
},
rubric: {
opener: 55,
discovery: 55,
value_proposition: 55,
objection_handling: 55,
closing: 55,
clarity: 55,
conciseness: 55,
curiosity_questions: 55,
active_listening: 55,
control_of_call: 55
},
next_best_action: "Re-run evaluation after ending the session again.",
headline: "Evaluation parse failed"
};
}

parsed.wins = Array.isArray(parsed.wins) ? parsed.wins : [];
parsed.fixes = Array.isArray(parsed.fixes) ? parsed.fixes : [];
parsed.stuck_points = Array.isArray(parsed.stuck_points) ? parsed.stuck_points : [];
parsed.delivery = parsed.delivery && typeof parsed.delivery === "object" ? parsed.delivery : {};
parsed.rubric = parsed.rubric && typeof parsed.rubric === "object" ? parsed.rubric : {};

const deliverySafe = {
confidence: clamp(parsed.delivery.confidence, 0, 100) ?? 0,
tone: clamp(parsed.delivery.tone, 0, 100) ?? 0,
pacing: clamp(parsed.delivery.pacing, 0, 100) ?? 0,
clarity: clamp(parsed.delivery.clarity, 0, 100) ?? 0,
energy: clamp(parsed.delivery.energy, 0, 100) ?? 0,
wpm: parsed.delivery.wpm == null ? null : clamp(parsed.delivery.wpm, 50, 260),
talk_ratio: parsed.delivery.talk_ratio == null ? null : clamp(parsed.delivery.talk_ratio, 0, 1)
};

const rubricSafe = {
opener: clamp(parsed.rubric.opener, 0, 100) ?? 0,
discovery: clamp(parsed.rubric.discovery, 0, 100) ?? 0,
value_proposition: clamp(parsed.rubric.value_proposition, 0, 100) ?? 0,
objection_handling: clamp(parsed.rubric.objection_handling, 0, 100) ?? 0,
closing: clamp(parsed.rubric.closing, 0, 100) ?? 0,
clarity: clamp(parsed.rubric.clarity, 0, 100) ?? 0,
conciseness: clamp(parsed.rubric.conciseness, 0, 100) ?? 0,
curiosity_questions: clamp(parsed.rubric.curiosity_questions, 0, 100) ?? 0,
active_listening: clamp(parsed.rubric.active_listening, 0, 100) ?? 0,
control_of_call: clamp(parsed.rubric.control_of_call, 0, 100) ?? 0
};

const overallScore = clamp(parsed.overall_score, 0, 100);
const overall =
overallScore == null
? Math.round(Object.values(rubricSafe).reduce((a, b) => a + b, 0) / 10)
: overallScore;

const baseXp = Math.round((overall / 100) * 120);
const mult = DIFFICULTY_MULT[session.difficulty] ?? 1.1;
const xpEarned = Math.max(5, Math.round(baseXp * mult));

const newTotal = (profile.total_xp || 0) + xpEarned;
const newLevel = getLevel(newTotal);

// Minimal insert because your evaluations table only has:
// id, session_id, company_id, user_id, scores, summary, xp_earned, created_at
const { error: eErr } = await supabaseAdmin.from("evaluations").insert({
session_id: sessionId,
company_id: profile.company_id,
user_id: userId,
scores: {
overall_score: overall,
stage_reached: parsed.stage_reached || null,
wins: parsed.wins,
fixes: parsed.fixes,
stuck_points: parsed.stuck_points,
delivery: deliverySafe,
rubric: rubricSafe,
next_best_action: parsed.next_best_action || "",
headline: parsed.headline || ""
},
summary: parsed.headline || parsed.next_best_action || "",
xp_earned: xpEarned
});

if (eErr) throw eErr;

await supabaseAdmin
.from("sessions")
.update({ ended_at: new Date().toISOString() })
.eq("id", sessionId);

const { error: pErr } = await supabaseAdmin
.from("profiles")
.update({ total_xp: newTotal, level: newLevel })
.eq("user_id", userId);

if (pErr) throw pErr;

return res.json({
overall_score: overall,
stage_reached: parsed.stage_reached || null,
wins: parsed.wins,
fixes: parsed.fixes,
stuck_points: parsed.stuck_points,
delivery: deliverySafe,
rubric: rubricSafe,
next_best_action: parsed.next_best_action || "",
headline: parsed.headline || "",
xpEarned,
totalXp: newTotal,
level: newLevel
});
} catch (e) {
res.status(500).json({ error: "Evaluate failed", details: e.message });
}
});

// -------- Send rep invite email --------
// Body: { managerUserId, repName, repEmail }
app.post("/api/invite/send", async (req, res) => {
try {
const { managerUserId, repName, repEmail } = req.body;

if (!managerUserId || !repEmail) {
return res.status(400).json({ error: "Missing fields" });
}

const manager = await getProfileOrThrow(managerUserId);

if (!manager.is_manager) {
return res.status(403).json({ error: "Only managers can invite" });
}

const token = crypto.randomUUID();

const { error: inviteErr } = await supabaseAdmin
.from("invites")
.insert({
code: token,
company_id: manager.company_id,
created_by: managerUserId,
rep_email: repEmail.toLowerCase().trim(),
rep_name: (repName || "").trim()
});

if (inviteErr) throw inviteErr;

const inviteLink = `${process.env.FRONTEND_URL}/invite/${token}`;

await resend.emails.send({
from: "Sales Trainer <onboarding@resend.dev>",
to: repEmail.toLowerCase().trim(),
subject: "You're invited to Sales Trainer",
html: `
<h2>You're invited!</h2>
<p>${repName || "A rep"}, click below to join your team:</p>
<p><a href="${inviteLink}">Accept Invite</a></p>
`
});

res.json({ success: true, inviteLink });
} catch (e) {
res.status(500).json({ error: "Invite send failed", details: e.message });
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
app.post("/api/invite/send", async (req, res) => {
try {
const { managerUserId, repName, repEmail } = req.body;

if (!managerUserId || !repEmail) {
return res.status(400).json({ error: "Missing fields" });
}

// Get manager profile
const { data: profile, error: pErr } = await supabaseAdmin
.from("profiles")
.select("company_id")
.eq("user_id", managerUserId)
.single();

if (pErr || !profile) {
return res.status(400).json({ error: "Manager profile not found" });
}

const code = crypto.randomUUID();

// Insert invite
const { error: iErr } = await supabaseAdmin
.from("invites")
.insert({
company_id: profile.company_id,
code,
role: "rep",
invited_email: repEmail,
invited_by: managerUserId
});

if (iErr) throw iErr;

const inviteLink = `${process.env.FRONTEND_URL}/invite/${code}`;

await resend.emails.send({
from: "AI Sales Trainer <onboarding@resend.dev>",
to: repEmail,
subject: "You're invited to AI Sales Trainer",
html: `
<h2>You were invited to AI Sales Trainer</h2>
<p>${repName || "A rep"}, click below to join your company.</p>
<a href="${inviteLink}">${inviteLink}</a>
`
});

res.json({ success: true });

} catch (err) {
res.status(500).json({ error: err.message });
}
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));

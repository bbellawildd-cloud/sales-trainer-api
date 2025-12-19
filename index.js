import express from "express";
import cors from "cors";
import OpenAI from "openai";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

/* -------------------------
IN-MEMORY DATA STORES
-------------------------- */
const sessions = {};
const reps = {}; // repId → rep data
const companies = {}; // companyId → repIds

/* -------------------------
XP + LEVEL CONFIG
-------------------------- */
const LEVELS = [
{ level: 1, xp: 0 },
{ level: 2, xp: 50 },
{ level: 3, xp: 125 },
{ level: 4, xp: 250 },
{ level: 5, xp: 450 },
{ level: 6, xp: 700 },
{ level: 7, xp: 1000 }
];

const DIFFICULTY_MULTIPLIER = {
1: 1.0,
2: 1.1,
3: 1.25,
4: 1.4,
5: 1.6
};

/* -------------------------
INDUSTRY PROMPT
-------------------------- */
const INDUSTRY_PROMPT = `
You are a real homeowner talking to a door-to-door sales rep.
Be realistic, human, short responses.
You may be skeptical, annoyed, friendly, or distracted.
End with either "I'm not interested." or "Okay let's do it."
`;

/* -------------------------
UTIL
-------------------------- */
function getLevel(totalXp) {
let current = 1;
for (const l of LEVELS) {
if (totalXp >= l.xp) current = l.level;
}
return current;
}

/* -------------------------
CHAT
-------------------------- */
app.post("/api/chat", async (req, res) => {
const { message, sessionId, repId, companyId, difficulty = 2 } = req.body;

if (!message || !sessionId || !repId || !companyId) {
return res.status(400).json({ error: "Missing fields" });
}

if (!sessions[sessionId]) {
sessions[sessionId] = {
history: [],
repId,
companyId,
difficulty
};
}

if (!reps[repId]) {
reps[repId] = {
repId,
companyId,
totalXp: 0,
level: 1,
sessions: 0
};
if (!companies[companyId]) companies[companyId] = [];
companies[companyId].push(repId);
}

const history = sessions[sessionId].history;
history.push({ role: "user", content: message });

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: INDUSTRY_PROMPT },
...history
]
});

const reply = completion.choices[0].message.content;
history.push({ role: "assistant", content: reply });

res.json({ reply });
});

/* -------------------------
EVALUATE + XP
-------------------------- */
app.post("/api/evaluate", async (req, res) => {
const { sessionId } = req.body;
const session = sessions[sessionId];

if (!session) return res.status(404).json({ error: "Session not found" });

const evalPrompt = `
Score the sales rep from 1–5 in each category:
- Opener & Rapport
- Discovery
- Objection Handling
- Confidence
- Close

Return STRICT JSON like:
{
"scores": {
"opener": 3,
"discovery": 2,
"objections": 4,
"confidence": 3,
"close": 2
},
"summary": "short feedback"
}
`;

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: evalPrompt },
{ role: "user", content: JSON.stringify(session.history) }
]
});

const result = JSON.parse(completion.choices[0].message.content);
const scores = result.scores;

const baseXp =
Object.values(scores).reduce((a, b) => a + b, 0) * 2;

const xpEarned = Math.round(
baseXp * DIFFICULTY_MULTIPLIER[session.difficulty]
);

const rep = reps[session.repId];
rep.totalXp += xpEarned;
rep.level = getLevel(rep.totalXp);
rep.sessions += 1;

res.json({
scores,
xpEarned,
totalXp: rep.totalXp,
level: rep.level,
summary: result.summary
});
});

/* -------------------------
LEADERBOARD
-------------------------- */
app.get("/api/leaderboard/:companyId", (req, res) => {
const { companyId } = req.params;
const repIds = companies[companyId] || [];

const leaderboard = repIds
.map((id) => reps[id])
.sort((a, b) =>
b.level !== a.level
? b.level - a.level
: b.totalXp - a.totalXp
);

res.json(leaderboard);
});

/* -------------------------
SERVER
-------------------------- */
app.listen(3000, () =>
console.log("Sales Trainer API running")
);

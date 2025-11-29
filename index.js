//-------------------------------------------------------
// SALES TRAINER AI — FULL BACKEND API (Render Version)
//-------------------------------------------------------

import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());
https://github.com/bbellawildd-cloud/sales-trainer-api/blob/main/index.js
// ------------------ OPENAI CLIENT ---------------------

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

// ---------------- INDUSTRY SYSTEM ---------------------

const INDUSTRY_CONFIG = {
pest: "You are a homeowner being pitched pest control. Respond realistically.",
solar: "You are a homeowner being pitched solar. Respond realistically.",
SaaS: "You are a warehouse manager being pitched Rufus Labs WorkHero. Respond realistically.",
car: "You are a customer at a dealership being pitched a car. Respond realistically.",
insurance: "You are a potential customer being pitched insurance. Respond realistically.",
};

let ACTIVE_INDUSTRY = "pest";

// Health check
app.get("/", (req, res) => {
res.json({ ok: true, activeIndustry: ACTIVE_INDUSTRY });
});

// Admin endpoint to change industry
app.post("/api/admin/industry", (req, res) => {
const industry = req.body.industry;
if (!INDUSTRY_CONFIG[industry]) {
return res
.status(400)
.json({ error: "Invalid industry", allowed: Object.keys(INDUSTRY_CONFIG) });
}
ACTIVE_INDUSTRY = industry;
res.json({ ok: true, activeIndustry: ACTIVE_INDUSTRY });
});

// ------------------- MAIN CHAT ENDPOINT --------------------

app.post("/api/chat", async (req, res) => {
const { message, history = [] } = req.body;

if (!message) {
return res.status(400).json({ error: "Missing 'message' in body" });
}

try {
//----------------------------------------------------
// 1) AI REPLY — The “customer” responds to the rep
//----------------------------------------------------

const completion = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{
role: "system",
content: INDUSTRY_CONFIG[ACTIVE_INDUSTRY],
},
...history.map((h) => ({
role: h.role,
content: h.content,
})),
{ role: "user", content: message },
],
});

const reply = completion.choices[0].message.content;

//----------------------------------------------------
// 2) GRADING — Score the rep's message (XP, tier, score)
//----------------------------------------------------

const gradeResponse = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{
role: "system",
content:
"You are a grading engine. Evaluate the rep’s last message ONLY. Return STRICT JSON: {score: number, tier: string, xp: number, feedback: string}. No extra text.",
},
{
role: "user",
content: message,
},
],
});

let grading;
try {
grading = JSON.parse(gradeResponse.choices[0].message.content);
} catch (err) {
grading = {
score: 0,
tier: "Error",
xp: 0,
feedback: "Could not parse grading JSON.",
};
}

//----------------------------------------------------
// 3) DECIDE IF THE CONVERSATION SHOULD END
//----------------------------------------------------

const lowerReply = reply.toLowerCase();
const endConversation =
lowerReply.includes("not interested") ||
lowerReply.includes("stop") ||
lowerReply.includes("no thanks") ||
lowerReply.includes("i’ll take it") ||
lowerReply.includes("sign me up") ||
lowerReply.includes("let’s do it");

//----------------------------------------------------
// 4) RETURN EVERYTHING TO THE FRONTEND
//----------------------------------------------------

res.json({
reply,
grading,
endConversation,
activeIndustry: ACTIVE_INDUSTRY,
});
} catch (err) {
console.error("API ERROR:", err);
res.status(500).json({ error: "Server error" });
}
});

// ------------------ START SERVER ---------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Sales Trainer API running on port ${PORT}`);
});

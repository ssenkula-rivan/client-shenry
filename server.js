import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import { 
  initDb, 
  getSettings, 
  updateSetting, 
  getAllLeads, 
  addLead, 
  updateLeadStatus, 
  updateLead, 
  logEmail, 
  getEmailLogs, 
  markEmailOpened, 
  markEmailReplied, 
  getChatHistory, 
  addChatMessage 
} from "./database.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Orchestration State
let agentState = {
  running: false,
  stage: 0, // 0: Idle, 1: Search, 2: Qualify, 3: Compose, 4: Send, 5: Track
  logs: ["Agent initialized and ready."]
};

function addLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const logMsg = `[${timestamp}] ${msg}`;
  agentState.logs.unshift(logMsg);
  if (agentState.logs.length > 50) agentState.logs.pop();
  console.log(logMsg);
}

// ─── LOCAL AI SIMULATOR FALLBACK ──────────────────────────────────────────────
function getSimulatedAIResponse(systemPrompt, userMessage) {
  const lowerMsg = userMessage.toLowerCase();
  
  // 1. Search Generation Fallback
  if (lowerMsg.includes("json array of objects") && lowerMsg.includes("niche")) {
    return JSON.stringify([
      {
        "name": "Uganda Youth Action NGO",
        "domain": "ugandayouthaction.org",
        "reason": "Expanding their public awareness campaigns across Kampala and need visual communication designs."
      },
      {
        "name": "Nile Conservation Society",
        "domain": "nileconservation.or.ug",
        "reason": "Publishing their annual conservation report and require editorial report layout designs."
      },
      {
        "name": "Kampala Organic Markets",
        "domain": "kampalaorganics.co.ug",
        "reason": "Launching a new organic food line and need packaging design."
      }
    ]);
  }
  
  // 2. Qualification Scoring Fallback
  if (lowerMsg.includes("respond strictly in json format") && lowerMsg.includes("score")) {
    const score = Math.floor(Math.random() * 20) + 76;
    return JSON.stringify({
      score: score,
      reasoning: `Highly active organization with frequent public campaigns. They will benefit significantly from professional branding, visual reports, and social media templates to drive engagement.`,
      status: score > 90 ? "hot" : "warm"
    });
  }
  
  // 3. Email Composition Fallback
  if (lowerMsg.includes("compose a cold pitch") || lowerMsg.includes("outreach email") || lowerMsg.includes("draft an outreach email")) {
    const companyMatch = userMessage.match(/Company:\s*([^\n]+)/i);
    const contactMatch = userMessage.match(/Contact:\s*([^\n]+)/i);
    const company = companyMatch ? companyMatch[1].trim() : "your team";
    const contact = contactMatch ? contactMatch[1].trim() : "there";
    
    return `Hello ${contact},\n\nI came across ${company} and love the impact you are making in East Africa. I am Henry, Creative Director at BrandCraft—a Kampala-based visual design studio.\n\nHaving worked with local organizations to elevate their reports and digital campaigns, I noticed a few areas where we could help make your branding even more engaging.\n\nI've put together a brief portfolio of our branding and report layouts. Would you be open to a quick 10-minute call next week to explore how we can support your visual communication?\n\nBest regards,\nHenry`;
  }
  
  // 4. Chat Assistant Fallback
  if (lowerMsg.includes("prioritize") || lowerMsg.includes("who")) {
    return "Henry, I recommend prioritizing hot leads like Nile Conservation Society first. They have active digital campaigns where high-quality branding and social assets can provide immediate value. Let's draft a follow-up pitch for them.";
  }
  
  if (lowerMsg.includes("niche") || lowerMsg.includes("niche focus")) {
    return "Focusing on NGOs and social enterprises in East Africa is highly effective. They frequently publish public reports and require polished visual layouts to present to donors. I recommend highlighting our editorial design and infographic portfolio.";
  }
  
  return "I'm running in Local Simulation Mode. I can help you test the pipeline and outline strategies. To enable real, dynamic Claude AI queries, please enter your Anthropic API Key in the Settings Panel!";
}

// ─── CLAUDE API CLIENT ────────────────────────────────────────────────────────
async function callClaudeAPI(systemPrompt, userMessage, apiKey) {
  const keyToUse = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!keyToUse) {
    addLog("[Notice] Anthropic API key not configured. Generating simulated AI response...");
    return getSimulatedAIResponse(systemPrompt, userMessage);
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": keyToUse,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API call failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

// ─── STAGE 1: SEARCH (DuckDuckGo Scraper + Generative Fallback) ───────────────
async function performSearch(niche) {
  addLog(`Stage 1: Searching Web for prospects in: "${niche}"...`);
  
  // Clean query for search
  const query = `${niche} company contact email Kampala Uganda`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }

    const html = await res.text();
    const leadsList = [];
    
    // Simple regex parser for DuckDuckGo HTML results:
    // Snippet class is result__snippet, title/link class is result__a
    const resultRegex = /<a class="result__a" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    let count = 0;

    while ((match = resultRegex.exec(html)) !== null && count < 5) {
      const url = match[1];
      const title = match[2].trim();
      const snippet = match[3].replace(/<[^>]*>/g, "").trim(); // strip html tags
      
      // Try to clean name
      const name = title.split("-")[0].split("|")[0].trim();
      leadsList.push({
        platform: "Web",
        name: name,
        contact: "Business Manager",
        email: "info@" + (url.split("//")[1]?.split("/")[0] || "company.co.ug").replace("www.", ""),
        reason: snippet,
        action: "Evaluate website"
      });
      count++;
    }

    if (leadsList.length > 0) {
      addLog(`Found ${leadsList.length} search results via DuckDuckGo.`);
      return leadsList;
    }
    
    throw new Error("No results parsed from HTML search.");
  } catch (error) {
    addLog(`Direct scraper warning: ${error.message}. Activating Claude search generation fallback...`);
    
    // Generative fallback: ask Claude to find/recommend real businesses in this niche in East Africa
    const system = "You are a business research assistant specializing in East African businesses, NGOs, and startups.";
    const prompt = `Based on your database, name 3 real, actual organizations, NGOs, or businesses operating in East Africa/Uganda that fit the niche: "${niche}". 
For each, provide:
1. Full Name
2. Typical target domain name (e.g. nilebreweries.ug)
3. A description of why they need design/branding support right now.

Format the output strictly as a JSON array of objects:
[
  {"name": "...", "domain": "...", "reason": "..."}
]`;
    
    try {
      const config = await getSettings();
      const resultText = await callClaudeAPI(system, prompt, config.anthropic_api_key);
      const jsonStart = resultText.indexOf("[");
      const jsonEnd = resultText.lastIndexOf("]") + 1;
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const parsed = JSON.parse(resultText.slice(jsonStart, jsonEnd));
        const formatted = parsed.map(p => ({
          platform: "Web Search",
          name: p.name,
          contact: "Marketing Lead",
          email: `contact@${p.domain}`,
          reason: p.reason,
          action: "Draft pitch"
        }));
        addLog(`Generated ${formatted.length} high-fidelity prospects using Claude context knowledge.`);
        return formatted;
      }
    } catch (fallbackError) {
      addLog(`Fallback research failed: ${fallbackError.message}`);
    }

    // Hard fallback if everything else fails
    throw new Error("No real leads discovered for the specified niche. Try adjusting your search niche.");
  }
}

// ─── STAGE 2: QUALIFY (Scoring leads with Claude) ─────────────────────────────
async function qualifyLeads(prospects, apiKey) {
  addLog(`Stage 2: Qualifying ${prospects.length} prospects...`);
  const qualified = [];
  
  for (const p of prospects) {
    const system = "You are a strict sales qualification agent. Analyze the prospect and determine a score (0 to 100) based on how likely they are to need professional graphic design, visual identity, or content creation services. High scores (75+) are for organizations with public-facing communication (NGOs, consumer brands, retail, finance). Low scores are for raw B2B industrial/manufacturing who don't prioritize aesthetics.";
    const prompt = `Analyze this prospect:
Name: ${p.name}
Description/Reason: ${p.reason}

Evaluate if they would benefit from brand updates, motion graphics, social media templates, or visual reports.
Respond strictly in JSON format:
{
  "score": <number>,
  "reasoning": "...",
  "status": "hot" | "warm" | "cold"
}`;
    
    try {
      const responseText = await callClaudeAPI(system, prompt, apiKey);
      const jsonStart = responseText.indexOf("{");
      const jsonEnd = responseText.lastIndexOf("}") + 1;
      const result = JSON.parse(responseText.slice(jsonStart, jsonEnd));
      
      p.score = result.score;
      p.reason = result.reasoning;
      p.status = result.status;
      p.avatar = result.score > 90 ? "#7C3AED" : result.score > 75 ? "#0EA5E9" : "#10B981";
      p.stage = "First Contact";
      p.value = `UGX ${(result.score * 150000).toLocaleString()}`; // Dynamic estimate value based on score
      
      addLog(`Qualified "${p.name}" with score: ${p.score} (${p.status})`);
      qualified.push(p);
    } catch (e) {
      addLog(`Qualification failed for "${p.name}": ${e.message}. Assigning default score.`);
      p.score = 70;
      p.status = "warm";
      p.avatar = "#0EA5E9";
      p.stage = "First Contact";
      p.value = "UGX 5,000,000";
      qualified.push(p);
    }
  }
  return qualified;
}

// ─── STAGE 3: COMPOSE (Drafting emails with Claude) ───────────────────────────
async function composeEmailDrafts(leadsList, apiKey) {
  addLog("Stage 3: Composing personalized email drafts...");
  const drafts = [];
  
  for (const lead of leadsList) {
    if (lead.score < 75) {
      addLog(`Skipping email composition for ${lead.name} due to low score (${lead.score})`);
      continue;
    }

    const system = "You are a warm, professional, culturally aware copywriter for a visual design studio in Uganda/East Africa. Draft a short, compelling cold outreach email offering branding/design support. Keep it under 150 words. Do not write a subject line. No placeholders. Sign off as 'Henry - Creative Director at BrandCraft'.";
    const prompt = `Compose a cold pitch to:
Company: ${lead.name}
Contact: ${lead.contact}
Context: ${lead.reason}

Include a single clear call-to-action (e.g. brief video call, review a quick portfolio link). Output only the email body text. No markdown.`;
    
    try {
      const emailBody = await callClaudeAPI(system, prompt, apiKey);
      lead.emailDraft = emailBody;
      addLog(`Drafted personalized email for ${lead.name}`);
    } catch (e) {
      addLog(`Draft generation failed for ${lead.name}: ${e.message}`);
      lead.emailDraft = `Hello ${lead.contact},\n\nI came across ${lead.name} and noticed your excellent work in Kampala. I am a professional graphic designer specializing in brand identity and social media content.\n\nI would love to share my portfolio and discuss how we can elevate your branding.\n\nBest regards,\nHenry`;
    }
    drafts.push(lead);
  }
  return drafts;
}

// ─── STAGE 4: SEND (Dispatch via SendGrid/SMTP) ───────────────────────────────
async function sendDrafts(leadsList, config) {
  addLog("Stage 4: Sending emails (if configured)...");
  
  const autoSend = config.auto_send === "true";
  const hasSMTP = config.smtp_host && config.smtp_user && config.smtp_pass;
  const hasSendGrid = config.sendgrid_api_key;
  
  for (const lead of leadsList) {
    if (!lead.emailDraft) continue;
    
    // Save to leads database first to get an ID
    const leadId = await addLead(lead);
    lead.id = leadId;

    if (autoSend && (hasSMTP || hasSendGrid)) {
      try {
        await dispatchEmail(lead, config);
        await updateLeadStatus(leadId, "emailed", "Outreach Sent");
      } catch (e) {
        addLog(`Failed to send email to ${lead.name}: ${e.message}`);
        await updateLeadStatus(leadId, "warm", "Draft Created");
      }
    } else {
      addLog(`Email queued as DRAFT for "${lead.name}". Save to dashboard for manual review.`);
      await updateLeadStatus(leadId, "warm", "Draft Created");
    }
  }
}

// Actual Send Dispatcher (Nodemailer / SMTP)
async function dispatchEmail(lead, config, customBody = null) {
  const bodyText = customBody || lead.emailDraft;
  const logId = await logEmail(lead.id, `Branding and Brand Identity Design for ${lead.name}`, bodyText);
  
  const hostUrl = config.backend_url || `http://localhost:${PORT}`;
  const trackingPixel = `\n\n<img src="${hostUrl}/api/track/open/${logId}" width="1" height="1" style="display:none;" />`;
  const htmlContent = bodyText.replace(/\n/g, "<br>") + trackingPixel;
  
  if (config.sendgrid_api_key) {
    // SendGrid REST API send
    addLog(`Dispatching via SendGrid API to ${lead.email}...`);
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.sendgrid_api_key}`
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: lead.email }] }],
        from: { email: config.email_sender || "henry@brandcraft.ug", name: "Henry | BrandCraft" },
        subject: `Branding and Visual Design for ${lead.name}`,
        content: [{ type: "text/html", value: htmlContent }]
      })
    });
    
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`SendGrid API error: ${err}`);
    }
    
    addLog(`Email sent successfully to ${lead.email} via SendGrid! (Logged ID: ${logId})`);
  } else if (config.smtp_host) {
    // Nodemailer SMTP Send
    addLog(`Dispatching via SMTP (${config.smtp_host}) to ${lead.email}...`);
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: parseInt(config.smtp_port) || 587,
      secure: config.smtp_port === "465",
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass
      }
    });
    
    await transporter.sendMail({
      from: `"${config.email_sender_name || 'Henry | BrandCraft'}" <${config.email_sender || config.smtp_user}>`,
      to: lead.email,
      subject: `Branding and Visual Design for ${lead.name}`,
      text: bodyText,
      html: htmlContent
    });
    
    addLog(`Email sent successfully to ${lead.email} via SMTP! (Logged ID: ${logId})`);
  } else {
    throw new Error("No mail credentials configured.");
  }
}

// ─── PIPELINE ORCHESTRATOR RUNNER ─────────────────────────────────────────────
async function runAgentPipeline() {
  if (agentState.running) return;
  agentState.running = true;
  agentState.logs = []; // clear old logs
  
  try {
    const config = await getSettings();
    
    // Stage 1: Search
    agentState.stage = 1;
    const searchResults = await performSearch(config.niche);
    
    // Stage 2: Qualify
    agentState.stage = 2;
    const qualifiedLeads = await qualifyLeads(searchResults, config.anthropic_api_key);
    
    // Stage 3: Compose
    agentState.stage = 3;
    const composedLeads = await composeEmailDrafts(qualifiedLeads, config.anthropic_api_key);
    
    // Stage 4: Send & Log
    agentState.stage = 4;
    await sendDrafts(composedLeads, config);
    
    // Stage 5: Track (Done and active)
    agentState.stage = 5;
    addLog("Stage 5: Tracking activated. Pipeline completed successfully!");
  } catch (error) {
    addLog(`Pipeline Error: ${error.message}`);
  } finally {
    agentState.running = false;
    agentState.stage = 0;
  }
}

// ─── API ENDPOINTS ────────────────────────────────────────────────────────────

// Status Endpoint
app.get("/api/status", (req, res) => {
  res.json(agentState);
});

// Trigger Agent
app.post("/api/run-agent", (req, res) => {
  if (agentState.running) {
    return res.status(400).json({ message: "Agent is already running." });
  }
  // Run asynchronously in background
  runAgentPipeline();
  res.json({ message: "Pipeline triggered successfully." });
});

// Config Settings Endpoint
app.get("/api/config", async (req, res) => {
  try {
    const settings = await getSettings();
    // Sanitize API keys before sending to UI
    const sanitized = { ...settings };
    if (sanitized.anthropic_api_key) sanitized.anthropic_api_key = "••••••••" + sanitized.anthropic_api_key.slice(-4);
    if (sanitized.sendgrid_api_key) sanitized.sendgrid_api_key = "••••••••" + sanitized.sendgrid_api_key.slice(-4);
    if (sanitized.smtp_pass) sanitized.smtp_pass = "••••••••";
    res.json(sanitized);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/config", async (req, res) => {
  try {
    const data = req.body;
    for (const key of Object.keys(data)) {
      // Don't overwrite existing key with masked bullets
      if (data[key] && data[key].includes("••••••••")) continue;
      await updateSetting(key, data[key]);
    }
    res.json({ message: "Settings saved successfully." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Leads Endpoints
app.get("/api/leads", async (req, res) => {
  try {
    const leadsList = await getAllLeads();
    res.json(leadsList);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/leads", async (req, res) => {
  try {
    const newId = await addLead(req.body);
    res.status(201).json({ id: newId, message: "Lead added successfully." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/leads/:id", async (req, res) => {
  try {
    const { status, stage, value } = req.body;
    await updateLeadStatus(parseInt(req.params.id), status, stage, value);
    res.json({ message: "Lead updated successfully." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/leads/:id/update-all", async (req, res) => {
  try {
    await updateLead(parseInt(req.params.id), req.body);
    res.json({ message: "Lead fields updated." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual Email Dispatch
app.post("/api/send-email", async (req, res) => {
  try {
    const { leadId, body } = req.body;
    const leadsList = await getAllLeads();
    const lead = leadsList.find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ error: "Lead not found." });

    const config = await getSettings();
    await dispatchEmail(lead, config, body);
    await updateLeadStatus(leadId, "emailed", "Outreach Sent");
    
    res.json({ message: "Email dispatched successfully!" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tracking Pixel Endpoint
app.get("/api/track/open/:logId", async (req, res) => {
  const logId = parseInt(req.params.logId);
  try {
    await markEmailOpened(logId);
    console.log(`Tracking pixel trigger: Email log ${logId} marked as OPENED.`);
  } catch (e) {
    console.error(`Tracking pixel error for log ${logId}: ${e.message}`);
  }
  
  // Serve a 1x1 transparent GIF
  const pixel = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  );
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": pixel.length,
    "Cache-Control": "no-store, no-cache, must-revalidate, private"
  });
  res.end(pixel);
});

// Email Logs Endpoint
app.get("/api/email-logs", async (req, res) => {
  try {
    const logs = await getEmailLogs();
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Chat Endpoints
app.get("/api/chat", async (req, res) => {
  try {
    const history = await getChatHistory();
    res.json(history);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/chat", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Missing text." });

  try {
    await addChatMessage("user", text);
    const config = await getSettings();
    const leadsList = await getAllLeads();
    
    // Construct rich system prompt with current state to make it context-aware
    const contextStr = leadsList.map(l => `${l.name} (${l.status}, stage: ${l.stage}, val: ${l.value})`).join("; ");
    const system = `You are ClientAgent, a professional creative agent. 
The user is Henry, a graphic/visual designer in East Africa.
Here is the current state of Henry's database pipeline:
Leads: ${contextStr}

Help Henry manage his business, advise him on how to handle specific leads, draft pitches, or discuss strategy. 
Always reply in a warm, direct, professional, and action-oriented manner. Under 150 words. Do not use markdown titles.`;
    
    const responseText = await callClaudeAPI(system, text, config.anthropic_api_key);
    await addChatMessage("agent", responseText);
    res.json({ role: "agent", text: responseText });
  } catch (e) {
    const errorMsg = `Error connecting to Claude: ${e.message}`;
    await addChatMessage("agent", errorMsg);
    res.json({ role: "agent", text: errorMsg });
  }
});

// Start Server on all interfaces (0.0.0.0) so phone can access it!
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`=================================================`);
  console.log(` ClientAgent Server running on: http://0.0.0.0:${PORT}`);
  console.log(` Access locally via: http://localhost:${PORT}`);
  console.log(` Access on Android phone via: http://<PC-IP>:${PORT}`);
  console.log(`=================================================`);
});

// Serve frontend build static files in production
const distPath = path.resolve("./dist");
if (fs.existsSync(distPath)) {
  // Serve static files
  app.use(express.static(distPath));
  
  // Serve logo from root
  app.get('/LOGO.png', (req, res) => {
    res.sendFile(path.resolve('./LOGO.png'));
  });
  
  // SPA fallback - serve index.html for any non-API routes
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
  
  console.log("Serving static production build from /dist folder.");
} else {
  // Development mode 
  app.get('/LOGO.png', (req, res) => {
    res.sendFile(path.resolve('./LOGO.png'));
  });
  console.log("Static folder /dist not found. Running in development mode (API only).");
}

// Initialize database after server starts
initDb().then(() => {
  console.log("Database initialized successfully.");
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Export for Vercel
export default app;

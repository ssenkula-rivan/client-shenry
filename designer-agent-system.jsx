import { useState, useEffect, useCallback, useRef } from "react";

export default function DesignerAgentSystem() {
  const [tab, setTab] = useState("dashboard");
  const [leads, setLeads] = useState([]);
  const [emailLogs, setEmailLogs] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [config, setConfig] = useState({
    niche: "",
    daily_quota: "10",
    anthropic_api_key: "",
    sendgrid_api_key: "",
    smtp_host: "",
    smtp_port: "587",
    smtp_user: "",
    smtp_pass: "",
    email_sender: "",
    email_sender_name: "",
    auto_send: "false",
    backend_url: ""
  });
  
  const [agentState, setAgentState] = useState({
    running: false,
    stage: 0,
    logs: ["Status: Loading backend connection..."]
  });

  const [selectedLead, setSelectedLead] = useState(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [socialDraft, setSocialDraft] = useState("");
  const [socialPlatform, setSocialPlatform] = useState("LinkedIn");
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const chatEndRef = useRef(null);

  // Status mapping
  const STATUS_LABELS = {
    new: "New Lead",
    hot: "High Priority",
    warm: "In Conversation",
    closed: "Closed Deal",
    disqualified: "Disqualified"
  };

  const STAGE_COLORS = {
    new: "badge-purple",
    hot: "badge-red",
    warm: "badge-gold",
    closed: "badge-green",
    disqualified: "badge-secondary"
  };

  // ─── FETCH WRAPPERS ─────────────────────────────────────────────────────────
  const fetchLeads = async () => {
    try {
      const res = await fetch("/api/leads");
      if (res.ok) {
        const data = await res.json();
        setLeads(data);
      }
    } catch (e) {
      console.error("Failed to fetch leads", e);
    }
  };

  const fetchEmailLogs = async () => {
    try {
      const res = await fetch("/api/email-logs");
      if (res.ok) {
        const data = await res.json();
        setEmailLogs(data);
      }
    } catch (e) {
      console.error("Failed to fetch email logs", e);
    }
  };

  const fetchChatHistory = async () => {
    try {
      const res = await fetch("/api/chat");
      if (res.ok) {
        const data = await res.json();
        setChatHistory(data);
      }
    } catch (e) {
      console.error("Failed to fetch chat history", e);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (e) {
      console.error("Failed to fetch settings config", e);
    }
  };

  const fetchAgentStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        setAgentState(data);
      }
    } catch (e) {
      console.error("Failed to fetch agent status", e);
    }
  };

  // ─── EFFECTS ────────────────────────────────────────────────────────────────
  // Initial load
  useEffect(() => {
    fetchLeads();
    fetchConfig();
    fetchChatHistory();
    fetchEmailLogs();
    fetchAgentStatus();
  }, []);

  // Poll agent state when running
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAgentStatus();
      // If agent state changes or completes, update local lists
      if (agentState.running) {
        fetchLeads();
        fetchEmailLogs();
      }
    }, agentState.running ? 2000 : 8000);
    return () => clearInterval(interval);
  }, [agentState.running]);

  // Scroll chat window to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, tab]);

  // ─── HANDLERS ───────────────────────────────────────────────────────────────
  const handleTriggerAgent = async () => {
    if (agentState.running) return;
    try {
      const res = await fetch("/api/run-agent", { method: "POST" });
      if (res.ok) {
        fetchAgentStatus();
      }
    } catch (e) {
      alert("Error starting agent pipeline.");
    }
  };

  const handleUpdateConfig = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        alert("Settings saved successfully to database!");
        fetchConfig();
      }
    } catch (e) {
      alert("Failed to save settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");
    
    // Add user message to UI immediately for speed
    setChatHistory(prev => [...prev, { id: Date.now(), role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (res.ok) {
        const reply = await res.json();
        setChatHistory(prev => [...prev, reply]);
      }
    } catch (e) {
      setChatHistory(prev => [...prev, { id: Date.now(), role: "agent", text: "Error talking to agent backend. Check server logs." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmailDraft = async (leadId, draftText) => {
    if (!draftText.trim()) return alert("Email draft is empty.");
    setLoading(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, body: draftText })
      });
      if (res.ok) {
        alert("Email sent successfully!");
        setEmailDraft("");
        fetchLeads();
        fetchEmailLogs();
      } else {
        const err = await res.json();
        alert(`Failed to send email: ${err.error}`);
      }
    } catch (e) {
      alert("Failed to dispatch email. Please check your SMTP or SendGrid keys.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLeadStatus = async (leadId, status, stage, value) => {
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, stage, value })
      });
      if (res.ok) {
        fetchLeads();
      }
    } catch (e) {
      console.error("Failed to update status", e);
    }
  };

  const generateSocial = async (platform) => {
    setLoading(true);
    setSocialDraft("");
    try {
      // Direct request using Claude API on server
      const prompt = `Write a professional, attractive ${platform} post to get business clients for Henry's graphic design studio in Uganda. Focus on: ${config.niche}. Under 100 words. Try to include a couple of creative hashtags. Output ONLY the post body text.`;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `Generate a social post outline: ${prompt}` })
      });
      if (res.ok) {
        const reply = await res.json();
        setSocialDraft(reply.text);
      }
    } catch (e) {
      setSocialDraft("Error generating social draft. Verify your Claude API Key in Settings.");
    } finally {
      setLoading(false);
    }
  };

  // ─── PARTS & SUBVIEWS ───────────────────────────────────────────────────────
  
  // Dashboard view
  const Dashboard = () => {
    // Analytics sums
    const activeCount = leads.filter(l => l.status !== "closed" && l.status !== "disqualified").length;
    const closedCount = leads.filter(l => l.status === "closed").length;
    const totalPipelineVal = leads
      .filter(l => l.status !== "disqualified" && l.status !== "closed")
      .reduce((sum, l) => {
        const valStr = l.value?.replace(/[^0-9]/g, "") || "0";
        return sum + parseInt(valStr);
      }, 0);

    return (
      <div>
        {/* KPI metrics */}
        <div className="responsive-grid-3">
          <div className="glass-card">
            <div className="card-title">Active Pipelines</div>
            <div className="card-value" style={{ color: "var(--accent-hi)" }}>{activeCount}</div>
            <div className="card-sub">In progress or qualified leads</div>
          </div>
          <div className="glass-card">
            <div className="card-title">Closed Deals</div>
            <div className="card-value" style={{ color: "var(--green)" }}>{closedCount}</div>
            <div className="card-sub">Completed signings this cycle</div>
          </div>
          <div className="glass-card">
            <div className="card-title">Pipeline Value</div>
            <div className="card-value" style={{ color: "var(--gold)" }}>
              UGX {totalPipelineVal.toLocaleString()}
            </div>
            <div className="card-sub">Est. contract values active</div>
          </div>
        </div>

        {/* Live Logs & Action */}
        <div className="responsive-grid-2">
          <div>
            <div className="section-title">
              Agent Orchestrator
              {agentState.running ? (
                <span className="badge badge-gold" style={{ marginLeft: "auto" }}>
                  Stage {agentState.stage}/5: Running
                </span>
              ) : (
                <span className="badge badge-green" style={{ marginLeft: "auto" }}>
                  Idle
                </span>
              )}
            </div>
            <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button 
                  className={`btn btn-primary ${agentState.running ? "disabled" : ""}`} 
                  onClick={handleTriggerAgent}
                  disabled={agentState.running}
                  style={{ flex: 1, padding: "12px" }}
                >
                  {agentState.running ? (
                    <>
                      <div className="spinner" /> Agent is Working...
                    </>
                  ) : "Run Agent Pipeline Now"}
                </button>
              </div>

              <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--muted)", textTransform: "uppercase" }}>
                Real-Time Execution Logs
              </div>
              <div style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "12px",
                height: "180px",
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: "11px",
                color: "var(--text)",
                lineHeight: "1.6",
                display: "flex",
                flexDirection: "column-reverse"
              }}>
                {agentState.logs.length > 0 ? (
                  agentState.logs.map((log, i) => (
                    <div key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", padding: "4px 0" }}>{log}</div>
                  ))
                ) : (
                  <div style={{ color: "var(--muted)" }}>No events recorded. Click 'Run Agent' to start.</div>
                )}
              </div>
            </div>
          </div>

          {/* Quick Chat Preview */}
          <div>
            <div className="section-title">Quick Agent Assistant</div>
            <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 10, height: "295px" }}>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: "6px" }}>
                {chatHistory.slice(-4).map((m, i) => (
                  <div key={i} style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    backgroundColor: m.role === "user" ? "var(--accent-lo)" : "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    maxWidth: "85%",
                    color: "var(--text)",
                    lineHeight: "1.4"
                  }}>
                    {m.role === "agent" && <div style={{ fontSize: "9px", color: "var(--accent-hi)", fontWeight: "700", marginBottom: "2px" }}>CLIENT AGENT</div>}
                    {m.text}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                <input 
                  className="custom-input" 
                  placeholder="Ask agent for creative support..." 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSendChat()}
                />
                <button className="btn btn-primary" onClick={handleSendChat} disabled={loading}>Send</button>
              </div>
            </div>
          </div>
        </div>

        {/* Lead Feeds list */}
        <div style={{ marginTop: "8px" }}>
          <div className="section-title">Lead Pipeline Radar (Search Results)</div>
          <div className="glass-card">
            {leads.length > 0 ? (
              leads.slice(0, 5).map(l => (
                <div key={l.id} className="list-item">
                  <div className="list-avatar" style={{ backgroundColor: l.avatar || "#7C3AED" }}>
                    {l.name ? l.name[0] : "L"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: "14px" }}>{l.name}</span>
                      <span className="badge badge-purple" style={{ fontSize: "10px", padding: "2px 8px" }}>{l.platform}</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0" }}>{l.reason}</div>
                    <div style={{ fontSize: "11px", color: "var(--accent-hi)", fontWeight: "600" }}>Email: {l.email || "No email parsed"}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                    <span className={`badge ${STAGE_COLORS[l.status] || "badge-purple"}`}>{STATUS_LABELS[l.status] || l.status}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: "5px 10px", fontSize: "11px" }}
                        onClick={() => {
                          setSelectedLead(l);
                          setEmailDraft(l.emailDraft || "");
                          setTab("email");
                        }}
                      >
                        {l.emailDraft ? "View Pitch" : "Write Email"}
                      </button>
                      <button 
                        className="btn btn-ghost" 
                        style={{ padding: "5px 10px", fontSize: "11px" }}
                        onClick={() => handleUpdateLeadStatus(l.id, "disqualified", "Archived")}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--muted)", textAlign: "center", padding: "30px 0" }}>No leads parsed yet. Run the orchestrator pipeline to fetch leads.</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Pipeline CRM List view
  const Clients = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div className="section-title">Client Deal Stages</div>
        <button 
          className="btn btn-primary"
          onClick={() => {
            const name = prompt("Enter Business Name:");
            const contact = prompt("Enter Contact Name:");
            const email = prompt("Enter Email:");
            const val = prompt("Enter Deal Value (e.g. UGX 5,000,000):");
            if (name) {
              fetch("/api/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, contact, email, value: val, status: "new", stage: "First Contact" })
              }).then(fetchLeads);
            }
          }}
        >
          + Add Client Deal
        </button>
      </div>

      <div className="glass-card">
        {leads.length > 0 ? (
          leads.map(l => (
            <div key={l.id} className="list-item" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="list-avatar" style={{ backgroundColor: l.avatar || "#7C3AED" }}>{l.name[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>{l.name}</div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                  Contact: {l.contact || "Unknown"} · Email: {l.email || "None"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
                  Reason: {l.reason}
                </div>
              </div>
              
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <select 
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    fontSize: "12px",
                    outline: "none"
                  }}
                  value={l.status}
                  onChange={e => handleUpdateLeadStatus(l.id, e.target.value, l.stage)}
                >
                  <option value="new">New Lead</option>
                  <option value="hot">High Priority</option>
                  <option value="warm">In Conversation</option>
                  <option value="closed">Closed Deal</option>
                  <option value="disqualified">Disqualified</option>
                </select>

                <select 
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    fontSize: "12px",
                    outline: "none"
                  }}
                  value={l.stage}
                  onChange={e => handleUpdateLeadStatus(l.id, l.status, e.target.value)}
                >
                  <option value="First Contact">First Contact</option>
                  <option value="Draft Created">Draft Created</option>
                  <option value="Outreach Sent">Outreach Sent</option>
                  <option value="Discovery Call">Discovery Call</option>
                  <option value="Proposal Sent">Proposal Sent</option>
                  <option value="Contract Signed">Contract Signed</option>
                  <option value="Archived">Archived</option>
                </select>

                <input 
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "6px 8px",
                    fontSize: "12px",
                    width: "110px",
                    outline: "none"
                  }}
                  value={l.value || ""}
                  placeholder="UGX Value"
                  onChange={e => {
                    const val = e.target.value;
                    // Update locally first for smooth typing
                    setLeads(prev => prev.map(item => item.id === l.id ? { ...item, value: val } : item));
                  }}
                  onBlur={e => handleUpdateLeadStatus(l.id, l.status, l.stage, e.target.value)}
                />
              </div>

              <div style={{ display: "flex", gap: 6, marginLeft: "10px" }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: "6px 10px", fontSize: "11px" }}
                  onClick={() => {
                    setSelectedLead(l);
                    setEmailDraft(l.emailDraft || "");
                    setTab("email");
                  }}
                >
                  Write Pitch
                </button>
              </div>
            </div>
          ))
        ) : (
          <div style={{ color: "var(--muted)", textAlign: "center", padding: "30px 0" }}>No pipeline contacts. Add deal or run agent pipeline.</div>
        )}
      </div>
    </div>
  );

  // Email Log and Custom Dispatch view
  const EmailTab = () => {
    const [filterLead, setFilterLead] = useState("");
    
    return (
      <div className="responsive-grid-2">
        {/* Left Column: Email Log History */}
        <div>
          <div className="section-title">Outreach logs (Pixel Tracked)</div>
          <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "550px", overflowY: "auto" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
              Below are all emails sent by this client agent. Opens are tracked automatically via a transparent 1x1 tracking pixel.
            </div>

            {emailLogs.length > 0 ? (
              emailLogs.map((log) => (
                <div key={log.id} style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "12px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontWeight: "700" }}>To: {log.lead_name}</span>
                    <span style={{ color: "var(--muted)", fontSize: "11px" }}>{log.sent_at}</span>
                  </div>
                  <div style={{ color: "var(--accent-hi)", fontSize: "11px", fontWeight: "600", marginBottom: "4px" }}>
                    Target: {log.lead_email}
                  </div>
                  <div style={{
                    color: "var(--text)",
                    borderLeft: "2px solid var(--accent)",
                    paddingLeft: "8px",
                    margin: "8px 0",
                    maxHeight: "80px",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    fontSize: "11px",
                    lineHeight: "1.5"
                  }}>
                    {log.body}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: "8px", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {log.opened_at ? (
                        <span className="badge badge-green" style={{ fontSize: "9px" }}>
                          Opened at {new Date(log.opened_at).toLocaleTimeString()}
                        </span>
                      ) : (
                        <span className="badge badge-gold" style={{ fontSize: "9px" }}>
                          Unopened
                        </span>
                      )}
                      
                      {log.replied_at ? (
                        <span className="badge badge-purple" style={{ fontSize: "9px" }}>
                          Replied!
                        </span>
                      ) : (
                        <button 
                          style={{
                            background: "transparent",
                            color: "var(--accent-hi)",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "10px",
                            fontWeight: "700"
                          }}
                          onClick={async () => {
                            try {
                              await fetch(`/api/leads/${log.lead_id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "closed", stage: "Contract Signed" })
                              });
                              alert("Deal status updated to Replied/Closed!");
                              fetchLeads();
                              fetchEmailLogs();
                            } catch (e) {}
                          }}
                        >
                          Mark Replied
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: "center", color: "var(--muted)", padding: "30px 0" }}>No email logs recorded yet.</div>
            )}
          </div>
        </div>

        {/* Right Column: Email Composer */}
        <div>
          <div className="section-title">Manual Email Dispatcher</div>
          <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: "11px", fontWeight: "700", color: "var(--muted)" }}>Select Lead Recipient</label>
              <select
                className="custom-input"
                value={selectedLead?.id || ""}
                onChange={(e) => {
                  const lead = leads.find(l => l.id === parseInt(e.target.value));
                  setSelectedLead(lead || null);
                  setEmailDraft(lead?.emailDraft || "");
                }}
              >
                <option value="">-- Choose Lead from CRM --</option>
                {leads.map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.email || "No Email"})</option>
                ))}
              </select>
            </div>

            {selectedLead && (
              <div style={{
                backgroundColor: "var(--surface)",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                fontSize: "12px"
              }}>
                <strong>Lead Qualification Score:</strong> {selectedLead.score}/100
                <br />
                <strong>Scraper Context:</strong> {selectedLead.reason}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "11px", fontWeight: "700", color: "var(--muted)" }}>Email Body</label>
                {selectedLead && (
                  <button 
                    className="btn btn-ghost" 
                    style={{ padding: "4px 8px", fontSize: "10px" }}
                    onClick={async () => {
                      setLoading(true);
                      try {
                        const res = await fetch("/api/chat", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ text: `Draft an outreach email to ${selectedLead.contact} at ${selectedLead.name}. Their score details: ${selectedLead.reason}. Under 150 words. Plain text.` })
                        });
                        if (res.ok) {
                          const reply = await res.json();
                          setEmailDraft(reply.text);
                        }
                      } catch (e) {}
                      setLoading(false);
                    }}
                  >
                    AI Rewrite Pitch
                  </button>
                )}
              </div>
              <textarea 
                className="custom-textarea" 
                style={{ minHeight: "220px" }} 
                placeholder="Draft your pitch here..."
                value={emailDraft}
                onChange={e => setEmailDraft(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button 
                className="btn btn-primary" 
                style={{ flex: 1 }}
                onClick={() => {
                  if (!selectedLead) return alert("Select a lead first.");
                  handleSendEmailDraft(selectedLead.id, emailDraft);
                }}
                disabled={loading || !selectedLead}
              >
                {loading ? "Sending..." : "Dispatch Email via Server"}
              </button>
              <button className="btn btn-secondary" onClick={() => setEmailDraft("")}>Clear</button>
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)" }}>
              Note: Email dispatch relies on SMTP/SendGrid details in Settings. If unset, it will log an error.
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Social generator view
  const SocialTab = () => (
    <div className="responsive-grid-2">
      <div>
        <div className="section-title">Organic Client Generation</div>
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>
            Generate punchy, client-attracting posts for your profiles to draw inbound graphic design interest.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {["LinkedIn", "Instagram", "Twitter/X", "Facebook"].map(p => (
              <button 
                key={p} 
                className={`btn ${socialPlatform === p ? "btn-primary" : "btn-ghost"}`}
                style={{ textAlign: "left", display: "flex", justifyContent: "space-between" }}
                onClick={() => {
                  setSocialPlatform(p);
                  generateSocial(p);
                }}
              >
                <span>{p} Marketing Pitch</span>
                <span style={{ opacity: 0.6, fontSize: "11px" }}>Generate</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: "10px" }}>
            <label style={{ fontSize: "11px", fontWeight: "700", color: "var(--muted)", display: "block", marginBottom: "6px" }}>
              Niche Focus Context (from settings)
            </label>
            <input className="custom-input" disabled value={config.niche || "Graphic Design NGO Uganda"} />
          </div>
        </div>
      </div>

      <div>
        <div className="section-title">{socialPlatform} Post Draft</div>
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {loading ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)" }}>
              <div className="spinner" style={{ marginBottom: "10px" }} />
              <br />Claude is composing social post...
            </div>
          ) : socialDraft ? (
            <>
              <textarea 
                className="custom-textarea" 
                style={{ minHeight: "180px", lineHeight: "1.7", fontSize: "14px" }}
                value={socialDraft}
                onChange={e => setSocialDraft(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={() => {
                  navigator.clipboard.writeText(socialDraft);
                  alert("Copied post draft to clipboard!");
                }}>
                  Copy Pitch
                </button>
                <button className="btn btn-ghost" onClick={() => setSocialDraft("")}>Clear</button>
              </div>
            </>
          ) : (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: "13px" }}>
              Click any social platform outline to generate marketing contents.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Full-screen agent chat
  const ChatTab = () => (
    <div>
      <div className="section-title">ClientAgent Conversation Session</div>
      <div className="glass-card chat-window">
        <div className="chat-messages">
          {chatHistory.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role === "user" ? "user" : ""}`}>
              {m.role === "agent" && <div className="chat-sender-tag">CLIENT AGENT</div>}
              {m.text}
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: "12px", padding: "6px" }}>
              <div className="spinner" /> Agent is analyzing state...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input 
            className="custom-input"
            placeholder="Ask strategies, email followups, or client advice..."
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !loading && handleSendChat()}
          />
          <button className="btn btn-primary" onClick={handleSendChat} disabled={loading}>Send</button>
        </div>
        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "8px" }}>
          Claude Sonnet has full awareness of your SQLite pipelines, deal values, and niche settings.
        </div>
      </div>
    </div>
  );

  // Settings view
  const SettingsTab = () => (
    <div>
      <div className="section-title">Secure Settings Management</div>
      <div className="glass-card">
        <form onSubmit={handleUpdateConfig}>
          <div className="settings-grid">
            {/* Left Col: Niche and quota */}
            <div>
              <div style={{ fontWeight: "700", borderBottom: "1px solid var(--border)", paddingBottom: "6px", marginBottom: "12px" }}>
                Campaign Options
              </div>

              <div className="form-group">
                <label className="form-label">Search Niche / Niche Focus</label>
                <input 
                  className="custom-input" 
                  placeholder="e.g. Graphic Design NGO Kampala" 
                  value={config.niche}
                  onChange={e => setConfig({ ...config, niche: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Daily Lead Search Quota</label>
                <input 
                  className="custom-input" 
                  type="number"
                  placeholder="10" 
                  value={config.daily_quota}
                  onChange={e => setConfig({ ...config, daily_quota: e.target.value })}
                  required
                />
              </div>

              <div className="form-group" style={{ marginTop: "24px" }}>
                <label className="toggle-switch">
                  <input 
                    type="checkbox"
                    checked={config.auto_send === "true"}
                    onChange={e => setConfig({ ...config, auto_send: e.target.checked ? "true" : "false" })}
                  />
                  <div className="toggle-slider"></div>
                  <span style={{ fontSize: "13px", fontWeight: "700" }}>Auto-Send Cold Pitches Immediately</span>
                </label>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", marginLeft: "54px" }}>
                  If enabled, scored leads scoring high will be emailed instantly without manual confirmation.
                </div>
              </div>
            </div>

            {/* Right Col: Keys */}
            <div>
              <div style={{ fontWeight: "700", borderBottom: "1px solid var(--border)", paddingBottom: "6px", marginBottom: "12px" }}>
                Credentials & Integrations (Saved Securely)
              </div>

              <div className="form-group">
                <label className="form-label">Anthropic Claude API Key</label>
                <input 
                  className="custom-input" 
                  type="password"
                  placeholder="sk-ant-..." 
                  value={config.anthropic_api_key}
                  onChange={e => setConfig({ ...config, anthropic_api_key: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">SendGrid API Key (Optional)</label>
                <input 
                  className="custom-input" 
                  type="password"
                  placeholder="SG.xxxxx" 
                  value={config.sendgrid_api_key}
                  onChange={e => setConfig({ ...config, sendgrid_api_key: e.target.value })}
                />
              </div>

              <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--muted)", margin: "14px 0 6px 0" }}>
                SMTP Server Config (Use if SendGrid key empty)
              </div>

              <div className="responsive-grid-2" style={{ marginBottom: "0px", gap: "10px" }}>
                <div className="form-group" style={{ marginBottom: "8px" }}>
                  <label className="form-label">SMTP Host</label>
                  <input 
                    className="custom-input" 
                    placeholder="smtp.gmail.com" 
                    value={config.smtp_host}
                    onChange={e => setConfig({ ...config, smtp_host: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "8px" }}>
                  <label className="form-label">SMTP Port</label>
                  <input 
                    className="custom-input" 
                    placeholder="587" 
                    value={config.smtp_port}
                    onChange={e => setConfig({ ...config, smtp_port: e.target.value })}
                  />
                </div>
              </div>

              <div className="responsive-grid-2" style={{ marginBottom: "0px", gap: "10px" }}>
                <div className="form-group" style={{ marginBottom: "8px" }}>
                  <label className="form-label">SMTP User</label>
                  <input 
                    className="custom-input" 
                    placeholder="user@gmail.com" 
                    value={config.smtp_user}
                    onChange={e => setConfig({ ...config, smtp_user: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "8px" }}>
                  <label className="form-label">SMTP Password</label>
                  <input 
                    className="custom-input" 
                    type="password"
                    placeholder="SMTP secret passcode" 
                    value={config.smtp_pass}
                    onChange={e => setConfig({ ...config, smtp_pass: e.target.value })}
                  />
                </div>
              </div>

              <div className="responsive-grid-2" style={{ marginBottom: "0px", gap: "10px", marginTop: "10px" }}>
                <div className="form-group" style={{ marginBottom: "8px" }}>
                  <label className="form-label">Sender Email Address</label>
                  <input 
                    className="custom-input" 
                    placeholder="henry@brandcraft.ug" 
                    value={config.email_sender}
                    onChange={e => setConfig({ ...config, email_sender: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "8px" }}>
                  <label className="form-label">Sender Display Name</label>
                  <input 
                    className="custom-input" 
                    placeholder="Henry | BrandCraft" 
                    value={config.email_sender_name}
                    onChange={e => setConfig({ ...config, email_sender_name: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "18px", marginTop: "18px", display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" type="submit" disabled={savingSettings}>
              {savingSettings ? "Saving Settings..." : "Save Settings Configuration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // Tab configurations
  const TABS = [
    { id: "dashboard", label: "Dashboard" },
    { id: "clients", label: "CRM Pipeline" },
    { id: "email", label: "Email Outreach" },
    { id: "social", label: "Social Pitch" },
    { id: "chat", label: "Agent Session" },
    { id: "settings", label: "Settings Panel" },
  ];

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-mark">CA</div>
          ClientAgent
          <span className="logo-sub">for Henry</span>
        </div>
        <nav className="nav-tabs">
          {TABS.map(t => (
            <button 
              key={t.id} 
              className={`nav-btn ${tab === t.id ? "active" : ""}`} 
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "dashboard" && leads.filter(l => l.status === "new").length > 0 && (
                <span style={{ 
                  marginLeft: "8px", 
                  backgroundColor: "var(--red)", 
                  color: "white", 
                  borderRadius: "10px", 
                  padding: "1px 6px", 
                  fontSize: "10px" 
                }}>
                  {leads.filter(l => l.status === "new").length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="status-indicator">
          <div className={`status-dot ${agentState.running ? "running" : "active"}`} />
          <span>{agentState.running ? "Agent Active" : "Agent Standby"}</span>
        </div>
      </header>

      <main className="main-content">
        {tab === "dashboard" && <Dashboard />}
        {tab === "clients" && <Clients />}
        {tab === "email" && <EmailTab />}
        {tab === "social" && <SocialTab />}
        {tab === "chat" && <ChatTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

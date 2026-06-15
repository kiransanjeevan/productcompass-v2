// Phase 2 — seed sample Linear stories derived from the indexed RavenStack docs
// (Data Export PRD, Smart Alerts Launch Checklist, Churn Reduction Initiative,
// Customer Health Score Framework, Engineering OKRs Q4 2025). Creates projects +
// issues with a realistic spread of states/priorities so the read sync (Phase 3)
// has meaningful data. Idempotent: skips projects/issues that already exist by name/title.
//
// Run:  LINEAR_API_KEY=lin_api_... deno run --allow-net --allow-env scripts/seed-linear.ts
const KEY = Deno.env.get("LINEAR_API_KEY");
if (!KEY) throw new Error("LINEAR_API_KEY not set");
const TEAM = "2ee11968-adc6-4b0a-a284-18c4e180f0a7"; // KIR — Kiran Sanjeevan

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

// 1) Team metadata: workflow states, estimation setting, existing projects/issues (dedup)
const meta = await gql(
  `query($t:String!){ team(id:$t){ issueEstimationType
    states{ nodes{ id name type } }
    projects{ nodes{ id name } }
    issues(first:250){ nodes{ title } } } }`,
  { t: TEAM },
);
const stateByType: Record<string, string> = {};
for (const s of meta.team.states.nodes) if (!stateByType[s.type]) stateByType[s.type] = s.id;
const estimationOn = meta.team.issueEstimationType && meta.team.issueEstimationType !== "notUsed";
const existingProjects = new Map<string, string>(meta.team.projects.nodes.map((p: any) => [p.name, p.id]));
const existingTitles = new Set<string>(meta.team.issues.nodes.map((i: any) => i.title));
console.log(`estimation: ${estimationOn ? meta.team.issueEstimationType : "off"} · existing projects: ${existingProjects.size} · existing issues: ${existingTitles.size}`);

// 2) Projects (derived from the docs)
const projectDefs = [
  { name: "Data Export", description: "Native JSON/XLSX + scheduled & API-triggered exports (Data Export PRD)." },
  { name: "Smart Alerts GA", description: "Take Smart Alerts from beta to GA — owner Priya Patel, eng Jake Morrison (Launch Checklist)." },
  { name: "Churn Reduction", description: "Reduce churn via pricing flexibility, support, and mobile (Churn Reduction Initiative)." },
  { name: "Reliability & Compliance", description: "Error-rate fixes, read replicas, SOC 2 (Engineering OKRs Q4 2025)." },
  { name: "Customer Health Score", description: "Predictive account health scoring for CSM intervention (Health Score Framework)." },
];
const projectId: Record<string, string> = {};
for (const p of projectDefs) {
  if (existingProjects.has(p.name)) { projectId[p.name] = existingProjects.get(p.name)!; continue; }
  const d = await gql(
    `mutation($in:ProjectCreateInput!){ projectCreate(input:$in){ project{ id } } }`,
    { in: { name: p.name, description: p.description, teamIds: [TEAM] } },
  );
  projectId[p.name] = d.projectCreate.project.id;
  console.log("project +", p.name);
}

// 3) Issues (grounded in the doc content)
const PRIO: Record<string, number> = { Urgent: 1, High: 2, Medium: 3, Low: 4 };
const STYPE: Record<string, string> = { Backlog: "backlog", Todo: "unstarted", "In Progress": "started", Done: "completed" };
type Iss = { p: string; t: string; s: keyof typeof STYPE; pr: keyof typeof PRIO; est: number; d: string };
const issues: Iss[] = [
  // Data Export
  { p: "Data Export", t: "Add native JSON and XLSX export formats", s: "Todo", pr: "High", est: 5, d: "Power User Interviews (Nov 2025): 3 of 8 users built custom scripts to convert CSV→JSON/XLSX. Ship native JSON + XLSX export. Target: 0 customer-built scraping scripts within 3 months." },
  { p: "Data Export", t: "Scheduled exports (daily / weekly / monthly)", s: "Todo", pr: "High", est: 8, d: "Today export is manual click-and-download. Add scheduled exports. Target: 20%+ Pro/Enterprise adoption." },
  { p: "Data Export", t: "POST /v2/export API endpoint", s: "In Progress", pr: "High", est: 5, d: "API-triggered exports for pipeline integration, per API Integration Spec v2." },
  { p: "Data Export", t: "Expand export scope beyond task data", s: "Backlog", pr: "Medium", est: 5, d: "Current export only covers tasks. Add documents, project metadata, activity logs, team metrics." },
  { p: "Data Export", t: "Export History page (Settings → Data)", s: "Backlog", pr: "Low", est: 3, d: "Show all org exports: date, user, format, size, download link (7-day retention)." },
  // Smart Alerts GA
  { p: "Smart Alerts GA", t: "Reduce Smart Alerts error rate 7.4% → <3%", s: "In Progress", pr: "Urgent", est: 8, d: "Beta at 7.4% error. Shares NLP pipeline with AI Copilot, so fixes carry over. GA blocker." },
  { p: "Smart Alerts GA", t: "Get Smart Alerts pricing approved", s: "Todo", pr: "High", est: 1, d: "Included in Pro/Enterprise, $10/seat add-on for Basic. Needs Sarah Chen sign-off in Q1 pricing review." },
  { p: "Smart Alerts GA", t: "Improve importance-scoring model with GA usage data", s: "Backlog", pr: "Medium", est: 5, d: "Retrain importance scoring on larger GA dataset." },
  { p: "Smart Alerts GA", t: "Iterate alert templates from beta usage", s: "Todo", pr: "Medium", est: 3, d: "Month 2–3 iteration: refine templates, add event types by request." },
  { p: "Smart Alerts GA", t: "Smart Alerts GA launch (target Q2 2026)", s: "Backlog", pr: "High", est: 5, d: "Target metrics: alert volume −60% vs unfiltered, CTR 40%+, error <3%." },
  // Churn Reduction
  { p: "Churn Reduction", t: "Increase annual billing discount 20% → 30%", s: "Todo", pr: "High", est: 2, d: "Pricing Strategy Review Option C. Addresses pricing+budget churn (195 events all-time, 80 in Q4)." },
  { p: "Churn Reduction", t: "Win-back campaign: 30-day free reactivation", s: "Backlog", pr: "Medium", est: 3, d: "Targeted outreach to churned accounts." },
  { p: "Churn Reduction", t: "Increase support capacity & resolution quality", s: "Todo", pr: "Medium", est: 5, d: "Support churn: 104 events all-time, 41 in Q4." },
  { p: "Churn Reduction", t: "Build mobile app (competitive gap)", s: "Backlog", pr: "High", est: 13, d: "AcmeSaaS has a 4.7-star app; NimbusApp too. Start Q2 2026, beta Q4 2026." },
  { p: "Churn Reduction", t: "Evaluate Starter tier at $15/seat/month", s: "Backlog", pr: "Low", est: 2, d: "Q3 2026 analysis phase." },
  // Reliability & Compliance
  { p: "Reliability & Compliance", t: "Fix AI Copilot error rate 7.2% → <3%", s: "In Progress", pr: "Urgent", est: 8, d: "Staging at 5.8% (Jake Morrison, deployed Dec 15). Production deploy planned." },
  { p: "Reliability & Compliance", t: "SOC 2 Type II certification (Q2 2026)", s: "Todo", pr: "Urgent", est: 8, d: "Blocking Enterprise deals in FinTech and HealthTech." },
  { p: "Reliability & Compliance", t: "AI Search GA optimizations (5.5% → <5%)", s: "In Progress", pr: "Medium", est: 5, d: "Approved for GA at 5.5%; expect <5% with embedding-cleanup job." },
  { p: "Reliability & Compliance", t: "Route heavy reads to read replicas", s: "Done", pr: "High", est: 5, d: "ACHIEVED — dashboard/export/analytics reads now hit replicas; −30% primary DB load." },
  { p: "Reliability & Compliance", t: "Fix Video Conferencing", s: "Done", pr: "Medium", est: 3, d: "ACHIEVED Q4 KR." },
  // Customer Health Score
  { p: "Customer Health Score", t: "Implement Health Score model", s: "Todo", pr: "High", est: 8, d: "Weights: feature engagement 40%, CSAT 30%, usage trend 20%, support 10%. 15+ features → 3x lower churn." },
  { p: "Customer Health Score", t: "At-risk account alerts for CSM intervention", s: "Backlog", pr: "Medium", est: 5, d: "Flag Critical/At-Risk accounts for proactive CSM outreach." },
  { p: "Customer Health Score", t: "Health Score POC validation", s: "Done", pr: "Medium", est: 3, d: "ACHIEVED — Oct 2025 POC on 10 at-risk Enterprise accounts: 80% prediction accuracy." },
  { p: "Customer Health Score", t: "AI Agent Builder beta (Enterprise)", s: "Done", pr: "High", est: 8, d: "ACHIEVED — launched Sep 22, 2025; 367 uses, 4.9% error. FinTech compliance early adopters." },
];

let created = 0, skipped = 0;
for (const it of issues) {
  if (existingTitles.has(it.t)) { skipped++; continue; }
  const input: Record<string, unknown> = {
    teamId: TEAM, title: it.t, description: it.d,
    stateId: stateByType[STYPE[it.s]], priority: PRIO[it.pr], projectId: projectId[it.p],
  };
  if (estimationOn) input.estimate = it.est;
  const d = await gql(`mutation($in:IssueCreateInput!){ issueCreate(input:$in){ issue{ identifier title } } }`, { in: input });
  created++;
  console.log(`  ${d.issueCreate.issue.identifier.padEnd(7)} [${it.s}/${it.pr}]  ${it.t}`);
}
console.log(`\nDone. Created ${created} issues, skipped ${skipped} (already existed). Projects: ${Object.keys(projectId).length}.`);

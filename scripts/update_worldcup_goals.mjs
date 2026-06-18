import fs from "node:fs";

const dataPath = new URL("../data/worldcup_player_goals_breakdown.json", import.meta.url);
const ESPN_STATS_URL = "https://www.espn.com/soccer/stats/_/league/fifa.world";

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function extractJsonObjectAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`Marker not found: ${marker}`);
  const from = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(from, i + 1));
    }
  }
  throw new Error("Object did not terminate");
}

async function fetchEspnScoringRows() {
  const html = await fetch(ESPN_STATS_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 UUMit data refresh"
    }
  }).then((res) => {
    if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
    return res.text();
  });
  const statistics = extractJsonObjectAfter(html, '"statistics":');
  const rows = statistics.tableRows?.[0] || [];
  return rows.map((row) => ({
    rank: Number(row[0]),
    player: row[1]?.name || "",
    team: row[2]?.name || "",
    appearances_2026: Number(row[3]?.value || 0),
    goals_2026: Number(row[4]?.value || 0),
    player_url: row[1]?.href || null,
    team_url: row[2]?.href || null
  })).filter((row) => row.player && Number.isFinite(row.goals_2026));
}

function findItem(items, livePlayer) {
  const target = normalize(livePlayer);
  return items.find((item) => {
    const keys = [item.player, item.player_cn, ...(item.aliases || [])].map(normalize);
    return keys.includes(target);
  });
}

function setWorldCupGoals(item, year, goals) {
  item.breakdown ||= [];
  const existing = item.breakdown.find((entry) => Number(entry.worldcup) === year);
  if (existing) existing.goals = goals;
  else item.breakdown.push({ worldcup: year, goals });
  item.breakdown.sort((a, b) => Number(a.worldcup) - Number(b.worldcup));
  item.total_goals = item.breakdown.reduce((sum, entry) => sum + Number(entry.goals || 0), 0);
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const liveRows = await fetchEspnScoringRows();
const now = new Date().toISOString();

for (const live of liveRows) {
  let item = findItem(data.items, live.player);
  if (!item) {
    item = {
      player: live.player,
      player_cn: live.player,
      aliases: [live.player],
      team: live.team,
      team_cn: live.team,
      total_goals: 0,
      breakdown: [],
      status: "live_only_2026"
    };
    data.items.push(item);
  }
  item.team ||= live.team;
  item.espn_player_url = live.player_url;
  item.espn_team_url = live.team_url;
  item.appearances_2026 = live.appearances_2026;
  item.status = item.status === "final" ? "in_progress_2026" : item.status;
  item.as_of = now;
  setWorldCupGoals(item, 2026, live.goals_2026);
}

data.as_of = now;
data.data_note = "历史分届统计 + ESPN 2026 FIFA World Cup scoring 页面自动刷新。2026 数据为进行中赛事快照，最终数据以赛事结束后复核为准。";
data.live_2026_source = {
  name: "ESPN FIFA World Cup scoring stats",
  url: ESPN_STATS_URL,
  fetched_at: now,
  row_count: liveRows.length
};
data.live_2026_top_scorers = liveRows.slice(0, 50);
data.items.sort((a, b) => Number(b.total_goals || 0) - Number(a.total_goals || 0) || String(a.player).localeCompare(String(b.player)));

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ updated: true, fetched_at: now, live_rows: liveRows.length, items: data.items.length }));

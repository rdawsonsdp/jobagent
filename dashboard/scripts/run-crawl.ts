/**
 * Run crawls directly, bypassing HTTP auth.
 * Usage: npx tsx scripts/run-crawl.ts [company_name]
 * If no name given, crawls all pending companies.
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

// Load .env.local
const envFile = readFileSync(join(__dirname, "../.env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2];
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---- Utility functions ----

function urlHash(url: string): string {
  return crypto.createHash("md5").update(url).digest("hex");
}

function generateSlugs(companyName: string): string[] {
  const name = companyName.trim();
  const slugs = new Set<string>();
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  const firstWord = name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  slugs.add(firstWord);
  const words = name.split(/\s+/);
  if (words.length > 1) slugs.add(words.map((w) => w.toLowerCase()).join(""));
  slugs.add(`${firstWord}jobs`);
  slugs.add(`${name.toLowerCase().replace(/[^a-z0-9]/g, "")}jobs`);
  slugs.add(`${firstWord}usjobs`);
  return [...slugs].filter((s) => s.length > 0);
}

// ---- ATS APIs ----

async function tryGreenhouseApi(slug: string) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.jobs?.length) return null;
    return {
      type: "greenhouse" as const,
      jobs: data.jobs.map((j: any) => ({
        title: j.title,
        url: j.absolute_url,
        location: j.location?.name || "Unknown",
        id: String(j.id),
      })),
    };
  } catch { return null; }
}

async function tryLeverApi(slug: string) {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    return {
      type: "lever" as const,
      jobs: data.map((j: any) => ({
        title: j.text,
        url: j.hostedUrl,
        location: j.categories?.location || "Unknown",
        id: String(j.id),
      })),
    };
  } catch { return null; }
}

async function tryWorkdayApi(tenant: string, wdNum: number, site: string, limit = 20) {
  const apiUrl = `https://${tenant}.wd${wdNum}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ limit, offset: 0 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.total) return null;
    const baseUrl = `https://${tenant}.wd${wdNum}.myworkdayjobs.com/en-US/${site}`;
    return {
      type: "workday" as const,
      total: data.total as number,
      jobs: data.jobPostings.map((j: any) => ({
        title: j.title,
        url: `${baseUrl}${j.externalPath}`,
        location: j.locationsText || "Unknown",
        id: j.externalPath?.split("/").pop() || j.title,
      })),
    };
  } catch { return null; }
}

// ---- Smart ATS discovery ----

const WORKDAY_SITE_NAMES = ["External", "Americas", "Careers", "Jobs", "US"];

function generateWorkdaySiteNames(companyName: string): string[] {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cap = companyName.split(/\s+/)[0];
  return [
    `${slug}careers`, `${slug}jobs`,
    `${cap}_Careers`, `${cap}_Jobs`,
    `${cap}USA`, `${cap}US`,
    `${cap}Careers`, `DomoCareers`,
  ];
}

async function discoverJobs(companyName: string, careersUrl: string, atsType: string | null) {
  const slugs = generateSlugs(companyName);

  // Strategy 1: Try known ATS type with slug variations
  if (atsType === "greenhouse" || !atsType) {
    for (const slug of slugs) {
      const result = await tryGreenhouseApi(slug);
      if (result) return result;
    }
  }
  if (atsType === "lever" || !atsType) {
    for (const slug of slugs.slice(0, 5)) {
      const result = await tryLeverApi(slug);
      if (result) return result;
    }
  }

  // Strategy 2: Workday JSON API
  if (atsType === "workday" || !atsType) {
    // Check if URL is already a Workday URL
    const wdMatch = careersUrl.match(/([^/.]+)\.wd(\d+)\.myworkdayjobs\.com(?:\/(?:en-US\/)?([^/?]+))?/i);
    if (wdMatch) {
      const [, tenant, wdNumStr, site] = wdMatch;
      const wdNum = parseInt(wdNumStr, 10);
      const sites = site ? [site, ...generateWorkdaySiteNames(companyName), ...WORKDAY_SITE_NAMES] : [...generateWorkdaySiteNames(companyName), ...WORKDAY_SITE_NAMES];
      for (const s of [...new Set(sites)]) {
        const result = await tryWorkdayApi(tenant, wdNum, s);
        if (result) return result;
      }
    }

    // Try slug-based discovery
    const companySites = generateWorkdaySiteNames(companyName);
    for (const slug of slugs.slice(0, 3)) {
      for (const wdNum of [1, 5, 3, 2, 4, 12]) {
        const sites = [slug, ...companySites, ...WORKDAY_SITE_NAMES];
        for (const site of [...new Set(sites)]) {
          const result = await tryWorkdayApi(slug, wdNum, site);
          if (result) return result;
        }
      }
    }
  }

  // Strategy 3: If ats_type was set but wrong, try other types
  if (atsType === "workday") {
    for (const slug of slugs.slice(0, 3)) {
      const gh = await tryGreenhouseApi(slug);
      if (gh) return gh;
    }
  }
  if (atsType === "greenhouse") {
    for (const slug of slugs.slice(0, 3)) {
      const lv = await tryLeverApi(slug);
      if (lv) return lv;
    }
  }

  return null;
}

// ---- Claude matching ----

const MATCH_PROMPT = `You are a job matching analyst. Given a candidate's profile and a list of job openings, score how well each matches.

Return ONLY a JSON array. Each element:
{
  "title": "Job Title",
  "url": "https://...",
  "location": "City, State or Remote",
  "description_snippet": "Brief 1-2 sentence description",
  "match_confidence": 0.85,
  "match_reasoning": "Why this is/isn't a good match"
}

Rules:
- match_confidence: 0.0 to 1.0 (1.0 = perfect match)
- Only include jobs with at least 0.2 confidence
- Score based on skills overlap, title relevance, location fit, seniority match
- If no good matches, return []`;

async function loadUserContext(userId: string): Promise<string> {
  const [resumeRes, profileRes, prefsRes] = await Promise.all([
    supabase.from("resumes").select("raw_text, parsed_data, skills, target_titles")
      .eq("user_id", userId).eq("is_active", true).limit(1).maybeSingle(),
    supabase.from("search_profiles").select("job_titles, keywords, locations, remote_only")
      .eq("user_id", userId).eq("is_active", true).limit(1).maybeSingle(),
    supabase.from("user_profile").select("city, state, country")
      .eq("user_id", userId).limit(1).maybeSingle(),
  ]);

  const parts: string[] = [];
  if (resumeRes.data) {
    const r = resumeRes.data;
    if (r.parsed_data) {
      const pd = r.parsed_data as Record<string, any>;
      parts.push(`Resume summary: ${pd.summary || "N/A"}`);
      parts.push(`Skills: ${pd.skills?.join(", ") || r.skills?.join(", ") || "N/A"}`);
      parts.push(`Target titles: ${pd.target_titles?.join(", ") || r.target_titles?.join(", ") || "N/A"}`);
      parts.push(`Years experience: ${pd.years_of_experience || "N/A"}`);
    } else if (r.raw_text) {
      parts.push(`Resume text: ${(r.raw_text as string).substring(0, 2000)}`);
    }
  }
  if (profileRes.data) {
    const p = profileRes.data;
    parts.push(`Search titles: ${(p.job_titles as string[])?.join(", ") || "N/A"}`);
    parts.push(`Keywords: ${(p.keywords as string[])?.join(", ") || "N/A"}`);
    parts.push(`Locations: ${(p.locations as string[])?.join(", ") || "N/A"}`);
    parts.push(`Remote only: ${p.remote_only ? "Yes" : "No"}`);
  }
  if (prefsRes.data) {
    const u = prefsRes.data;
    parts.push(`User location: ${[u.city, u.state, u.country].filter(Boolean).join(", ")}`);
  }
  return parts.length > 0 ? `USER PROFILE:\n${parts.join("\n")}` : "";
}

// ---- Main crawl function ----

async function crawlCompany(companyId: string, userId: string, userContext: string) {
  const { data: company } = await supabase
    .from("target_companies").select("*").eq("id", companyId).single();
  if (!company) throw new Error("Company not found");

  const name = company.name as string;
  const careersUrl = company.careers_url as string;
  const atsType = (company.ats_type as string) || null;

  console.log(`\n🔍 ${name} (${atsType || "unknown"})...`);

  await supabase.from("target_companies")
    .update({ crawl_status: "crawling", crawl_error: null }).eq("id", companyId);

  // Discover jobs
  const result = await discoverJobs(name, careersUrl, atsType);
  if (!result || result.jobs.length === 0) {
    const msg = "No jobs found via ATS API";
    console.log(`  ❌ ${msg}`);
    await supabase.from("target_companies")
      .update({ crawl_status: "failed", crawl_error: msg }).eq("id", companyId);
    return { jobsFound: 0, matchedJobs: 0 };
  }

  console.log(`  📋 Found ${result.jobs.length} jobs via ${result.type}`);

  // Update ats_type if discovered
  if (atsType !== result.type) {
    await supabase.from("target_companies")
      .update({ ats_type: result.type }).eq("id", companyId);
  }

  // Format jobs for Claude
  const jobsText = result.jobs
    .map((j: any) => `JOB: ${j.title}\nURL: ${j.url}\nLOCATION: ${j.location}\n---`)
    .join("\n");

  // Send to Claude for matching
  console.log(`  🤖 Matching against user profile...`);
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: MATCH_PROMPT,
    messages: [{
      role: "user",
      content: `${userContext}\n\nCOMPANY: ${name}\nINDUSTRY: ${company.industry || "Unknown"}\n\nJOBS:\n${jobsText}`,
    }],
  });

  let responseText = "";
  if (response.content?.length > 0 && response.content[0].type === "text") {
    responseText = response.content[0].text;
  }

  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  let matchedJobs: any[] = [];
  if (jsonMatch) {
    try { matchedJobs = JSON.parse(jsonMatch[0]); } catch { matchedJobs = []; }
  }

  // Filter out info requests
  matchedJobs = matchedJobs.filter((j: any) => j.title !== "[NEED_INFO]");

  console.log(`  ✅ ${matchedJobs.length} matched jobs (of ${result.jobs.length} total)`);

  // Insert matched jobs
  let insertedCount = 0;
  for (const job of matchedJobs) {
    const jobUrl = job.url || `${careersUrl}#${encodeURIComponent(job.title)}`;
    const hash = urlHash(jobUrl);

    const { error } = await supabase.from("jobs").upsert({
      user_id: userId,
      title: job.title,
      company: name,
      url: jobUrl,
      url_hash: hash,
      location: job.location,
      description_text: job.description_snippet,
      match_confidence: job.match_confidence,
      relevance_score: Math.round(job.match_confidence * 10),
      score_reasoning: job.match_reasoning,
      target_company_id: companyId,
      is_active: true,
      is_remote: job.location?.toLowerCase().includes("remote") || false,
    }, { onConflict: "user_id,url_hash" });

    if (!error) insertedCount++;
    else console.log(`    ⚠️ Insert error: ${error.message}`);
  }

  // Update company stats
  const avgConf = matchedJobs.length > 0
    ? matchedJobs.reduce((sum: number, j: any) => sum + j.match_confidence, 0) / matchedJobs.length
    : 0;

  await supabase.from("target_companies").update({
    crawl_status: "completed",
    crawl_error: null,
    last_crawled_at: new Date().toISOString(),
    jobs_found: matchedJobs.length,
    matched_jobs_count: insertedCount,
    avg_match_confidence: Math.round(avgConf * 100) / 100,
  }).eq("id", companyId);

  for (const job of matchedJobs.slice(0, 3)) {
    console.log(`    📌 ${job.title} (${(job.match_confidence * 100).toFixed(0)}%)`);
  }

  return { jobsFound: matchedJobs.length, matchedJobs: insertedCount };
}

// ---- Main ----

async function main() {
  const targetName = process.argv[2];

  // Get user_id
  const { data: anyCompany } = await supabase
    .from("target_companies").select("user_id").limit(1).single();
  if (!anyCompany) { console.log("No companies found"); return; }
  const userId = anyCompany.user_id;

  // Load user context once
  const userContext = await loadUserContext(userId);
  if (!userContext) {
    console.log("⚠️  No user profile found — matching will be generic");
  } else {
    console.log("✅ User profile loaded");
  }

  // Get pending companies
  let query = supabase.from("target_companies")
    .select("id, name, ats_type, careers_url, crawl_status")
    .eq("user_id", userId)
    .in("crawl_status", ["pending", "failed"]);

  if (targetName) {
    query = query.ilike("name", `%${targetName}%`);
  }

  const { data: companies } = await query.order("name");
  if (!companies?.length) {
    console.log("No pending companies to crawl");
    return;
  }

  console.log(`\n🚀 Crawling ${companies.length} companies...\n`);

  let totalFound = 0;
  let totalMatched = 0;
  let successes = 0;
  let failures = 0;

  for (const company of companies) {
    try {
      const result = await crawlCompany(company.id, userId, userContext);
      totalFound += result.jobsFound;
      totalMatched += result.matchedJobs;
      if (result.jobsFound > 0) successes++;
      else failures++;
    } catch (err) {
      console.log(`  ❌ ${company.name}: ${err instanceof Error ? err.message : String(err)}`);
      await supabase.from("target_companies")
        .update({ crawl_status: "failed", crawl_error: err instanceof Error ? err.message : String(err) })
        .eq("id", company.id);
      failures++;
    }
  }

  console.log(`\n📊 Results: ${successes} succeeded, ${failures} failed`);
  console.log(`   ${totalFound} jobs found, ${totalMatched} inserted into pipeline`);
}

main().catch(console.error);

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";
import { loadUserContext } from "@/lib/user-context";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import chromium from "chromium";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CRAWL_SYSTEM_PROMPT = `You are a job matching analyst acting as a human job seeker browsing a company's careers page. You will be given:
1. A candidate's profile (skills, experience, target roles)
2. Content from a company's careers/jobs page

Your task: Identify specific job openings listed on the page and score how well each matches the candidate.

Return ONLY a JSON array (no other text). Each element:
{
  "title": "Job Title",
  "url": "https://... (full URL if found, otherwise null)",
  "location": "City, State or Remote",
  "description_snippet": "Brief 1-2 sentence description of the role",
  "match_confidence": 0.85,
  "match_reasoning": "Why this is/isn't a good match"
}

Rules:
- match_confidence is 0.0 to 1.0 (1.0 = perfect match)
- Only include jobs that have at least 0.2 confidence
- If no jobs are found on the page, return an empty array []
- Be accurate about URLs - only include if you can see the actual link
- Score based on skills overlap, title relevance, location fit, and seniority match
- Ignore cookie consent banners, privacy notices, and other overlay content — focus on the actual job listings
- If the page appears to only show a cookie wall with no job content behind it, return []
- If you need additional information about the candidate to properly match (e.g., security clearance, specific certifications, language skills), include a special entry with title "[NEED_INFO]" and match_reasoning describing what info is needed`;

function stripHtml(html: string): string {
  let cleaned = html
    .replace(/<div[^>]*(?:cookie|consent|gdpr|privacy-notice|cc-banner|onetrust)[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<section[^>]*(?:cookie|consent|gdpr)[^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<aside[^>]*(?:cookie|consent)[^>]*>[\s\S]*?<\/aside>/gi, "");

  return cleaned
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function urlHash(url: string): string {
  return crypto.createHash("md5").update(url).digest("hex");
}

interface MatchedJob {
  title: string;
  url: string | null;
  location: string | null;
  description_snippet: string | null;
  match_confidence: number;
  match_reasoning: string | null;
}

interface CrawlResult {
  jobsFound: number;
  matchedJobs: number;
  avgConfidence: number;
  needsInfo?: string;
}

// ----- Slug generation -----

/** Generate candidate slugs from company name for ATS API lookups */
function generateSlugs(companyName: string): string[] {
  const name = companyName.trim();
  const slugs = new Set<string>();

  // lowercase, spaces to hyphens (e.g. "enova-international")
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  // lowercase, no spaces (e.g. "enovainternational")
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  // lowercase, spaces to underscores
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  // just first word (common for single-brand companies like "Morningstar", "Ensono")
  const firstWord = name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  slugs.add(firstWord);
  // camelCase-ish: first word + capitalized rest
  const words = name.split(/\s+/);
  if (words.length > 1) {
    slugs.add(words.map((w) => w.toLowerCase()).join(""));
  }
  // Greenhouse often appends "jobs" or "usjobs" to the slug (e.g. "preciselyusjobs")
  const noSpaces = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  slugs.add(`${firstWord}jobs`);
  slugs.add(`${noSpaces}jobs`);
  slugs.add(`${firstWord}usjobs`);

  return [...slugs].filter((s) => s.length > 0);
}

/** Try to extract a slug from a URL path */
function extractSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // Get the first meaningful path segment
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length > 0 && parts[0] !== "careers" && parts[0] !== "jobs") {
      return parts[0];
    }
    if (parts.length > 1) return parts[1];
  } catch {
    // ignore
  }
  return null;
}

// ----- ATS API Strategies -----

interface ATSResult {
  type: string;
  jobs: { title: string; url: string; location: string; id: string }[];
}

/** Try to detect ATS type from URL patterns */
function detectATSFromUrl(url: string): { type: string; slug: string } | null {
  const ghMatch = url.match(/boards\.greenhouse\.io\/([^/?\s]+)/i)
    || url.match(/([^/.]+)\.greenhouse\.io/i);
  if (ghMatch) return { type: "greenhouse", slug: ghMatch[1] };

  const leverMatch = url.match(/jobs\.lever\.co\/([^/?\s]+)/i);
  if (leverMatch) return { type: "lever", slug: leverMatch[1] };

  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?\s]+)/i);
  if (ashbyMatch) return { type: "ashby", slug: ashbyMatch[1] };

  // Workday patterns: {company}.wd{N}.myworkdayjobs.com
  const wdMatch = url.match(/([^/.]+)\.wd\d+\.myworkdayjobs\.com/i);
  if (wdMatch) return { type: "workday", slug: wdMatch[1] };

  return null;
}

async function tryATSApi(type: string, slug: string): Promise<ATSResult | null> {
  try {
    if (type === "greenhouse") {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.jobs || data.jobs.length === 0) return null;
      return {
        type: "greenhouse",
        jobs: data.jobs.map((j: Record<string, unknown>) => ({
          title: j.title as string,
          url: j.absolute_url as string,
          location: (j.location as Record<string, string>)?.name || "Unknown",
          id: String(j.id),
        })),
      };
    }

    if (type === "lever") {
      const res = await fetch(
        `https://api.lever.co/v0/postings/${slug}?mode=json`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return {
        type: "lever",
        jobs: data.map((j: Record<string, unknown>) => ({
          title: j.text as string,
          url: j.hostedUrl as string,
          location: (j.categories as Record<string, string>)?.location || "Unknown",
          id: String(j.id),
        })),
      };
    }

    if (type === "ashby") {
      const res = await fetch(
        `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.jobs || data.jobs.length === 0) return null;
      return {
        type: "ashby",
        jobs: data.jobs.map((j: Record<string, unknown>) => ({
          title: j.title as string,
          url: `https://jobs.ashbyhq.com/${slug}/${j.id}`,
          location: (j.location as string) || "Unknown",
          id: String(j.id),
        })),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Intelligently try ATS APIs using stored ats_type and multiple slug guesses.
 * This is the "smart agent" approach: don't just rely on URL parsing,
 * use everything we know about the company to find their jobs.
 */
async function tryATSSmart(
  companyName: string,
  careersUrl: string,
  atsType: string | null
): Promise<ATSResult | null> {
  // Step 1: Try detecting from URL (most reliable)
  const urlDetected = detectATSFromUrl(careersUrl);
  if (urlDetected) {
    const result = await tryATSApi(urlDetected.type, urlDetected.slug);
    if (result) return result;
  }

  // Step 2: If we know the ATS type, try multiple slug variations
  const typeToTry = atsType || urlDetected?.type;
  if (typeToTry && typeToTry !== "workday") {
    // Generate slug candidates from company name + URL
    const slugs = generateSlugs(companyName);
    const urlSlug = extractSlugFromUrl(careersUrl);
    if (urlSlug) slugs.unshift(urlSlug); // prioritize URL-derived slug

    for (const slug of slugs) {
      console.log(`[Crawl] ${companyName}: Trying ${typeToTry} API with slug "${slug}"...`);
      const result = await tryATSApi(typeToTry, slug);
      if (result) {
        console.log(`[Crawl] ${companyName}: Found ${result.jobs.length} jobs via ${typeToTry}/${slug}`);
        return result;
      }
    }
  }

  // Step 3: Try all major APIs with slug guesses (broadens search if ats_type was wrong)
  const slugs2 = generateSlugs(companyName);
  for (const ats of ["greenhouse", "lever", "ashby"] as const) {
    if (ats === typeToTry) continue; // already tried above
    for (const slug of slugs2.slice(0, 3)) {
      const result = await tryATSApi(ats, slug);
      if (result) {
        console.log(`[Crawl] ${companyName}: Discovered ${ats} with slug "${slug}" (${result.jobs.length} jobs)`);
        return result;
      }
    }
  }

  return null;
}

// ----- Browser-based page fetching -----

const COOKIE_CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '.onetrust-close-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  'button[id*="accept"]',
  'button[id*="consent"]',
  'button[class*="accept"]',
  'button[class*="consent"]',
  'a[id*="accept"]',
  '[data-testid*="accept"]',
  '[data-testid*="consent"]',
];

const COOKIE_CONSENT_TEXTS = [
  "accept all", "accept cookies", "i accept", "i agree",
  "got it", "allow all", "agree", "ok",
];

async function fetchWithBrowser(url: string): Promise<string> {
  const browser = await puppeteer.launch({
    executablePath: chromium.path,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    // Pre-set common cookie consent cookies
    const domain = new URL(url).hostname;
    await page.setCookie(
      { name: "cookieconsent_status", value: "allow", domain },
      { name: "CookieConsent", value: "true", domain },
      { name: "cookie-agreed", value: "2", domain },
      { name: "cookies_accepted", value: "true", domain },
      { name: "gdpr_consent", value: "1", domain },
      { name: "OptanonAlertBoxClosed", value: new Date().toISOString(), domain },
      { name: "eupubconsent-v2", value: "true", domain },
    );

    await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });

    // Try CSS selectors first
    for (const selector of COOKIE_CONSENT_SELECTORS) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});
          break;
        }
      } catch { /* try next */ }
    }

    // Try text-based button clicking
    await page.evaluate((texts: string[]) => {
      const buttons = document.querySelectorAll("button, a[role='button'], [class*='btn']");
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || "";
        if (texts.some((t) => text === t || text.startsWith(t))) {
          (btn as HTMLElement).click();
          return;
        }
      }
    }, COOKIE_CONSENT_TEXTS);

    await new Promise((r) => setTimeout(r, 1500));
    return await page.content();
  } finally {
    await browser.close();
  }
}

// ----- Simple fetch with consent cookies -----

async function fetchWithCookies(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Cookie:
          "cookieconsent_status=allow; CookieConsent=true; cookie-agreed=2; cookies_accepted=true; gdpr_consent=1; OptanonAlertBoxClosed=2026-01-01T00:00:00.000Z; eupubconsent-v2=true",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ----- Workday JSON API -----

interface WorkdayJobPosting {
  title: string;
  locationsText: string;
  externalPath: string;
  postedOn: string;
  bulletFields: string[];
}

interface WorkdayDiscoveryResult {
  tenant: string;
  wdNum: number;
  site: string;
  total: number;
  jobs: { title: string; url: string; location: string; id: string }[];
}

/** Common Workday site/path names used by companies */
const WORKDAY_SITE_NAMES = [
  "External", "Americas", "en-US/External", "en-US/Americas",
  "Careers", "Jobs", "US",
];

/** Generate company-specific Workday site names (e.g. healthcatalystcareers, Navient_Jobs) */
function generateWorkdaySiteNames(companyName: string): string[] {
  const sites: string[] = [];
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const capitalized = companyName.split(/\s+/)[0]; // e.g. "Navient"
  // Common patterns: {slug}careers, {Slug}_Careers, {Slug}_Jobs, {slug}jobs
  sites.push(`${slug}careers`);
  sites.push(`${slug}jobs`);
  sites.push(`${capitalized}_Careers`);
  sites.push(`${capitalized}_Jobs`);
  sites.push(`${capitalized}USA`);
  sites.push(`${capitalized}US`);
  return sites;
}

/**
 * Try the Workday JSON API: POST to /wday/cxs/{tenant}/{site}/jobs
 * Returns structured job data without needing a browser.
 */
async function tryWorkdayJsonApi(
  tenant: string,
  wdNum: number,
  site: string,
  limit = 20
): Promise<WorkdayDiscoveryResult | null> {
  const apiUrl = `https://${tenant}.wd${wdNum}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      body: JSON.stringify({ limit, offset: 0 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const total = data.total as number;
    if (!total || total === 0) return null;
    const baseUrl = `https://${tenant}.wd${wdNum}.myworkdayjobs.com/en-US/${site}`;
    return {
      tenant,
      wdNum,
      site,
      total,
      jobs: (data.jobPostings as WorkdayJobPosting[]).map((j) => ({
        title: j.title,
        url: `${baseUrl}${j.externalPath}`,
        location: j.locationsText || "Unknown",
        id: j.externalPath?.split("/").pop() || j.title,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Discover Workday jobs using the JSON API with multiple tenant/site guesses.
 * Tries common patterns and falls back to broader search.
 */
async function discoverWorkdayJobs(
  companyName: string,
  careersUrl: string
): Promise<ATSResult | null> {
  const slugs = generateSlugs(companyName);

  // Step 0: If the careers URL might redirect to a Workday URL, follow redirects
  let resolvedUrl = careersUrl;
  if (!careersUrl.includes("myworkdayjobs.com")) {
    try {
      const probeRes = await fetch(careersUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (probeRes.url.includes("myworkdayjobs.com")) {
        resolvedUrl = probeRes.url;
        console.log(`[Crawl] ${companyName}: Careers URL redirected to ${resolvedUrl}`);
      }
    } catch { /* continue with original URL */ }
  }

  // Step 1: If the URL already looks like a Workday URL, extract tenant and site
  const wdUrlMatch = resolvedUrl.match(
    /([^/.]+)\.wd(\d+)\.myworkdayjobs\.com(?:\/(?:en-US\/)?([^/?]+))?/i
  );
  if (wdUrlMatch) {
    const [, tenant, wdNumStr, site] = wdUrlMatch;
    const wdNum = parseInt(wdNumStr, 10);
    // Try the extracted site first, then common alternatives
    const sites = site ? [site, ...WORKDAY_SITE_NAMES] : WORKDAY_SITE_NAMES;
    for (const s of [...new Set(sites)]) {
      const result = await tryWorkdayJsonApi(tenant, wdNum, s);
      if (result) {
        console.log(
          `[Crawl] ${companyName}: Found ${result.total} Workday jobs at ${tenant}.wd${wdNum}/${s}`
        );
        return {
          type: "workday",
          jobs: result.jobs,
        };
      }
    }
  }

  // Step 2: Try slug-based discovery across wd numbers
  const companySites = generateWorkdaySiteNames(companyName);
  for (const slug of slugs.slice(0, 3)) {
    for (const wdNum of [1, 5, 3, 2, 4, 12]) {
      // Try slug, company-specific names, then standard site names
      const sites = [slug, ...companySites, ...WORKDAY_SITE_NAMES];
      for (const site of [...new Set(sites)]) {
        const result = await tryWorkdayJsonApi(slug, wdNum, site);
        if (result) {
          console.log(
            `[Crawl] ${companyName}: Discovered Workday at ${slug}.wd${wdNum}/${site} (${result.total} jobs)`
          );
          return {
            type: "workday",
            jobs: result.jobs,
          };
        }
      }
    }
  }

  return null;
}

// ----- Alternative URL patterns -----

function generateAlternativeUrls(companyName: string, originalUrl: string): string[] {
  const urls: string[] = [];
  try {
    const u = new URL(originalUrl);
    const domain = u.hostname.replace(/^www\./, "");
    const baseDomain = domain.split(".").slice(-2).join(".");

    // Common career page patterns
    urls.push(`https://www.${baseDomain}/careers`);
    urls.push(`https://www.${baseDomain}/jobs`);
    urls.push(`https://careers.${baseDomain}`);
    urls.push(`https://jobs.${baseDomain}`);
    urls.push(`https://www.${baseDomain}/about/careers`);
    urls.push(`https://www.${baseDomain}/company/careers`);
  } catch { /* ignore */ }

  // Filter out the original URL
  return urls.filter((u) => u !== originalUrl);
}

// ----- Main crawl function -----

async function crawlCompany(
  supabase: ReturnType<typeof createServiceRoleClient> extends Promise<infer T> ? T : never,
  companyId: string,
  userId: string,
  userContext: string
): Promise<CrawlResult> {
  const { data: company, error: companyErr } = await supabase
    .from("target_companies")
    .select("*")
    .eq("id", companyId)
    .eq("user_id", userId)
    .single();

  if (companyErr || !company) throw new Error("Company not found");
  if (!company.careers_url) throw new Error("No careers URL");

  await supabase
    .from("target_companies")
    .update({ crawl_status: "crawling", crawl_error: null })
    .eq("id", companyId);

  const careersUrl = company.careers_url as string;
  const companyName = company.name as string;
  const atsType = (company.ats_type as string) || null;
  let pageText = "";

  // ===== STRATEGY 1: Smart ATS API (try multiple slugs, use stored ats_type) =====
  console.log(`[Crawl] ${companyName}: Starting smart crawl (ats_type=${atsType || "unknown"})...`);
  const atsResult = await tryATSSmart(companyName, careersUrl, atsType);
  if (atsResult && atsResult.jobs.length > 0) {
    pageText = atsResult.jobs
      .map((j) => `JOB: ${j.title}\nURL: ${j.url}\nLOCATION: ${j.location}\n---`)
      .join("\n");
    console.log(`[Crawl] ${companyName}: Got ${atsResult.jobs.length} jobs from ${atsResult.type} API`);

    // Update the ats_type if we discovered it
    if (!atsType || atsType !== atsResult.type) {
      await supabase
        .from("target_companies")
        .update({ ats_type: atsResult.type })
        .eq("id", companyId);
    }
  }

  // ===== STRATEGY 2: Workday JSON API (structured data, no browser needed) =====
  if (!pageText && (atsType === "workday" || !atsType)) {
    const wdResult = await discoverWorkdayJobs(companyName, careersUrl);
    if (wdResult && wdResult.jobs.length > 0) {
      pageText = wdResult.jobs
        .map((j) => `JOB: ${j.title}\nURL: ${j.url}\nLOCATION: ${j.location}\n---`)
        .join("\n");
      console.log(`[Crawl] ${companyName}: Got ${wdResult.jobs.length} jobs from Workday JSON API`);

      // Update the ats_type
      if (atsType !== "workday") {
        await supabase
          .from("target_companies")
          .update({ ats_type: "workday" })
          .eq("id", companyId);
      }
    }
  }

  // ===== STRATEGY 3: Headless browser on original URL =====
  if (!pageText) {
    try {
      console.log(`[Crawl] ${companyName}: Trying headless browser on ${careersUrl}...`);
      const html = await fetchWithBrowser(careersUrl);
      const text = stripHtml(html).substring(0, 80000);
      if (text.length > 100) {
        pageText = text;
      }
    } catch (browserErr) {
      console.log(`[Crawl] ${companyName}: Browser failed: ${browserErr instanceof Error ? browserErr.message : String(browserErr)}`);
    }
  }

  // ===== STRATEGY 4: Simple fetch on original URL =====
  if (!pageText) {
    try {
      console.log(`[Crawl] ${companyName}: Trying simple fetch on ${careersUrl}...`);
      const html = await fetchWithCookies(careersUrl);
      const text = stripHtml(html).substring(0, 80000);
      if (text.length > 100) {
        pageText = text;
      }
    } catch (fetchErr) {
      console.log(`[Crawl] ${companyName}: Simple fetch failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
    }
  }

  // ===== STRATEGY 5: Try alternative URL patterns =====
  if (!pageText) {
    const altUrls = generateAlternativeUrls(companyName, careersUrl);
    for (const altUrl of altUrls) {
      try {
        console.log(`[Crawl] ${companyName}: Trying alternative URL ${altUrl}...`);
        const html = await fetchWithCookies(altUrl);
        const text = stripHtml(html).substring(0, 80000);
        if (text.length > 200) {
          pageText = text;
          // Update the careers URL since we found a working one
          await supabase
            .from("target_companies")
            .update({ careers_url: altUrl })
            .eq("id", companyId);
          break;
        }
      } catch {
        // try next URL
      }
    }
  }

  // ===== STRATEGY 6: Last resort — ask Claude to find careers page =====
  if (!pageText) {
    console.log(`[Crawl] ${companyName}: All strategies failed. Asking Claude for help...`);
    try {
      const searchResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `I need to find the careers/jobs page for "${companyName}". The URL ${careersUrl} is not working. Their ATS type might be "${atsType || "unknown"}". What is the most likely correct URL for their careers page? Return ONLY the URL, nothing else.`,
        }],
      });
      const suggestedUrl = searchResponse.content?.[0]?.type === "text"
        ? searchResponse.content[0].text.trim()
        : "";

      if (suggestedUrl && suggestedUrl.startsWith("http")) {
        try {
          const html = await fetchWithBrowser(suggestedUrl);
          const text = stripHtml(html).substring(0, 80000);
          if (text.length > 200) {
            pageText = text;
            await supabase
              .from("target_companies")
              .update({ careers_url: suggestedUrl })
              .eq("id", companyId);
          }
        } catch {
          // Last resort also failed
        }
      }
    } catch {
      // Claude call failed
    }
  }

  if (!pageText || pageText.length < 50) {
    throw new Error(
      "Could not access careers page — tried ATS APIs, headless browser, alternative URLs, and AI lookup"
    );
  }

  // ===== Send to Claude for analysis and matching =====
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: CRAWL_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${userContext}\n\nCOMPANY: ${companyName}\nINDUSTRY: ${company.industry || "Unknown"}\nCAREERS PAGE URL: ${careersUrl}\n\nCAREERS PAGE CONTENT:\n${pageText}`,
      },
    ],
  });

  // Safe content extraction (fixes "Cannot read properties of undefined" bug)
  let responseText = "";
  if (response.content && response.content.length > 0 && response.content[0].type === "text") {
    responseText = response.content[0].text;
  }

  const jsonMatch = responseText.match(/\[[\s\S]*\]/);

  let matchedJobs: MatchedJob[] = [];
  if (jsonMatch) {
    try {
      matchedJobs = JSON.parse(jsonMatch[0]);
    } catch {
      matchedJobs = [];
    }
  }

  // Check if Claude needs more info
  let needsInfo: string | undefined;
  const infoRequest = matchedJobs.find((j) => j.title === "[NEED_INFO]");
  if (infoRequest) {
    needsInfo = infoRequest.match_reasoning || "Additional candidate information needed";
    matchedJobs = matchedJobs.filter((j) => j.title !== "[NEED_INFO]");
  }

  // Insert matched jobs
  let insertedCount = 0;
  for (const job of matchedJobs) {
    const jobUrl = job.url || `${careersUrl}#${encodeURIComponent(job.title)}`;
    const hash = urlHash(jobUrl);

    const { error: insertErr } = await supabase.from("jobs").upsert(
      {
        user_id: userId,
        title: job.title,
        company: companyName,
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
      },
      { onConflict: "user_id,url_hash" }
    );

    if (!insertErr) insertedCount++;
  }

  // Update company stats
  const avgConf =
    matchedJobs.length > 0
      ? matchedJobs.reduce((sum, j) => sum + j.match_confidence, 0) / matchedJobs.length
      : 0;

  await supabase
    .from("target_companies")
    .update({
      crawl_status: "completed",
      crawl_error: needsInfo ? `Needs info: ${needsInfo}` : null,
      last_crawled_at: new Date().toISOString(),
      jobs_found: matchedJobs.length,
      matched_jobs_count: insertedCount,
      avg_match_confidence: Math.round(avgConf * 100) / 100,
    })
    .eq("id", companyId);

  return {
    jobsFound: matchedJobs.length,
    matchedJobs: insertedCount,
    avgConfidence: avgConf,
    needsInfo,
  };
}

/**
 * POST /api/companies/crawl
 * Crawl career pages for given companies and find matching jobs.
 * Body: { companyIds: string[], extraContext?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { companyIds, extraContext } = body;

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json(
        { error: "companyIds array required" },
        { status: 400 }
      );
    }

    const supabase = await createServiceRoleClient();
    let userContext = await loadUserContext(supabase, auth.userId);
    if (extraContext) {
      userContext += `\n\nADDITIONAL CONTEXT FROM CANDIDATE:\n${extraContext}`;
    }

    const results: {
      companyId: string;
      status: string;
      jobsFound: number;
      matchedJobs: number;
      error?: string;
      needsInfo?: string;
    }[] = [];

    for (const companyId of companyIds) {
      try {
        const result = await crawlCompany(supabase, companyId, auth.userId, userContext);
        results.push({
          companyId,
          status: "completed",
          jobsFound: result.jobsFound,
          matchedJobs: result.matchedJobs,
          needsInfo: result.needsInfo,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        await supabase
          .from("target_companies")
          .update({ crawl_status: "failed", crawl_error: message })
          .eq("id", companyId);

        results.push({
          companyId,
          status: "failed",
          jobsFound: 0,
          matchedJobs: 0,
          error: message,
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

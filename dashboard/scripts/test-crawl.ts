/**
 * Test script: crawl specific companies directly, bypassing HTTP auth.
 * Usage: npx tsx scripts/test-crawl.ts [company_name]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

// Load .env.local manually
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

// ---- Inline the key crawl functions for testing ----

function generateSlugs(companyName: string): string[] {
  const name = companyName.trim();
  const slugs = new Set<string>();
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  slugs.add(name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  const firstWord = name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  slugs.add(firstWord);
  const words = name.split(/\s+/);
  if (words.length > 1) {
    slugs.add(words.map((w) => w.toLowerCase()).join(""));
  }
  // Greenhouse often appends "jobs" or "usjobs" to the slug
  const noSpaces = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  slugs.add(`${firstWord}jobs`);
  slugs.add(`${noSpaces}jobs`);
  slugs.add(`${firstWord}usjobs`);
  return [...slugs].filter((s) => s.length > 0);
}

function generateWorkdaySiteNames(companyName: string): string[] {
  const sites: string[] = [];
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const capitalized = companyName.split(/\s+/)[0];
  sites.push(`${slug}careers`);
  sites.push(`${slug}jobs`);
  sites.push(`${capitalized}_Careers`);
  sites.push(`${capitalized}_Jobs`);
  sites.push(`${capitalized}USA`);
  sites.push(`${capitalized}US`);
  sites.push(`DomoCareers`); // some companies use brand+Careers
  return sites;
}

const WORKDAY_SITE_NAMES = [
  "External", "Americas", "en-US/External", "en-US/Americas",
  "Careers", "Jobs", "US",
];

async function tryWorkdayJsonApi(
  tenant: string, wdNum: number, site: string, limit = 20
) {
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
    if (!data.total || data.total === 0) return null;
    const baseUrl = `https://${tenant}.wd${wdNum}.myworkdayjobs.com/en-US/${site}`;
    return {
      tenant, wdNum, site, total: data.total,
      jobs: data.jobPostings.map((j: any) => ({
        title: j.title,
        url: `${baseUrl}${j.externalPath}`,
        location: j.locationsText || "Unknown",
        id: j.externalPath?.split("/").pop() || j.title,
      })),
    };
  } catch { return null; }
}

async function tryATSApi(type: string, slug: string) {
  try {
    if (type === "greenhouse") {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.jobs?.length) return null;
      return { type: "greenhouse", count: data.jobs.length, slug };
    }
    if (type === "lever") {
      const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) return null;
      return { type: "lever", count: data.length, slug };
    }
  } catch { return null; }
  return null;
}

async function testWorkday(name: string, careersUrl: string) {
  console.log(`\n=== Testing Workday for ${name} ===`);
  const slugs = generateSlugs(name);
  console.log(`  Slugs: ${slugs.join(", ")}`);

  // Check if URL redirects to Workday
  let resolvedUrl = careersUrl;
  if (!careersUrl.includes("myworkdayjobs.com")) {
    try {
      const res = await fetch(careersUrl, {
        method: "HEAD", redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (res.url.includes("myworkdayjobs.com")) {
        resolvedUrl = res.url;
        console.log(`  Redirected to: ${resolvedUrl}`);
      }
    } catch (e) {
      console.log(`  Redirect check failed: ${e}`);
    }
  }

  // Try URL-derived tenant/site
  const wdMatch = resolvedUrl.match(/([^/.]+)\.wd(\d+)\.myworkdayjobs\.com(?:\/(?:en-US\/)?([^/?]+))?/i);
  if (wdMatch) {
    const [, tenant, wdNumStr, site] = wdMatch;
    const wdNum = parseInt(wdNumStr, 10);
    const sites = site ? [site, ...WORKDAY_SITE_NAMES] : WORKDAY_SITE_NAMES;
    for (const s of [...new Set(sites)]) {
      console.log(`  Trying ${tenant}.wd${wdNum}/${s}...`);
      const result = await tryWorkdayJsonApi(tenant, wdNum, s);
      if (result) {
        console.log(`  ✓ FOUND: ${result.total} jobs at ${tenant}.wd${wdNum}/${s}`);
        result.jobs.slice(0, 3).forEach((j: any) => console.log(`    - ${j.title} (${j.location})`));
        return result;
      }
    }
  }

  // Try slug-based discovery
  const companySites = generateWorkdaySiteNames(name);
  for (const slug of slugs.slice(0, 2)) {
    for (const wdNum of [1, 5, 3, 12]) {
      for (const site of [slug, ...companySites, "External", "Americas"]) {
        const result = await tryWorkdayJsonApi(slug, wdNum, site);
        if (result) {
          console.log(`  ✓ DISCOVERED: ${result.total} jobs at ${slug}.wd${wdNum}/${site}`);
          result.jobs.slice(0, 3).forEach((j: any) => console.log(`    - ${j.title} (${j.location})`));
          return result;
        }
      }
    }
  }

  console.log(`  ✗ No Workday jobs found`);
  return null;
}

async function testATS(name: string, atsType: string) {
  console.log(`\n=== Testing ${atsType} for ${name} ===`);
  const slugs = generateSlugs(name);
  console.log(`  Slugs: ${slugs.join(", ")}`);
  for (const slug of slugs) {
    console.log(`  Trying ${atsType}/${slug}...`);
    const result = await tryATSApi(atsType, slug);
    if (result) {
      console.log(`  ✓ FOUND: ${result.count} jobs at ${atsType}/${slug}`);
      return result;
    }
  }
  console.log(`  ✗ No ${atsType} jobs found`);
  return null;
}

async function main() {
  const targetName = process.argv[2];

  // Get failed/pending companies
  const { data: companies } = await supabase
    .from("target_companies")
    .select("id, name, careers_url, ats_type, crawl_status, crawl_error")
    .in("crawl_status", ["failed", "pending"])
    .order("name");

  if (!companies?.length) {
    console.log("No failed/pending companies found");
    return;
  }

  console.log(`Found ${companies.length} companies to test:`);
  companies.forEach((c) => console.log(`  ${c.name} (${c.ats_type || "unknown"}) - ${c.crawl_status}: ${c.crawl_error || ""}`));

  const toTest = targetName
    ? companies.filter((c) => c.name.toLowerCase().includes(targetName.toLowerCase()))
    : companies;

  for (const company of toTest) {
    if (company.ats_type === "workday") {
      await testWorkday(company.name, company.careers_url);
    } else if (company.ats_type === "greenhouse" || company.ats_type === "lever") {
      await testATS(company.name, company.ats_type);
    } else {
      // Try all
      const wdResult = await testWorkday(company.name, company.careers_url);
      if (!wdResult) {
        for (const ats of ["greenhouse", "lever"] as const) {
          const result = await testATS(company.name, ats);
          if (result) break;
        }
      }
    }
  }
}

main().catch(console.error);

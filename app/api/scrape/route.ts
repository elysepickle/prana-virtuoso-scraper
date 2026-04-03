import { NextRequest, NextResponse } from "next/server";
import { scrapePage, HotelData } from "@/lib/scraper";
import { getExistingHotels, upsertHotels } from "@/lib/airtable";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Safety margin — stop before 300s hard limit
const TIME_LIMIT_MS = 250_000; // 250 seconds

export async function GET(req: NextRequest) {
  const startTime = Date.now();

  // Verify cron secret or manual trigger
  const secret = req.nextUrl.searchParams.get("secret");
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cronSecret = process.env.CRON_SECRET;
  const isManual = req.nextUrl.searchParams.get("manual") === "true";

  if (cronSecret && secret !== cronSecret && bearerToken !== cronSecret && !isManual) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Start page — the cron or manual trigger can specify where to begin
  const startPage = parseInt(req.nextUrl.searchParams.get("start") || "1");

  try {
    console.log(`Starting Virtuoso discovery scrape from page ${startPage}...`);

    // Step 1: Get existing hotels from Airtable (by ID and by name)
    const existingHotels = await getExistingHotels();
    console.log(`Found ${existingHotels.byName.size} existing hotels in Airtable (by name)`);

    let currentPage = startPage;
    let totalPages = 999; // Will be updated after first scrape
    let allHotels: HotelData[] = [];
    let pagesScraped = 0;

    // Step 2: Scrape pages until we run out of time or pages
    while (currentPage <= totalPages) {
      const elapsed = Date.now() - startTime;
      if (elapsed > TIME_LIMIT_MS) {
        console.log(`Time limit reached (${Math.round(elapsed / 1000)}s). Stopping at page ${currentPage}.`);
        break;
      }

      console.log(`Scraping page ${currentPage}...`);
      try {
        let result = await scrapePage(currentPage);

        // Update total pages from first result
        if (pagesScraped === 0) {
          totalPages = result.totalPages;
          console.log(`Total: ${result.totalResults} hotels across ${totalPages} pages`);
        }

        // Retry once if page returned 0 hotels (hash routing may not have fired)
        if (result.hotels.length === 0 && currentPage <= totalPages) {
          const retryElapsed = Date.now() - startTime;
          if (retryElapsed < TIME_LIMIT_MS - 60000) {
            console.log(`Page ${currentPage}: 0 hotels, retrying...`);
            await new Promise((r) => setTimeout(r, 2000));
            result = await scrapePage(currentPage);
            console.log(`Page ${currentPage} retry: found ${result.hotels.length} hotels`);
          }
        }

        allHotels = allHotels.concat(result.hotels);
        pagesScraped++;
        console.log(`Page ${currentPage}: found ${result.hotels.length} hotels (${allHotels.length} total so far)`);
      } catch (err: any) {
        console.error(`Error scraping page ${currentPage}: ${err.message}`);
      }

      currentPage++;

      // Small delay between pages
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`Scraped ${pagesScraped} pages, found ${allHotels.length} hotels total`);

    // Step 3: Upsert to Airtable
    const result = await upsertHotels(allHotels, existingHotels);

    const summary = {
      success: true,
      pagesScraped,
      startPage,
      stoppedAtPage: currentPage - 1,
      nextPage: currentPage <= totalPages ? currentPage : null,
      totalPagesAvailable: totalPages,
      hotelsFound: allHotels.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      existingInAirtable: existingHotels.byName.size,
      elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
    };

    console.log("Scrape complete:", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Scrape error:", error);
    return NextResponse.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

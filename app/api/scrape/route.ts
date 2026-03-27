import { NextRequest, NextResponse } from "next/server";
import { scrapePage, HotelData } from "@/lib/scraper";
import { getExistingHotelIds, upsertHotels } from "@/lib/airtable";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Verify cron secret or manual trigger
  const secret = req.nextUrl.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  const isManual = req.nextUrl.searchParams.get("manual") === "true";

  if (cronSecret && secret !== cronSecret && !isManual) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional: scrape specific page range
  const startPage = parseInt(
    req.nextUrl.searchParams.get("start") || "1"
  );
  const endPage = parseInt(
    req.nextUrl.searchParams.get("end") || "0"
  );
  const pagesPerRun = parseInt(
    req.nextUrl.searchParams.get("pages") || "5"
  );

  try {
    console.log(`Starting Virtuoso scrape from page ${startPage}...`);

    // Step 1: Get existing hotel IDs from Airtable
    const existingIds = await getExistingHotelIds();
    console.log(`Found ${existingIds.size} existing hotels in Airtable`);

    // Step 2: Scrape first page to get total count
    const firstResult = await scrapePage(startPage);
    const totalPages = firstResult.totalPages;
    const actualEndPage = endPage > 0
      ? Math.min(endPage, totalPages)
      : Math.min(startPage + pagesPerRun - 1, totalPages);

    console.log(
      `Total: ${firstResult.totalResults} hotels across ${totalPages} pages. Scraping pages ${startPage}-${actualEndPage}`
    );

    let allHotels: HotelData[] = [...firstResult.hotels];

    // Step 3: Scrape remaining pages in this batch
    for (let page = startPage + 1; page <= actualEndPage; page++) {
      console.log(`Scraping page ${page}/${actualEndPage}...`);
      try {
        const result = await scrapePage(page);
        allHotels = allHotels.concat(result.hotels);
        console.log(
          `Page ${page}: found ${result.hotels.length} hotels`
        );
      } catch (err: any) {
        console.error(`Error scraping page ${page}: ${err.message}`);
      }

      // Small delay between pages
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`Total hotels scraped: ${allHotels.length}`);

    // Step 4: Upsert to Airtable
    const result = await upsertHotels(allHotels, existingIds);

    const summary = {
      success: true,
      pagesScraped: `${startPage}-${actualEndPage}`,
      totalPagesAvailable: totalPages,
      hotelsFound: allHotels.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      existingInAirtable: existingIds.size,
      nextPage: actualEndPage < totalPages ? actualEndPage + 1 : null,
      timestamp: new Date().toISOString(),
    };

    console.log("Scrape complete:", summary);
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Scrape error:", error);
    return NextResponse.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

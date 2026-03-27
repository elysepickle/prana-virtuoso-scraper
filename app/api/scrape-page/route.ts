import { NextRequest, NextResponse } from "next/server";
import { scrapePage } from "@/lib/scraper";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Scrape a single page - useful for testing or parallel execution
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const page = parseInt(req.nextUrl.searchParams.get("page") || "1");

  try {
    console.log(`Scraping page ${page}...`);
    const result = await scrapePage(page);

    return NextResponse.json({
      success: true,
      page,
      totalResults: result.totalResults,
      totalPages: result.totalPages,
      hotelsFound: result.hotels.length,
      hotels: result.hotels,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(`Error scraping page ${page}:`, error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

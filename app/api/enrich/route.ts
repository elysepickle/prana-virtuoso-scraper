import { NextRequest, NextResponse } from "next/server";
import { scrapeHotelDetail, assignNeighborhoodViaAI, assignPropertyTagsViaAI } from "@/lib/enricher";
import {
  getHotelsToEnrich,
  updateHotelWithEnrichment,
} from "@/lib/airtable";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Safety margin — stop processing before the 300s hard limit
const TIME_LIMIT_MS = 260_000; // 260 seconds, leaves 40s buffer

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

  try {
    // Fetch a larger pool of candidates — we'll process as many as time allows
    const hotelsToEnrich = await getHotelsToEnrich(50);
    console.log(`Found ${hotelsToEnrich.length} hotels needing enrichment`);

    if (hotelsToEnrich.length === 0) {
      return NextResponse.json({
        success: true,
        message: "All hotels are fully enriched!",
        enrichedThisRound: 0,
        timestamp: new Date().toISOString(),
      });
    }

    let enriched = 0;
    let skipped = 0;
    let errors = 0;
    const details: Array<{ hotel: string; status: string }> = [];

    // Process hotels until we run out of time
    for (const hotel of hotelsToEnrich) {
      // Check time before starting a new hotel
      const elapsed = Date.now() - startTime;
      if (elapsed > TIME_LIMIT_MS) {
        console.log(`Time limit reached (${Math.round(elapsed / 1000)}s). Stopping.`);
        break;
      }

      console.log(`Enriching: ${hotel.hotelName} (${hotel.bookingUrl})`);

      try {
        const enrichedData = await scrapeHotelDetail(hotel.bookingUrl);

        if (!enrichedData) {
          console.log(`  No data scraped for ${hotel.hotelName}`);
          skipped++;
          details.push({ hotel: hotel.hotelName, status: "no_data" });
          continue;
        }

        // AI neighborhood backfill: if Virtuoso didn't provide a neighborhood
        // and the hotel doesn't already have one, ask Claude to assign it
        if (!enrichedData.neighborhood && !hotel.currentNeighborhood) {
          const aiNeighborhood = await assignNeighborhoodViaAI(
            hotel.hotelName,
            hotel.currentCity || enrichedData.city || "",
            hotel.currentCountry || enrichedData.country || "",
            enrichedData.description
          );
          if (aiNeighborhood) {
            enrichedData.neighborhood = aiNeighborhood;
          }
        }

        // AI property tag backfill: if regex detected fewer than 3 tags,
        // ask Claude to fill in what the regex missed
        if (!enrichedData.propertyTags || enrichedData.propertyTags.length < 3) {
          const aiTags = await assignPropertyTagsViaAI(
            hotel.hotelName,
            hotel.currentCity || enrichedData.city || "",
            hotel.currentCountry || enrichedData.country || "",
            enrichedData.propertyTags || [],
            enrichedData.description,
            enrichedData.hotelFeatures
          );
          enrichedData.propertyTags = aiTags;
        }

        const updated = await updateHotelWithEnrichment(
          hotel.recordId,
          hotel,
          enrichedData
        );

        if (updated) {
          enriched++;
          details.push({ hotel: hotel.hotelName, status: "enriched" });
          console.log(`  ✓ Enriched ${hotel.hotelName}`);
        } else {
          skipped++;
          details.push({
            hotel: hotel.hotelName,
            status: "no_updates_needed",
          });
          console.log(`  - No updates needed for ${hotel.hotelName}`);
        }
      } catch (err: any) {
        errors++;
        details.push({
          hotel: hotel.hotelName,
          status: `error: ${err.message}`,
        });
        console.error(
          `  ✗ Error enriching ${hotel.hotelName}: ${err.message}`
        );
      }

      // Delay between hotels to be respectful to Virtuoso's server
      await new Promise((r) => setTimeout(r, 2000));
    }

    const totalElapsed = Math.round((Date.now() - startTime) / 1000);

    const summary = {
      success: true,
      thisRound: { enriched, skipped, errors },
      totalProcessed: enriched + skipped + errors,
      elapsedSeconds: totalElapsed,
      details,
      timestamp: new Date().toISOString(),
    };

    console.log("Enrichment round complete:", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Enrichment error:", error);
    return NextResponse.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

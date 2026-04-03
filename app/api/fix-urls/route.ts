import { NextRequest, NextResponse } from "next/server";
import Airtable from "airtable";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BASE_ID = "apphUmaIx16zr2J3y";
const TABLE_NAME = "Virtuoso Hotels";
const TIME_LIMIT_MS = 250_000;
const BROKEN_URL_PATTERN = "100-princes-street";

function getAirtable() {
  if (!process.env.AIRTABLE_API_KEY) {
    throw new Error("AIRTABLE_API_KEY environment variable is required");
  }
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
}

/**
 * Fix records that have the broken "100-princes-street" booking URL.
 * These records were enriched with data from the WRONG hotel.
 * This endpoint:
 *  1. Finds all records with the broken URL
 *  2. Wipes bad enrichment data (gallery, notes, perks from wrong hotel)
 *  3. Clears Last Enriched so they get re-enriched once they have correct URLs
 *  4. Clears the broken Booking URL so the discovery scraper can set the correct one
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  const secret = req.nextUrl.searchParams.get("secret");
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && secret !== cronSecret && bearerToken !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "true";

  try {
    const base = getAirtable().base(BASE_ID);

    // Step 1: Find all records with the broken URL
    console.log("Scanning for records with broken 100-princes-street URL...");
    const brokenRecords: { id: string; name: string }[] = [];

    await new Promise<void>((resolve, reject) => {
      base(TABLE_NAME)
        .select({
          fields: ["Hotel Name", "Booking URL"],
          pageSize: 100,
        })
        .eachPage(
          (records, fetchNextPage) => {
            for (const record of records) {
              const url = (record.get("Booking URL") as string) || "";
              if (url.includes(BROKEN_URL_PATTERN)) {
                brokenRecords.push({
                  id: record.id,
                  name: (record.get("Hotel Name") as string) || "Unknown",
                });
              }
            }
            fetchNextPage();
          },
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
    });

    console.log(`Found ${brokenRecords.length} records with broken URL`);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        brokenRecords: brokenRecords.length,
        sampleHotels: brokenRecords.slice(0, 20).map((r) => r.name),
      });
    }

    // Step 2: Wipe bad data from each record
    let fixedCount = 0;
    for (let i = 0; i < brokenRecords.length; i += 10) {
      if (Date.now() - startTime > TIME_LIMIT_MS) {
        console.log(`Time limit reached after fixing ${fixedCount} records`);
        break;
      }

      const batch = brokenRecords.slice(i, i + 10).map((r) => ({
        id: r.id,
        fields: {
          "Booking URL": "",            // Clear broken URL
          "Gallery Images": "",          // Clear wrong hotel's images
          "VIP Perks Summary": "",       // Clear wrong hotel's perks
          "Notes": "",                   // Clear wrong hotel's notes
          "Perks Notes": "",             // Clear wrong hotel's perks notes
          "Virtuoso Image URL": "",      // Clear wrong hotel's image
          "Last Enriched": "" as any,     // Reset so enricher will re-process
        },
      }));

      try {
        await base(TABLE_NAME).update(batch, { typecast: true });
        fixedCount += batch.length;
        if (fixedCount % 50 === 0) {
          console.log(`Fixed ${fixedCount} / ${brokenRecords.length} records...`);
        }
      } catch (err: any) {
        console.error(`Error fixing batch at ${i}: ${err.message}`);
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    const summary = {
      success: true,
      totalBroken: brokenRecords.length,
      fixed: fixedCount,
      remaining: brokenRecords.length - fixedCount,
      elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
    };

    console.log("Fix-URLs complete:", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Fix-URLs error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

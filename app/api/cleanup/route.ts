import { NextRequest, NextResponse } from "next/server";
import Airtable from "airtable";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BASE_ID = "apphUmaIx16zr2J3y";
const TABLE_NAME = "Virtuoso Hotels";
const TIME_LIMIT_MS = 250_000;

function getAirtable() {
  if (!process.env.AIRTABLE_API_KEY) {
    throw new Error("AIRTABLE_API_KEY environment variable is required");
  }
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
}

function normalizeHotelName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

interface HotelRecord {
  recordId: string;
  hotelId: string;
  hotelName: string;
  bookingUrl: string;
  hasPerks: boolean;
  hasNotes: boolean;
  hasGallery: boolean;
  lastEnriched: string | null;
  createdTime: string;
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();

  // Auth check
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

    // Step 1: Load ALL records with key fields
    console.log("Loading all hotel records...");
    const allRecords: HotelRecord[] = [];

    await new Promise<void>((resolve, reject) => {
      base(TABLE_NAME)
        .select({
          fields: [
            "Hotel ID",
            "Hotel Name",
            "Booking URL",
            "VIP Perks Summary",
            "Notes",
            "Gallery Images",
            "Last Enriched",
          ],
          pageSize: 100,
        })
        .eachPage(
          (records, fetchNextPage) => {
            for (const record of records) {
              allRecords.push({
                recordId: record.id,
                hotelId: (record.get("Hotel ID") as string) || "",
                hotelName: (record.get("Hotel Name") as string) || "",
                bookingUrl: (record.get("Booking URL") as string) || "",
                hasPerks: !!(record.get("VIP Perks Summary") as string),
                hasNotes: !!(record.get("Notes") as string),
                hasGallery: !!(record.get("Gallery Images") as string),
                lastEnriched: (record.get("Last Enriched") as string) || null,
                createdTime: (record as any)._rawJson?.createdTime || "",
              });
            }
            fetchNextPage();
          },
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
    });

    console.log(`Loaded ${allRecords.length} total records`);

    // Step 2: Group by normalized hotel name
    const groups = new Map<string, HotelRecord[]>();
    for (const record of allRecords) {
      const normalized = normalizeHotelName(record.hotelName);
      if (!normalized) continue;
      const group = groups.get(normalized) || [];
      group.push(record);
      groups.set(normalized, group);
    }

    // Step 3: Find duplicates and decide which to keep
    const toDelete: string[] = [];
    const toUpdate: { id: string; fields: Record<string, any> }[] = [];
    let duplicateGroups = 0;

    for (const [name, records] of groups) {
      if (records.length <= 1) continue;
      duplicateGroups++;

      // Score each record: higher = more data / better quality
      const scored = records.map((r) => {
        let score = 0;
        if (r.hasPerks) score += 3;
        if (r.hasNotes) score += 2;
        if (r.hasGallery) score += 3;
        if (r.lastEnriched) score += 2;
        // Clean booking URL (no hash fragment) is worth points
        if (r.bookingUrl && !r.bookingUrl.includes("#")) score += 2;
        // Older record gets a small bonus (likely has more manual curation)
        if (r.createdTime && r.createdTime < "2026-04-01") score += 1;
        return { record: r, score };
      });

      // Keep the highest-scored record
      scored.sort((a, b) => b.score - a.score);
      const keeper = scored[0].record;
      const dupes = scored.slice(1).map((s) => s.record);

      // Merge: get best booking URL from any record
      const bestBookingUrl = records.find(
        (r) => r.bookingUrl && !r.bookingUrl.includes("#")
      )?.bookingUrl;

      if (bestBookingUrl && bestBookingUrl !== keeper.bookingUrl) {
        toUpdate.push({
          id: keeper.recordId,
          fields: { "Booking URL": bestBookingUrl },
        });
      }

      for (const dupe of dupes) {
        toDelete.push(dupe.recordId);
      }
    }

    console.log(
      `Found ${duplicateGroups} duplicate groups, ${toDelete.length} records to delete, ${toUpdate.length} records to update`
    );

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalRecords: allRecords.length,
        duplicateGroups,
        recordsToDelete: toDelete.length,
        recordsToUpdate: toUpdate.length,
        estimatedFinalCount: allRecords.length - toDelete.length,
      });
    }

    // Step 4: Update keepers with best booking URLs
    let updatedCount = 0;
    for (let i = 0; i < toUpdate.length; i += 10) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break;
      const batch = toUpdate.slice(i, i + 10);
      try {
        await base(TABLE_NAME).update(batch, { typecast: true });
        updatedCount += batch.length;
      } catch (err: any) {
        console.error(`Error updating batch: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // Step 5: Delete duplicates in batches of 10
    let deletedCount = 0;
    for (let i = 0; i < toDelete.length; i += 10) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break;
      const batch = toDelete.slice(i, i + 10);
      try {
        await base(TABLE_NAME).destroy(batch);
        deletedCount += batch.length;
      } catch (err: any) {
        console.error(`Error deleting batch: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const summary = {
      success: true,
      totalRecords: allRecords.length,
      duplicateGroups,
      deleted: deletedCount,
      updated: updatedCount,
      remaining: allRecords.length - deletedCount,
      moreToDelete: deletedCount < toDelete.length,
      elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
    };

    console.log("Cleanup complete:", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Cleanup error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

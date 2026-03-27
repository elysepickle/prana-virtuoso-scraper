import Airtable from "airtable";
import { HotelData } from "./scraper";

const BASE_ID = "apphUmaIx16zr2J3y";
const TABLE_NAME = "Virtuoso Hotels";

// Field IDs from the Prana Airtable schema
const FIELDS = {
  hotelId: "fldmkVG94JztvkkmF",      // Hotel ID (primary)
  hotelName: "fldmupKgH8V34aVTE",     // Hotel Name
  city: "fldMVGp3vk4SZCV2C",         // City
  country: "fldutqufuPxohzRpv",       // Country
  neighborhood: "fldkFBFO8uZcBdLOr",  // Neighborhood / Area
  bookingUrl: "fldHJyzqfoGEOSBuC",    // Booking URL
  vipPerks: "fldoHIBRGMvlzFMCN",      // VIP Perks Summary
  notes: "fldxw053AVV8fBgfg",         // Notes
  perksNotes: "fldd2aOMCrSS32uAb",    // Perks Notes
  styleTags: "fldTlbVQ97oxJVyQd",     // Style Tags
  vibeTags: "fldhfqL6l6nnsQV1w",      // Vibe Tags
  imageUrl: "fldsA9mEJsfRoeDGg",      // Virtuoso Image URL
  source: "fldlCKTdcGvtERPWc",        // Source
  partnershipProgram: "fldyTYZ8wihUEOLAB", // Partnership Program
};

function getAirtable() {
  if (!process.env.AIRTABLE_API_KEY) {
    throw new Error("AIRTABLE_API_KEY environment variable is required");
  }
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
}

function generateHotelId(hotel: HotelData): string {
  // Create a consistent ID from hotel name + city
  const slug = `${hotel.hotelName}-${hotel.city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
  return slug;
}

export async function getExistingHotelIds(): Promise<Set<string>> {
  const base = getAirtable().base(BASE_ID);
  const ids = new Set<string>();

  return new Promise((resolve, reject) => {
    base(TABLE_NAME)
      .select({
        fields: ["Hotel ID"],
        pageSize: 100,
      })
      .eachPage(
        (records, fetchNextPage) => {
          records.forEach((record) => {
            const id = record.get("Hotel ID") as string;
            if (id) ids.add(id);
          });
          fetchNextPage();
        },
        (err) => {
          if (err) reject(err);
          else resolve(ids);
        }
      );
  });
}

export async function upsertHotels(
  hotels: HotelData[],
  existingIds: Set<string>
): Promise<{ created: number; updated: number; skipped: number }> {
  const base = getAirtable().base(BASE_ID);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Process in batches of 10 (Airtable API limit)
  const batchSize = 10;

  for (let i = 0; i < hotels.length; i += batchSize) {
    const batch = hotels.slice(i, i + batchSize);
    const toCreate: any[] = [];
    const toUpdate: any[] = [];

    for (const hotel of batch) {
      const hotelId = generateHotelId(hotel);

      const fields: Record<string, any> = {
        "Hotel ID": hotelId,
        "Hotel Name": hotel.hotelName,
        "City": hotel.city,
        "Country": hotel.country,
        "Source": "Virtuoso Scraper",
      };

      if (hotel.neighborhood) fields["Neighborhood / Area"] = hotel.neighborhood;
      if (hotel.bookingUrl) fields["Booking URL"] = hotel.bookingUrl;
      if (hotel.roomStyle) fields["Style Tags"] = hotel.roomStyle;
      if (hotel.vibe) fields["Vibe Tags"] = hotel.vibe;
      if (hotel.imageUrl) fields["Virtuoso Image URL"] = hotel.imageUrl;
      if (hotel.numberOfRooms) {
        fields["Notes"] = `Rooms: ${hotel.numberOfRooms}${hotel.nearestAirport ? ` | Airport: ${hotel.nearestAirport}` : ""}`;
      }
      if (hotel.hasVirtuosoExclusive) {
        fields["Perks Notes"] = "Virtuoso Exclusive offers available";
      }

      if (existingIds.has(hotelId)) {
        // Find existing record and update it
        skipped++; // For now, skip existing records to avoid overwrites
        // We could update them, but let's be conservative
      } else {
        toCreate.push({ fields });
      }
    }

    if (toCreate.length > 0) {
      try {
        await base(TABLE_NAME).create(toCreate, { typecast: true });
        created += toCreate.length;
      } catch (err: any) {
        console.error(`Error creating batch: ${err.message}`);
        // Try one by one on batch failure
        for (const record of toCreate) {
          try {
            await base(TABLE_NAME).create([record], { typecast: true });
            created++;
          } catch (innerErr: any) {
            console.error(
              `Error creating ${record.fields["Hotel Name"]}: ${innerErr.message}`
            );
            skipped++;
          }
        }
      }
    }

    // Rate limiting: Airtable allows 5 requests per second
    if (i + batchSize < hotels.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  return { created, updated, skipped };
}

export async function findRecordByHotelId(
  hotelId: string
): Promise<string | null> {
  const base = getAirtable().base(BASE_ID);

  return new Promise((resolve, reject) => {
    base(TABLE_NAME)
      .select({
        filterByFormula: `{Hotel ID} = "${hotelId}"`,
        maxRecords: 1,
      })
      .firstPage((err, records) => {
        if (err) reject(err);
        else resolve(records && records.length > 0 ? records[0].id : null);
      });
  });
}

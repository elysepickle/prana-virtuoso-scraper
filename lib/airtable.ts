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
  galleryImages: "fldKtPfJ9cokERGBN",  // Gallery Images
  lastEnriched: "fldM4XExIELuKLdyv",   // Last Enriched (dateTime)
  propertyTags: "fldAfOyINLkKVSads",     // Property Tags (multipleSelects)
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

/** Normalize a hotel name for comparison (lowercase, strip punctuation, collapse spaces) */
function normalizeHotelName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export interface ExistingHotel {
  recordId: string;
  hotelId: string;
  hotelName: string;
  normalizedName: string;
}

/**
 * Get all existing hotels from Airtable, indexed by both Hotel ID and normalized name.
 * Returns a Map keyed by normalized hotel name → record info.
 */
export async function getExistingHotels(): Promise<{
  byId: Map<string, ExistingHotel>;
  byName: Map<string, ExistingHotel>;
}> {
  const base = getAirtable().base(BASE_ID);
  const byId = new Map<string, ExistingHotel>();
  const byName = new Map<string, ExistingHotel>();

  return new Promise((resolve, reject) => {
    base(TABLE_NAME)
      .select({
        fields: ["Hotel ID", "Hotel Name"],
        pageSize: 100,
      })
      .eachPage(
        (records, fetchNextPage) => {
          records.forEach((record) => {
            const hotelId = (record.get("Hotel ID") as string) || "";
            const hotelName = (record.get("Hotel Name") as string) || "";
            const normalizedName = normalizeHotelName(hotelName);

            const entry: ExistingHotel = {
              recordId: record.id,
              hotelId,
              hotelName,
              normalizedName,
            };

            if (hotelId) byId.set(hotelId, entry);
            if (normalizedName) byName.set(normalizedName, entry);
          });
          fetchNextPage();
        },
        (err) => {
          if (err) reject(err);
          else resolve({ byId, byName });
        }
      );
  });
}

/** Backwards-compatible wrapper */
export async function getExistingHotelIds(): Promise<Set<string>> {
  const { byId } = await getExistingHotels();
  return new Set(byId.keys());
}

export async function upsertHotels(
  hotels: HotelData[],
  existingHotels: { byId: Map<string, ExistingHotel>; byName: Map<string, ExistingHotel> }
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
      const normalizedName = normalizeHotelName(hotel.hotelName);

      // Check by BOTH hotel ID and normalized name
      const existingById = existingHotels.byId.get(hotelId);
      const existingByName = existingHotels.byName.get(normalizedName);
      const existing = existingById || existingByName;

      if (existing) {
        // Hotel exists — update booking URL if we have a clean one (no hash fragment)
        if (hotel.bookingUrl && !hotel.bookingUrl.includes("#")) {
          toUpdate.push({
            id: existing.recordId,
            fields: {
              "Booking URL": hotel.bookingUrl,
              // Also update Hotel ID to the clean slug if it was a PRANA-XXXX
              ...(existing.hotelId.startsWith("PRANA-") ? { "Hotel ID": hotelId } : {}),
            },
          });
        } else {
          skipped++;
        }
      } else {
        // Truly new hotel
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

        toCreate.push({ fields });
        // Add to maps so subsequent hotels in the same run don't duplicate
        existingHotels.byId.set(hotelId, { recordId: "", hotelId, hotelName: hotel.hotelName, normalizedName });
        existingHotels.byName.set(normalizedName, { recordId: "", hotelId, hotelName: hotel.hotelName, normalizedName });
      }
    }

    // Update existing records (booking URLs)
    if (toUpdate.length > 0) {
      try {
        await base(TABLE_NAME).update(toUpdate, { typecast: true });
        updated += toUpdate.length;
      } catch (err: any) {
        console.error(`Error updating batch: ${err.message}`);
      }
    }

    if (toCreate.length > 0) {
      try {
        await base(TABLE_NAME).create(toCreate, { typecast: true });
        created += toCreate.length;
      } catch (err: any) {
        console.error(`Error creating batch: ${err.message}`);
        for (const record of toCreate) {
          try {
            await base(TABLE_NAME).create([record], { typecast: true });
            created++;
          } catch (innerErr: any) {
            console.error(`Error creating ${record.fields["Hotel Name"]}: ${innerErr.message}`);
            skipped++;
          }
        }
      }
    }

    // Rate limiting
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

// ============================================================
// ENRICHMENT: fetch hotels that need enrichment, update them
// ============================================================

const GENERIC_PERKS_PLACEHOLDER =
  "Typical VIP-style benefits may include daily breakfast for two";

// Re-enrich hotels after this many days to catch changes on Virtuoso
const RE_ENRICH_AFTER_DAYS = 30;

export interface HotelToEnrich {
  recordId: string;
  hotelName: string;
  bookingUrl: string;
  currentPerks: string;
  currentNotes: string;
  currentGallery: string;
  currentPerksNotes: string;
  currentCity: string;
  currentCountry: string;
  currentNeighborhood: string;
  currentPropertyTags: string[];
  lastEnriched: string | null;
}

/**
 * Get hotels that need enrichment.
 * Returns hotels that either:
 *  1. Have never been enriched (no Last Enriched date)
 *  2. Were last enriched more than RE_ENRICH_AFTER_DAYS ago
 * Prioritizes never-enriched hotels first, then oldest enrichment.
 */
export async function getHotelsToEnrich(
  limit: number = 10
): Promise<HotelToEnrich[]> {
  const base = getAirtable().base(BASE_ID);
  const hotels: HotelToEnrich[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RE_ENRICH_AFTER_DAYS);

  return new Promise((resolve, reject) => {
    base(TABLE_NAME)
      .select({
        fields: [
          "Hotel Name",
          "Booking URL",
          "VIP Perks Summary",
          "Notes",
          "Gallery Images",
          "Perks Notes",
          "Last Enriched",
          "City",
          "Country",
          "Neighborhood / Area",
          "Property Tags",
        ],
        pageSize: 100,
      })
      .eachPage(
        (records, fetchNextPage) => {
          for (const record of records) {
            const bookingUrl = record.get("Booking URL") as string;
            if (!bookingUrl) continue;

            const lastEnriched = record.get("Last Enriched") as string | null;
            const currentCity = (record.get("City") as string) || "";
            const currentNeighborhood = (record.get("Neighborhood / Area") as string) || "";
            const currentPropertyTags = (record.get("Property Tags") as string[]) || [];

            // Include if never enriched OR enriched before the cutoff OR missing city/neighborhood/tags
            const neverEnriched = !lastEnriched;
            const staleEnrichment =
              lastEnriched && new Date(lastEnriched) < cutoffDate;
            const missingCity = !currentCity;
            const missingNeighborhood = !currentNeighborhood;
            const missingTags = currentPropertyTags.length === 0;

            if (neverEnriched || staleEnrichment || missingCity || missingNeighborhood || missingTags) {
              hotels.push({
                recordId: record.id,
                hotelName: (record.get("Hotel Name") as string) || "",
                bookingUrl,
                currentPerks: (record.get("VIP Perks Summary") as string) || "",
                currentNotes: (record.get("Notes") as string) || "",
                currentGallery: (record.get("Gallery Images") as string) || "",
                currentPerksNotes: (record.get("Perks Notes") as string) || "",
                currentCity,
                currentCountry: (record.get("Country") as string) || "",
                currentNeighborhood,
                currentPropertyTags,
                lastEnriched: lastEnriched || null,
              });
            }
          }
          fetchNextPage();
        },
        (err) => {
          if (err) reject(err);
          else {
            // Sort: missing city first, then never-enriched (by missing data score), then stale by oldest
            hotels.sort((a, b) => {
              // Missing city gets highest priority
              if (!a.currentCity && b.currentCity) return -1;
              if (a.currentCity && !b.currentCity) return 1;

              // Never-enriched get next priority
              if (!a.lastEnriched && b.lastEnriched) return -1;
              if (a.lastEnriched && !b.lastEnriched) return 1;

              // Both never enriched: sort by most missing data
              if (!a.lastEnriched && !b.lastEnriched) {
                const scoreA =
                  (a.currentPerks ? 0 : 2) +
                  (a.currentGallery ? 0 : 1) +
                  (a.currentNotes ? 0 : 1) +
                  (a.currentNeighborhood ? 0 : 1) +
                  (a.currentPropertyTags.length > 0 ? 0 : 1);
                const scoreB =
                  (b.currentPerks ? 0 : 2) +
                  (b.currentGallery ? 0 : 1) +
                  (b.currentNotes ? 0 : 1) +
                  (b.currentNeighborhood ? 0 : 1) +
                  (b.currentPropertyTags.length > 0 ? 0 : 1);
                return scoreB - scoreA;
              }

              // Both stale: oldest enrichment first
              return new Date(a.lastEnriched!).getTime() - new Date(b.lastEnriched!).getTime();
            });
            resolve(hotels.slice(0, limit));
          }
        }
      );
  });
}

/**
 * Helper: check if scraped value is meaningfully different from current value.
 * Ignores whitespace differences and trailing form/UI junk text.
 */
function isDifferent(current: string, scraped: string): boolean {
  if (!current && !scraped) return false;
  if (!current && scraped) return true;
  if (current && !scraped) return false; // Don't overwrite with empty

  // Normalize: trim, collapse whitespace
  const norm = (s: string) =>
    s.replace(/\s+/g, " ").trim().substring(0, 500).toLowerCase();
  return norm(current) !== norm(scraped);
}

/**
 * Update a hotel record with enriched data.
 * Compares scraped data vs existing and updates when different.
 * Always stamps Last Enriched to track when we last checked.
 */
export async function updateHotelWithEnrichment(
  recordId: string,
  currentData: HotelToEnrich,
  enriched: {
    vipPerks?: string;
    description?: string;
    advisorTip?: string;
    hotelFeatures?: string;
    galleryImages?: string[];
    roomTypes?: string;
    checkInOut?: string;
    cancellationPolicy?: string;
    experiences?: string;
    address?: string;
    nearestAirport?: string;
    numberOfRooms?: string;
    roomStyle?: string;
    vibe?: string;
    city?: string;
    country?: string;
    neighborhood?: string;
    propertyTags?: string[];
  }
): Promise<boolean> {
  const base = getAirtable().base(BASE_ID);
  const updates: Record<string, any> = {};

  // Always stamp Last Enriched so we know when we last checked
  updates["Last Enriched"] = new Date().toISOString();

  // Backfill City/Country if currently empty
  if (!currentData.currentCity && enriched.city) {
    updates["City"] = enriched.city;
  }
  if (!currentData.currentCountry && enriched.country) {
    updates["Country"] = enriched.country;
  }

  // VIP Perks: update if scraped is different from current (or current is generic/empty)
  if (enriched.vipPerks) {
    const isGeneric = currentData.currentPerks.includes(GENERIC_PERKS_PLACEHOLDER);
    if (!currentData.currentPerks || isGeneric || isDifferent(currentData.currentPerks, enriched.vipPerks)) {
      updates["VIP Perks Summary"] = enriched.vipPerks;
    }
  }

  // Notes: build from description + features and compare
  const noteParts: string[] = [];
  if (enriched.description) noteParts.push(enriched.description);
  if (enriched.hotelFeatures) noteParts.push(`\n\nFeatures: ${enriched.hotelFeatures}`);
  if (enriched.roomTypes) noteParts.push(`\nRoom Types: ${enriched.roomTypes}`);
  if (enriched.numberOfRooms) noteParts.push(`\nRooms: ${enriched.numberOfRooms}`);
  if (enriched.nearestAirport) noteParts.push(`\nAirport: ${enriched.nearestAirport}`);
  if (enriched.checkInOut) noteParts.push(`\n${enriched.checkInOut}`);
  if (noteParts.length > 0) {
    const newNotes = noteParts.join("").substring(0, 5000);
    if (!currentData.currentNotes || currentData.currentNotes.length < 20 || isDifferent(currentData.currentNotes, newNotes)) {
      updates["Notes"] = newNotes;
    }
  }

  // Perks Notes: build from advisor tip + cancellation and compare
  if (enriched.advisorTip || enriched.cancellationPolicy) {
    const perksParts: string[] = [];
    if (enriched.advisorTip) perksParts.push(enriched.advisorTip);
    if (enriched.cancellationPolicy) perksParts.push(`\n\nCancellation: ${enriched.cancellationPolicy}`);
    const newPerksNotes = perksParts.join("").substring(0, 3000);
    if (isDifferent(currentData.currentPerksNotes, newPerksNotes)) {
      updates["Perks Notes"] = newPerksNotes;
    }
  }

  // Gallery Images: update if new images are different/more
  if (enriched.galleryImages && enriched.galleryImages.length > 0) {
    const newGallery = enriched.galleryImages.join("\n");
    if (!currentData.currentGallery || isDifferent(currentData.currentGallery, newGallery)) {
      updates["Gallery Images"] = newGallery;
    }
  }

  // Neighborhood: update if scraped and currently empty or different
  if (enriched.neighborhood) {
    if (!currentData.currentNeighborhood || isDifferent(currentData.currentNeighborhood, enriched.neighborhood)) {
      updates["Neighborhood / Area"] = enriched.neighborhood;
    }
  }

  // Property Tags: update if scraped tags are available and different from current
  if (enriched.propertyTags && enriched.propertyTags.length > 0) {
    const currentTagSet = new Set(currentData.currentPropertyTags || []);
    const newTagSet = new Set(enriched.propertyTags);
    // Update if tags are different (new ones found or changed)
    const hasNewTags = enriched.propertyTags.some(t => !currentTagSet.has(t));
    if (currentData.currentPropertyTags.length === 0 || hasNewTags) {
      // Merge: keep existing tags and add new ones
      const merged = Array.from(new Set([...currentData.currentPropertyTags, ...enriched.propertyTags]));
      updates["Property Tags"] = merged;
    }
  }

  // Style/Vibe: always update if scraped has a value
  if (enriched.roomStyle) updates["Style Tags"] = enriched.roomStyle;
  if (enriched.vibe) updates["Vibe Tags"] = enriched.vibe;

  try {
    await base(TABLE_NAME).update(
      [{ id: recordId, fields: updates }],
      { typecast: true }
    );
    // Return true if we updated anything beyond just the timestamp
    return Object.keys(updates).length > 1;
  } catch (err: any) {
    console.error(`Error updating ${currentData.hotelName}: ${err.message}`);
    return false;
  }
}

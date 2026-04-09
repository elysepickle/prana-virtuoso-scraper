import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

export interface EnrichedHotelData {
  // VIP Perks - the specific Virtuoso amenities
  vipPerks: string;
  // Hotel description from "About Us" section
  description: string;
  // "Best of the Best" advisor recommendation
  advisorTip: string;
  // Structured amenities/features list
  hotelFeatures: string;
  // Gallery image URLs (high-res h500 versions)
  galleryImages: string[];
  // Room types available
  roomTypes: string;
  // Check-in/check-out times
  checkInOut: string;
  // Cancellation policy
  cancellationPolicy: string;
  // Experiences tags (e.g., "City Life, Landmarks, Wellness")
  experiences: string;
  // Full address
  address: string;
  // Nearest airport with distance
  nearestAirport: string;
  // Number of rooms (confirm/update)
  numberOfRooms: string;
  // Room style (confirm/update)
  roomStyle: string;
  // Vibe (confirm/update)
  vibe: string;
  // City extracted from detail page location
  city?: string;
  // Country extracted from detail page location
  country?: string;
  // Neighborhood / area name from Virtuoso page
  neighborhood?: string;
  // Rich property tags derived from features, description, and experiences
  propertyTags?: string[];
}

export async function scrapeHotelDetail(
  hotelUrl: string
): Promise<EnrichedHotelData | null> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1470, height: 813 },
    executablePath: await chromium.executablePath(),
    headless: true,
  } as any);

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Navigate to the hotel detail page
    await page.goto(hotelUrl, { waitUntil: "networkidle2", timeout: 45000 });

    // Wait for the article content to load
    await page
      .waitForSelector("article, .hotel-detail, main", { timeout: 15000 })
      .catch(() => {});

    // Give time for dynamic content
    await new Promise((r) => setTimeout(r, 3000));

    const data = await page.evaluate(() => {
      const text = document.body.innerText || "";

      // === VIP PERKS ===
      // Extract Virtuoso Amenities section
      let vipPerks = "";
      const amenitiesMatch = text.match(
        /Virtuoso Amenities[^:]*:\s*([\s\S]*?)(?=(?:Enter Dates|Read More|PROPERTY SIZE|$))/i
      );
      if (amenitiesMatch) {
        vipPerks = amenitiesMatch[1]
          .trim()
          .split("\n")
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0)
          .join("; ");
      }

      // === HOTEL DESCRIPTION ===
      let description = "";
      const aboutMatch = text.match(
        /About Us\s*([\s\S]*?)(?=(?:View More|Best of the Best|Health & Safety|Location|$))/i
      );
      if (aboutMatch) {
        description = aboutMatch[1]
          .trim()
          .split("\n")
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 5)
          .join(" ")
          .substring(0, 2000);
      }

      // === ADVISOR TIP ===
      let advisorTip = "";
      const bestMatch = text.match(
        /Best of the Best\s*([\s\S]*?)(?=(?:Advisor Tip|Health & Safety|Location|$))/i
      );
      if (bestMatch) {
        advisorTip = bestMatch[1].trim().substring(0, 1000);
      }
      const tipMatch = text.match(
        /Advisor Tip\s*([\s\S]*?)(?=(?:Health & Safety|Location|$))/i
      );
      if (tipMatch) {
        const tip = tipMatch[1].trim().substring(0, 500);
        advisorTip = advisorTip ? `${advisorTip}\n\nAdvisor Tip: ${tip}` : tip;
      }

      // === HOTEL FEATURES ===
      let hotelFeatures = "";
      const featuresMatch = text.match(
        /Hotel Features\s*At the Hotel\s*([\s\S]*?)(?=(?:About Us|In Your Room|$))/i
      );
      const inRoomMatch = text.match(
        /In Your Room\s*([\s\S]*?)(?=(?:About Us|Recreation|$))/i
      );
      const recreationMatch = text.match(
        /Recreation\s*([\s\S]*?)(?=(?:In Your Room|About Us|$))/i
      );

      const featureParts: string[] = [];
      if (featuresMatch) {
        const items = featuresMatch[1]
          .trim()
          .split("\n")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 1 && s.length < 80);
        if (items.length > 0)
          featureParts.push("At the Hotel: " + items.join(", "));
      }
      if (recreationMatch) {
        const items = recreationMatch[1]
          .trim()
          .split("\n")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 1 && s.length < 80);
        if (items.length > 0)
          featureParts.push("Recreation: " + items.join(", "));
      }
      if (inRoomMatch) {
        const items = inRoomMatch[1]
          .trim()
          .split("\n")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 1 && s.length < 80);
        if (items.length > 0)
          featureParts.push("In Room: " + items.join(", "));
      }
      hotelFeatures = featureParts.join(" | ");

      // === GALLERY IMAGES ===
      const images = Array.from(
        document.querySelectorAll(
          'img[src*="media.virtuoso.com/m/Images/Brochures"]'
        )
      );
      const galleryImages = images
        .map((img) => {
          const src = (img as HTMLImageElement).src;
          // Convert to h500 (high-res) version
          return src.replace(/\/h\d+\//, "/h500/");
        })
        .filter(
          (url, idx, arr) => arr.indexOf(url) === idx // deduplicate
        );

      // === ROOM TYPES ===
      let roomTypes = "";
      const roomEls = document.querySelectorAll(
        '[class*="room-type"], [class*="suite"]'
      );
      if (roomEls.length === 0) {
        // Fallback: parse from "Guest Rooms & Suites" section
        const roomMatch = text.match(
          /Guest Rooms & Suites\s*([\s\S]*?)(?=(?:Facts & Policies|Terms|$))/i
        );
        if (roomMatch) {
          // Extract room names - they appear as headers before amenity lists
          const lines = roomMatch[1].split("\n").map((s: string) => s.trim());
          const roomNames: string[] = [];
          for (const line of lines) {
            if (
              line.length > 3 &&
              line.length < 80 &&
              !line.includes("Bathrobe") &&
              !line.includes("Hair Dryer") &&
              !line.includes("Mini Bar") &&
              !line.includes("Safe") &&
              !line.includes("Slippers") &&
              !line.includes("Air Conditioning") &&
              !line.includes("Internet") &&
              !line.includes("View More") &&
              !line.includes("Jacuzzi") &&
              !line.includes("Balcony") &&
              !line.includes("Non-Smoking") &&
              !line.includes("Total") &&
              !line.includes("Records") &&
              !line.match(/^[\d\s«‹›»]+$/)
            ) {
              // Deduplicate - room names appear twice (as header and in expanded view)
              if (!roomNames.includes(line)) {
                roomNames.push(line);
              }
            }
          }
          roomTypes = roomNames.join(", ");
        }
      }

      // === FACTS ===
      let checkInOut = "";
      const checkInMatch = text.match(/Check-In Time\s*(\d+:\d+ [AP]M)/);
      const checkOutMatch = text.match(/Check-Out Time\s*(\d+:\d+ [AP]M)/);
      if (checkInMatch || checkOutMatch) {
        checkInOut = `Check-in: ${checkInMatch?.[1] || "N/A"}, Check-out: ${checkOutMatch?.[1] || "N/A"}`;
      }

      let cancellationPolicy = "";
      const cancelMatch = text.match(
        /Cancellation Policy\s*([\s\S]*?)(?=(?:Accepted Forms|Terms & Conditions|$))/i
      );
      if (cancelMatch) {
        cancellationPolicy = cancelMatch[1]
          .trim()
          .split("\n")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 3)
          .join(" ")
          .substring(0, 500);
      }

      let experiences = "";
      const expMatch = text.match(/Experiences\s*([\s\S]*?)(?=Vibe)/i);
      if (expMatch) {
        experiences = expMatch[1].trim().substring(0, 200);
      }

      // === LOCATION ===
      let address = "";
      const addrMatch = text.match(
        /Address\s*([\s\S]*?)(?=(?:Nearest Airport|Neighborhood|$))/i
      );
      if (addrMatch) {
        address = addrMatch[1]
          .trim()
          .split("\n")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 1)
          .join(", ")
          .substring(0, 300);
      }

      // === NEIGHBORHOOD ===
      // Virtuoso pages show neighborhood as a short label after the heading.
      // Some have a clean name ("Spagna", "Trastevere"), others have a short
      // descriptive phrase ("Near the Spanish Steps"). We want either — the AI
      // can work with both for location-based recommendations.
      let neighborhood = "";
      const hoodMatch = text.match(
        /Neighborhood\s*([\s\S]*?)(?=(?:Nearest Airport|Guest Rooms|Enter Dates|Address|$))/i
      );
      if (hoodMatch) {
        // Take just the first line — that's the neighborhood label
        let raw = hoodMatch[1].trim().split("\n")[0].trim();
        // Strip leading punctuation or numbering artifacts
        raw = raw.replace(/^[\.\,\:\;\-\s]+/, "").trim();
        // If it's unreasonably long (>80 chars), it's probably page junk —
        // try to extract just a meaningful opening phrase
        if (raw.length > 80) {
          // Cut at the first sentence boundary or period
          const sentenceEnd = raw.match(/^(.{10,75}?)[\.;,](?:\s|$)/);
          raw = sentenceEnd ? sentenceEnd[1].trim() : raw.substring(0, 80).trim();
        }
        // Skip if it looks like UI text or irrelevant content
        const junkPatterns = /^(its \d|featuring|book now|enter dates|view |click|rooms feature)/i;
        if (raw.length >= 2 && !junkPatterns.test(raw)) {
          neighborhood = raw;
        }
      }

      let nearestAirport = "";
      const airportMatch = text.match(
        /Nearest Airport\s*([\s\S]*?)(?=(?:Guest Rooms|Enter Dates|$))/i
      );
      if (airportMatch) {
        nearestAirport = airportMatch[1]
          .trim()
          .split("\n")[0]
          .trim()
          .substring(0, 200);
      }

      // Property facts
      let numberOfRooms = "";
      const roomsMatch = text.match(/Number of Rooms\s*(\d+)/);
      if (roomsMatch) numberOfRooms = roomsMatch[1];

      let roomStyle = "";
      const styleMatch = text.match(
        /Room Style\s*(Contemporary|Classic|Indigenous|Eclectic)/
      );
      if (styleMatch) roomStyle = styleMatch[1];

      let vibe = "";
      const vibeMatch = text.match(
        /Vibe\s*(Sophisticated|Zen|Casual|Hip)/
      );
      if (vibeMatch) vibe = vibeMatch[1];

      // === CITY & COUNTRY ===
      // Detail pages show location like "Rome, Italy" or "Edinburgh, Scotland, United Kingdom"
      let city = "";
      let country = "";
      // Try parsing from the page header area — often appears near hotel name
      const locMatch = text.match(/Location\s*([\s\S]*?)(?=(?:Neighborhood|Nearest Airport|Address|$))/i);
      if (locMatch) {
        const locParts = locMatch[1].trim().split("\n")[0].split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 0);
        if (locParts.length >= 2) {
          city = locParts[0];
          country = locParts[locParts.length - 1];
        }
      }
      // Fallback: parse from address if it has city, country pattern
      if (!city && address) {
        const addrParts = address.split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 0);
        if (addrParts.length >= 2) {
          city = addrParts[addrParts.length - 2] || "";
          country = addrParts[addrParts.length - 1] || "";
        }
      }

      // === GENERATE RICH PROPERTY TAGS ===
      // Analyze all scraped text to build a comprehensive tag array.
      // Uses STRICT matching — requires strong signals (multiple keywords,
      // specific phrases, or feature-list mentions) to avoid false positives.
      const allContent = [description, hotelFeatures, experiences, advisorTip, roomTypes, vipPerks].join(" ").toLowerCase();
      // Features/experiences sections are higher-signal than description prose
      const featuresContent = [hotelFeatures, experiences, vipPerks].join(" ").toLowerCase();
      const tags: string[] = [];

      // Helper: count how many of the given patterns match
      const countMatches = (content: string, patterns: RegExp[]): number =>
        patterns.filter(p => p.test(content)).length;

      // === SETTING & LOCATION (strictest — most prone to false positives) ===

      // Beachfront: must have explicit beach-setting language, not just "ocean view" from a city rooftop
      if (allContent.match(/\b(beachfront|oceanfront|on the beach|beach resort|seaside resort|private beach|beach club)\b/)) {
        tags.push("Beachfront");
      } else if (countMatches(allContent, [/\bbeach\b/, /\bocean view\b/, /\bseaside\b/, /\bbay view\b/]) >= 2) {
        tags.push("Beachfront");
      }

      // Mountain: must be about the mountain SETTING, not just mentioning a mountain view from a city hotel
      if (allContent.match(/\b(mountain resort|alpine|ski resort|mountain retreat|in the mountains|mountain lodge|hillside retreat|hilltop retreat)\b/)) {
        tags.push("Mountain");
      } else if (countMatches(allContent, [/\bmountain\b/, /\balpine\b/, /\bski\b/, /\bslopes\b/, /\bhillside\b/]) >= 2) {
        tags.push("Mountain");
      }

      // Island: must actually be ON an island
      if (allContent.match(/\b(private island|island resort|on the island|island retreat|atoll|island getaway)\b/)) {
        tags.push("Island");
      }

      // Countryside: must be a rural/estate setting, not just mentioning a vineyard dinner
      if (allContent.match(/\b(countryside|country estate|rural|agriturismo|farmhouse|country house|in the countryside)\b/)) {
        tags.push("Countryside");
      } else if (countMatches(allContent, [/\bvineyard\b/, /\bestate\b/, /\brural\b/, /\bfarm\b/, /\bacres of\b/]) >= 2) {
        tags.push("Countryside");
      }

      // City Center: strong urban-core signals
      if (allContent.match(/\b(city center|city centre|downtown|in the heart of|steps from .{0,20}(square|piazza|plaza|boulevard)|central location|centrally located)\b/)) {
        tags.push("City Center");
      }

      // Secluded: must be about isolation/remoteness, not just marketing fluff like "private balcony"
      if (allContent.match(/\b(secluded|remote location|private island|hideaway|tucked away|off the beaten|middle of nowhere|isolated)\b/)) {
        tags.push("Secluded");
      }

      // Rooftop/Views: needs a rooftop venue or panoramic feature, not just "terrace" (too common)
      if (allContent.match(/\b(rooftop bar|rooftop pool|rooftop restaurant|rooftop terrace|panoramic view|360.degree|skyline view|rooftop lounge)\b/)) {
        tags.push("Rooftop/Views");
      }

      // Garden Setting: must have significant garden/botanical focus
      if (allContent.match(/\b(botanical garden|tropical garden|garden setting|lush garden|acres of garden|landscaped garden|garden estate|set in .{0,15}garden)\b/)) {
        tags.push("Garden Setting");
      } else if (countMatches(allContent, [/\bgarden\b/, /\bbotanical\b/, /\bcourtyard garden\b/, /\blush\b/]) >= 2) {
        tags.push("Garden Setting");
      }

      // Waterfront: lake/river/canal-side (distinct from beachfront)
      if (allContent.match(/\b(lakeside|lake view|on the lake|riverfront|river view|on the river|canalside|canal view|lakefront|waterfront(?! .*city))\b/)) {
        tags.push("Waterfront");
      }

      // Clifftop: dramatic elevated coastal/volcanic setting
      if (allContent.match(/\b(clifftop|cliff.?side|perched (?:on|above|atop)|caldera|cliffside)\b/)) {
        tags.push("Clifftop");
      }

      // === EXPERIENCE TYPE (moderate strictness) ===

      // Spa & Wellness: only if spa is a notable feature, not just "spa bath" in room
      if (featuresContent.match(/\bspa\b/) || allContent.match(/\b(wellness center|wellness centre|spa & wellness|full.service spa|signature spa|hammam|thermal bath|hydrotherapy|spa treatment|spa facility|spa suite)\b/)) {
        tags.push("Spa & Wellness");
      }

      // Romantic: needs explicit romantic positioning
      if (allContent.match(/\b(romantic|honeymoon|couples retreat|anniversary|lovers|romance package)\b/)) {
        tags.push("Romantic");
      }

      // Family-Friendly: must have actual family facilities
      if (allContent.match(/\b(kids club|kids' club|children's program|family-friendly|family friendly|playground|babysitting|family suite|children welcome|family program)\b/)) {
        tags.push("Family-Friendly");
      } else if (countMatches(allContent, [/\bfamil(y|ies)\b/, /\bkids\b/, /\bchildren\b/]) >= 2) {
        tags.push("Family-Friendly");
      }

      // Golf: must have golf on-site or be known as a golf destination
      if (allContent.match(/\b(golf course|golf club|putting green|driving range|golf resort|championship golf|hole golf)\b/)) {
        tags.push("Golf");
      }

      // Adventure: must offer actual adventure activities
      if (countMatches(allContent, [/\bhiking\b/, /\bdiving\b/, /\bsnorkeling\b/, /\bsafari\b/, /\bexpedition\b/, /\bkayak\b/, /\brafting\b/, /\bzip.?line\b/, /\brock climbing\b/, /\bsurfing\b/]) >= 2) {
        tags.push("Adventure");
      } else if (allContent.match(/\b(safari|expedition|adventure resort|adventure activities)\b/)) {
        tags.push("Adventure");
      }

      // Foodie/Culinary: must have notable culinary focus
      if (allContent.match(/\b(michelin|cooking class|culinary program|wine cellar|wine tasting|sommelier|gastronom|farm.to.table|chef's table)\b/)) {
        tags.push("Foodie/Culinary");
      } else if (countMatches(allContent, [/\bfine dining\b/, /\bculinary\b/, /\bwine\b/, /\btasting\b/, /\brestaurant\b/]) >= 3) {
        tags.push("Foodie/Culinary");
      }

      // Arts & Culture: must have dedicated cultural programming or be in a cultural landmark
      if (allContent.match(/\b(art collection|art gallery|museum|cultural program|art.inspired|arts district|archaeological|cultural heritage)\b/)) {
        tags.push("Arts & Culture");
      } else if (countMatches(allContent, [/\bart\b/, /\bgallery\b/, /\bmuseum\b/, /\bcultural\b/]) >= 2) {
        tags.push("Arts & Culture");
      }

      // Nightlife & Social: must have actual nightlife venues
      if (allContent.match(/\b(rooftop bar|cocktail bar|lounge bar|nightclub|live music|dj|buzzy|vibrant nightlife|social scene)\b/)) {
        tags.push("Nightlife & Social");
      } else if (countMatches(allContent, [/\bbar\b/, /\blounge\b/, /\bcocktail\b/, /\bnightlife\b/]) >= 2) {
        tags.push("Nightlife & Social");
      }

      // === PROPERTY STYLE ===

      // Boutique: room count is the strongest signal; or explicit "boutique" branding
      if (Number(numberOfRooms) > 0 && Number(numberOfRooms) <= 50) {
        tags.push("Boutique");
      } else if (allContent.match(/\b(boutique hotel|boutique property|intimate hotel)\b/)) {
        tags.push("Boutique");
      }

      // Historic/Heritage: must reference actual historic architecture/era
      if (allContent.match(/\b(palazzo|castle|château|chateau|manor house|mansion|18th.century|19th.century|17th.century|16th.century|15th.century|heritage building|historic landmark|restored .{0,20}(building|palace|hotel|villa)|listed building)\b/)) {
        tags.push("Historic/Heritage");
      } else if (countMatches(allContent, [/\bhistoric\b/, /\bheritage\b/, /\bcentury\b/, /\brestored\b/]) >= 2) {
        tags.push("Historic/Heritage");
      }

      // Design-Forward: must emphasize design as a core identity
      if (allContent.match(/\b(design hotel|design.forward|architect.designed|contemporary design|minimalist design|avant.garde|design district|iconic design)\b/)) {
        tags.push("Design-Forward");
      } else if (countMatches(allContent, [/\barchitect\b/, /\bcontemporary\b/, /\bminimalist\b/, /\bdesign\b/]) >= 2) {
        tags.push("Design-Forward");
      }

      // All-Inclusive: very specific
      if (allContent.match(/\b(all.inclusive|all inclusive)\b/)) tags.push("All-Inclusive");

      // Resort: must be an actual resort property, not just have "grounds"
      if (allContent.match(/\b(resort|resort & spa|beach resort|golf resort|ski resort|island resort|luxury resort)\b/)) {
        tags.push("Resort");
      }

      // Villa/Residence Style: must offer villa or residence-style accommodation
      if (allContent.match(/\b(private villa|villa accommodation|residence style|serviced apartment|villa suite|pool villa|villa resort)\b/)) {
        tags.push("Villa/Residence Style");
      }

      // === AMENITIES & FEATURES (check features sections first for higher signal) ===

      // Pool: look in features primarily, but accept strong description signals too
      if (featuresContent.match(/\bpool\b/) || allContent.match(/\b(infinity pool|rooftop pool|outdoor pool|indoor pool|plunge pool|swimming pool|pool deck|pool area|heated pool)\b/)) {
        tags.push("Pool");
      }

      // Fitness: must be in features or explicitly described
      if (featuresContent.match(/\b(fitness|gym|yoga)\b/) || allContent.match(/\b(fitness center|fitness centre|state.of.the.art gym|yoga studio|pilates|personal trainer)\b/)) {
        tags.push("Fitness");
      }

      // Pet-Friendly: very specific
      if (allContent.match(/\b(pet.friendly|pet friendly|dogs? welcome|pets? (allowed|welcome)|pet amenities|pet program)\b/)) {
        tags.push("Pet-Friendly");
      }

      // Business: must have actual business facilities
      if (allContent.match(/\b(business center|business centre|meeting room|conference room|conference facilit|boardroom|co.?working space)\b/)) {
        tags.push("Business");
      }

      // Adults Only: very specific
      if (allContent.match(/\b(adults.only|adult.only|adults only|no children|18\+|over 18)\b/)) tags.push("Adults Only");

      // Eco/Sustainable: must have genuine sustainability commitment
      if (allContent.match(/\b(sustainable|sustainability|eco.friendly|eco.resort|solar.powered|carbon neutral|green certified|leed|conservation program|eco.conscious)\b/)) {
        tags.push("Eco/Sustainable");
      }

      // Deduplicate
      const uniqueTags = tags.filter((t, i) => tags.indexOf(t) === i);

      return {
        vipPerks,
        description,
        advisorTip,
        hotelFeatures,
        galleryImages,
        roomTypes,
        checkInOut,
        cancellationPolicy,
        experiences,
        address,
        nearestAirport,
        neighborhood,
        numberOfRooms,
        roomStyle,
        vibe,
        city,
        country,
        propertyTags: uniqueTags,
      };
    });

    return data;
  } catch (err: any) {
    console.error(`Error scraping detail page ${hotelUrl}: ${err.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * AI-powered neighborhood assignment.
 * Uses Claude Haiku to determine the neighborhood/area for a hotel
 * based on its name, city, country, and description.
 * Falls back gracefully if no API key is available.
 */
export async function assignNeighborhoodViaAI(
  hotelName: string,
  city: string,
  country: string,
  description?: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[AI Neighborhood] No ANTHROPIC_API_KEY, skipping AI assignment");
    return "";
  }

  try {
    const descSnippet = description ? description.substring(0, 300) : "";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [
          {
            role: "user",
            content: `What neighborhood or area is the hotel "${hotelName}" located in within ${city}, ${country}? Reply with ONLY the neighborhood/area name — no explanation, no punctuation, no quotes. If it's a well-known named neighborhood, use that (e.g. "Trastevere", "Spagna", "Monti"). If not, give a short location description (e.g. "Near Piazza del Popolo", "Historic Center"). If you genuinely don't know, reply with just "Unknown".${descSnippet ? `\n\nHotel description: ${descSnippet}` : ""}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`[AI Neighborhood] API error: ${response.status}`);
      return "";
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text?.trim() || "";

    // Validate the response
    if (!text || text.toLowerCase() === "unknown" || text.length > 80) {
      return "";
    }

    console.log(`[AI Neighborhood] ${hotelName} → ${text}`);
    return text;
  } catch (err: any) {
    console.error(`[AI Neighborhood] Error for ${hotelName}: ${err.message}`);
    return "";
  }
}

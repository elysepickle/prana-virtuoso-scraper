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
      let neighborhood = "";
      const hoodMatch = text.match(
        /Neighborhood\s*([\s\S]*?)(?=(?:Nearest Airport|Guest Rooms|Enter Dates|Address|$))/i
      );
      if (hoodMatch) {
        neighborhood = hoodMatch[1]
          .trim()
          .split("\n")[0]
          .trim()
          .substring(0, 200);
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
      // Analyze all scraped text to build a comprehensive tag array
      const allContent = [description, hotelFeatures, experiences, advisorTip, roomTypes, vipPerks].join(" ").toLowerCase();
      const tags: string[] = [];

      // Setting & Location
      if (allContent.match(/beach|oceanfront|beachfront|seaside|waterfront|bay view|ocean view/)) tags.push("Beachfront");
      if (allContent.match(/mountain|alpine|hillside|hilltop|ski|slopes/)) tags.push("Mountain");
      if (allContent.match(/island|private island|atoll|lagoon/)) tags.push("Island");
      if (allContent.match(/countryside|vineyard|estate|rural|farm|agriturismo/)) tags.push("Countryside");
      if (allContent.match(/city center|city centre|downtown|heart of|steps from|walking distance|central location/)) tags.push("City Center");
      if (allContent.match(/secluded|remote|private|hideaway|retreat|escape|tucked away/)) tags.push("Secluded");
      if (allContent.match(/rooftop|terrace|panoramic view|city view|skyline/)) tags.push("Rooftop/Views");
      if (allContent.match(/garden|botanical|courtyard|lush|tropical garden/)) tags.push("Garden Setting");
      if (allContent.match(/waterfront|lake|lakeside|river|canal/)) tags.push("Waterfront");
      if (allContent.match(/cliff|cliffside|perched|overlooking|caldera/)) tags.push("Clifftop");

      // Experience Type
      if (allContent.match(/spa|wellness|treatment|massage|hammam|thermal|hydrotherapy|health club/)) tags.push("Spa & Wellness");
      if (allContent.match(/romantic|honeymoon|couples|anniversary|intimate/)) tags.push("Romantic");
      if (allContent.match(/family|kids|children|playground|kids club|babysitting|family-friendly/)) tags.push("Family-Friendly");
      if (allContent.match(/golf|golf course|putting green|driving range/)) tags.push("Golf");
      if (allContent.match(/adventure|hiking|diving|snorkeling|safari|expedition|excursion/)) tags.push("Adventure");
      if (allContent.match(/culinary|michelin|fine dining|cooking class|wine|vineyard|tasting|gastronom/)) tags.push("Foodie/Culinary");
      if (allContent.match(/art|gallery|museum|cultural|heritage|historic|landmark|archaeological/)) tags.push("Arts & Culture");
      if (allContent.match(/nightlife|bar|lounge|club|scene|buzzy|social/)) tags.push("Nightlife & Social");

      // Property Style
      if (allContent.match(/boutique|intimate|small|exclusive|only \d+ room|under 50 room/)) tags.push("Boutique");
      if (Number(numberOfRooms) > 0 && Number(numberOfRooms) <= 50) tags.push("Boutique");
      if (allContent.match(/palazzo|castle|chateau|manor|mansion|historic|century|heritage|restored/)) tags.push("Historic/Heritage");
      if (allContent.match(/design|architect|contemporary|modern|minimalist|sleek/)) tags.push("Design-Forward");
      if (allContent.match(/all.inclusive|all inclusive/)) tags.push("All-Inclusive");
      if (allContent.match(/resort|compound|grounds|acres/)) tags.push("Resort");
      if (allContent.match(/villa|private residence|apartment|suite hotel/)) tags.push("Villa/Residence Style");

      // Amenities & Features
      if (allContent.match(/pool|infinity pool|swimming|plunge pool/)) tags.push("Pool");
      if (allContent.match(/fitness|gym|yoga|pilates|personal trainer/)) tags.push("Fitness");
      if (allContent.match(/pet.friendly|pet friendly|dogs? welcome|pets? allowed/)) tags.push("Pet-Friendly");
      if (allContent.match(/business|meeting|conference|co.working|coworking/)) tags.push("Business");
      if (allContent.match(/adults.only|adult only|no children/)) tags.push("Adults Only");
      if (allContent.match(/eco|sustainable|green|solar|organic|conservation/)) tags.push("Eco/Sustainable");

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

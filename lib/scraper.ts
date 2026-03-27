import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

export interface HotelData {
  hotelName: string;
  city: string;
  country: string;
  neighborhood: string;
  nearestAirport: string;
  numberOfRooms: string;
  roomStyle: string;
  vibe: string;
  bookingUrl: string;
  imageUrl: string;
  hasVirtuosoExclusive: boolean;
}

const BASE_URL =
  "https://www.virtuoso.com/advisor/pranajourneys/hotels";

function buildPageUrl(page: number): string {
  const startRow = (page - 1) * 25;
  return `${BASE_URL}#CurrentPage=${page}&FacetCategoryIndex=0&FacetLimit=6&LeftToShow=0&RowsPerPage=25&SearchView=1col&StartRow=${startRow}&HotelBookingNumberChildren=0&HotelBookingNumberAdults=2&SearchType=Property&SortType=HotelNameAsc`;
}

export async function scrapePage(pageNum: number): Promise<{
  hotels: HotelData[];
  totalResults: number;
  totalPages: number;
}> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1470, height: 813 },
    executablePath: await chromium.executablePath(),
    headless: true,
  } as any);

  try {
    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const url = buildPageUrl(pageNum);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // Wait for hotel cards to render
    await page.waitForSelector('[class*="search-result"], [class*="hotel-card"], [role="region"]', {
      timeout: 15000,
    }).catch(() => {
      // Cards might use different selectors, continue anyway
    });

    // Give extra time for dynamic content
    await new Promise((r) => setTimeout(r, 3000));

    const data = await page.evaluate(() => {
      const hotels: any[] = [];

      // Get total results count
      const resultsText = document.body.innerText.match(
        /(\d[\d,]*)\s*Results?\s*Found/i
      );
      const totalResults = resultsText
        ? parseInt(resultsText[1].replace(/,/g, ""))
        : 0;
      const totalPages = Math.ceil(totalResults / 25);

      // The page renders hotel data in region elements within main
      // Extract from the text content of each card region
      const mainEl = document.querySelector("main");
      if (!mainEl) return { hotels: [], totalResults: 0, totalPages: 0 };

      // Get all the hotel card containers - they are the region elements
      const regions = mainEl.querySelectorAll('[role="region"]');

      regions.forEach((region) => {
        const text = region.textContent || "";
        const links = region.querySelectorAll("a");
        const imgs = region.querySelectorAll("img");

        // Skip non-hotel regions (ads, filters, etc.)
        if (!text.includes("Number of Rooms") && !text.includes("Room Style"))
          return;

        // Extract hotel name - usually the first prominent text/link
        let hotelName = "";
        const nameLink = region.querySelector('a[href*="/hotel/"], a[href*="/hotels/"]');
        if (nameLink) {
          hotelName = nameLink.textContent?.trim() || "";
        }
        // Fallback: look for heading or strong text
        if (!hotelName) {
          const heading = region.querySelector("h2, h3, h4, strong, b");
          if (heading) hotelName = heading.textContent?.trim() || "";
        }
        // Another fallback: first link text that's not a utility link
        if (!hotelName) {
          for (const link of links) {
            const t = link.textContent?.trim() || "";
            if (
              t.length > 2 &&
              !t.includes("Compare") &&
              !t.includes("Select") &&
              !t.includes("Amenities") &&
              !t.includes("View")
            ) {
              hotelName = t;
              break;
            }
          }
        }

        if (!hotelName) return;

        // Extract location info from text
        // Pattern: "City, State/Region, Country" or "City, Country"
        // It appears right after hotel name, before "Nearest Airport" or "Neighborhood"
        let city = "";
        let country = "";
        let neighborhood = "";

        // Look for neighborhood
        const neighborhoodMatch = text.match(
          /Neighborhood:\s*([^\n]+?)(?:\s*Nearest|Select|Number|\n)/
        );
        if (neighborhoodMatch)
          neighborhood = neighborhoodMatch[1].trim();

        // Look for nearest airport
        let nearestAirport = "";
        const airportMatch = text.match(
          /Nearest Airport:\s*([^\n]+?)(?:\s*Select|Number|\n)/
        );
        if (airportMatch) nearestAirport = airportMatch[1].trim();

        // Extract location - it comes after "Compare" in the text
        const compareIdx = text.indexOf("Compare");
        if (compareIdx > -1) {
          const afterCompare = text.substring(compareIdx + 7).trim();
          // Get text up to "Neighborhood" or "Nearest Airport" or "Select"
          const locationEnd = afterCompare.search(
            /Neighborhood|Nearest Airport|Select Dates|Number of Rooms|Pricing/
          );
          const locationStr =
            locationEnd > -1
              ? afterCompare.substring(0, locationEnd).trim()
              : afterCompare.substring(0, 100).trim();

          // Parse "City, State, Country" or "City, Country"
          const parts = locationStr
            .split(",")
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0);
          if (parts.length >= 2) {
            city = parts[0];
            country = parts[parts.length - 1];
          } else if (parts.length === 1) {
            city = parts[0];
          }
        }

        // Extract room count
        let numberOfRooms = "";
        const roomsMatch = text.match(/Number of Rooms:\s*(\d+)/);
        if (roomsMatch) numberOfRooms = roomsMatch[1];

        // Extract room style
        let roomStyle = "";
        const styleMatch = text.match(
          /Room Style:\s*(Contemporary|Classic|Indigenous|Eclectic)/
        );
        if (styleMatch) roomStyle = styleMatch[1];

        // Extract vibe
        let vibe = "";
        const vibeMatch = text.match(
          /Vibe:\s*(Sophisticated|Zen|Casual|Hip)/
        );
        if (vibeMatch) vibe = vibeMatch[1];

        // Get booking URL
        let bookingUrl = "";
        for (const link of links) {
          const href = link.getAttribute("href") || "";
          if (
            href.includes("/hotel/") ||
            href.includes("/hotels/") ||
            href.includes("virtuoso.com")
          ) {
            if (!href.includes("#") && href.length > 10) {
              bookingUrl = href.startsWith("http")
                ? href
                : `https://www.virtuoso.com${href}`;
              break;
            }
          }
        }

        // Get image URL
        let imageUrl = "";
        for (const img of imgs) {
          const src = img.getAttribute("src") || "";
          if (src.includes("virtuoso") || src.includes("hotel") || src.includes("image")) {
            imageUrl = src.startsWith("http")
              ? src
              : `https://www.virtuoso.com${src}`;
            break;
          }
        }

        // Check for Virtuoso Exclusive
        const hasVirtuosoExclusive =
          text.includes("Virtuoso Exclusive") ||
          text.includes("Amenities & Offers");

        hotels.push({
          hotelName,
          city,
          country,
          neighborhood,
          nearestAirport,
          numberOfRooms,
          roomStyle,
          vibe,
          bookingUrl,
          imageUrl,
          hasVirtuosoExclusive,
        });
      });

      return { hotels, totalResults, totalPages };
    });

    return data;
  } finally {
    await browser.close();
  }
}

// Lighter scraper that uses fetch + cheerio for environments where puppeteer is too heavy
export async function scrapePageLight(pageNum: number): Promise<{
  hotels: HotelData[];
  totalResults: number;
  totalPages: number;
}> {
  // The Virtuoso page uses hash-based routing (client-side),
  // so a plain fetch won't get paginated results.
  // However, the initial page load returns the first 25 hotels in HTML.
  // For pagination, we need the browser approach.
  // This light version only works for page 1.

  const { load } = await import("cheerio");

  const res = await fetch(BASE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  const html = await res.text();
  const $ = load(html);

  // Parse the server-rendered HTML
  const hotels: HotelData[] = [];

  // This is a fallback - the real scraping happens in the puppeteer version
  const bodyText = $("body").text();
  const resultsMatch = bodyText.match(/(\d[\d,]*)\s*Results?\s*Found/i);
  const totalResults = resultsMatch
    ? parseInt(resultsMatch[1].replace(/,/g, ""))
    : 0;
  const totalPages = Math.ceil(totalResults / 25);

  return { hotels, totalResults, totalPages };
}

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

/**
 * Wait for hotel sections to appear in the DOM by polling.
 * Returns true if hotel content was found within the timeout.
 */
async function waitForHotelContent(page: any, timeoutMs: number = 12000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hasContent = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return false;
      const sections = main.querySelectorAll("section");
      for (const s of sections) {
        if (s.textContent?.includes("Number of Rooms") || s.querySelector('a[href*="/hotels/"]')) {
          return true;
        }
      }
      return false;
    });
    if (hasContent) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
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

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const url = buildPageUrl(pageNum);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // Dismiss cookie consent if present
    await page.evaluate(() => {
      const acceptBtn = document.querySelector('button');
      if (acceptBtn && acceptBtn.textContent?.trim() === 'Accept') {
        (acceptBtn as HTMLElement).click();
      }
    }).catch(() => {});

    // Wait for main page structure
    await page.waitForSelector('main', { timeout: 15000 }).catch(() => {});

    // The hash-based routing may not fire on initial load.
    // Force the hash change programmatically to trigger Virtuoso's client-side router.
    const startRow = (pageNum - 1) * 25;
    const hashFragment = `CurrentPage=${pageNum}&FacetCategoryIndex=0&FacetLimit=6&LeftToShow=0&RowsPerPage=25&SearchView=1col&StartRow=${startRow}&HotelBookingNumberChildren=0&HotelBookingNumberAdults=2&SearchType=Property&SortType=HotelNameAsc`;

    await page.evaluate((hash: string) => {
      window.location.hash = hash;
      // Also dispatch hashchange event in case the router listens for it
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }, hashFragment);

    // Wait for hotel content to actually appear (poll-based)
    let hasContent = await waitForHotelContent(page, 12000);

    // If no content, try one more approach: full page reload with the hash
    if (!hasContent) {
      console.log(`Page ${pageNum}: no content after hash set, reloading...`);
      await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
      await page.waitForSelector('main', { timeout: 10000 }).catch(() => {});
      hasContent = await waitForHotelContent(page, 10000);
    }

    // Final extra wait for any remaining dynamic rendering
    await new Promise((r) => setTimeout(r, 2000));

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

      const mainEl = document.querySelector("main");
      if (!mainEl) return { hotels: [], totalResults, totalPages };

      // Hotel cards are <section> elements inside main.
      // They contain: heading with link, location text, airport, room info list items.
      const sections = mainEl.querySelectorAll("section");

      sections.forEach((section) => {
        const text = section.textContent || "";

        // Skip non-hotel sections (filters, sidebar, etc.)
        // Hotel sections contain "Number of Rooms" or a link to /hotels/
        const hasRoomInfo = text.includes("Number of Rooms");
        const hotelLink = section.querySelector('a[href*="/hotels/"]');
        if (!hasRoomInfo && !hotelLink) return;

        // Extract hotel name from heading link
        let hotelName = "";
        const heading = section.querySelector("h2, h3, h4");
        if (heading) {
          const nameLink = heading.querySelector("a");
          hotelName = nameLink?.textContent?.trim() || heading.textContent?.trim() || "";
        }
        if (!hotelName && hotelLink) {
          hotelName = hotelLink.textContent?.trim() || "";
        }
        if (!hotelName) return;

        // Extract booking URL from the hotel link
        let bookingUrl = "";
        const allLinks = section.querySelectorAll("a");
        for (const link of allLinks) {
          const href = link.getAttribute("href") || "";
          if (href.includes("/hotels/") && href.length > 20) {
            // Strip the hash fragment to get clean URL
            const cleanHref = href.split("#")[0];
            bookingUrl = cleanHref.startsWith("http")
              ? cleanHref
              : `https://www.virtuoso.com${cleanHref}`;
            break;
          }
        }

        // Extract location — look for text nodes after the heading
        // Structure: "Edinburgh, Scotland" in one element, ", United Kingdom" in another
        let city = "";
        let country = "";
        let neighborhood = "";

        // Get all direct child text content that looks like location
        const childDivs = section.querySelectorAll(":scope > div, :scope > span, :scope > p");
        for (const div of childDivs) {
          const t = div.textContent?.trim() || "";
          // Location text is like "Edinburgh, Scotland" or ", United Kingdom"
          if (t.startsWith(",") && t.length < 100) {
            // This is the country part
            country = t.replace(/^,\s*/, "").trim();
          } else if (
            t.length > 2 &&
            t.length < 100 &&
            !t.includes("Number of Rooms") &&
            !t.includes("Nearest Airport") &&
            !t.includes("Select Dates") &&
            !t.includes("Virtuoso") &&
            !t.includes("Compare") &&
            t.includes(",")
          ) {
            // This could be "City, Region" or "City, State"
            const parts = t.split(",").map((p: string) => p.trim());
            if (parts.length >= 1) city = parts[0];
            if (parts.length >= 2 && !country) country = parts[parts.length - 1];
          }
        }

        // Fallback: parse location from full text
        if (!city) {
          // Look for text between "Compare" and "Nearest Airport" or "Select Dates"
          const compareIdx = text.indexOf("Compare");
          const airportIdx = text.indexOf("Nearest Airport");
          const selectIdx = text.indexOf("Select Dates");
          const endIdx = airportIdx > compareIdx ? airportIdx : (selectIdx > compareIdx ? selectIdx : -1);
          if (compareIdx > -1 && endIdx > compareIdx) {
            const locStr = text.substring(compareIdx + 7, endIdx).trim();
            const parts = locStr.split(",").map((p: string) => p.trim()).filter((p: string) => p.length > 0);
            if (parts.length >= 2) {
              city = parts[0];
              country = parts[parts.length - 1];
            } else if (parts.length === 1 && parts[0].length > 1) {
              city = parts[0];
            }
          }
        }

        // Extract from list items
        let nearestAirport = "";
        let numberOfRooms = "";
        let roomStyle = "";
        let vibe = "";

        const airportMatch = text.match(/Nearest Airport:\s*(.+?)(?:Select|Number|\n|$)/);
        if (airportMatch) nearestAirport = airportMatch[1].trim();

        const roomsMatch = text.match(/Number of Rooms:\s*(\d+)/);
        if (roomsMatch) numberOfRooms = roomsMatch[1];

        const styleMatch = text.match(/Room Style:\s*(\w+)/);
        if (styleMatch) roomStyle = styleMatch[1];

        const vibeMatch = text.match(/Vibe:\s*(\w+)/);
        if (vibeMatch) vibe = vibeMatch[1];

        const neighborhoodMatch = text.match(/Neighborhood:\s*(.+?)(?:Nearest|Select|Number|\n|$)/);
        if (neighborhoodMatch) neighborhood = neighborhoodMatch[1].trim();

        // Get image URL
        let imageUrl = "";
        const imgs = section.querySelectorAll("img");
        for (const img of imgs) {
          const src = img.getAttribute("src") || "";
          if (src.includes("media.virtuoso") || src.includes("Brochures")) {
            imageUrl = src.startsWith("http") ? src : `https://www.virtuoso.com${src}`;
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

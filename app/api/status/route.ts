import { NextResponse } from "next/server";
import { getExistingHotelIds } from "@/lib/airtable";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const existingIds = await getExistingHotelIds();

    return NextResponse.json({
      status: "ok",
      airtableHotels: existingIds.size,
      airtableConnected: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({
      status: "error",
      airtableConnected: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

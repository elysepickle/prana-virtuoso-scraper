export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>PRANA Virtuoso Scraper</h1>
      <p>This service scrapes the Virtuoso hotel catalog and syncs it to the Prana Airtable.</p>
      <h2>Endpoints</h2>
      <ul>
        <li><code>GET /api/status</code> — Check Airtable connection and hotel count</li>
        <li><code>GET /api/scrape-page?page=1</code> — Scrape a single page (for testing)</li>
        <li><code>GET /api/scrape?start=1&pages=5</code> — Scrape a batch and sync to Airtable</li>
      </ul>
      <h2>Cron Schedule</h2>
      <p>Runs daily at 6:00 AM UTC via Vercel Cron.</p>
    </main>
  );
}

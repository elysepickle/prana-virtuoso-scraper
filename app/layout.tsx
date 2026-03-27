export const metadata = {
  title: "PRANA Virtuoso Scraper",
  description: "Scrapes Virtuoso hotel catalog and syncs to Airtable",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

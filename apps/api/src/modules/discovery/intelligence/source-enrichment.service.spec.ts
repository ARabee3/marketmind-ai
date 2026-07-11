import "reflect-metadata";

jest.mock("node:dns/promises", () => ({
  lookup: jest.fn().mockResolvedValue([
    {
      address: "93.184.216.34",
      family: 4,
    },
  ]),
}));

import {
  SourceEnrichmentService,
  extractSourceEnrichment,
} from "./source-enrichment.service";

describe("SourceEnrichmentService", () => {
  const fetchMock = jest.spyOn(global, "fetch");

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  it("enriches high-value search results with source-backed page data", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html>
          <head>
            <title>مطعم كشري المدينة</title>
            <meta property="og:title" content="Koshary City">
            <meta property="og:description" content="Fresh koshary offers in Nasr City">
            <meta property="og:site_name" content="Menu Cairo">
            <link rel="canonical" href="https://example.com/koshary">
          </head>
          <body>
            <h1>مطعم كشري في مدينة نصر</h1>
            <p>منيو يومي مع عروض وتوصيل داخل مدينة نصر.</p>
          </body>
        </html>`,
        { status: 200 },
      ),
    );

    const result = await new SourceEnrichmentService().enrich([
      {
        provider: "serpapi",
        title: "Original result",
        url: "https://example.com/koshary",
        snippet: "Original snippet.",
        rank: 1,
        query: "مطعم كشري مدينة نصر",
        confidence: 0.9,
      },
    ]);

    expect(result[0]).toMatchObject({
      title: "Original result",
      snippet: expect.stringContaining("Fresh koshary offers"),
      metadata: expect.objectContaining({
        enrichment_status: "complete",
        enriched_title: "مطعم كشري المدينة",
        og_title: "Koshary City",
        og_site_name: "Menu Cairo",
        canonical_url: "https://example.com/koshary",
        visible_text_excerpt: expect.stringContaining("مطعم كشري"),
      }),
    });
    expect(result[0]?.metadata).toMatchObject({
      content_hints: expect.arrayContaining(["menu", "offer", "delivery"]),
    });
  });

  it("keeps the search result when enrichment is blocked", async () => {
    fetchMock.mockResolvedValue(
      new Response("blocked", {
        status: 403,
      }),
    );

    const result = await new SourceEnrichmentService().enrich([
      {
        provider: "duckduckgo",
        title: "Directory result",
        url: "https://example.com/blocked",
        snippet: "Directory snippet.",
        rank: 2,
        query: "restaurant cairo",
        confidence: 0.7,
      },
    ]);

    expect(result[0]).toMatchObject({
      title: "Directory result",
      snippet: "Directory snippet.",
      metadata: {
        enrichment_status: "failed",
        enrichment_error_code: "SOURCE_ENRICHMENT_FAILED",
        enrichment_error_message: "Source enrichment failed.",
      },
    });
  });

  it("fails open when the page body is oversized", async () => {
    fetchMock.mockResolvedValue(
      new Response("large", {
        status: 200,
        headers: {
          "content-length": `${300 * 1024}`,
        },
      }),
    );

    const result = await new SourceEnrichmentService().enrich([
      {
        provider: "serpapi",
        title: "Large page",
        url: "https://example.com/large",
        rank: 1,
        query: "large page",
        confidence: 0.8,
      },
    ]);

    expect(result[0]?.metadata).toMatchObject({
      enrichment_status: "failed",
      enrichment_error_code: "SOURCE_ENRICHMENT_FAILED",
    });
  });
});

describe("extractSourceEnrichment", () => {
  it("extracts visible text without script and style content", () => {
    const enrichment = extractSourceEnrichment(
      `<html><head><title>Title</title><style>.x{}</style></head>
      <body><script>alert(1)</script><p>Useful visible Arabic نص واضح</p></body></html>`,
    );

    expect(enrichment.visible_text_excerpt).toBe("Useful visible Arabic نص واضح");
  });
});

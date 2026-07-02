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
  LanguageModeDto,
  SocialPlatformDto,
  StartDiscoveryDto,
} from "../dto/start-discovery.dto";
import {
  MetadataExtractorService,
  extractPageMetadata,
} from "./metadata-extractor.service";

describe("MetadataExtractorService", () => {
  const fetchMock = jest.spyOn(global, "fetch");
  const dto: StartDiscoveryDto = {
    language_mode: LanguageModeDto.Mixed,
    intake: {
      business_name: "Koshary Corner",
      business_type: "restaurant",
      city: "Cairo",
      social_links: [
        {
          platform: SocialPlatformDto.Instagram,
          url: "https://instagram.com/kosharycorner",
        },
      ],
    },
  };

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  it("extracts title and description from owner-submitted links", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html><head><title>Koshary Corner</title><meta name="description" content="Egyptian restaurant in Cairo"></head></html>`,
        { status: 200 },
      ),
    );

    const result = await new MetadataExtractorService().extract(dto);

    expect(result.source_refs[0]).toMatchObject({
      source_type: "owner_link",
      platform: "instagram",
      url: "https://instagram.com/kosharycorner",
      title: "Koshary Corner",
      snippet: "Egyptian restaurant in Cairo",
      confidence: 0.75,
      metadata: {
        owner_submitted: true,
        metadata_fetch_status: "complete",
      },
    });
    expect(result.research_observations[0]).toMatchObject({
      kind: "social_signal",
      source_index: 0,
      statement: "Egyptian restaurant in Cairo",
    });
  });

  it("keeps the submitted owner link when metadata fetch fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
    } as Response);

    const result = await new MetadataExtractorService().extract(dto);

    expect(result.source_refs[0]).toMatchObject({
      source_type: "owner_link",
      platform: "instagram",
      url: "https://instagram.com/kosharycorner",
      confidence: 0.45,
      metadata: {
        owner_submitted: true,
        metadata_fetch_status: "failed",
        error_code: "METADATA_FETCH_FAILED",
        error_message: "Metadata fetch failed.",
      },
    });
  });

  it("rejects private owner metadata URLs before fetching", async () => {
    const result = await new MetadataExtractorService().extract({
      ...dto,
      intake: {
        ...dto.intake,
        social_links: [
          {
            platform: SocialPlatformDto.Website,
            url: "http://127.0.0.1/admin",
          },
        ],
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source_refs[0]).toMatchObject({
      url: "http://127.0.0.1/admin",
      metadata: {
        metadata_fetch_status: "failed",
      },
    });
  });

  it("parses open graph descriptions without lowercasing content", () => {
    expect(
      extractPageMetadata(
        `<meta property="og:description" content="Fresh Lunch Offers in Cairo">`,
      ),
    ).toEqual({
      title: undefined,
      description: "Fresh Lunch Offers in Cairo",
    });
  });
});

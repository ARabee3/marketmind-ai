import "reflect-metadata";
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
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        `<html><head><title>Koshary Corner</title><meta name="description" content="Egyptian restaurant in Cairo"></head></html>`,
    } as Response);

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
        error_message: "External request failed with 403",
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

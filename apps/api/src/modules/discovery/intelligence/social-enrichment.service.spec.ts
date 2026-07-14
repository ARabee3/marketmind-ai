import "reflect-metadata";
import { ProviderError } from "../../../common/errors/provider-error";
import {
  SocialPlatformDto,
  StartDiscoveryDto,
} from "../dto/start-discovery.dto";
import { ApifyFacebookPagesProvider } from "./facebook/apify-facebook-pages.provider";
import { ApifyFacebookPostsProvider } from "./facebook/apify-facebook-posts.provider";
import { SocialEnrichmentService } from "./social-enrichment.service";

describe("SocialEnrichmentService", () => {
  const pages = {
    enrich: jest.fn(),
  } as unknown as jest.Mocked<ApifyFacebookPagesProvider>;
  const posts = {
    enrich: jest.fn(),
  } as unknown as jest.Mocked<ApifyFacebookPostsProvider>;
  const dto: StartDiscoveryDto = {
    intake: {
      business_name: "قصر نابولي",
      business_type: "محل حلويات",
      city: "أسيوط",
      social_links: [
        {
          platform: SocialPlatformDto.Facebook,
          url: "https://www.facebook.com/kasrnapoly?ref=owner",
        },
      ],
    },
  };
  const previousEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...previousEnv,
      DISCOVERY_FACEBOOK_ENRICHMENT_ENABLED: "true",
      DISCOVERY_FACEBOOK_POSTS_ENABLED: "true",
    };
    pages.enrich.mockResolvedValue([
      {
        provider: "apify_facebook_pages",
        title: "قصر نابولي",
        url: "https://facebook.com/kasrnapoly",
        rank: 1,
        query: "owner submitted Facebook Page",
        confidence: 0.8,
      },
    ]);
    posts.enrich.mockResolvedValue([
      {
        provider: "apify_facebook_posts",
        title: "Facebook post 1",
        url: "https://facebook.com/kasrnapoly/posts/1",
        rank: 1,
        query: "recent owner submitted Facebook Page posts",
        confidence: 0.7,
      },
    ]);
  });

  afterAll(() => {
    process.env = previousEnv;
  });

  it("runs bounded Page and post enrichment concurrently for the first valid owner URL", async () => {
    let releasePages!: () => void;
    let releasePosts!: () => void;
    pages.enrich.mockReturnValue(
      new Promise((resolve) => {
        releasePages = () => resolve([]);
      }),
    );
    posts.enrich.mockReturnValue(
      new Promise((resolve) => {
        releasePosts = () => resolve([]);
      }),
    );
    const service = new SocialEnrichmentService(pages, posts);

    const enrichment = service.enrich(dto);
    await Promise.resolve();

    expect(pages.enrich).toHaveBeenCalledWith(
      "https://facebook.com/kasrnapoly",
      undefined,
    );
    expect(posts.enrich).toHaveBeenCalledWith(
      "https://facebook.com/kasrnapoly",
      undefined,
    );
    releasePages();
    releasePosts();
    await expect(enrichment).resolves.toMatchObject({
      candidates: [],
      provider_warnings: [],
      provider_attempts: [
        { provider: "apify_facebook_pages", outcome: "empty" },
        { provider: "apify_facebook_posts", outcome: "empty" },
      ],
    });
  });

  it("keeps Page evidence when posts fail", async () => {
    posts.enrich.mockRejectedValue(
      new ProviderError("APIFY_ACTOR_ERROR", "Apify failed.", true),
    );
    const service = new SocialEnrichmentService(pages, posts);

    const result = await service.enrich(dto);

    expect(result.candidates).toHaveLength(1);
    expect(result.provider_warnings).toEqual([
      expect.objectContaining({
        code: "APIFY_FACEBOOK_PROVIDER_ERROR",
        retryable: true,
      }),
    ]);
    expect(result.provider_attempts[1]).toMatchObject({
      provider: "apify_facebook_posts",
      outcome: "failed",
      error_code: "APIFY_FACEBOOK_PROVIDER_ERROR",
    });
  });

  it("does not call Apify when disabled or when the URL is not a Page", async () => {
    const service = new SocialEnrichmentService(pages, posts);
    process.env.DISCOVERY_FACEBOOK_ENRICHMENT_ENABLED = "false";
    await expect(service.enrich(dto)).resolves.toMatchObject({
      candidates: [],
    });

    process.env.DISCOVERY_FACEBOOK_ENRICHMENT_ENABLED = "true";
    const personalProfile = structuredClone(dto);
    personalProfile.intake.social_links![0]!.url =
      "https://facebook.com/profile.php?id=123";
    const result = await service.enrich(personalProfile);

    expect(result.candidates).toEqual([]);
    expect(result.provider_warnings[0]?.code).toBe(
      "APIFY_FACEBOOK_INVALID_PAGE_URL",
    );
    expect(pages.enrich).not.toHaveBeenCalled();
    expect(posts.enrich).not.toHaveBeenCalled();
  });
});

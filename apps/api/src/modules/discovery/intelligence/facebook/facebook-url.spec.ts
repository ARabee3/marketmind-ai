import { normalizeFacebookPageUrl } from "./facebook-url";

describe("normalizeFacebookPageUrl", () => {
  it.each([
    [
      "https://www.facebook.com/kasrnapoly?ref=page_internal#about",
      "https://facebook.com/kasrnapoly",
    ],
    [
      "https://m.facebook.com/%D9%85%D8%B7%D8%B9%D9%85-%D8%A7%D9%84%D9%86%D9%88%D8%B1?locale=ar_AR",
      "https://facebook.com/%D9%85%D8%B7%D8%B9%D9%85-%D8%A7%D9%84%D9%86%D9%88%D8%B1",
    ],
  ])("canonicalizes public Page URL %s", (input: string, expected: string) => {
    expect(normalizeFacebookPageUrl(input)).toBe(expected);
  });

  it.each([
    "http://facebook.com/kasrnapoly",
    "https://facebook.com.evil.test/kasrnapoly",
    "https://evil.test/facebook.com/kasrnapoly",
    "https://user:pass@facebook.com/kasrnapoly",
    "https://facebook.com/profile.php?id=123",
    "https://facebook.com/people/kasrnapoly/100063123",
    "https://facebook.com/groups/kasrnapoly",
    "https://facebook.com/events/123",
    "https://facebook.com/marketplace/item/123",
    "https://facebook.com/watch/live/?ref=watch_permalink",
    "https://facebook.com/reel/123",
    "https://facebook.com/reels/123",
    "https://facebook.com/kasrnapoly/posts/123",
    "https://facebook.com/kasrnapoly/photos/a.1/2",
    "https://facebook.com/kasrnapoly/videos/123",
    "https://facebook.com/permalink.php?story_fbid=123&id=456",
    "https://facebook.com/stories/kasrnapoly/123",
    "https://facebook.com/share/p/123",
    "https://facebook.com/kasrnapoly/about",
    "https://facebook.com/%70rofile.php?id=123",
    "https://facebook.com/%2Fgroups",
    "https://facebook.com/groups%2Fkasrnapoly",
    "https://facebook.com/%2Fprofile.php%3Fid%3D123",
    "https://facebook.com/%252Fgroups",
    "https://facebook.com/%2525252Fgroups",
    "https://facebook.com/groups%2525252Fkasrnapoly",
    "https://facebook.com/%E0%A4%A",
  ])("rejects non-public-Page URL %s", (input: string) => {
    expect(normalizeFacebookPageUrl(input)).toBeNull();
  });
});

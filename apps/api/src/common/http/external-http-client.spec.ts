import { getExternalText } from "./external-http-client";

describe("external HTTP client", () => {
  const fetchMock = jest.spyOn(global, "fetch");

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  it("rejects unsafe private URLs before fetching", async () => {
    await expect(
      getExternalText("http://127.0.0.1/admin", { validateUrl: true }),
    ).rejects.toThrow("Unsafe external URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects bracketed IPv6 loopback URLs before fetching", async () => {
    await expect(
      getExternalText("http://[::1]/admin", { validateUrl: true }),
    ).rejects.toThrow("Unsafe external URL");
    await expect(
      getExternalText("http://[::ffff:127.0.0.1]/admin", {
        validateUrl: true,
      }),
    ).rejects.toThrow("Unsafe external URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized text responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("x".repeat(12), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      getExternalText("https://example.com", {
        maxBodyBytes: 10,
        validateUrl: false,
      }),
    ).rejects.toThrow("External response exceeded 10 bytes");
  });
});

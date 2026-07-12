import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BrevoClient } from "@getbrevo/brevo";

import { BrevoMailProvider } from "./brevo-mail.provider";
import { MailDeliveryError } from "./mail-delivery.error";

const mockSendTransacEmail = jest.fn();

jest.mock("@getbrevo/brevo", () => ({
  BrevoClient: jest.fn().mockImplementation(() => ({
    transactionalEmails: {
      sendTransacEmail: mockSendTransacEmail,
    },
  })),
}));

const createConfigService = (
  apiKey = "test-api-key",
  from = "team@example.com",
) =>
  ({
    get: jest.fn((key: string) => {
      if (key === "mail.brevoApiKey") return apiKey;
      if (key === "mail.from") return from;
      return undefined;
    }),
  }) as unknown as ConfigService;

describe("BrevoMailProvider", () => {
  beforeEach(() => {
    mockSendTransacEmail.mockReset();
    jest.mocked(BrevoClient).mockClear();
  });

  afterEach(() => jest.restoreAllMocks());

  it("configures a bounded timeout and retry count", () => {
    new BrevoMailProvider(createConfigService());

    expect(BrevoClient).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      timeoutInSeconds: 10,
      maxRetries: 1,
    });
  });

  it("maps the MarketMind mail contract to the Brevo API", async () => {
    mockSendTransacEmail.mockResolvedValue({ messageId: "message-id" });
    const provider = new BrevoMailProvider(createConfigService());

    await provider.send("owner@example.com", "Verify email", "<p>Verify</p>");

    expect(mockSendTransacEmail).toHaveBeenCalledWith({
      sender: { email: "team@example.com", name: "MarketMind AI" },
      to: [{ email: "owner@example.com" }],
      subject: "Verify email",
      htmlContent: "<p>Verify</p>",
      headers: { idempotencyKey: expect.any(String) },
    });
  });

  it("uses a new idempotency key for each logical send", async () => {
    mockSendTransacEmail.mockResolvedValue({ messageId: "message-id" });
    const provider = new BrevoMailProvider(createConfigService());

    await provider.send("one@example.com", "One", "<p>One</p>");
    await provider.send("two@example.com", "Two", "<p>Two</p>");

    const firstKey =
      mockSendTransacEmail.mock.calls[0][0].headers.idempotencyKey;
    const secondKey =
      mockSendTransacEmail.mock.calls[1][0].headers.idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });

  it("normalizes Brevo failures as MailDeliveryError", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    mockSendTransacEmail.mockRejectedValue(new Error("Brevo unavailable"));
    const provider = new BrevoMailProvider(createConfigService());

    await expect(
      provider.send("owner@example.com", "Subject", "<p>body</p>"),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "MailDeliveryError",
        message: "Brevo unavailable",
      }),
    );
  });

  it("fails visibly when selected without complete configuration", async () => {
    const provider = new BrevoMailProvider(createConfigService("", ""));

    await expect(
      provider.send("owner@example.com", "Subject", "<p>body</p>"),
    ).rejects.toBeInstanceOf(MailDeliveryError);
    expect(mockSendTransacEmail).not.toHaveBeenCalled();
  });
});

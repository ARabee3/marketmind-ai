import { Logger } from "@nestjs/common";

import { MockMailProvider } from "./mock-mail.provider";

describe("MockMailProvider", () => {
  afterEach(() => jest.restoreAllMocks());

  it("logs an explicitly labelled local delivery without external calls", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const provider = new MockMailProvider();

    await expect(
      provider.send("user@example.com", "Subject", "<p>body</p>"),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith("[MAIL MOCK] Email to: user@example.com");
    expect(log).toHaveBeenCalledWith("[MAIL MOCK] Subject: Subject");
  });
});

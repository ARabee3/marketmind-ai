import { SmtpMailProvider } from "./smtp-mail.provider";
import { selectMailProvider } from "./mail.module";
import { MockMailProvider } from "./mock-mail.provider";

describe("selectMailProvider", () => {
  const mockProvider = {} as MockMailProvider;
  const smtpProvider = {} as SmtpMailProvider;

  it("selects the mock strategy", () => {
    expect(selectMailProvider("mock", mockProvider, smtpProvider)).toBe(
      mockProvider,
    );
  });

  it("selects the SMTP strategy", () => {
    expect(selectMailProvider("smtp", mockProvider, smtpProvider)).toBe(
      smtpProvider,
    );
  });
});
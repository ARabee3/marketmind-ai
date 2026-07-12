import { BrevoMailProvider } from "./brevo-mail.provider";
import { selectMailProvider } from "./mail.module";
import { MockMailProvider } from "./mock-mail.provider";

describe("selectMailProvider", () => {
  const mockProvider = {} as MockMailProvider;
  const brevoProvider = {} as BrevoMailProvider;

  it("selects the mock strategy", () => {
    expect(selectMailProvider("mock", mockProvider, brevoProvider)).toBe(
      mockProvider,
    );
  });

  it("selects the Brevo strategy", () => {
    expect(selectMailProvider("brevo", mockProvider, brevoProvider)).toBe(
      brevoProvider,
    );
  });
});

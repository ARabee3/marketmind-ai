import { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function makeHost(json: jest.Mock) {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status: jest.fn().mockReturnThis(), json }),
    }),
  } as unknown as ArgumentsHost;
}

describe("AllExceptionsFilter", () => {
  it("maps non-HTTP exceptions to a stable SERVER_ERROR response", () => {
    const json = jest.fn();
    const filter = new AllExceptionsFilter();

    filter.catch(new Error("Prisma validation exploded"), makeHost(json));

    expect(json).toHaveBeenCalledWith({
      code: "SERVER_ERROR",
      message: "An unexpected error occurred. Please try again later.",
    });
  });

  it("never leaks the underlying error message to the client", () => {
    const json = jest.fn();
    const filter = new AllExceptionsFilter();

    filter.catch(
      new Error("Argument strategy is missing at prisma.strategyBrief.upsert()"),
      makeHost(json),
    );

    const body = json.mock.calls[0][0] as { message: string };
    expect(body.message).not.toContain("strategy");
    expect(body.message).not.toContain("prisma");
  });

  it("handles non-Error values without throwing", () => {
    const json = jest.fn();
    const filter = new AllExceptionsFilter();

    expect(() => filter.catch("boom", makeHost(json))).not.toThrow();
    expect(json).toHaveBeenCalled();
  });
});

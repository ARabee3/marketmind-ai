import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function makeHost(json: jest.Mock, status = jest.fn().mockReturnThis()) {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status, json }),
    }),
  } as unknown as ArgumentsHost;
}

describe("AllExceptionsFilter", () => {
  it("preserves stable HTTP exception status and codes", () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const filter = new AllExceptionsFilter();

    filter.catch(
      new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Please check the submitted values.",
      }),
      makeHost(json, status),
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: "VALIDATION_ERROR",
      message: "Please check the submitted values.",
    });
  });

  it("preserves extra custom fields from the exception payload", () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const filter = new AllExceptionsFilter();

    filter.catch(
      new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message: "This item version is no longer the current version.",
        latest_version_id: "11111111-1111-4111-8111-111111111111",
      }),
      makeHost(json, status),
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: "CONTENT_VERSION_CONFLICT",
      message: "This item version is no longer the current version.",
      latest_version_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("never forwards NestJS boilerplate fields to the client", () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const filter = new AllExceptionsFilter();

    filter.catch(
      new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Please check the submitted values.",
        statusCode: 400,
        error: "Bad Request",
        extra: "kept",
      }),
      makeHost(json, status),
    );

    expect(json).toHaveBeenCalledWith({
      code: "VALIDATION_ERROR",
      message: "Please check the submitted values.",
      extra: "kept",
    });
  });

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

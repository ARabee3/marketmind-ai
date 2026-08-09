import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetaConnectionStart } from "../meta-connection-start";

const connectMetaMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/lib/api/facebook", () => ({
  connectMeta: connectMetaMock,
}));

describe("MetaConnectionStart", () => {
  beforeEach(() => {
    connectMetaMock.mockReset();
    replaceMock.mockReset();
  });

  it("starts PR #193 Facebook OAuth and returns to publishing", async () => {
    connectMetaMock.mockResolvedValue({ pageName: "MarketMind Page" });

    render(<MetaConnectionStart />);
    fireEvent.click(screen.getByRole("button", { name: "startButton" }));

    await waitFor(() => {
      expect(connectMetaMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/publishing");
    });
  });

  it("keeps the owner on the page with a translated error when OAuth fails", async () => {
    connectMetaMock.mockRejectedValue(new Error("expired"));

    render(<MetaConnectionStart />);
    fireEvent.click(screen.getByRole("button", { name: "startButton" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

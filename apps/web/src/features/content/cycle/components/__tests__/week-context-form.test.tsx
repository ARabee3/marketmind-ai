import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WeekContextForm } from "../week-context-form";
import { mockOwnerConfirmedContextWeek1, mockSystemDefaultedContextWeek1 } from "../../lib/content-cycle-fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: Record<string, unknown>) => {
    if (key === "retainedAssets") return `Retained photos: ${opts?.count}`;
    if (key === "noPromotion") return "No promotion";
    if (key === "approvedPromotion") return "Owner-approved promotion";
    if (key === "save") return "Save weekly context";
    if (key === "safeDefaultTitle") return "Safe default used";
    return key;
  },
  useLocale: () => "en",
}));

describe("WeekContextForm", () => {
  it("renders promotion modes and populates fields when initialContext is passed", () => {
    render(
      <WeekContextForm
        initialContext={mockOwnerConfirmedContextWeek1}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("No promotion")).toBeDefined();
    expect(screen.getByText("Owner-approved promotion")).toBeDefined();
    expect(screen.getByDisplayValue("Summer Refresh Special: Buy 1 Get 1 50% Off")).toBeDefined();
  });

  it("displays read-only safe default notice when system_defaulted", () => {
    render(
      <WeekContextForm
        initialContext={mockSystemDefaultedContextWeek1}
        isReadonly
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("Safe default used")).toBeDefined();
    expect(screen.queryByText("Save weekly context")).toBeNull();
  });

  it("keeps field changes local until the owner submits the form", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<WeekContextForm onSave={onSave} />);

    fireEvent.click(screen.getByRole("radio", { name: /No promotion/ }));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("ctaType"), { target: { value: "none" } });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.submit(screen.getByRole("button", { name: /Save weekly context/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

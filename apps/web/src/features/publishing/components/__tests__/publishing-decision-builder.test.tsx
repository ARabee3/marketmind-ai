import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
  PublishingTargetPublicV1,
} from "@marketmind/contracts";
import type { PublishingIntentDetailView } from "@/lib/api/publishing";
import { PublishingDecisionBuilder } from "../publishing-decision-builder";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "formatted date" }),
}));

const candidate = {
  source_state: "active",
  candidate: {
    candidate_id: "candidate-1",
    target_channel: "facebook",
    content_format: "text_post",
    caption: "A single selected post caption",
    strategy_week_number: 1,
    recommended_publish_window: {
      starts_at: "2026-08-12T14:00:00.000Z",
      ends_at: "2026-08-12T17:00:00.000Z",
      timezone: "Africa/Cairo",
    },
  },
} as unknown as PublicationCandidateSummaryV1;

const target = {
  target_id: "target-1",
  display_name: "Owner Page",
  channel: "facebook",
  connection_state: "connected",
  capabilities: ["static_image", "text"],
} as unknown as PublishingTargetPublicV1;

const noOp = vi.fn(async () => undefined);

function renderBuilder(
  intent: PublicationIntentV1 | null,
  detail: PublishingIntentDetailView | null = null,
) {
  return render(
    <PublishingDecisionBuilder
      candidate={candidate}
      intent={intent}
      detail={detail}
      targets={[target]}
      onCreate={vi.fn(async () => null)}
      onSchedule={noOp}
      onApprove={noOp}
      onCancel={noOp}
      onDispatch={noOp}
      onRetry={noOp}
      onRefresh={noOp}
      onConnect={vi.fn()}
      onContinue={vi.fn()}
      realIntentExists={Boolean(intent?.mode === "real")}
    />,
  );
}

describe("PublishingDecisionBuilder", () => {
  it("keeps Publish, Export, and Simulation available before a real intent exists", () => {
    renderBuilder(null);

    expect(
      (screen.getByRole("radio", { name: /mode.real/ }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("radio", { name: /mode.export/ }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("radio", {
          name: /mode.simulation/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
  });

  it("prefills the recommended Cairo time and lets the owner change it", () => {
    const intent = {
      intent_id: "intent-1",
      mode: "real",
      state: "draft",
      target_id: null,
      scheduled_local: null,
      scheduled_utc: null,
    } as unknown as PublicationIntentV1;
    renderBuilder(intent);

    const schedule = screen.getByLabelText(
      "schedule.dateLabel",
    ) as HTMLInputElement;
    expect(schedule.value).toBe("2026-08-12T17:00");

    fireEvent.change(schedule, { target: { value: "2026-08-13T18:30" } });
    expect(schedule.value).toBe("2026-08-13T18:30");
    expect(
      (
        screen.getByRole("button", {
          name: "schedule.schedule",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("keeps approval facts grouped and centers both dialogs in RTL", () => {
    const intent = {
      intent_id: "intent-1",
      mode: "real",
      state: "awaiting_approval",
      target_id: "target-1",
      scheduled_local: "2099-08-12T17:00:00",
      scheduled_utc: "2099-08-12T14:00:00.000Z",
    } as unknown as PublicationIntentV1;
    renderBuilder(intent);

    const localValue = screen.getByText("2099-08-12T17:00:00");
    expect(localValue.parentElement?.textContent).toContain("schedule.local");

    fireEvent.click(screen.getByRole("button", { name: "decision.approve" }));
    const approvalDialog = screen.getByRole("dialog");
    expect(approvalDialog.className.split(/\s+/)).toContain("left-1/2");
    expect(approvalDialog.className.split(/\s+/)).not.toContain("start-1/2");

    fireEvent.click(screen.getByRole("button", { name: "dialog.cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "decision.cancel" }));
    const cancellationDialog = screen.getByRole("dialog");
    expect(cancellationDialog.className.split(/\s+/)).toContain("left-1/2");
    expect(cancellationDialog.className.split(/\s+/)).not.toContain(
      "start-1/2",
    );
  });

  it("makes approval and cancellation explicitly scoped to one selected post", () => {
    const intent = {
      intent_id: "intent-1",
      mode: "real",
      state: "awaiting_approval",
      target_id: "target-1",
      scheduled_local: "2099-08-12T17:00:00",
      scheduled_utc: "2099-08-12T14:00:00.000Z",
    } as unknown as PublicationIntentV1;

    renderBuilder(intent);

    expect(screen.getByText("decision.scopeOnly")).toBeDefined();
    expect(screen.getByText("decision.scopeHelp")).toBeDefined();
    expect(screen.getByText("A single selected post caption")).toBeDefined();
    expect(screen.getByText("decision.approvalScope")).toBeDefined();
    expect(screen.getByText("decision.cancelHelp")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "decision.approve" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "decision.cancel" }),
    ).toBeDefined();
  });

  it("shows a safe recovery message instead of a provider error code", () => {
    const intent = {
      intent_id: "intent-1",
      mode: "real",
      state: "failed",
      version: 3,
    } as unknown as PublicationIntentV1;
    const detail = {
      publication_intent: intent,
      approval: null,
      target,
      attempts: [{ state: "failed", attempt_number: 1 }],
      results: [
        {
          outcome: "failed",
          error_code: "PUBLISHING_PROVIDER_FAILURE",
          retryable: true,
        },
      ],
    } as unknown as PublishingIntentDetailView;

    renderBuilder(intent, detail);

    expect(screen.getByText("decision.retryableFailure")).toBeDefined();
    expect(screen.queryByText("PUBLISHING_PROVIDER_FAILURE")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "decision.retry",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

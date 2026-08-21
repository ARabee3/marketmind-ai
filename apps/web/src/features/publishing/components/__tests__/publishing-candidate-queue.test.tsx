import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
} from "@marketmind/contracts";
import { PublishingCandidateQueue } from "../publishing-candidate-queue";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";
const INTENT_ID = "22222222-2222-4222-8222-222222222222";

function candidate(): PublicationCandidateSummaryV1 {
  return {
    candidate: {
      candidate_id: CANDIDATE_ID,
      strategy_week_number: 1,
      target_channel: "facebook",
      content_format: "text_post",
      selected_locale: "ar",
      caption: "بوست تجريبي",
    } as PublicationCandidateSummaryV1["candidate"],
    source_state: "active",
    source_state_version: 1,
    active_intent_id: INTENT_ID,
    received_at: "2026-08-21T08:00:00.000Z",
  };
}

function publishedIntent(): PublicationIntentV1 {
  return {
    intent_id: INTENT_ID,
    candidate_id: CANDIDATE_ID,
    state: "succeeded",
    mode: "real",
    published_post_url: "https://facebook.example/post-1",
  } as PublicationIntentV1;
}

describe("PublishingCandidateQueue", () => {
  it("localizes post metadata and gives published posts an external link", () => {
    render(
      <PublishingCandidateQueue
        week={1}
        candidates={[candidate()]}
        intents={[publishedIntent()]}
        selectedCandidateId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByText("queue.metadata.channel.facebook"),
    ).not.toBeNull();
    expect(
      screen.getByText("queue.metadata.format.textPost"),
    ).not.toBeNull();
    expect(
      screen.getByText("queue.metadata.locale.arabic"),
    ).not.toBeNull();

    const link = screen.getByRole("link", {
      name: "queue.viewPublishedPost",
    });
    expect(link.getAttribute("href")).toBe(
      "https://facebook.example/post-1",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

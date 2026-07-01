import { progressEventsFromPersistence } from "./discovery-progress.mapper";

describe("progressEventsFromPersistence", () => {
  it("preserves query planning and filtering stages for recovered progress", () => {
    const events = progressEventsFromPersistence([
      progressEvent("query_planning"),
      progressEvent("filtering"),
      progressEvent("persisting"),
    ]);

    expect(events.map((event) => event.stage)).toEqual([
      "query_planning",
      "filtering",
      "persisting",
    ]);
  });
});

function progressEvent(stage: string) {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    seq: 1,
    stage,
    status: "completed",
    messageKey: `discovery.${stage}.completed`,
    messageText: stage,
    payload: {},
    createdAt: new Date("2026-06-29T10:01:00.000Z"),
  };
}

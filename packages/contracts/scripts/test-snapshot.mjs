import fs from "fs/promises";
import assert from "assert";

const SNAPSHOT_PATH = new URL(
  "../schema-snapshots/strategy-v1.snapshot.json",
  import.meta.url,
);
const STRATEGY_V2_SNAPSHOT_PATH = new URL(
  "../schema-snapshots/strategy-v2.snapshot.json",
  import.meta.url,
);
const CONTENT_SNAPSHOT_PATH = new URL(
  "../schema-snapshots/content-v1.snapshot.json",
  import.meta.url,
);
const PUBLISHING_SNAPSHOT_PATH = new URL(
  "../schema-snapshots/publishing-v1.snapshot.json",
  import.meta.url,
);
const EXAMPLES_DIR = new URL("../examples/", import.meta.url);
const WORKFLOW_FIXTURES_DIR = new URL(
  "../../../infra/n8n/fixtures/",
  import.meta.url,
);

async function run() {
  const snapshotData = await fs.readFile(SNAPSHOT_PATH, "utf-8");
  const snapshot = JSON.parse(snapshotData);

  const briefData = await fs.readFile(
    new URL("strategy-brief.example.json", EXAMPLES_DIR),
    "utf-8",
  );
  const brief = JSON.parse(briefData);

  const planData = await fs.readFile(
    new URL("strategy-plan.example.json", EXAMPLES_DIR),
    "utf-8",
  );
  const plan = JSON.parse(planData);

  const packData = await fs.readFile(
    new URL("strategy-retrieval-pack.example.json", EXAMPLES_DIR),
    "utf-8",
  );
  const pack = JSON.parse(packData);

  // Assert backward compatibility (fields in snapshot must exist in current schema)
  for (const field of snapshot.StrategyBrief) {
    assert(
      field in brief,
      `Backward compatibility failure: StrategyBrief is missing field '${field}'`,
    );
  }
  for (const field of snapshot.StrategyPlan) {
    assert(
      field in plan,
      `Backward compatibility failure: StrategyPlan is missing field '${field}'`,
    );
  }
  for (const field of snapshot.RetrievedKnowledgePack) {
    assert(
      field in pack,
      `Backward compatibility failure: RetrievedKnowledgePack is missing field '${field}'`,
    );
  }

  // Owner-first strategy-v2 surfaces (issue #135).
  const v2Snapshot = JSON.parse(
    await fs.readFile(STRATEGY_V2_SNAPSHOT_PATH, "utf-8"),
  );
  const v2Brief = JSON.parse(
    await fs.readFile(
      new URL("strategy-brief-v2.example.json", EXAMPLES_DIR),
      "utf-8",
    ),
  );
  const v2Plan = JSON.parse(
    await fs.readFile(
      new URL("strategy-plan-v2.example.json", EXAMPLES_DIR),
      "utf-8",
    ),
  );
  for (const field of v2Snapshot.StrategyBriefV2) {
    assert(
      field in v2Brief,
      `Backward compatibility failure: StrategyBriefV2 is missing field '${field}'`,
    );
  }
  for (const field of v2Snapshot.StrategyPlanV2) {
    assert(
      field in v2Plan,
      `Backward compatibility failure: StrategyPlanV2 is missing field '${field}'`,
    );
  }
  // Optional snapshot fields are asserted against a synthetic choice object so
  // optionality never breaks the backward-compatibility check.
  const syntheticChoice = {
    channel: "instagram",
    role: "supporting",
    setup_state: "connected",
    public_url: "https://instagram.com/kosharycorner",
    publishing_target_id: "00000000-0000-4000-8000-000000000000",
    note: "owner note",
  };
  for (const field of v2Snapshot.StrategyChannelChoice) {
    assert(
      field in syntheticChoice,
      `Backward compatibility failure: StrategyChannelChoice is missing field '${field}'`,
    );
  }
  for (const field of v2Snapshot.ChannelCommitment) {
    assert(
      field in v2Plan.channel_commitments[0],
      `Backward compatibility failure: ChannelCommitment is missing field '${field}'`,
    );
  }
  if (v2Plan.content_handoff.available === true) {
    for (const field of v2Snapshot.ContentHandoffAvailable) {
      assert(
        field in v2Plan.content_handoff,
        `Backward compatibility failure: ContentHandoffAvailable is missing field '${field}'`,
      );
    }
  }

  const contentSnapshotData = await fs.readFile(CONTENT_SNAPSHOT_PATH, "utf-8");
  const contentSnapshot = JSON.parse(contentSnapshotData);

  const fixtureFor = {
    ContentCycle: "content-cycle.example.json",
    ContentWeekContext: "content-week-context-safe-default.example.json",
    ContentPack: "content-pack-week-1-en.example.json",
    ContentItemVersion: "content-item-version-generated-asset.example.json",
    ContentDecision: "content-decision-approved.example.json",
    PublicationCandidateV1: "publication-candidate-approved.example.json",
    PublicationCandidateStatusV1:
      "publication-candidate-status-active.example.json",
    PublicationCandidateCreatedEventV1:
      "publication-candidate-created-event.example.json",
    PublicationCandidateStateChangedEventV1:
      "publication-candidate-state-changed-event.example.json",
  };

  for (const [surface, fixtureName] of Object.entries(fixtureFor)) {
    const fixture = JSON.parse(
      await fs.readFile(new URL(fixtureName, EXAMPLES_DIR), "utf-8"),
    );
    for (const field of contentSnapshot[surface]) {
      assert(
        field in fixture,
        `Backward compatibility failure: ${surface} is missing field '${field}'`,
      );
    }
  }

  const publishingSnapshot = JSON.parse(
    await fs.readFile(PUBLISHING_SNAPSHOT_PATH, "utf-8"),
  );
  const publishingCandidate = JSON.parse(
    await fs.readFile(
      new URL("publication-candidate-approved.example.json", EXAMPLES_DIR),
      "utf-8",
    ),
  );
  const publishingCandidateStatus = JSON.parse(
    await fs.readFile(
      new URL("publication-candidate-status-active.example.json", EXAMPLES_DIR),
      "utf-8",
    ),
  );
  const publishingCandidateCreatedEvent = JSON.parse(
    await fs.readFile(
      new URL("publication-candidate-created-event.example.json", EXAMPLES_DIR),
      "utf-8",
    ),
  );
  const publishingFixtures = {
    PublicationCandidateRecordV1: {
      contract_version: "publishing-candidate-record-v1",
      candidate_id: publishingCandidate.candidate_id,
      event_id: publishingCandidateCreatedEvent.event_id,
      business_id: publishingCandidate.business_id,
      candidate_checksum: publishingCandidate.candidate_checksum,
      event_fingerprint: "0".repeat(64),
      source_state: publishingCandidateStatus.candidate_state,
      source_state_version: publishingCandidateStatus.state_version,
      source_status: publishingCandidateStatus,
      received_at: publishingCandidateCreatedEvent.occurred_at,
      payload: publishingCandidate,
    },
    PublishingTargetV1: JSON.parse(
      await fs.readFile(
        new URL("publishing-target-connected.example.json", EXAMPLES_DIR),
        "utf-8",
      ),
    ),
    PublicationIntentV1: JSON.parse(
      await fs.readFile(
        new URL("publication-intent-real-scheduled.example.json", EXAMPLES_DIR),
        "utf-8",
      ),
    ),
    PublicationApprovalSnapshotV1: JSON.parse(
      await fs.readFile(
        new URL("publication-approval-real.example.json", EXAMPLES_DIR),
        "utf-8",
      ),
    ),
    PublicationAttemptV1: JSON.parse(
      await fs.readFile(
        new URL("publication-attempt-running.example.json", EXAMPLES_DIR),
        "utf-8",
      ),
    ),
    PublicationResultV1: JSON.parse(
      await fs.readFile(
        new URL("publication-result-published.example.json", EXAMPLES_DIR),
        "utf-8",
      ),
    ),
    SignedPublicationDispatchEnvelopeV1: JSON.parse(
      await fs.readFile(
        new URL("publishing-dispatch-real.example.json", WORKFLOW_FIXTURES_DIR),
        "utf-8",
      ),
    ),
    SignedPublicationCallbackEnvelopeV1: JSON.parse(
      await fs.readFile(
        new URL(
          "publishing-callback-published.example.json",
          WORKFLOW_FIXTURES_DIR,
        ),
        "utf-8",
      ),
    ),
  };
  publishingFixtures.PublicationDispatchBodyV1 =
    publishingFixtures.SignedPublicationDispatchEnvelopeV1.body;
  publishingFixtures.PublicationCallbackBodyV1 =
    publishingFixtures.SignedPublicationCallbackEnvelopeV1.body;

  for (const [surface, fixture] of Object.entries(publishingFixtures)) {
    for (const field of publishingSnapshot[surface]) {
      assert(
        field in fixture,
        `Backward compatibility failure: ${surface} is missing field '${field}'`,
      );
    }
  }

  console.log("Schema snapshot backward compatibility test passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

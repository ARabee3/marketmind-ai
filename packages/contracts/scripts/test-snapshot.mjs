import fs from "fs/promises";
import assert from "assert";

const SNAPSHOT_PATH = new URL(
  "../schema-snapshots/strategy-v1.snapshot.json",
  import.meta.url,
);
const CONTENT_SNAPSHOT_PATH = new URL(
  "../schema-snapshots/content-v1.snapshot.json",
  import.meta.url,
);
const EXAMPLES_DIR = new URL("../examples/", import.meta.url);

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

  console.log("Schema snapshot backward compatibility test passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

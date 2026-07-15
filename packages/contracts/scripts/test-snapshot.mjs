import fs from "fs/promises";
import assert from "assert";

const SNAPSHOT_PATH = new URL(
  "../schema-snapshots/strategy-v1.snapshot.json",
  import.meta.url,
);
const EXAMPLES_DIR = new URL("../examples/", import.meta.url);

async function run() {
  const snapshotData = await fs.readFile(SNAPSHOT_PATH, "utf-8");
  const snapshot = JSON.parse(snapshotData);

  const briefData = await fs.readFile(new URL("strategy-brief.example.json", EXAMPLES_DIR), "utf-8");
  const brief = JSON.parse(briefData);

  const planData = await fs.readFile(new URL("strategy-plan.example.json", EXAMPLES_DIR), "utf-8");
  const plan = JSON.parse(planData);

  const packData = await fs.readFile(new URL("strategy-retrieval-pack.example.json", EXAMPLES_DIR), "utf-8");
  const pack = JSON.parse(packData);

  // Assert backward compatibility (fields in snapshot must exist in current schema)
  for (const field of snapshot.StrategyBrief) {
    assert(field in brief, `Backward compatibility failure: StrategyBrief is missing field '${field}'`);
  }
  for (const field of snapshot.StrategyPlan) {
    assert(field in plan, `Backward compatibility failure: StrategyPlan is missing field '${field}'`);
  }
  for (const field of snapshot.RetrievedKnowledgePack) {
    assert(field in pack, `Backward compatibility failure: RetrievedKnowledgePack is missing field '${field}'`);
  }

  console.log("Schema snapshot backward compatibility test passed.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

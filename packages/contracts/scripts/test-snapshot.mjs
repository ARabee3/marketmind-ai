import fs from "fs/promises";
import path from "path";
import assert from "assert";

const SNAPSHOT_PATH = path.join(process.cwd(), "packages/contracts/schema-snapshots/strategy-v1.snapshot.json");
const EXAMPLES_DIR = path.join(process.cwd(), "packages/contracts/examples");

async function run() {
  const snapshotData = await fs.readFile(SNAPSHOT_PATH, "utf-8");
  const snapshot = JSON.parse(snapshotData);

  const briefData = await fs.readFile(path.join(EXAMPLES_DIR, "strategy-brief.example.json"), "utf-8");
  const brief = JSON.parse(briefData);

  const planData = await fs.readFile(path.join(EXAMPLES_DIR, "strategy-plan.example.json"), "utf-8");
  const plan = JSON.parse(planData);

  const packData = await fs.readFile(path.join(EXAMPLES_DIR, "strategy-retrieval-pack.example.json"), "utf-8");
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

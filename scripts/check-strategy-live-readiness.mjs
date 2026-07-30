import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import matter from "gray-matter";

const repoRoot = process.cwd();
const approvalRecordPath = path.join(
  repoRoot,
  "Docs/marketing-knowledge/APPROVAL_RECORD.md",
);
const frameworkPaths = [
  "Docs/marketing-knowledge/frameworks/situation-diagnosis-5cs-swot.md",
  "Docs/marketing-knowledge/frameworks/smart-objectives-funnel-mapping.md",
];
const requiredReviewers = [
  "ARabee3",
  "mostafamerzk",
  "abdulazimRabie",
  "MostafaAhmed22",
  "GergesYoussef-hub",
];
const requiredLiveProof = [
  "Corpus validation after approval",
  "Committed PostgreSQL and Qdrant ingestion",
  "Arabic live framework_diagnosis retrieval",
  "English live framework_diagnosis retrieval",
  "Live Strategy generation without MISSING_FRAMEWORK_DATA",
];

function checkedRecord(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^- \\[x\\] ${escaped}(?:\\s|$)`, "mi").test(text);
}

function metadataChecks(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const { data } = matter(fs.readFileSync(absolutePath, "utf8"));
  return {
    entry: data.slug ?? relativePath,
    approved: data.review_status === "approved",
    reviewerRecorded:
      typeof data.reviewer === "string" && data.reviewer.trim().length > 0,
    reviewedAtRecorded:
      typeof data.reviewed_at === "string" && data.reviewed_at.trim().length > 0,
  };
}

if (!fs.existsSync(approvalRecordPath)) {
  console.error(`Missing approval record: ${approvalRecordPath}`);
  process.exit(2);
}

const approvalRecord = fs.readFileSync(approvalRecordPath, "utf8");
const entryChecks = frameworkPaths.map(metadataChecks);
const reviewerChecks = requiredReviewers.map((reviewer) => ({
  reviewer,
  approved: checkedRecord(approvalRecord, `@${reviewer}`),
}));
const liveProofChecks = requiredLiveProof.map((proof) => ({
  proof,
  recorded: checkedRecord(approvalRecord, proof),
}));
const ready = [
  ...entryChecks.flatMap((entry) => [
    entry.approved,
    entry.reviewerRecorded,
    entry.reviewedAtRecorded,
  ]),
  ...reviewerChecks.map((reviewer) => reviewer.approved),
  ...liveProofChecks.map((proof) => proof.recorded),
].every(Boolean);

console.log(
  JSON.stringify(
    {
      strategyLiveReady: ready,
      issue: 103,
      entries: entryChecks,
      reviewers: reviewerChecks,
      liveProof: liveProofChecks,
    },
    null,
    2,
  ),
);

if (!ready) {
  console.error(
    "\nStrategy live readiness is blocked. Humans must approve the two framework entries and record real PostgreSQL/Qdrant retrieval and generation evidence. Automation must not mark these checks complete.",
  );
  process.exitCode = 2;
}

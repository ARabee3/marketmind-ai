ALTER TABLE "content_assets"
  ALTER COLUMN "content_item_version_id" DROP NOT NULL;

CREATE TABLE "content_item_version_assets" (
    "content_item_version_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,

    CONSTRAINT "content_item_version_assets_pkey" PRIMARY KEY ("content_item_version_id", "asset_id")
);

INSERT INTO "content_item_version_assets" ("content_item_version_id", "asset_id")
SELECT "content_item_version_id", "id"
FROM "content_assets"
WHERE "content_item_version_id" IS NOT NULL;

CREATE INDEX "content_item_version_assets_asset_id_idx"
  ON "content_item_version_assets"("asset_id");

ALTER TABLE "content_item_version_assets"
  ADD CONSTRAINT "content_item_version_assets_content_item_version_id_fkey"
  FOREIGN KEY ("content_item_version_id") REFERENCES "content_item_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "content_item_version_assets"
  ADD CONSTRAINT "content_item_version_assets_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "content_assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

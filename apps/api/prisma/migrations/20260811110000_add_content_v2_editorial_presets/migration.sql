ALTER TABLE "content_editorial_profiles"
  ADD COLUMN "tone_preset" TEXT NOT NULL DEFAULT 'recommended',
  ADD COLUMN "length_preset" TEXT NOT NULL DEFAULT 'balanced';

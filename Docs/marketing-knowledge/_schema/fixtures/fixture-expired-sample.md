---
slug: fixture-expired-sample
version: 1
kind: benchmark_report
title: "Fixture: Expired Sample Entry"
summary: >
  Intentionally-invalid fixture used only to test the validator's
  expiry-unavailability behaviour. Must never become a live retrieval
  result. Not part of the real corpus.
locale: en
markets: [egypt]
industries: [general]
business_models: []
objectives: [awareness]
funnel_stages: [awareness]
channels: [facebook]
seasons: []
budget_modes: []
evidence_tier: contextual_note
review_status: approved
source_references:
  - "internal:reviewed-marketing-methodology"
effective_at: "2020-01-01"
expires_at: "2020-02-01"
author: "abdulazimRabie"
reviewer: "ARabee3"
reviewed_at: "2020-01-15"
checksum: ""
---

## Purpose

This entry exists only so the authoring validator can confirm that an entry
past its `expires_at` is flagged as unavailable for live retrieval. It is not
part of the real corpus and must never be ingested.
# publishing-v1 workflow fixtures

These are the canonical authenticated dispatch and callback examples for the
future n8n workflow in issue #120. The manifest points to the frozen Content
candidate fixtures instead of copying them.

`canonical_content_*` entries are repository-relative references consumed by
the publishing contract check. `canonical_asset_bytes_utf8` supplies deterministic
retrieved bytes whose SHA-256 digest is frozen in the candidate and dispatch.
The check fails if the embedded n8n candidate/status drifts or if retrieved
bytes do not match that digest.

`fixture_secret` is public test data used only to prove canonical HMAC behavior.
It must never be used as a deployed webhook secret.

Validate the fixtures from the repository root:

```bash
npm --workspace @marketmind/contracts run check:publishing
```

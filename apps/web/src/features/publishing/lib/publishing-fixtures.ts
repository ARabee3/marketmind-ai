import type {
  CurrentJourneyResponse,
  PublicationCandidateSummaryV1,
  PublicationCandidateV1,
  PublicationIntentV1,
  PublishingTargetPublicV1,
} from "@marketmind/contracts";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STRATEGY_ID = "22222222-2222-4222-8222-222222222222";
const CONTENT_CYCLE_ID = "33333333-3333-4333-8333-333333333333";

const baseCandidate: PublicationCandidateV1 = {
  contract_version: "publication-candidate-v1",
  candidate_id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
  business_id: BUSINESS_ID,
  strategy_id: STRATEGY_ID,
  strategy_version: 1,
  content_cycle_id: CONTENT_CYCLE_ID,
  strategy_week_number: 1,
  content_pack_id: "77777777-7777-4777-8777-777777777777",
  content_item_id: "88888888-8888-4888-8888-888888888888",
  content_item_version_id: "99999999-9999-4999-8999-999999999999",
  content_item_version: 1,
  content_item_version_checksum: "item-version-checksum-week-1-ar",
  target_channel: "facebook",
  content_format: "static_image_post",
  selected_locale: "ar",
  caption:
    "ابدأ الأسبوع بعرض واضح من متجر الندى. اطلب عبر واتساب وخدمة التوصيل متاحة داخل المنطقة.",
  cta: "راسلنا على واتساب",
  hashtags: ["#متجر_الندى", "#عروض_محلية"],
  alt_text: "منتج من متجر الندى مع بطاقة عرض أسبوعية واضحة.",
  assets: [
    {
      asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "owner_supplied",
      mime_type: "image/jpeg",
      storage_key: "content/111/week-1/owner-product.jpg",
      checksum:
        "101954615d862e6921a9fb7e2f5866170d3d375d6e8eb4a7443ea1e30cd2a0e4",
    },
  ],
  recommended_publish_window: {
    starts_at: "2026-08-03T18:00:00+03:00",
    ends_at: "2026-08-03T21:00:00+03:00",
    timezone: "Africa/Cairo",
  },
  approval: {
    decision_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    decision: "approved",
    content_item_version_id: "99999999-9999-4999-8999-999999999999",
    content_item_version_checksum: "item-version-checksum-week-1-ar",
    decided_by_user_id: OWNER_ID,
    decided_at: "2026-08-01T11:00:00+03:00",
  },
  candidate_checksum:
    "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
  created_at: "2026-08-01T11:01:00+03:00",
};

export const PUBLISHING_CANDIDATE_FIXTURES: readonly PublicationCandidateSummaryV1[] =
  [
    {
      candidate: baseCandidate,
      source_state: "active",
      source_state_version: 1,
      active_intent_id: null,
      received_at: "2026-08-01T11:01:00+03:00",
    },
    {
      candidate: {
        ...baseCandidate,
        candidate_id: "dededede-dede-4ded-8ded-dededededede",
        strategy_week_number: 2,
        selected_locale: "en",
        caption:
          "A clear weekly offer for Al Nada customers. Message us on WhatsApp and we will arrange delivery nearby.",
        cta: "Message us on WhatsApp",
        hashtags: ["#LocalOffer", "#AlNada"],
        alt_text: "A weekly offer card beside a product from Al Nada shop.",
        recommended_publish_window: {
          starts_at: "2026-08-10T18:00:00+03:00",
          ends_at: "2026-08-10T21:00:00+03:00",
          timezone: "Africa/Cairo",
        },
        candidate_checksum:
          "c5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3554",
        created_at: "2026-08-02T11:01:00+03:00",
      },
      source_state: "active",
      source_state_version: 1,
      active_intent_id: "13131313-1313-4131-8131-131313131313",
      received_at: "2026-08-02T11:01:00+03:00",
    },
    {
      candidate: {
        ...baseCandidate,
        candidate_id: "efefefef-efef-4efe-8fef-efefefefefef",
        strategy_week_number: 4,
        selected_locale: "ar",
        caption: "اختيار جديد من متجر الندى مع دعوة واضحة للتواصل والطلب.",
        cta: "اطلب الآن",
        candidate_checksum:
          "d5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3665",
        created_at: "2026-08-03T11:01:00+03:00",
      },
      source_state: "revoked",
      source_state_version: 2,
      active_intent_id: null,
      received_at: "2026-08-03T11:01:00+03:00",
    },
  ];

export const PUBLISHING_TARGET_FIXTURES: readonly PublishingTargetPublicV1[] = [
  {
    contract_version: "publishing-target-v1",
    target_id: "12121212-1212-4121-8121-121212121212",
    version: 1,
    business_id: BUSINESS_ID,
    provider: "meta",
    channel: "facebook",
    external_account_id: "fixture-page-1001",
    display_name: "Al Nada Fixture Page",
    connection_state: "connected",
    capabilities: ["static_image"],
    last_verified_at: "2026-08-01T08:00:00Z",
  },
];

/**
 * Future-dated schedule pair for fixtures. The owner approval dialog refuses
 * past dates (`new Date(scheduled_utc) <= Date.now()`), so fixed calendar
 * dates rot the fixtures as time passes. `scheduled_local` is the same
 * instant formatted in the fixture's Africa/Cairo time zone.
 */
export function futureSchedulePair(hoursAhead = 2): {
  scheduled_local: string
  scheduled_utc: string
} {
  const utc = new Date(Date.now() + hoursAhead * 3_600_000)
  utc.setSeconds(0, 0)
  utc.setMilliseconds(0)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utc)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    scheduled_local: `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`,
    scheduled_utc: utc.toISOString(),
  }
}

const FUTURE_SCHEDULE = futureSchedulePair()

export const PUBLISHING_INTENT_FIXTURE: PublicationIntentV1 = {
  contract_version: "publication-intent-v1",
  intent_id: "13131313-1313-4131-8131-131313131313",
  version: 2,
  business_id: BUSINESS_ID,
  candidate_id: "dededede-dede-4ded-8ded-dededededede",
  candidate_checksum:
    "c5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3554",
  mode: "real",
  target_id: "12121212-1212-4121-8121-121212121212",
  scheduled_local: FUTURE_SCHEDULE.scheduled_local,
  time_zone: "Africa/Cairo",
  scheduled_utc: FUTURE_SCHEDULE.scheduled_utc,
  state: "scheduled",
  approved_decision_id: "14141414-1414-8141-141414141414",
  created_by_user_id: OWNER_ID,
  created_at: "2026-08-02T11:30:00Z",
  updated_at: "2026-08-02T12:00:00Z",
};

export const PUBLISHING_JOURNEY_FIXTURE: CurrentJourneyResponse = {
  owner: {
    user_id: OWNER_ID,
    full_name: "Ahmed Hassan",
    email: "owner@example.com",
    email_verified: true,
  },
  journey: {
    state: "discovery_confirmed",
    discovery: {
      session_id: "22222222-2222-4222-8222-222222222222",
      status: "confirmed",
      language_mode: "ar-EG",
      business_summary: {
        business_name: "Al Nada Shop",
        business_type: "Retail shop",
        city: "Assiut",
        area: "Assiut City",
      },
      readiness: {
        ready: true,
        profile_readiness: 0.92,
        owner_turn_count: 6,
        max_owner_turns: 15,
      },
      profile_draft_id: null,
      confirmed_profile_version_id: "44444444-4444-4444-8444-444444444444",
      updated_at: "2026-07-17T10:00:00.000Z",
      completed_at: "2026-07-17T10:05:00.000Z",
    },
    profile: {
      business_profile_version_id: "44444444-4444-4444-8444-444444444444",
      business_id: BUSINESS_ID,
      version: 1,
      business_name: "Al Nada Shop",
      business_type: "Retail shop",
      city: "Assiut",
      area: "Assiut City",
      confirmed_at: "2026-07-17T10:05:00.000Z",
    },
  },
  future_phase: {
    phase: "strategy",
    availability: "available",
    status: "approved",
    reason: "strategy_active",
    strategy_id: STRATEGY_ID,
    current_version_id: "55555555-5555-4555-8555-555555555555",
    destination: `/strategy/${STRATEGY_ID}`,
    business: {
      business_name: "Al Nada Shop",
      business_type: "Retail shop",
      city: "Assiut",
      area: "Assiut City",
      profile_version: 1,
    },
  },
  primary_action: {
    type: "view_strategy",
    strategy_id: STRATEGY_ID,
    destination: `/strategy/${STRATEGY_ID}`,
  },
  content: {
    ready: true,
    reason: "cycle_active",
    cycle: {
      id: CONTENT_CYCLE_ID,
      status: "active",
      current_week: 3,
    },
    pack: {
      id: "77777777-7777-4777-8777-777777777777",
      status: "ready",
      week_number: 3,
      failed: false,
      pending_decisions: 1,
    },
  },
  generated_at: "2026-08-04T10:06:00.000Z",
};

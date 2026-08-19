import type {
  OptimizationProposalWorkspaceV1,
  PerformanceMetricsV1,
  PerformanceOverviewV1,
  PerformancePostProjectionV1,
  PerformanceSnapshotProjectionV1,
  PerformanceSyncWindowV1,
  PerformanceWindow,
} from '@marketmind/contracts'

const DEMO_BUSINESS_ID = 'a1000000-0000-4000-8000-000000000001'
const DEMO_GENERATED_AT = '2026-08-18T08:00:00.000Z'

type DemoPostConfig = {
  readonly candidateId: string
  readonly resultId: string
  readonly providerObjectId: string
  readonly publishedAt: string
  readonly values: Readonly<
    Record<PerformanceWindow, readonly [number, number, number]>
  >
}

const DEMO_POSTS: readonly DemoPostConfig[] = [
  {
    candidateId: 'a1000000-0000-4000-8000-000000000101',
    resultId: 'a1000000-0000-4000-8000-000000000102',
    providerObjectId: 'demo-facebook-post-1',
    publishedAt: '2026-08-08T08:00:00.000Z',
    values: {
      '24h': [72, 54, 6],
      '72h': [88, 68, 8],
      '7d': [100, 80, 9],
    },
  },
  {
    candidateId: 'a1000000-0000-4000-8000-000000000103',
    resultId: 'a1000000-0000-4000-8000-000000000104',
    providerObjectId: 'demo-facebook-post-2',
    publishedAt: '2026-08-09T08:00:00.000Z',
    values: {
      '24h': [86, 64, 7],
      '72h': [104, 78, 9],
      '7d': [120, 94, 10],
    },
  },
  {
    candidateId: 'a1000000-0000-4000-8000-000000000105',
    resultId: 'a1000000-0000-4000-8000-000000000106',
    providerObjectId: 'demo-facebook-post-3',
    publishedAt: '2026-08-10T08:00:00.000Z',
    values: {
      '24h': [98, 74, 8],
      '72h': [122, 92, 10],
      '7d': [140, 108, 11],
    },
  },
]

const WINDOW_HOURS: Readonly<Record<PerformanceWindow, number>> = {
  '24h': 24,
  '72h': 72,
  '7d': 168,
}

function addHours(value: string, hours: number): string {
  return new Date(
    new Date(value).getTime() + hours * 60 * 60 * 1000
  ).toISOString()
}

function metrics(
  values: readonly [number, number, number]
): PerformanceMetricsV1 {
  return {
    post_media_view: { status: 'available', value: values[0] },
    post_total_media_view_unique: { status: 'available', value: values[1] },
    post_clicks: { status: 'available', value: values[2] },
  }
}

function snapshot(
  config: DemoPostConfig,
  window: PerformanceWindow,
  snapshotIndex: number
): PerformanceSnapshotProjectionV1 {
  const dueAt = addHours(config.publishedAt, WINDOW_HOURS[window])
  const observedAt = dueAt
  return {
    contract_version: 'performance-v1',
    snapshot_id: `a1000000-0000-4000-8000-000000000${String(snapshotIndex).padStart(3, '0')}`,
    business_id: DEMO_BUSINESS_ID,
    publishing_result_id: config.resultId,
    provider: 'facebook',
    provider_object_id: config.providerObjectId,
    window,
    published_at: config.publishedAt,
    observed_at: observedAt,
    fetched_at: addHours(observedAt, 1 / 60),
    metrics: metrics(config.values[window]),
  }
}

function syncWindow(
  config: DemoPostConfig,
  window: PerformanceWindow,
  windowIndex: number
): PerformanceSyncWindowV1 {
  const dueAt = addHours(config.publishedAt, WINDOW_HOURS[window])
  return {
    contract_version: 'performance-v1',
    sync_window_id: `a2000000-0000-4000-8000-000000000${String(windowIndex).padStart(3, '0')}`,
    business_id: DEMO_BUSINESS_ID,
    publishing_result_id: config.resultId,
    provider: 'facebook',
    window,
    due_at: dueAt,
    state: 'succeeded',
    attempt_count: 1,
    next_attempt_at: null,
    lease_owner: null,
    lease_expires_at: null,
    last_error_code: null,
    created_at: config.publishedAt,
    updated_at: addHours(dueAt, 1 / 60),
  }
}

function buildDemoPosts(): readonly PerformancePostProjectionV1[] {
  let snapshotIndex = 201
  let windowIndex = 201
  return DEMO_POSTS.map((config) => ({
    contract_version: 'performance-v1',
    business_id: DEMO_BUSINESS_ID,
    candidate_id: config.candidateId,
    publishing_result_id: config.resultId,
    provider: 'facebook',
    provider_object_id: config.providerObjectId,
    published_at: config.publishedAt,
    snapshots: (['24h', '72h', '7d'] as const).map((window) =>
      snapshot(config, window, snapshotIndex++)
    ),
    sync_windows: (['24h', '72h', '7d'] as const).map((window) =>
      syncWindow(config, window, windowIndex++)
    ),
  }))
}

export const PERFORMANCE_DEMO_OVERVIEW: PerformanceOverviewV1 = {
  contract_version: 'performance-v1',
  business_id: DEMO_BUSINESS_ID,
  provider: 'facebook',
  generated_at: DEMO_GENERATED_AT,
  posts: buildDemoPosts(),
  baseline: {
    status: 'ready',
    observed_snapshot_count: 3,
    required_snapshot_count: 3,
    reason: null,
  },
}

const DEMO_7D_SNAPSHOT_IDS = PERFORMANCE_DEMO_OVERVIEW.posts.map(
  (post) => post.snapshots.find((item) => item.window === '7d')!.snapshot_id
)

export function getPerformanceDemoWorkspace(
  locale: string
): OptimizationProposalWorkspaceV1 {
  const arabic = locale.toLowerCase().startsWith('ar')
  return {
    contract_version: 'optimization-v1',
    proposal: {
      contract_version: 'optimization-v1',
      proposal_id: 'a4000000-0000-4000-8000-000000000101',
      business_id: DEMO_BUSINESS_ID,
      strategy_id: 'a4000000-0000-4000-8000-000000000102',
      strategy_version: 2,
      content_cycle_id: 'a4000000-0000-4000-8000-000000000103',
      format_cohort: 'text_post',
      basis_snapshot_ids: DEMO_7D_SNAPSHOT_IDS,
      evidence_checksum:
        'b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0',
      deterministic_comparison: [
        {
          metric: 'post_media_view',
          baseline_median: 120,
          values: [100, 120, 140],
          best_snapshot_id: DEMO_7D_SNAPSHOT_IDS[2],
          best_value: 140,
          delta_from_median: 20,
          delta_percent: 16.666666666666664,
          direction: 'higher_is_better',
        },
        {
          metric: 'post_clicks',
          baseline_median: 10,
          values: [9, 10, 11],
          best_snapshot_id: DEMO_7D_SNAPSHOT_IDS[2],
          best_value: 11,
          delta_from_median: 1,
          delta_percent: 10,
          direction: 'higher_is_better',
        },
      ],
      change_kind: 'hook_style',
      summary: arabic
        ? 'جرّب افتتاحية تبدأ بموقف واضح للعميل.'
        : 'Test a clearer customer situation in the opening sentence.',
      rationale: arabic
        ? 'أقوى منشور في هذه العينة الصغيرة بدأ بعبارة مباشرة.'
        : 'The strongest observed post used a direct opening.',
      uncertainty: arabic
        ? 'العينة صغيرة؛ النتيجة ارتباط ملحوظ وليست إثباتًا للسببية.'
        : 'This is an observed association across a small cohort; it does not establish causality or a universal rule.',
      instruction: arabic
        ? 'في مسودة مستقبلية واحدة، طبّق هذا الاتجاه على الافتتاحية فقط، مع إبقاء الموضوع والجمهور والتنسيق والوسائط والجدول كما هي.'
        : 'For one future draft, apply this wording direction only to the hook; keep the approved topic, audience, format, media, and schedule unchanged.',
      model_version: 'mock-optimization-model',
      prompt_version: 'optimization-prompt-v1',
      generation_fingerprint:
        'c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0',
      status: 'PENDING_OWNER_DECISION',
      created_at: DEMO_GENERATED_AT,
    },
    state: 'PENDING_OWNER_DECISION',
    decision: null,
    instruction: null,
  }
}

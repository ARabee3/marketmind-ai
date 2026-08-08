import type {
  StrategyPlanV2,
  StrategyResource,
  SourcedClaim,
  StrategyBriefV2,
} from '@marketmind/contracts'

type StrategyPlanV2FixtureInput = {
  readonly idSuffix: string
  readonly brief: NonNullable<StrategyResource['brief']>
  readonly retrievalRunId: string
  readonly blockers: StrategyPlanV2['blockers']
}

const claim = (text: string, source: SourcedClaim['source'] = 'model_synthesis'): SourcedClaim => ({
  text,
  source,
  citation_ids: [],
})

function weekFormats(weekNumber: number): string[] {
  const pool: Array<[string, string]> = [
    ['reels', 'photo'],
    ['photo', 'carousel'],
    ['reels', 'photo'],
    ['photo', 'text'],
    ['photo', 'text'],
    ['text', 'carousel'],
    ['reels', 'photo'],
    ['photo', 'text'],
    ['photo', 'carousel'],
    ['photo', 'poll'],
    ['text', 'reels'],
    ['text', 'carousel'],
  ]
  return pool[weekNumber - 1]
}

export function createStrategyPlanV2Fixture({
  idSuffix,
  brief,
  retrievalRunId,
  blockers,
}: StrategyPlanV2FixtureInput): StrategyPlanV2 {
  const weeklyFocus = [
    'تهيئة القنوات المختارة',
    'التعريف بالمطعم',
    'وراء الكواليس',
    'أول تقييم ومشاركة',
    'العروض الموسمية المباشرة',
    'قياس منتصف الرحلة',
    'تكرار أفضل محتوى',
    'الشراكة مع عملاء قريبين',
    'تذكير القائمة في جوجل',
    'بناء عادة الزيارة الأسبوعية',
    'تقييم الأداء والاستعداد للشهر الجديد',
    'خطة الأسابيع الـ12 التالية',
  ]

  return {
    id: `88888888-8888-4888-8888-8888888888${idSuffix === 'draftReady' ? '8' : '9'}`,
    strategy_id: brief.strategy_id,
    version: idSuffix === 'revisionFailed' ? 2 : 1,
    contract_version: 'strategy-v2',
    brief_id: brief.id,
    profile_version: brief.business_profile_version,
    retrieval_run_id: retrievalRunId,
    goal: claim('جذب عملاء جدد في أوقات الغداء من المكاتب القريبة خلال 12 أسبوعاً.'),
    primary_objective: 'acquisition',
    funnel_stage: 'awareness_to_purchase',
    plan_language: 'ar-EG',
    start_date: brief.start_date,
    calendar_weeks: Array.from({ length: 12 }, (_, index) => {
      const weekNumber = index + 1
      return {
        week_number: weekNumber,
        focus: weeklyFocus[weekNumber - 1],
        expected_outcome: 'نتيجة واضحة يمكن للمالك ملاحظتها في نهاية الأسبوع.',
        measurement_check: 'مراجعة أرقام القناة في نهاية الأسبوع ومقارنتها بالأسبوع السابق.',
        formats: weekFormats(weekNumber),
      }
    }),
    owner_advice: {
      before_week_1: [
        {
          id: `aaaa0000-0000-4000-8000-0000000000b1`,
          week_number: 0,
          category: 'channel_setup',
          action: 'أكمل بيانات صفحة فيسبوك وقائمة إنستجرام قبل أول نشر.',
          why_it_matters: 'البيانات المكتملة تبني أول انطباع لدى العملاء.',
          timing: 'خلال أول 3 أيام',
          source: claim('توصية من دليل المراجعة المحلي.', 'retrieved_evidence'),
        },
      ],
      weeks: Array.from({ length: 12 }, (_, index) => ({
        week_number: index + 1,
        items: [
          {
            id: `aaaa0000-0000-4000-8000-0000000000${(index + 2).toString(16).padStart(2, '0')}`,
            week_number: index + 1,
            category: 'content' as const,
            action: 'نشر محتوى الأسبوع وتوثيق النتيجة في سطرين.',
            why_it_matters: 'الخطوات الصغيرة المنتظمة تبني نتيجة الخطة.',
            timing: 'قبل نهاية الأسبوع',
            source: claim('مستند إلى قدرة المالك الأسبوعية المؤكدة.', 'owner_input'),
          },
        ],
      })),
    },
    channel_commitments: [
      {
        channel: 'facebook',
        role: 'primary',
        setup_state: 'setup_later',
        capability_state: 'owner_managed',
        rationale: claim('فيسبوك هي القناة الأساسية المختارة؛ الإعداد لاحقاً.', 'owner_input'),
      },
      {
        channel: 'instagram',
        role: 'supporting',
        setup_state: 'existing_link',
        capability_state: 'owner_managed',
        rationale: claim('حساب إنستجرام قائم ويديره المالك مباشرة.', 'owner_input'),
      },
      {
        channel: 'google_business_profile',
        role: 'supporting',
        setup_state: 'existing_link',
        capability_state: 'owner_managed',
        rationale: claim('الملف على جوجل بزنس قائم وله تقييمات.', 'owner_input'),
      },
    ],
    evidence_summary: claim('تعتمد الخطة على ملف النشاط المؤكد وعلى دليل إرشادي مراجع.'),
    risks: [
      claim('التزام المالك محدود؛ أي خطة أكبر من قدرته ستفشل في التنفيذ.', 'owner_input'),
    ],
    knowledge_gaps: blockers.map((blocker) => ({
      category: blocker.field ?? blocker.code,
      description: blocker.message,
      severity: blocker.severity === 'blocking' ? 'blocking' : 'non_critical',
    })),
    blockers,
    citations: [],
    content_handoff: {
      available: true,
      channels: ['facebook', 'instagram', 'google_business_profile'],
      language: 'ar-EG',
      weeks: Array.from({ length: 12 }, (_, index) => ({
        week_number: index + 1,
        formats: (weekFormats(index + 1) as Array<'photo' | 'reels' | 'carousel' | 'text' | 'poll'>)
          .map((label) => {
            if (label === 'reels') return 'short_video_script'
            if (label === 'photo') return 'static_image_post'
            if (label === 'carousel') return 'carousel_brief'
            return 'text_post'
          }),
      })),
    },
    created_at: brief.created_at,
  }
}

export function isV2Brief(brief: NonNullable<StrategyResource['brief']>): brief is StrategyBriefV2 {
  return Array.isArray((brief as StrategyBriefV2).channel_choices)
}

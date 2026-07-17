export type LandingLocale = 'ar' | 'en';

export type EvidenceTag = {
  label: string;
  latin?: string;
  type: 'provider' | 'known' | 'review';
};

export type RoadmapCard = {
  no: string;
  title: string;
  en: string;
  output: string;
  desc: string;
  status: 'live' | 'planned';
  statusLabel: string;
};

export type DiscoveryStep = {
  no: string;
  label: string;
  desc: string;
  chips: string[];
};

export type LandingCopy = {
  nav: {
    links: { href: string; label: string }[];
    aria: string;
    login: string;
    signup: string;
    openMenu: string;
    closeMenu: string;
    language: string;
    languageLabel: string;
  };
  shell: { skip: string };
  hero: {
    badge: string;
    title: string;
    body: string;
    note: string;
    noteLink: string;
    primary: string;
    secondary: string;
    preview: {
      steps: { step: string; title: string; mono: string; text: string }[];
    };
  };
  capability: {
    eyebrow: string;
    row1: { label: string; latin: string | null }[];
    row2: { label: string; latin: string | null }[];
  };
  evidence: {
    title: string;
    body: string;
    tags: EvidenceTag[];
  };
  why: {
    eyebrow: string;
    title: string;
    body: string;
    before: string;
    beforeText: string;
    transition: string;
    after: string;
    afterText: string;
  };
  roadmap: {
    eyebrow: string;
    title: string;
    body: string;
    hint: string;
    aria: string;
    liveCta: string;
    cards: RoadmapCard[];
  };
  discovery: {
    eyebrow: string;
    title: string;
    body: string;
    aria: string;
    steps: DiscoveryStep[];
  };
  research: {
    eyebrow: string;
    title: string;
    body: string;
    status: string;
    stages: { label: string; detail: string }[];
  };
  sample: {
    sourceNotes: string[];
    eyebrow: string;
    name: string;
    meta: string;
    metaEmphasis: string;
    fileLabel: string;
    imageAlt: string;
    sourceNote: string;
    acceptedTitle: string;
    acceptedText: string;
    discardedTitle: string;
    discardedText: string;
    competitorTitle: string;
    competitorName: string;
    chatTitle: string;
    aiQuestion: string;
    suggested: string[];
    inputLabel: string;
    inputValue: string;
    inputPlaceholder: string;
    send: string;
  };
  faq: {
    eyebrow: string;
    title: string;
    items: { q: string; a: string }[];
  };
  finalCta: {
    title: string;
    body: string;
    primary: string;
    secondary: string;
  };
  footer: {
    body: string;
    navAria: string;
    linksTitle: string;
    contactTitle: string;
    facebook: string;
    instagram: string;
    sourceLine: string;
    privacy: string;
    terms: string;
  };
  status: Record<'accepted' | 'review' | 'discard' | 'inference', string>;
};

export const LANDING_COPY: Record<LandingLocale, LandingCopy> = {
  ar: {
    nav: {
      links: [
        { href: '#roadmap', label: 'الرحلة الكاملة' },
        { href: '#discovery', label: 'إزاي بيشتغل' },
        { href: '#sample', label: 'عيّنة' },
        { href: '#faq', label: 'أسئلة شائعة' },
      ],
      aria: 'التنقل الرئيسي',
      login: 'تسجيل الدخول',
      signup: 'إنشاء حساب',
      openMenu: 'فتح القائمة',
      closeMenu: 'إغلاق القائمة',
      language: 'EN',
      languageLabel: 'English',
    },
    shell: { skip: 'تخطي إلى المحتوى' },
    hero: {
      badge: 'رحلة نمو واضحة',
      title: 'من فهم نشاطك لحد تحسين التسويق',
      body:
        'ماركت مايند يحوّل بيانات نشاطك ورؤيتك لرحلة تسويق كاملة: فهم واضح، خطة نمو، محتوى قابل للمراجعة، وتحسين مستمر مبني على نتائج حقيقية.',
      note:
        'أنت بتفضل صاحب القرار في كل مرحلة: تؤكد المعلومة، تراجع الخطة، وتوافق قبل أي خطوة تنفيذ.',
      noteLink: 'شوف الرحلة الكاملة',
      primary: 'ابدأ بناء خطة النمو',
      secondary: 'استكشف الرحلة الكاملة',
      preview: {
        steps: [
          { step: '١', title: 'فهم النشاط', mono: 'Profile', text: 'حقائق مؤكدة عن نشاطك وسوقك' },
          { step: '٢', title: 'خطة نمو', mono: 'Strategy', text: 'أهداف وقنوات وأولويات واضحة' },
          { step: '٣', title: 'تنفيذ قابل للمراجعة', mono: 'Content', text: 'محتوى وحملات جاهزة قبل النشر' },
          { step: '٤', title: 'تحسين مستمر', mono: 'Improve', text: 'نتائج تقود السؤال والخطوة الجاية' },
        ],
      },
    },
    capability: {
      eyebrow: 'إيه اللي ماركت مايند بيتأكد منه',
      row1: [
        { label: 'مصادر بحث عامة', latin: null },
        { label: 'دلائل محلية موثوقة', latin: null },
        { label: 'مصادر احتياطية', latin: null },
        { label: 'روابط النشاط الرسمية', latin: null },
        { label: 'تحليل المنافسين', latin: null },
        { label: 'السياق المحلي', latin: null },
      ],
      row2: [
        { label: 'الهوية', latin: null },
        { label: 'العروض والخدمات', latin: null },
        { label: 'العملاء', latin: null },
        { label: 'التميز', latin: null },
        { label: 'التسويق الحالي', latin: null },
        { label: 'الأهداف', latin: null },
        { label: 'سياق السوق', latin: null },
      ],
    },
    evidence: {
      title: 'الدليل قبل القرار.',
      body: 'كل وسم فوق ده حاجة حقيقية بيفحصها ماركت مايند — مصدر بحث، أو مجال من مجالات نشاطك.',
      tags: [
        { label: 'مصدر بحث عام', type: 'provider' },
        { label: 'دليل محلي', type: 'provider' },
        { label: 'مصدر احتياطي', type: 'provider' },
        { label: 'رابط رسمي من المالك', type: 'provider' },
        { label: 'الهوية', type: 'known' },
        { label: 'العروض', type: 'known' },
        { label: 'العملاء', type: 'review' },
        { label: 'المنافسون', type: 'review' },
      ],
    },
    why: {
      eyebrow: 'ليه الدليل مهم',
      title: 'البحث ممكن يقترح، لكن إنت اللي بتأكد.',
      body:
        'كل معلومة عن نشاطك بتفضل اقتراح من البحث لحد ما تراجعها إنت. الشكل مختلف عشان تعرف الفرق من أول نظرة.',
      before: 'قبل التأكيد',
      beforeText: 'النشاط بيفتح من ٩ الصبح لـ ١١ بالليل',
      transition: '↓ راجعت وأكدت',
      after: 'بعد التأكيد',
      afterText: 'النشاط بيفتح من ١٠ الصبح لـ ١٢ بالليل',
    },
    roadmap: {
      eyebrow: 'الرحلة الكاملة',
      title: 'من الفهم لحد التحسين',
      body: 'دلوقتي تقدر تبدأ بالاكتشاف. باقي الرحلة متصممة كخطوات واضحة ومراجعة.',
      hint: 'انزل لتشوف كل مرحلة بتسلّم اللي بعدها',
      aria: 'مراحل رحلة ماركت مايند',
      liveCta: 'ابدأ دلوقتي',
      cards: [
        { no: '01', title: 'اكتشف', en: 'Discover', output: 'BusinessProfile', desc: 'نبني صورة موثقة لنشاطك من بحث حقيقي ومحادثة معاك.', status: 'live', statusLabel: 'متاح الآن' },
        { no: '02', title: 'ابحث', en: 'Research', output: 'ResearchPack', desc: 'نجمع أدلة السوق والمنافسين في ملف واضح للمراجعة.', status: 'planned', statusLabel: 'المرحلة التالية' },
        { no: '03', title: 'خطّط', en: 'Strategize', output: 'StrategyPlan', desc: 'نرتب الأولويات والقنوات والمؤشرات من بروفايل مؤكد.', status: 'planned', statusLabel: 'ضمن الرحلة' },
        { no: '04', title: 'أنشئ', en: 'Create', output: 'ContentPack', desc: 'نجهز محتوى مناسب للهدف والسياق قبل أي تنفيذ.', status: 'planned', statusLabel: 'ضمن الرحلة' },
        { no: '05', title: 'انشر أو صدّر', en: 'Publish or export', output: 'Publication Result', desc: 'خدمة نشر أو تصدير آمنة تتم فقط بعد موافقتك.', status: 'planned', statusLabel: 'ضمن الرحلة' },
        { no: '06', title: 'راقب', en: 'Monitor', output: 'MetricSnapshot', desc: 'نعرض لقطة واضحة للأداء بدون ادعاء أرقام غير موجودة.', status: 'planned', statusLabel: 'ضمن الرحلة' },
        { no: '07', title: 'حسّن', en: 'Improve', output: 'OptimizationProposal', desc: 'نقترح تحسينات قابلة للمراجعة قبل أي تعديل.', status: 'planned', statusLabel: 'ضمن الرحلة' },
      ],
    },
    discovery: {
      eyebrow: 'رحلة الاكتشاف — المرحلة الأولى بالتفصيل',
      title: 'خمس خطوات، كلها شغّالة دلوقتي',
      body: 'دي السلسلة الوحيدة في الصفحة اللي متاحة بالكامل — من أول ما تكتب اسم نشاطك لحد ما يبقى عندك بروفايل مؤكد.',
      aria: 'خطوات رحلة الاكتشاف',
      steps: [
        { no: '01', label: 'استقبال بيانات النشاط', desc: 'بتكتب اسم نشاطك ومجاله وموقعه — دي نقطة البداية للبحث.', chips: ['الاسم', 'المجال', 'الموقع'] },
        { no: '02', label: 'تخطيط البحث وتنفيذه', desc: 'بنحوّل بياناتك لاستعلامات بحث ونشغّلها على مصادر حقيقية.', chips: ['مصادر بحث', 'دلائل محلية', 'مصادر احتياطية'] },
        { no: '03', label: 'فلترة الأدلة', desc: 'بنشيل النتائج غير المرتبطة ونحتفظ باللي ليه علاقة بنشاطك بمصدره.', chips: ['تصفية', 'ربط بالمصدر'] },
        { no: '04', label: 'أول سؤال مبني على البحث', desc: 'بنسألك سؤال يكمّل الصورة، مش سؤال عام — مبني على اللي لقيناه.', chips: ['سؤال ذكي', 'سياق البحث'] },
        { no: '05', label: 'بروفايل مؤكد', desc: 'كل معلومة اتأكدت منك بتتحفظ كحقيقة مؤكدة في بروفايل نشاطك.', chips: ['تأكيد المالك', 'حفظ الأدلة'] },
      ],
    },
    research: {
      eyebrow: 'معاينة تقدّم البحث',
      title: 'بتتفرج على الشغل الحقيقي لحظة بلحظة',
      body: 'كل مرحلة بتتحرك بس لما يبقى فيه شغل فعلي وراها — من غير عدّاد وهمي ولا نسبة مخترعة.',
      status: 'متصل — بيستقبل التحديثات',
      stages: [
        { label: 'استلام الطلب', detail: 'تم قبول طلب البحث ووضعه في الطابور.' },
        { label: 'تخطيط الاستعلامات', detail: 'تحويل بيانات النشاط لاستعلامات بحث دقيقة.' },
        { label: 'فحص روابط المالك', detail: 'مراجعة صفحة فيسبوك والروابط اللي دخّلتها.' },
        { label: 'بحث المنافسين', detail: 'تحديد أنشطة مشابهة في نفس المنطقة.' },
        { label: 'بحث السوق', detail: 'جمع السياق المحلي وحجم الطلب.' },
        { label: 'الفلترة', detail: 'استبعاد النتائج غير المرتبطة.' },
        { label: 'حفظ الأدلة', detail: 'تخزين كل نتيجة مع مصدرها.' },
        { label: 'تجهيز أول سؤال', detail: 'صياغة سؤال مبني على ما تم إيجاده.' },
        { label: 'جاهز', detail: 'البروفايل المبدئي جاهز لمراجعتك.' },
      ],
    },
    sample: {
      sourceNotes: ['مصدر بحث عام', 'دليل محلي', 'رابط رسمي', 'سؤال مراجعة'],
      eyebrow: 'عيّنة توضيحية',
      name: 'حلويات ورد وسكر',
      meta: 'محل حلويات افتراضي في مدينة افتراضية —',
      metaEmphasis: 'مثال للتوضيح فقط',
      fileLabel: 'ملف أدلة توضيحي',
      imageAlt: 'واجهة محل حلويات افتراضي بعرض متنوع من الحلويات',
      sourceNote: 'البحث بيوصل لمصادر عامة، لكن الحقيقة النهائية بتفضل عند صاحب النشاط.',
      acceptedTitle: 'نتيجة مقبولة',
      acceptedText: 'المحل ظاهر في دليل محلي عام، بتقييم وصور من الزباين ومواعيد عمل واضحة.',
      discardedTitle: 'نتيجة مستبعدة',
      discardedText: 'نتيجة عن اسم مشابه في مدينة تانية — السبب: الاسم متشابه بس النشاط والموقع مختلفين.',
      competitorTitle: 'منافس محتمل',
      competitorName: 'حلواني زهرة الحي — نفس المنطقة',
      chatTitle: 'محادثة العينة',
      aiQuestion: 'لقيت إن مواعيدكم في مصدر عام من ٩ الصبح لـ ١١ بالليل. ده صح؟',
      suggested: ['أيوة صح', 'عايز أعدّل المواعيد', 'المواعيد بتختلف في رمضان'],
      inputLabel: 'اكتب إجابتك',
      inputValue: 'لأ، إحنا بنفتح ١٠ الصبح ونقفل ١٢ بالليل.',
      inputPlaceholder: 'أو اكتب إجابتك هنا...',
      send: 'إرسال',
    },
    faq: {
      eyebrow: 'أسئلة شائعة',
      title: 'كل حاجة واضحة قبل ما تبدأ',
      items: [
        { q: 'إزاي بتحافظوا على خصوصية بياناتي؟', a: 'بياناتك بتُستخدم فقط لبناء بروفايل نشاطك أنت. مبنشاركش بياناتك مع أي جهة تانية، وإنت اللي بتتحكم في اللي بيتحفظ.' },
        { q: 'منين بتجيبوا المعلومات؟', a: 'من مصادر بحث عامة وروابط رسمية تخص نشاطك. كل نتيجة بتظهر ومعاها مصدرها، ومفيش معلومة بتتحفظ كحقيقة إلا لما تأكدها بنفسك.' },
        { q: 'البحث بياخد وقت قد إيه؟', a: 'أغلب الأنشطة بيخلص البحث المبدئي بتاعها خلال دقائق. بتتفرج على مراحل البحث لحظة بلحظة من غير عدّاد وهمي.' },
        { q: 'أقدر أكمّل بعدين لو خرجت؟', a: 'أيوة. رحلة الاكتشاف بتتحفظ، وتقدر ترجع تكمّل من نفس النقطة في أي وقت.' },
        { q: 'مين اللي بيتحكم في المعلومات النهائية؟', a: 'إنت. البحث ممكن يقترح، لكن إنت اللي بتأكد أو ترفض كل معلومة قبل ما تدخل بروفايلك.' },
      ],
    },
    finalCta: {
      title: 'مستعد تفهم نشاطك؟',
      body: 'ابدأ رحلة الاكتشاف دلوقتي — بحث حقيقي، أسئلة مبنية على اللي اتلاقى، وبروفايل إنت اللي بتأكده.',
      primary: 'ابدأ رحلة اكتشاف نشاطك',
      secondary: 'شوف مثال كامل',
    },
    footer: {
      body: 'نفهم نشاطك وسوقك بالدليل — قبل ما تبدأ التسويق.',
      navAria: 'روابط الموقع',
      linksTitle: 'روابط',
      contactTitle: 'تواصل معنا',
      facebook: 'فيسبوك',
      instagram: 'إنستجرام',
      sourceLine: 'ماركت مايند — كل نتيجة لها مصدر.',
      privacy: 'الخصوصية',
      terms: 'الشروط',
    },
    status: {
      accepted: 'تم التأكيد',
      review: 'يحتاج مراجعة',
      discard: 'مستبعد',
      inference: 'اقتراح من البحث',
    },
  },
  en: {
    nav: {
      links: [
        { href: '#roadmap', label: 'Full journey' },
        { href: '#discovery', label: 'How it works' },
        { href: '#sample', label: 'Sample' },
        { href: '#faq', label: 'FAQ' },
      ],
      aria: 'Primary navigation',
      login: 'Log in',
      signup: 'Create account',
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
      language: 'AR',
      languageLabel: 'العربية',
    },
    shell: { skip: 'Skip to content' },
    hero: {
      badge: 'A clear growth journey',
      title: 'From understanding your business to improving marketing',
      body:
        'MarketMind turns your business data and owner context into a complete marketing journey: clear understanding, a growth plan, reviewable content, and continuous improvement based on real results.',
      note:
        'You stay the decision-maker at every stage: confirm facts, review the plan, and approve before execution.',
      noteLink: 'See the full journey',
      primary: 'Start building the growth plan',
      secondary: 'Explore the full journey',
      preview: {
        steps: [
          { step: '1', title: 'Business understanding', mono: 'Profile', text: 'Confirmed facts about your business and market' },
          { step: '2', title: 'Growth plan', mono: 'Strategy', text: 'Clear goals, channels, and priorities' },
          { step: '3', title: 'Reviewable execution', mono: 'Content', text: 'Content and campaigns ready before publishing' },
          { step: '4', title: 'Continuous improvement', mono: 'Improve', text: 'Results guide the next question and next step' },
        ],
      },
    },
    capability: {
      eyebrow: 'What MarketMind checks',
      row1: [
        { label: 'Public research sources', latin: null },
        { label: 'Trusted local directories', latin: null },
        { label: 'Fallback sources', latin: null },
        { label: 'Official business links', latin: null },
        { label: 'Competitor analysis', latin: null },
        { label: 'Local context', latin: null },
      ],
      row2: [
        { label: 'Identity', latin: null },
        { label: 'Offers and services', latin: null },
        { label: 'Customers', latin: null },
        { label: 'Differentiation', latin: null },
        { label: 'Current marketing', latin: null },
        { label: 'Goals', latin: null },
        { label: 'Market context', latin: null },
      ],
    },
    evidence: {
      title: 'Evidence before decisions.',
      body: 'Each tag above is something MarketMind really checks — a research source or a part of your business profile.',
      tags: [
        { label: 'Public search source', type: 'provider' },
        { label: 'Local directory', type: 'provider' },
        { label: 'Fallback source', type: 'provider' },
        { label: 'Official owner link', type: 'provider' },
        { label: 'Identity', type: 'known' },
        { label: 'Offers', type: 'known' },
        { label: 'Customers', type: 'review' },
        { label: 'Competitors', type: 'review' },
      ],
    },
    why: {
      eyebrow: 'Why evidence matters',
      title: 'Research can suggest. You confirm.',
      body:
        'Every business fact stays a research suggestion until you review it. The visual state makes the difference clear at a glance.',
      before: 'Before confirmation',
      beforeText: 'The business opens from 9 AM to 11 PM',
      transition: '↓ Reviewed and confirmed',
      after: 'After confirmation',
      afterText: 'The business opens from 10 AM to midnight',
    },
    roadmap: {
      eyebrow: 'Full journey',
      title: 'From understanding to improvement',
      body: 'You can start with Discovery now. The rest of the journey is designed as clear, reviewable steps.',
      hint: 'Scroll to see how each stage hands off to the next',
      aria: 'MarketMind journey phases',
      liveCta: 'Start now',
      cards: [
        { no: '01', title: 'Discover', en: 'Discover', output: 'BusinessProfile', desc: 'Build an evidence-backed view of your business through real research and a conversation with you.', status: 'live', statusLabel: 'Available now' },
        { no: '02', title: 'Research', en: 'Research', output: 'ResearchPack', desc: 'Collect market and competitor evidence in a clear review pack.', status: 'planned', statusLabel: 'Next phase' },
        { no: '03', title: 'Strategize', en: 'Strategize', output: 'StrategyPlan', desc: 'Turn the confirmed profile into priorities, channels, and metrics.', status: 'planned', statusLabel: 'In the journey' },
        { no: '04', title: 'Create', en: 'Create', output: 'ContentPack', desc: 'Prepare content that fits the goal and context before execution.', status: 'planned', statusLabel: 'In the journey' },
        { no: '05', title: 'Publish or export', en: 'Publish or export', output: 'Publication Result', desc: 'Safe publishing or export only after owner approval.', status: 'planned', statusLabel: 'In the journey' },
        { no: '06', title: 'Monitor', en: 'Monitor', output: 'MetricSnapshot', desc: 'Show a clear performance snapshot without inventing unavailable metrics.', status: 'planned', statusLabel: 'In the journey' },
        { no: '07', title: 'Improve', en: 'Improve', output: 'OptimizationProposal', desc: 'Suggest reviewable improvements before any change is made.', status: 'planned', statusLabel: 'In the journey' },
      ],
    },
    discovery: {
      eyebrow: 'Discovery journey — phase one in detail',
      title: 'Five steps, all working now',
      body: 'This is the fully available flow: from entering your business name to reviewing a confirmed profile.',
      aria: 'Discovery journey steps',
      steps: [
        { no: '01', label: 'Receive business data', desc: 'You enter your business name, category, and location — the starting point for research.', chips: ['Name', 'Category', 'Location'] },
        { no: '02', label: 'Plan and run research', desc: 'We turn your intake into search queries and run them against real sources.', chips: ['Search sources', 'Local directories', 'Fallbacks'] },
        { no: '03', label: 'Filter evidence', desc: 'We remove unrelated results and keep relevant findings with their sources.', chips: ['Filtering', 'Source mapping'] },
        { no: '04', label: 'First research-backed question', desc: 'We ask a question that completes the picture, based on what was found.', chips: ['Smart question', 'Research context'] },
        { no: '05', label: 'Confirmed profile', desc: 'Every fact you confirm is saved as a trusted business profile fact.', chips: ['Owner confirmation', 'Evidence saved'] },
      ],
    },
    research: {
      eyebrow: 'Research progress preview',
      title: 'Watch real work happen step by step',
      body: 'Each stage moves only when there is actual work behind it — no fake counter and no made-up percentage.',
      status: 'Connected — receiving updates',
      stages: [
        { label: 'Request received', detail: 'The research request was accepted and queued.' },
        { label: 'Query planning', detail: 'Business data is turned into focused search queries.' },
        { label: 'Owner link check', detail: 'Facebook and submitted links are reviewed.' },
        { label: 'Competitor search', detail: 'Similar businesses in the same area are identified.' },
        { label: 'Market search', detail: 'Local context and demand signals are collected.' },
        { label: 'Filtering', detail: 'Unrelated results are removed.' },
        { label: 'Evidence saved', detail: 'Each result is stored with its source.' },
        { label: 'First question ready', detail: 'A question is drafted from what was found.' },
        { label: 'Ready', detail: 'The initial profile is ready for your review.' },
      ],
    },
    sample: {
      sourceNotes: ['Public search source', 'Local directory', 'Official link', 'Review question'],
      eyebrow: 'Illustrative sample',
      name: 'Rose & Sugar Sweets',
      meta: 'A fictional sweets shop in a fictional city —',
      metaEmphasis: 'example only',
      fileLabel: 'Sample evidence file',
      imageAlt: 'Fictional sweets shop storefront with a dessert display',
      sourceNote: 'Research can reach public sources, but final truth stays with the business owner.',
      acceptedTitle: 'Accepted result',
      acceptedText: 'The shop appears in a public local directory with reviews, customer photos, and clear opening hours.',
      discardedTitle: 'Discarded result',
      discardedText: 'A result with a similar name in another city was discarded because the activity and location are different.',
      competitorTitle: 'Potential competitor',
      competitorName: 'Neighborhood Blossom Sweets — same area',
      chatTitle: 'Sample conversation',
      aiQuestion: 'I found public hours from 9 AM to 11 PM. Is that correct?',
      suggested: ['Yes, correct', 'I want to edit the hours', 'Hours change in Ramadan'],
      inputLabel: 'Write your answer',
      inputValue: 'No, we open at 10 AM and close at midnight.',
      inputPlaceholder: 'Or write your answer here...',
      send: 'Send',
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Everything is clear before you start',
      items: [
        { q: 'How do you protect my data?', a: 'Your data is used only to build your own business profile. We do not share it with other parties, and you control what gets saved.' },
        { q: 'Where does the information come from?', a: 'From public search sources and official links for your business. Every result appears with its source, and nothing becomes a fact until you confirm it.' },
        { q: 'How long does research take?', a: 'Most initial research runs finish within minutes. You can watch the stages progress without a fake timer.' },
        { q: 'Can I continue later if I leave?', a: 'Yes. Discovery progress is saved, and you can return to continue from the same point.' },
        { q: 'Who controls the final information?', a: 'You do. Research can suggest, but you confirm or reject every fact before it enters your profile.' },
      ],
    },
    finalCta: {
      title: 'Ready to understand your business?',
      body: 'Start Discovery now — real research, questions based on findings, and a profile you confirm.',
      primary: 'Start business discovery',
      secondary: 'See a full example',
    },
    footer: {
      body: 'Understand your business and market with evidence before marketing starts.',
      navAria: 'Site links',
      linksTitle: 'Links',
      contactTitle: 'Contact',
      facebook: 'Facebook',
      instagram: 'Instagram',
      sourceLine: 'MarketMind — every result has a source.',
      privacy: 'Privacy',
      terms: 'Terms',
    },
    status: {
      accepted: 'Confirmed',
      review: 'Needs review',
      discard: 'Discarded',
      inference: 'Research suggestion',
    },
  },
};

export function getLandingCopy(locale: string): LandingCopy {
  return locale === 'en' ? LANDING_COPY.en : LANDING_COPY.ar;
}

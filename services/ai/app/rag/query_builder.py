from app.rag.schemas import RetrievalQueryContext, RetrievalSubquery


def get_locale_filter(locale: str) -> list[str]:
    """Map the requested language mode to the valid locale tags.
    'mixed' is implicitly supported when either Arabic or English is requested.
    """
    if locale == "ar-EG":
        return ["ar-EG", "mixed"]
    elif locale == "en":
        return ["en", "mixed"]
    return ["ar-EG", "en", "mixed"]


def get_market_filter(market: str) -> list[str]:
    """Return all acceptable market tiers. The regional preference engine
    will later sort out the actual priority.
    """
    if market == "egypt":
        return ["egypt", "mena", "global"]
    elif market == "mena":
        return ["mena", "global"]
    return ["global"]


def build_subqueries(context: RetrievalQueryContext) -> list[RetrievalSubquery]:
    """Fan out a single strategy context into multiple focused subqueries."""
    subqueries = []
    
    locale_filter = get_locale_filter(context.locale)
    market_filter = get_market_filter(context.market)
    
    # General entries are the cross-industry fallback for every specific SME
    # sector. Without this value, the hard filter silently excludes the
    # approved general frameworks that ground situation diagnosis.
    industry_filter = (
        [context.industry, "general"]
        if context.industry and context.industry != "general"
        else [context.industry]
        if context.industry
        else None
    )
    paid_media_allowed = context.paid_media_allowed

    # 1. Framework Diagnosis
    industry_text = f" for {context.industry} industry" if context.industry else ""
    subqueries.append(
        RetrievalSubquery(
            category="framework_diagnosis",
            text=f"Marketing frameworks and situation analysis إطار عمل وتحديد الوضع الحالي{industry_text} for a {context.business_type} business in the {context.market} market.",
            kind_filter="framework",
            locale_filter=locale_filter,
            market_filter=market_filter,
            industry_filter=industry_filter,
            paid_media_allowed=paid_media_allowed,
        )
    )
    
    # 2. Objective & Funnel
    subqueries.append(
        RetrievalSubquery(
            category="objective_funnel",
            text=f"Marketing playbook for the {context.objective} objective at the {context.funnel_stage} funnel stage دليل خطة عمل الأهداف ومراحل القمع.",
            kind_filter="objective_playbook",
            locale_filter=locale_filter,
            market_filter=market_filter,
            industry_filter=industry_filter,
            paid_media_allowed=paid_media_allowed,
        )
    )
    
    # 3. Channels
    for channel in context.active_channels:
        subqueries.append(
            RetrievalSubquery(
                category=f"channel_{channel}",
                text=f"Channel playbook for {channel.replace('_', ' ')} with {context.asset_capability} assets and {context.team_capacity} team capacity دليل القناة والمنصات التسويقية.",
                kind_filter="channel_playbook",
                locale_filter=locale_filter,
                market_filter=market_filter,
                industry_filter=industry_filter,
                paid_media_allowed=paid_media_allowed,
            )
        )
        
    # 4. Budget
    if context.budget_mode != "organic_only":
        subqueries.append(
            RetrievalSubquery(
                category="budget_method",
                text=f"Budget scenario planning and allocation strategy for {context.budget_mode.replace('_', ' ')} تخطيط الميزانية وتوزيع الإعلانات.",
                kind_filter="budget_playbook",
                locale_filter=locale_filter,
                market_filter=market_filter,
                industry_filter=industry_filter,
                paid_media_allowed=paid_media_allowed,
            )
        )
        
    # 5. Measurement & KPI
    subqueries.append(
        RetrievalSubquery(
            category="measurement_kpi",
            text=f"Measurement and KPI baseline establishment for {context.objective} objective at {context.funnel_stage} stage قياس الأداء والشرائح المرجعية المؤشرات.",
            kind_filter="measurement_playbook",
            locale_filter=locale_filter,
            market_filter=market_filter,
            industry_filter=industry_filter,
            paid_media_allowed=paid_media_allowed,
        )
    )
    
    # 6. Market & Sector Guidance
    subqueries.append(
        RetrievalSubquery(
            category="market_sector_season",
            text=f"Cultural insights, sector notes, and regional guidance رؤى ثقافية وإرشادات قطاعية إقليمية for the {context.market} market{industry_text}.",
            kind_filter=["regional_guidance", "sector_note"],
            locale_filter=locale_filter,
            market_filter=market_filter,
            industry_filter=industry_filter,
            paid_media_allowed=paid_media_allowed,
        )
    )
    
    return subqueries

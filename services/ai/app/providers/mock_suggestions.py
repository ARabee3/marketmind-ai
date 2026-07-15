CUSTOMER_ANSWERS = {
    "ar-EG": ["شباب وعائلات", "موظفين أو طلبة قريبين", "مش متأكد"],
    "mixed": ["شباب وعائلات", "Nearby workers or students", "مش متأكد"],
    "en": [
        "Families and young people",
        "Nearby workers or students",
        "Not sure yet",
    ],
}

DIFFERENTIATION_ANSWERS = {
    "ar-EG": ["الجودة والطعم", "القرب وسرعة الخدمة", "السعر أو العروض"],
    "mixed": ["الجودة والطعم", "Convenience and speed", "Price or offers"],
    "en": ["Quality and taste", "Convenience and speed", "Price or offers"],
}

CURRENT_MARKETING_ANSWERS = {
    "ar-EG": ["بوستات فيسبوك", "واتساب مع العملاء", "مفيش نظام ثابت"],
    "mixed": ["Facebook posts", "واتساب مع العملاء", "No fixed routine"],
    "en": ["Facebook posts", "WhatsApp with customers", "No fixed routine"],
}

GOAL_ANSWERS = {
    "ar-EG": [
        "زيادة المبيعات",
        "طلبات أكتر في أوقات هادية",
        "تثبيت العملاء الحاليين",
    ],
    "mixed": ["زيادة المبيعات", "More orders in quiet times", "Keep current customers"],
    "en": ["Increase sales", "More orders in quiet times", "Keep current customers"],
}


def suggested_answers_for_question(question: str, language_mode: str) -> list[str]:
    language = language_mode if language_mode in CUSTOMER_ANSWERS else "mixed"
    lowered = question.lower()
    if "بيعمل" in question or "actually do now" in lowered:
        return CURRENT_MARKETING_ANSWERS[language]
    if "choose you" in lowered or "بيختاركم" in question:
        return DIFFERENTIATION_ANSWERS[language]
    if "الشهور الجاية" in question or "next few months" in lowered:
        return GOAL_ANSWERS[language]
    return CUSTOMER_ANSWERS[language]

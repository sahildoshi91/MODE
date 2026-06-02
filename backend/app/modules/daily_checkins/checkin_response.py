from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.ai.client import TokenUsage
from app.modules.daily_checkins.meal_library import EFFORT_GUIDANCE, MEAL_EXAMPLES, get_nutrition_level
from app.modules.daily_checkins.schemas import (
    CheckinResponseInput,
    CheckinResponseOutput,
    CheckinResponseSection,
    CheckinSignalClassification,
)


PROMPT_VERSION = "daily_checkin_response_v1"
DETERMINISTIC_RESPONSE_MODEL = "deterministic_daily_checkin_v1"
MAX_RESPONSE_WORDS = 160
WHY_MIN_CHARS = 10

WHY_JUNK_VALUES = {
    "",
    "-",
    ".",
    "123",
    "idk",
    "i don't know",
    "i dont know",
    "dunno",
    "none",
    "n/a",
    "na",
    "nothing",
    "nothing much",
    "no idea",
    "not sure",
    "unsure",
}

BANNED_PHRASES = (
    "crush it",
    "smash",
    "beast mode",
    "listen to your body",
    "as always",
    "remember",
    "it's important to",
)

CONTRAST_PAIR_NOTES = {
    "high_motivation_low_body": "Your drive is high today, but your body is asking for a different kind of effort. Use that motivation for quality, not quantity.",
    "high_motivation_poor_sleep": "Motivation is there, but poor sleep means your output will cap out faster than it feels like it will. Work smart today, not just hard.",
    "fresh_body_low_motivation": "Your body is actually ready - sometimes the hardest part is just starting. Today is a just-show-up day.",
    "high_stress_high_motivation": "You've got energy to burn, but high stress raises your injury risk. Channel it into controlled work.",
}

SCORE_LABELS = {
    "sleep": {
        1: "Barely slept",
        2: "Poor sleep",
        3: "OK sleep",
        4: "Good sleep",
        5: "Great sleep",
    },
    "stress": {
        1: "Maxed out",
        2: "High stress",
        3: "Manageable",
        4: "Mostly calm",
        5: "Very calm",
    },
    "body": {
        1: "Very sore",
        2: "Pretty sore",
        3: "Some soreness",
        4: "Minor soreness",
        5: "Fresh body",
    },
    "nutrition": {
        1: "Way off",
        2: "Below target",
        3: "Decent enough",
        4: "Solid nutrition",
        5: "Locked in",
    },
    "motivation": {
        1: "Running on empty",
        2: "Low motivation",
        3: "I can show up",
        4: "Ready to work",
        5: "All in",
    },
}


class CheckinResponseError(ValueError):
    pass


SIGNAL_LABELS = {
    "sleep": "sleep",
    "stress": "stress",
    "body": "soreness",
    "nutrition": "nutrition",
    "motivation": "motivation",
}


def is_meaningful_client_why(value: Any) -> bool:
    text = str(value or "").strip()
    normalized = re.sub(r"\s+", " ", text).lower()
    normalized = normalized.strip(" .!?")
    if len(text) < WHY_MIN_CHARS:
        return False
    if normalized in WHY_JUNK_VALUES:
        return False
    if normalized.isnumeric():
        return False
    if re.fullmatch(r"[\W\d_]+", normalized):
        return False
    return True


def classify_signals(input_data: CheckinResponseInput) -> CheckinSignalClassification:
    def level(score: int) -> str:
        if score <= 2:
            return "low"
        if score == 3:
            return "neutral"
        return "high"

    signals = {
        "sleep": level(input_data.sleep_score),
        "stress": level(input_data.stress_score),
        "body": level(input_data.body_score),
        "nutrition": level(input_data.nutrition_score),
        "motivation": level(input_data.motivation_score),
    }
    scores = {
        "sleep": input_data.sleep_score,
        "stress": input_data.stress_score,
        "body": input_data.body_score,
        "nutrition": input_data.nutrition_score,
        "motivation": input_data.motivation_score,
    }

    standout_low = min(scores, key=scores.get)
    contrast_pair = None
    if input_data.motivation_score >= 4 and input_data.body_score <= 2:
        contrast_pair = "high_motivation_low_body"
    elif input_data.motivation_score >= 4 and input_data.sleep_score <= 2:
        contrast_pair = "high_motivation_poor_sleep"
    elif input_data.body_score >= 4 and input_data.motivation_score <= 2:
        contrast_pair = "fresh_body_low_motivation"
    elif input_data.stress_score <= 2 and input_data.motivation_score >= 4:
        contrast_pair = "high_stress_high_motivation"

    return CheckinSignalClassification(
        signals=signals,
        standout_low=standout_low,
        standout_low_score=scores[standout_low],
        contrast_pair=contrast_pair,
        all_neutral=all(value == "neutral" for value in signals.values()),
    )


def build_deterministic_checkin_response(
    input_data: CheckinResponseInput,
    classification: CheckinSignalClassification | None = None,
    *,
    generated_at: datetime | None = None,
) -> CheckinResponseOutput:
    classification = classification or classify_signals(input_data)
    scores = {
        "sleep": input_data.sleep_score,
        "stress": input_data.stress_score,
        "body": input_data.body_score,
        "nutrition": input_data.nutrition_score,
        "motivation": input_data.motivation_score,
    }
    strongest = max(scores, key=scores.get)
    weakest = classification.standout_low
    mode = str(input_data.mode or "RECOVER").strip().upper() or "RECOVER"
    opening = _build_deterministic_opening(
        mode=mode,
        total_score=input_data.total_score,
        strongest=strongest,
        weakest=weakest,
        scores=scores,
        contrast_pair=classification.contrast_pair,
    )
    workout = _build_deterministic_workout(mode, input_data, classification)
    nutrition_label, nutrition = _build_deterministic_nutrition(mode, input_data)
    why = _build_deterministic_why(input_data.client_why)
    question = _build_deterministic_question(classification)

    return CheckinResponseOutput(
        mode=mode,
        total_score=input_data.total_score,
        sections=[
            CheckinResponseSection(id="opening", label=None, content=opening),
            CheckinResponseSection(id="workout", label="Today's workout", content=workout),
            CheckinResponseSection(id="nutrition", label=nutrition_label, content=nutrition),
            CheckinResponseSection(id="why", label="Your why", content=why),
            CheckinResponseSection(id="question", label=None, content=question),
        ],
        signal_classification=classification,
        generated_at=generated_at or datetime.now(timezone.utc),
        model_used=DETERMINISTIC_RESPONSE_MODEL,
        tokens_used={"input": 0, "output": 0, "total": 0},
    )


def build_checkin_response_prompt(
    input_data: CheckinResponseInput,
    classification: CheckinSignalClassification,
) -> str:
    nutrition_level = get_nutrition_level(input_data.nutrition_score)
    meal_guidance = MEAL_EXAMPLES[nutrition_level]
    effort_guidance = EFFORT_GUIDANCE[input_data.mode]
    modifier = (
        effort_guidance.get("modifier_if_body_low")
        if input_data.body_score <= 2
        else None
    )
    workout_line = _format_workout_guidance(effort_guidance)
    kb_line = (
        f"- Knowledge base: {input_data.trainer_kb_summary}\n"
        if input_data.trainer_kb_summary
        else ""
    )
    contrast_note = (
        f"- Contrast coaching note: {CONTRAST_PAIR_NOTES[classification.contrast_pair]}\n"
        if classification.contrast_pair in CONTRAST_PAIR_NOTES
        else ""
    )

    return f"""You are the AI coaching layer for {input_data.trainer_name}, a personal trainer.
You are responding to {input_data.client_first_name} after they completed their daily check-in.

---
TODAY'S CHECK-IN SIGNALS:
- Sleep:      {input_data.sleep_score}/5 - {SCORE_LABELS["sleep"][input_data.sleep_score]}
- Stress:     {input_data.stress_score}/5 - {SCORE_LABELS["stress"][input_data.stress_score]}
- Body:       {input_data.body_score}/5 - {SCORE_LABELS["body"][input_data.body_score]}
- Nutrition:  {input_data.nutrition_score}/5 - {SCORE_LABELS["nutrition"][input_data.nutrition_score]}
- Motivation: {input_data.motivation_score}/5 - {SCORE_LABELS["motivation"][input_data.motivation_score]}
- Total:      {input_data.total_score}/25 -> {input_data.mode}

Signal analysis:
- Lowest signal today: {classification.standout_low} ({classification.standout_low_score}/5)
- Contrast pattern: {classification.contrast_pair or "none"}
{contrast_note}
---
CLIENT CONTEXT:
- Goal: {input_data.client_goal}
- Constraints: {input_data.client_constraints}
- Experience level: {input_data.client_experience_level}
- Their why: "{input_data.client_why}"

---
TRAINER CONTEXT:
- Programming philosophy: {input_data.trainer_programming_philosophy}
- Nutrition approach: {input_data.trainer_nutrition_approach}
- Coaching tone: {input_data.trainer_tone}
{kb_line}
---
WORKOUT GUIDANCE TO USE:
- {workout_line}
- Feel cue: {effort_guidance["feel"]}
{modifier or ""}

---
NUTRITION GUIDANCE TO USE:
- Fueling level today: {nutrition_level}
- Meal examples: {", ".join(meal_guidance["examples"])}
- Timing: {meal_guidance["timing"]}
- Why it matters: {meal_guidance["why"]}

---
YOUR TASK:
Write a check-in response for {input_data.client_first_name} using EXACTLY this structure:

[SECTION 1 - OPENING LINE]
One sentence. State the mode name and score (e.g. "Build day - 19/25.").
Then one or two sentences reading today's signal pattern honestly.
If there is a contrast pair, acknowledge it directly.
If one signal is unusually low, name it - don't paper over it.
Do not use generic praise.

[SECTION 2 - WORKOUT]
Label: "Today's workout"
Start with the specific guidance: sets, reps, intensity level.
Then explain what that feels like in plain English - no gym jargon without translation.
Connect the training approach to their goal OR their why.
If their body score is low, acknowledge it and adjust the recommendation accordingly.
Max 3 sentences.

[SECTION 3 - NUTRITION]
Label: "Before you train" (or "How to eat today" on REST days)
Give 2-3 concrete meal examples from the guidance above.
Add the timing if relevant.
Explain in one plain sentence why this matters today specifically - connect it
to their energy level or their performance, not just generic nutrition advice.
Max 3 sentences.

[SECTION 4 - WHY ANCHOR]
Label: "Your why"
One or two sentences. Do NOT quote their why verbatim.
Weave it into a coaching statement that connects today's effort to what
they are building toward. Make it feel earned, not appended.
This should land - not feel like a motivational poster.

[CLOSING QUESTION]
One specific question that invites them into the session.
Not "How are you feeling?" - something more specific to today's mode or signals.

---
RULES - follow every one of these:

1. Write for someone who is not a fitness expert. Translate every gym term.
2. Every recommendation must answer "so what?" - explain why it matters.
3. The "why" must appear in the workout or why anchor section, not both.
   Weave it in. Do not quote it directly. Do not use it as a footer.
4. Sections must be separated clearly. Each section is short - 2-3 sentences max.
5. Tone must match the trainer's coaching tone: {input_data.trainer_tone}
6. Do not use these words or phrases:
   - "crush it"
   - "smash"
   - "beast mode" (the mode label is fine, this phrase is not)
   - "listen to your body" (say what to do instead)
   - "as always"
   - "remember"
   - "it's important to"
7. Do not add any section not listed above.
8. Total response must be under 160 words.
9. Output plain text only. No markdown, no bullet points, no asterisks.
   Section labels are plain text on their own line.
"""


def _build_deterministic_opening(
    *,
    mode: str,
    total_score: int,
    strongest: str,
    weakest: str,
    scores: dict[str, int],
    contrast_pair: str | None,
) -> str:
    strongest_label = SIGNAL_LABELS.get(strongest, strongest)
    weakest_label = SIGNAL_LABELS.get(weakest, weakest)
    lines = [
        f"{mode.title()} day - {total_score}/25.",
        (
            f"{strongest_label.title()} is your strongest signal at {scores[strongest]}/5, "
            f"while {weakest_label} needs the most care at {scores[weakest]}/5."
        ),
    ]
    if contrast_pair in CONTRAST_PAIR_NOTES:
        lines.append(CONTRAST_PAIR_NOTES[contrast_pair])
    return " ".join(lines)


def _build_deterministic_workout(
    mode: str,
    input_data: CheckinResponseInput,
    classification: CheckinSignalClassification,
) -> str:
    guidance = EFFORT_GUIDANCE.get(mode) or EFFORT_GUIDANCE["RECOVER"]
    if mode == "REST" or not guidance.get("sets"):
        return (
            "Skip formal training today. Keep movement easy with a 10-20 minute walk, mobility, "
            "or light stretching so recovery can actually do its job."
        )

    text = (
        f"Use {guidance['sets']} of {guidance['reps']} at {guidance['intensity']}. "
        f"{guidance['feel']}"
    )
    if input_data.body_score <= 2 and guidance.get("modifier_if_body_low"):
        text += f" {guidance['modifier_if_body_low']}"
    elif input_data.sleep_score <= 2 or input_data.stress_score <= 2:
        text += " Keep the pace controlled and leave one clean rep in reserve so fatigue does not run the session."
    elif classification.contrast_pair == "fresh_body_low_motivation":
        text += " Make the first set the win; starting clean matters more than chasing intensity."
    return text


def _build_deterministic_nutrition(mode: str, input_data: CheckinResponseInput) -> tuple[str, str]:
    nutrition_level = get_nutrition_level(input_data.nutrition_score)
    guidance = MEAL_EXAMPLES[nutrition_level]
    examples = guidance["examples"][:3]
    label = "How to eat today" if mode == "REST" else "Before you train"
    if len(examples) == 1:
        example_text = examples[0]
    else:
        example_text = ", ".join(examples[:-1]) + f", or {examples[-1]}"
    return (
        label,
        f"Choose something simple like {example_text}. {guidance['timing']} {guidance['why']}",
    )


def _build_deterministic_why(client_why: str) -> str:
    if is_meaningful_client_why(client_why):
        why = str(client_why).strip().rstrip(".!?")
        return f"Treat today's work as one small deposit toward {why}."
    return "Treat today's work as one small deposit toward feeling stronger, steadier, and more capable in real life."


def _build_deterministic_question(classification: CheckinSignalClassification) -> str:
    if classification.contrast_pair == "high_motivation_low_body":
        return "Which movement can you keep clean today without forcing intensity?"
    if classification.contrast_pair == "high_motivation_poor_sleep":
        return "What is the cleanest version of today's session you can finish without overreaching?"
    if classification.contrast_pair == "fresh_body_low_motivation":
        return "What is the first low-friction set you can start with?"
    if classification.contrast_pair == "high_stress_high_motivation":
        return "Where can you channel that energy into controlled reps instead of rushing?"

    questions = {
        "sleep": "What would make today's session feel clean without asking too much from low sleep?",
        "stress": "What part of training can stay simple enough to lower stress instead of adding to it?",
        "body": "Which movement feels safest and smoothest for your sore spots today?",
        "nutrition": "What can you eat before training so energy does not dip halfway through?",
        "motivation": "What is the smallest training win you can commit to right now?",
    }
    return questions.get(classification.standout_low, "What do you want to achieve today?")


def parse_checkin_response(
    raw_text: str,
    *,
    input_data: CheckinResponseInput,
    classification: CheckinSignalClassification,
    model_used: str,
    token_usage: TokenUsage | None = None,
    generated_at: datetime | None = None,
) -> CheckinResponseOutput:
    text = _normalize_raw_response(raw_text)
    _validate_response_text(text)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        raise CheckinResponseError("empty_response")

    workout_index = _find_label_index(lines, {"today's workout", "todays workout"})
    nutrition_index = _find_label_index(lines, {"before you train", "how to eat today"})
    why_index = _find_label_index(lines, {"your why"})
    if not (0 < workout_index < nutrition_index < why_index):
        raise CheckinResponseError("section_labels_missing_or_out_of_order")

    opening = _join_content(lines[:workout_index])
    workout = _join_content(lines[workout_index + 1:nutrition_index])
    nutrition = _join_content(lines[nutrition_index + 1:why_index])
    why_lines = lines[why_index + 1:]
    question_index = _find_question_index(why_lines)
    if question_index <= 0:
        raise CheckinResponseError("closing_question_missing")
    why = _join_content(why_lines[:question_index])
    question = _join_content(why_lines[question_index:])

    sections = [
        CheckinResponseSection(id="opening", label=None, content=opening),
        CheckinResponseSection(id="workout", label="Today's workout", content=workout),
        CheckinResponseSection(id="nutrition", label=lines[nutrition_index], content=nutrition),
        CheckinResponseSection(id="why", label="Your why", content=why),
        CheckinResponseSection(id="question", label=None, content=question),
    ]
    for section in sections:
        if not section.content:
            raise CheckinResponseError(f"empty_section_{section.id}")

    usage = token_usage or TokenUsage()
    return CheckinResponseOutput(
        mode=input_data.mode,
        total_score=input_data.total_score,
        sections=sections,
        signal_classification=classification,
        generated_at=generated_at or datetime.now(timezone.utc),
        model_used=model_used,
        tokens_used={
            "input": usage.prompt_tokens,
            "output": usage.completion_tokens,
            "total": usage.total_tokens,
        },
    )


def _format_workout_guidance(effort_guidance: dict[str, str | None]) -> str:
    if not effort_guidance.get("sets"):
        return "No training today"
    return f"{effort_guidance['sets']}, {effort_guidance['reps']}, at {effort_guidance['intensity']}"


def _normalize_raw_response(raw_text: str) -> str:
    text = str(raw_text or "").strip()
    text = re.sub(r"^```(?:text)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.replace("*", "")
    lines = []
    for line in text.splitlines():
        normalized = re.sub(r"^\s*[-•]\s+", "", line.strip())
        if normalized:
            lines.append(normalized)
    return "\n".join(lines).strip()


def _validate_response_text(text: str) -> None:
    lowered = text.lower()
    for phrase in BANNED_PHRASES:
        if phrase in lowered:
            raise CheckinResponseError(f"banned_phrase_{phrase.replace(' ', '_')}")
    if len(re.findall(r"\b[\w'-]+\b", text)) > MAX_RESPONSE_WORDS:
        raise CheckinResponseError("word_count_exceeded")
    if "[" in text or "]" in text:
        raise CheckinResponseError("section_brackets_present")


def _find_label_index(lines: list[str], labels: set[str]) -> int:
    for index, line in enumerate(lines):
        normalized = line.strip().lower().rstrip(":")
        if normalized in labels:
            return index
    return -1


def _find_question_index(lines: list[str]) -> int:
    for index in range(len(lines) - 1, -1, -1):
        if lines[index].strip().endswith("?"):
            return index
    return -1


def _join_content(lines: list[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(line.strip() for line in lines if line.strip())).strip()

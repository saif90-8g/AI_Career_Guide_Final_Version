"""
AI Career Guide - AI Service
Handles fully AI-generated assessment questions, preference analysis,
career recommendations, skill gaps, and personalized roadmaps.
"""

import os
import json
import logging
import re
import sys
import time
import warnings
from typing import Dict, Any, List

# Suppress google-genai AFC deprecation and recommendation messages
warnings.filterwarnings("ignore", message=".*automatic function calling.*", category=DeprecationWarning)
warnings.filterwarnings("ignore", message=".*automatic function calling.*")

_old_stderr = sys.stderr


class _AFCMessageFilter:
    """Filter that silences AFC recommendation messages from the google-genai SDK."""

    def __init__(self, stream):
        self._stream = stream

    def write(self, text):
        if "automatic function calling" not in text.lower() and "AFC" not in text:
            self._stream.write(text)

    def flush(self):
        self._stream.flush()


sys.stderr = _AFCMessageFilter(sys.stderr)

logger = logging.getLogger(__name__)

CATEGORIES = ["analytical", "technical", "creative", "social", "leadership", "research", "practical"]
MODEL_NAME = "gemini-3.6-flash"
FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]


def clean_json_response(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```JSON"):
        text = text[8:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _get_client():
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    enable_gemini = os.environ.get("ENABLE_GEMINI", "0").strip().lower() in ("1", "true", "yes", "on")
    if not api_key or not enable_gemini:
        raise RuntimeError("AI generation requires Gemini to be enabled with GEMINI_API_KEY and ENABLE_GEMINI=1.")
    from google import genai
    return genai.Client(api_key=api_key)


def _generate_json(prompt: str) -> Dict[str, Any]:
    try:
        from google.genai import types
        client = _get_client()
        models_to_try = [MODEL_NAME] + [m for m in FALLBACK_MODELS if m != MODEL_NAME]
        last_error = None

        for model_index, model_name in enumerate(models_to_try):
            for attempt in range(3):
                try:
                    response_text = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(response_mime_type="application/json")
                    ).text
                    return json.loads(clean_json_response(response_text))
                except (json.JSONDecodeError, KeyError) as e:
                    last_error = e
                    logger.warning(
                        "Gemini model %s returned unparseable response (attempt %d/3). Retrying.",
                        model_name, attempt + 1
                    )
                    if attempt < 2:
                        time.sleep(1)
                    continue
                except Exception as e:
                    last_error = e
                    error_text = str(e)
                    is_transient = any(code in error_text for code in (
                        "503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED",
                        "404", "NOT_FOUND", "model"
                    ))
                    if not is_transient:
                        raise

                    if attempt < 2:
                        delay = 2 ** attempt
                        logger.warning(
                            "Gemini model %s is temporarily unavailable (attempt %d/3). Retrying in %d seconds.",
                            model_name, attempt + 1, delay
                        )
                        time.sleep(delay)
                    elif model_index < len(models_to_try) - 1:
                        logger.warning(
                            "Gemini model %s remains unavailable. Switching to fallback model %s.",
                            model_name, models_to_try[model_index + 1]
                        )

        raise last_error
    except RuntimeError:
        raise
    except Exception as e:
        logger.error("Error calling Gemini API: %s", e, exc_info=True)
        error_msg = str(e)
        if "401" in error_msg or "UNAUTHENTICATED" in error_msg:
            raise RuntimeError(
                "Unable to connect to the AI service. Please verify your GEMINI_API_KEY is valid "
                "and active at https://aistudio.google.com/apikey, then restart the application."
            ) from e
        raise RuntimeError(
            "The AI service is temporarily unavailable. Please wait a moment and try again."
        ) from e


def generate_dynamic_question(profile_data: Dict[str, Any], previous_questions: List[Dict[str, Any]], previous_answers: Dict[str, str], question_number: int) -> Dict[str, Any]:
    """Generate one adaptive multiple-choice question from the user's evolving profile."""
    prompt = f"""
You are a friendly AI career advisor helping a student or early-career person discover the right career path.
Generate question {question_number} of exactly 10 for a career preference quiz.

QUESTION STYLE — follow these strictly:
- Every question must be a simple, relatable real-life scenario.
- Start with a short scene like: "Imagine you just started a new job..." or "You are at a hackathon and..."
- The scenario must be easy to picture for a student or fresh graduate.
- After the scenario, ask one clear choice question about what they would do or prefer.
- Write at a high-school reading level. No jargon, no buzzwords, no complex vocabulary.
- Keep the full question under 40 words.
- Keep each answer option under 12 words and make it a realistic action or choice.

Good example:
  Question: "Imagine your team needs to fix a bug before launch. What do you do first?"
  Options: "Dig into the code and debug it myself" / "Ask a teammate to pair up with me" / "Search docs and Stack Overflow for a fix" / "Write a quick test to find where it breaks"

Bad example:
  "Which collaborative paradigm best aligns with your interpersonal synergy preferences in agile environments?"

CONTENT RULES:
- Pick the single most useful career preference that is still unknown about this person.
- Base the scenario on their background, skills, interests, experience, goals, and previous answers.
- This person is studying {profile_data.get('engineering_field', 'engineering')}. Keep scenarios relevant to that field.
- Do not repeat previous questions or cover already known information.
- Make it genuinely useful for recommending a career later.

Return exactly 4 short answer options. Do NOT include scores or weights.
Use id "q{question_number}" and return JSON only.

USER PROFILE:
{json.dumps(profile_data, ensure_ascii=False)}

PREVIOUS QUESTIONS:
{json.dumps(previous_questions, ensure_ascii=False)}

PREVIOUS ANSWERS:
{json.dumps(previous_answers, ensure_ascii=False)}

JSON SCHEMA:
{{
  "id": "q{question_number}",
  "question": "Question text tailored to this user",
  "options": [
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}}
  ]
}}
"""
    question = _generate_json(prompt)
    if question.get("id") != f"q{question_number}" or not question.get("question") or len(question.get("options", [])) != 4:
        raise RuntimeError("The AI returned an invalid personalized question format. Please try again.")
    for option in question["options"]:
        if not option.get("value") or not option.get("label"):
            raise RuntimeError("The AI returned a question with incomplete options. Please try again.")
    return question


def generate_matric_question(profile_data: Dict[str, Any], previous_questions: List[Dict[str, Any]], previous_answers: Dict[str, str], question_number: int) -> Dict[str, Any]:
    """Generate one simple scenario-based question for a Matric student choosing a study path."""
    prompt = f"""
You are a friendly career advisor helping a Matric (secondary school) student decide what to study after Matric.
Generate question {question_number} of exactly 10 for a short interest-assessment quiz.

QUESTION STYLE — follow these strictly:
- Every question must be a simple, relatable real-life scenario that a 14-16 year old can picture.
- Start with a short scene like: "Your teacher asks the class to..." or "During a school project, you..."
- The scenario should reveal the student's interests, strengths, or preferences.
- Write at a high-school reading level. No jargon, no buzzwords.
- Keep the full question under 40 words.
- Keep each answer option under 12 words and make it a realistic action or choice.

CONTENT RULES:
- Explore the student's interests, natural strengths, motivation, and how they like to work.
- Include psychological and preference-based themes: problem-solving style, what motivates them, teamwork vs solo work, creative vs logical thinking, helping people vs building things.
- Cover diverse themes across questions: technology, healthcare/medicine, business/commerce, arts/creativity, engineering, teaching, science/research.
- Do not repeat previous questions.
- Do NOT ask about the student's marks or subjects directly; focus on scenarios, feelings, and preferences.
- Each question should help determine which intermediate stream (Pre-Engineering, Pre-Medical, ICS, ICom, Arts) best suits this student.

Return exactly 4 short answer options. Do NOT include scores or weights.
Use id "q{question_number}" and return JSON only.

USER PROFILE:
{json.dumps(profile_data, ensure_ascii=False)}

PREVIOUS QUESTIONS:
{json.dumps(previous_questions, ensure_ascii=False)}

PREVIOUS ANSWERS:
{json.dumps(previous_answers, ensure_ascii=False)}

JSON SCHEMA:
{{
  "id": "q{question_number}",
  "question": "Question text tailored to this student",
  "options": [
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}}
  ]
}}
"""
    question = _generate_json(prompt)
    if question.get("id") != f"q{question_number}" or not question.get("question") or len(question.get("options", [])) != 4:
        raise RuntimeError("The AI returned an invalid personalized question format. Please try again.")
    for option in question["options"]:
        if not option.get("value") or not option.get("label"):
            raise RuntimeError("The AI returned a question with incomplete options. Please try again.")
    return question


def analyze_matric_study_path(profile_data: Dict[str, Any], questions: List[Dict[str, Any]], answers: Dict[str, str]) -> Dict[str, Any]:
    """Generate a study-path recommendation for a Matric student. No skill gap or job-readiness analysis."""
    prompt = f"""
You are an expert AI Career Counselor for "AI Career Guide" helping a Matric student in Pakistan choose the RIGHT INTERMEDIATE SUBJECT COMBINATION after Matric.

Your PRIMARY task is to recommend which intermediate stream the student should select:
  - FSc Pre-Engineering (Physics, Maths, Chemistry)
  - FSc Pre-Medical (Physics, Biology, Chemistry)
  - ICS — Intermediate in Computer Science (Physics, Maths, Computer Science)
  - ICom — Intermediate in Commerce (Accounting, Economics, Business)
  - FA / Humanities (Arts subjects)
  - Any other suitable intermediate combination

IMPORTANT DECISION FACTORS — you MUST base your recommendation on ALL of these:
  1. Subject marks: Physics, Chemistry, Maths, and optional subject (CompSci/Biology) scores.
  2. Overall percentage: How well the student is performing overall.
  3. Favourite subject and strongest subject: What the student enjoys and excels at.
  4. Subjects they enjoy most.
  5. Interests and hobbies outside school.
  6. Aim in life: The student's stated long-term career or life goal.
  7. Work type preferences: The kind of work the student is drawn to.
  8. Assessment question answers: The 10 scenario-based questions reveal deeper psychological preferences, motivations, and aptitudes. These answers are CRITICAL — they reveal whether the student thinks logically, creatively, or practically, and what truly motivates them.

REASONING RULES:
- The "reason" field must EXPLICITLY reference the student's specific marks, interests, aim in life, and assessment answers.
- Do NOT give generic advice. Tie every point directly to THIS student's data.
- Example of good reasoning: "Your Maths score of 92 and Physics score of 88 show strong analytical ability. Combined with your interest in coding and your aim to become a software engineer, Pre-Engineering with strong Maths and Physics is the ideal foundation. Your assessment answers also showed you enjoy solving logical problems and working with technology, which confirms this path."
- Example of bad reasoning: "Pre-Engineering is a good choice for students who like maths." (too generic)

Provide:
1. RECOMMENDED INTERMEDIATE SUBJECT COMBINATION — The single best stream with a detailed, personalized reason.
2. OTHER SUITABLE OPTIONS — 2-3 alternative streams with explanations tied to the student's profile.
3. FUTURE CAREER OPTIONS — 3-5 careers achievable after completing the recommended path (1 sentence each).
4. EDUCATION ROADMAP — Step-by-step path from Matric through intermediate, degree, to career (4-6 steps).

STUDENT PROFILE:
{json.dumps(profile_data, ensure_ascii=False)}

ASSESSMENT QUESTIONS:
{json.dumps(questions, ensure_ascii=False)}

ASSESSMENT ANSWERS:
{json.dumps(answers, ensure_ascii=False)}

Return valid JSON only.

JSON SCHEMA:
{{
  "is_matric": true,
  "recommended_path": {{
    "title": "FSc Pre-Medical",
    "reason": "Detailed personalized explanation referencing the student's Biology score of 85, strong Chemistry marks, love for helping people shown in assessment answers, and stated aim of becoming a doctor. Explain how their interest in medicine-related activities and preference for practical science work confirms this choice."
  }},
  "other_options": [
    {{"title": "FSc Pre-Engineering", "reason": "Personalized explanation tied to student's marks and interests"}},
    {{"title": "ICS", "reason": "Personalized explanation tied to student's profile"}}
  ],
  "future_careers": [
    {{"title": "Doctor", "description": "Simple description"}},
    {{"title": "Pharmacist", "description": "Simple description"}},
    {{"title": "Biomedical Researcher", "description": "Simple description"}}
  ],
  "roadmap": ["Matric", "FSc Pre-Medical", "MBBS", "House Job / Specialization", "Doctor"]
}}
"""
    data = _generate_json(prompt)
    if not data.get("recommended_path") or not data.get("roadmap"):
        raise RuntimeError("The AI returned an incomplete study-path recommendation. Please try again.")
    if not isinstance(data.get("other_options"), list) or not isinstance(data.get("future_careers"), list):
        raise RuntimeError("The AI returned an incomplete study-path recommendation. Please try again.")
    data["career_profile"] = {"analytical": 0, "technical": 0, "creative": 0, "social": 0, "leadership": 0, "research": 0, "practical": 0}
    return data


def generate_fsc_question(profile_data: Dict[str, Any], previous_questions: List[Dict[str, Any]], previous_answers: Dict[str, str], question_number: int) -> Dict[str, Any]:
    """Generate one simple scenario-based question for an FSc/Intermediate student choosing a degree program."""
    prompt = f"""
You are a friendly career advisor helping an FSc / Intermediate student in Pakistan decide which university degree program to pursue.
Generate question {question_number} of exactly 10 for a short interest-assessment quiz.

QUESTION STYLE — follow these strictly:
- Every question must be a simple, relatable real-life scenario that a 16-20 year old can picture.
- Start with a short scene like: "Your college professor asks you to..." or "During a college project, you..." or "A friend asks for your help with..."
- The scenario should reveal the student's interests, strengths, or preferences relevant to choosing a degree.
- Write at a high-school reading level. No jargon, no buzzwords.
- Keep the full question under 40 words.
- Keep each answer option under 12 words and make it a realistic action or choice.

CONTENT RULES:
- Explore the student's interests, natural strengths, motivation, and how they like to work.
- Include psychological and preference-based themes: problem-solving style, what motivates them, teamwork vs solo work, creative vs logical thinking, helping people vs building things.
- Cover diverse themes across questions: technology, healthcare/medicine, business/finance, engineering, arts/creativity, teaching, research/science.
- Do not repeat previous questions.
- Do NOT ask about the student's marks or subjects directly; focus on scenarios, feelings, and preferences.
- Each question should help determine which university degree program (CS, Engineering, Medical, Business, Arts, etc.) best suits this student.

Return exactly 4 short answer options. Do NOT include scores or weights.
Use id "q{question_number}" and return JSON only.

USER PROFILE:
{json.dumps(profile_data, ensure_ascii=False)}

PREVIOUS QUESTIONS:
{json.dumps(previous_questions, ensure_ascii=False)}

PREVIOUS ANSWERS:
{json.dumps(previous_answers, ensure_ascii=False)}

JSON SCHEMA:
{{
  "id": "q{question_number}",
  "question": "Question text tailored to this student",
  "options": [
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}},
    {{"value": "short stable value", "label": "User-facing option"}}
  ]
}}
"""
    question = _generate_json(prompt)
    if question.get("id") != f"q{question_number}" or not question.get("question") or len(question.get("options", [])) != 4:
        raise RuntimeError("The AI returned an invalid personalized question format. Please try again.")
    for option in question["options"]:
        if not option.get("value") or not option.get("label"):
            raise RuntimeError("The AI returned a question with incomplete options. Please try again.")
    return question


def analyze_fsc_study_path(profile_data: Dict[str, Any], questions: List[Dict[str, Any]], answers: Dict[str, str]) -> Dict[str, Any]:
    """Generate a degree-program recommendation for an FSc/Intermediate student. No skill gap or job-readiness analysis."""
    prompt = f"""
You are an expert AI Career Counselor for "AI Career Guide" helping an FSc / Intermediate student in Pakistan choose the RIGHT UNIVERSITY DEGREE PROGRAM after completing their intermediate studies.

Your PRIMARY task is to recommend which degree program the student should pursue:
  - BS Computer Science / IT / Software Engineering
  - BS / BE Engineering (Electrical, Mechanical, Civil, etc.)
  - MBBS / BDS / Pharmacy / Biomedical Sciences
  - BBA / BCom / Economics / Finance
  - BA / BS Humanities / Social Sciences / Law
  - BS Agriculture / Environmental Science
  - Any other suitable degree program

IMPORTANT DECISION FACTORS — you MUST base your recommendation on ALL of these:
  1. FSc Group / Major: Pre-Engineering, Pre-Medical, ICS, ICom, Arts, or General Science.
  2. Subject marks: Physics, Chemistry, Maths/CompSci scores (if provided).
  3. Overall percentage: How well the student performed in FSc/Intermediate.
  4. Favourite subject and strongest subject: What the student enjoys and excels at.
  5. Subjects they enjoy most.
  6. Interests and hobbies outside school.
  7. Career goal: The student's stated long-term career or life goal.
  8. Work type preferences: The kind of work the student is drawn to.
  9. Assessment question answers: The 10 scenario-based questions reveal deeper psychological preferences, motivations, and aptitudes. These answers are CRITICAL — they reveal whether the student thinks logically, creatively, or practically, and what truly motivates them.

REASONING RULES:
- The "reason" field must EXPLICITLY reference the student's specific FSc group, marks, interests, career goal, and assessment answers.
- Do NOT give generic advice. Tie every point directly to THIS student's data.
- Consider which degree programs are realistically available given the student's FSc group (e.g. Pre-Medical students typically pursue medical/health sciences, Pre-Engineering students can pursue engineering or CS, ICS students can pursue CS/IT).
- Example of good reasoning: "Your FSc Pre-Engineering background with Maths score of 88 and Physics score of 82 gives you a strong foundation for engineering. Your assessment answers showed a preference for hands-on building and solving real-world problems, and your aim of working in renewable energy aligns perfectly with Electrical Engineering."
- Example of bad reasoning: "Engineering is good for Pre-Engineering students." (too generic)

Provide:
1. RECOMMENDED DEGREE PROGRAM — The single best degree with a detailed, personalized reason.
2. OTHER SUITABLE OPTIONS — 2-3 alternative degree programs with explanations tied to the student's profile.
3. FUTURE CAREER OPTIONS — 3-5 careers achievable after completing the recommended degree (1 sentence each).
4. EDUCATION ROADMAP — Step-by-step path from FSc through degree to career (4-6 steps).

STUDENT PROFILE:
{json.dumps(profile_data, ensure_ascii=False)}

ASSESSMENT QUESTIONS:
{json.dumps(questions, ensure_ascii=False)}

ASSESSMENT ANSWERS:
{json.dumps(answers, ensure_ascii=False)}

Return valid JSON only.

JSON SCHEMA:
{{
  "is_fsc": true,
  "recommended_path": {{
    "title": "BS Computer Science",
    "reason": "Detailed personalized explanation referencing the student's FSc ICS group, strong Maths score of 90, passion for programming shown in assessment answers, interest in AI and technology, and stated career goal of becoming a software engineer. Explain how the assessment answers confirm logical thinking and technology affinity."
  }},
  "other_options": [
    {{"title": "BS Software Engineering", "reason": "Personalized explanation tied to student's marks and interests"}},
    {{"title": "BS Data Science", "reason": "Personalized explanation tied to student's profile"}}
  ],
  "future_careers": [
    {{"title": "Software Engineer", "description": "Simple description"}},
    {{"title": "AI/ML Engineer", "description": "Simple description"}},
    {{"title": "Data Scientist", "description": "Simple description"}}
  ],
  "roadmap": ["FSc / Intermediate", "BS Computer Science (4 years)", "Internship / Portfolio", "Software Engineer"]
}}
"""
    data = _generate_json(prompt)
    if not data.get("recommended_path") or not data.get("roadmap"):
        raise RuntimeError("The AI returned an incomplete degree recommendation. Please try again.")
    if not isinstance(data.get("other_options"), list) or not isinstance(data.get("future_careers"), list):
        raise RuntimeError("The AI returned an incomplete degree recommendation. Please try again.")
    data["career_profile"] = {"analytical": 0, "technical": 0, "creative": 0, "social": 0, "leadership": 0, "research": 0, "practical": 0}
    return data


def generate_ai_preference_profile(profile_data: Dict[str, Any], questions: List[Dict[str, Any]], answers: Dict[str, str]) -> Dict[str, int]:
    """Generate the visible seven-dimension profile entirely from AI reasoning."""
    prompt = f"""
You are an expert AI career counselor. Analyze this user's complete profile and assessment answers.
Generate a nuanced career-interest/work-preference profile. These scores must be your AI judgment, not a calculation from a predefined scoring table.

Score each dimension from 0 to 100:
analytical, technical, creative, social, leadership, research, practical.
The user is in the {profile_data.get('engineering_field', 'engineering')} field. Interpret and weight scores in that context (e.g. a Mechanical Engineering student's "practical" and "technical" scores may carry different meaning than a Software Engineering student's).
Use the user's background, skill levels, interests, experience, goals, every question and every answer. Avoid default or generic scores.
Return JSON only.

PROFILE:
{json.dumps(profile_data, ensure_ascii=False)}

QUESTIONS:
{json.dumps(questions, ensure_ascii=False)}

ANSWERS:
{json.dumps(answers, ensure_ascii=False)}

JSON SCHEMA:
{{
  "career_profile": {{
    "analytical": 0,
    "technical": 0,
    "creative": 0,
    "social": 0,
    "leadership": 0,
    "research": 0,
    "practical": 0
  }}
}}
"""
    data = _generate_json(prompt)
    scores = data.get("career_profile", {})
    if not all(cat in scores for cat in CATEGORIES):
        raise RuntimeError("The AI returned an incomplete career-interest profile. Please try again.")
    return {cat: max(0, min(100, int(scores[cat]))) for cat in CATEGORIES}


def validate_gemini_startup():
    """Lightweight check to verify Gemini API connectivity at server startup."""
    try:
        from google.genai import types
        client = _get_client()
        client.models.generate_content(
            model=MODEL_NAME,
            contents="Respond with exactly: {\"ok\":true}",
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        logger.info("Gemini API startup check passed - connection verified.")
        print("[+] Gemini API connection verified successfully")
        return True
    except RuntimeError as e:
        logger.error("Gemini not configured: %s", e)
        print(f"[!] WARNING: {e}")
        return False
    except Exception as e:
        logger.error("Gemini startup check failed: %s", e)
        print(f"[!] WARNING: Gemini API check failed - {e}")
        print("[!] The application will retry at request time.")
        return False


def analyze_career_with_gemini(profile_data: Dict[str, Any], preference_scores: Dict[str, int]) -> Dict[str, Any]:
    """Generate all career recommendations, analysis, skill gaps, and roadmaps with AI."""
    prompt = f"""
You are an expert AI Career Counselor and Technology Mentor for "AI Career Guide".

The user's engineering field is {profile_data.get('engineering_field', 'engineering')}. You MUST recommend careers grounded in that discipline. Do not recommend software or computer-science careers to a Mechanical, Civil, or Electrical engineering student unless their profile strongly justifies it.

Create a fully personalized career analysis for this individual. Nothing about the recommended careers, analysis, skill gaps, projects, responsibilities, or roadmaps should come from a predefined career catalog. Infer suitable career paths dynamically from the user's complete information.

Provide 3 to 4 genuinely distinct career recommendations. They may be common or niche roles if they fit the user. Do not force the user into a fixed list of careers.

For each recommendation:
- Explain specifically why it fits this user.
- Give a realistic match percentage from your holistic assessment.
- Identify skills the user already has, respecting each stated skill level.
- Identify missing skills and explain the gap.
- Give typical responsibilities relevant to the role.
- Give tailored portfolio/project ideas.
- Give targeted learning areas.
- Give practical next steps.
- Create a personalized 5-month roadmap. Each month must have a topic, what to learn, a suggested project, and an expected outcome. The roadmap must reflect this user's current skill levels and goals, not a generic template.

Also return the seven-dimensional career profile supplied below, which was independently generated by AI from the assessment responses.

USER PROFILE:
{json.dumps(profile_data, ensure_ascii=False)}

AI-GENERATED CAREER PROFILE:
{json.dumps(preference_scores)}

Return valid JSON only.

JSON SCHEMA:
{{
  "career_profile": {json.dumps(preference_scores)},
  "recommendations": [
    {{
      "id": "unique-kebab-case-id",
      "career": "Dynamically selected career title",
      "match_percentage": 0,
      "reason": "Specific explanation tied to the user's information",
      "overview": "Role overview",
      "existing_skills": ["Skill with level where relevant"],
      "missing_skills": ["Skill gap"],
      "responsibilities": ["Responsibility 1", "Responsibility 2"],
      "suggested_projects": ["Project 1", "Project 2"],
      "learning_areas": ["Area 1", "Area 2"],
      "next_steps": ["Step 1", "Step 2"],
      "roadmap": [
        {{"month": 1, "title": "Month 1", "topic": "Personalized topic", "what_to_learn": "What to learn", "suggested_project": "Project", "expected_outcome": "Outcome"}},
        {{"month": 2, "title": "Month 2", "topic": "Personalized topic", "what_to_learn": "What to learn", "suggested_project": "Project", "expected_outcome": "Outcome"}},
        {{"month": 3, "title": "Month 3", "topic": "Personalized topic", "what_to_learn": "What to learn", "suggested_project": "Project", "expected_outcome": "Outcome"}},
        {{"month": 4, "title": "Month 4", "topic": "Personalized topic", "what_to_learn": "What to learn", "suggested_project": "Project", "expected_outcome": "Outcome"}},
        {{"month": 5, "title": "Month 5", "topic": "Personalized topic", "what_to_learn": "What to learn", "suggested_project": "Project", "expected_outcome": "Outcome"}}
      ]
    }}
  ]
}}
"""
    data = _generate_json(prompt)
    recommendations = data.get("recommendations")
    if not isinstance(recommendations, list) or not recommendations:
        raise RuntimeError("The AI returned no personalized career recommendations. Please try again.")
    for idx, rec in enumerate(recommendations):
        if not rec.get("id"):
            rec["id"] = re.sub(r"[^a-zA-Z0-9]+", "-", rec.get("career", f"career-{idx}")).strip("-").lower()
        if not isinstance(rec.get("roadmap"), list) or len(rec["roadmap"]) != 5:
            raise RuntimeError("The AI returned an incomplete personalized roadmap. Please try again.")
    data["career_profile"] = preference_scores
    return data

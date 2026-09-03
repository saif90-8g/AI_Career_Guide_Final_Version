"""
AI Career Guide - Flask Web Application
Empowering students and early-career professionals to discover ideal career paths,
analyze skill gaps, and follow personalized monthly roadmaps.
"""

import os
import secrets
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from dotenv import load_dotenv
from services.ai_service import (
    generate_ai_preference_profile,
    analyze_career_with_gemini,
    generate_dynamic_question,
    generate_matric_question,
    generate_fsc_question,
    analyze_matric_study_path,
    analyze_fsc_study_path,
    validate_gemini_startup
)

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(24))


@app.context_processor
def inject_now():
    """Make current datetime available to all templates."""
    return {"now": datetime.now()}

# In-memory store for analysis results to keep session cookies compact
GLOBAL_RESULTS_CACHE = {}


def get_session_id():
    """Gets or initializes a unique session identifier."""
    if "uid" not in session:
        session["uid"] = secrets.token_hex(16)
    return session["uid"]


@app.route("/")
def index():
    """Renders the modern startup landing page."""
    return render_template("index.html")


@app.route("/assessment")
def assessment():
    """Renders the 3-step Career Interest & Work Preference assessment form."""
    return render_template("assessment.html")


@app.route("/results")
def results():
    """Renders the career recommendations & preference profile dashboard."""
    uid = get_session_id()
    user_data = GLOBAL_RESULTS_CACHE.get(uid)
    
    if not user_data:
        return redirect(url_for("assessment"))

    return render_template(
        "results.html",
        results=user_data.get("analysis_results", {}),
        profile=user_data.get("user_profile", {})
    )


@app.route("/career/<career_id>")
def career_detail(career_id):
    """Renders the detailed career deep dive, skill gap analysis, and 5-month roadmap."""
    uid = get_session_id()
    user_data = GLOBAL_RESULTS_CACHE.get(uid)
    
    if not user_data:
        return redirect(url_for("assessment"))

    analysis_data = user_data.get("analysis_results", {})
    recommendations = analysis_data.get("recommendations", [])
    selected_career = next((r for r in recommendations if r.get("id") == career_id), None)

    # Fallback to first recommendation if not matched
    if not selected_career and recommendations:
        selected_career = recommendations[0]

    if not selected_career:
        return redirect(url_for("results"))

    return render_template(
        "career.html",
        career=selected_career,
        all_careers=recommendations,
        user_profile=user_data.get("user_profile", {}),
        career_profile=analysis_data.get("career_profile", {})
    )


@app.route("/api/generate-question", methods=["POST"])
def api_generate_question():
    """Generates the next personalized assessment question from the user's profile and prior responses."""
    try:
        payload = request.get_json(silent=True) or {}
        question_number = int(payload.get("question_number", 1))
        if question_number < 1 or question_number > 10:
            return jsonify({"status": "error", "message": "Question number must be between 1 and 10."}), 400
        profile = payload.get("profile", {})
        education_level = profile.get("education")
        if education_level == "Matric":
            question = generate_matric_question(
                profile,
                payload.get("previous_questions", []),
                payload.get("previous_answers", {}),
                question_number
            )
        elif education_level == "FSc / Intermediate":
            question = generate_fsc_question(
                profile,
                payload.get("previous_questions", []),
                payload.get("previous_answers", {}),
                question_number
            )
        else:
            question = generate_dynamic_question(
                profile,
                payload.get("previous_questions", []),
                payload.get("previous_answers", {}),
                question_number
            )
        return jsonify({"status": "success", "question": question})
    except RuntimeError as e:
        return jsonify({"status": "error", "message": str(e)}), 503
    except Exception as e:
        app.logger.error(f"Error generating dynamic question: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Unable to generate the personalized question. Please try again."}), 500


@app.route("/api/calculate-profile", methods=["POST"])
def api_calculate_profile():
    """Computes the 7-dimension preference scores before full AI submission."""
    try:
        data = request.get_json(silent=True) or {}
        answers = data.get("answers", {})
        questions = data.get("questions", [])
        if not isinstance(answers, dict):
            return jsonify({"status": "error", "message": "Invalid answers format"}), 400

        profile = data.get('profile', {})
        if profile.get('education') in ('Matric', 'FSc / Intermediate'):
            scores = {
                "analytical": 0, "technical": 0, "creative": 0,
                "social": 0, "leadership": 0, "research": 0, "practical": 0
            }
        else:
            scores = generate_ai_preference_profile(profile, questions, answers)
        return jsonify({
            "status": "success",
            "career_profile": scores
        })
    except Exception as e:
        return jsonify({"status": "error", "message": f"Calculation error: {str(e)}"}), 500


@app.route("/api/analyze-career", methods=["POST"])
def api_analyze_career():
    """
    Primary AI API endpoint.
    Validates form data, calculates preference scores, queries Gemini AI,
    and returns recommendations, skill gap analysis, and roadmaps.
    """
    try:
        payload = request.get_json(silent=True)
        if not payload:
            return jsonify({
                "status": "error",
                "message": "Invalid request payload. Please submit a valid JSON body."
            }), 400

        # Form validation
        full_name = payload.get("full_name", "").strip()
        education = payload.get("education", "").strip()
        skills = payload.get("skills", [])
        answers = payload.get("answers", {})
        questions = payload.get("questions", [])

        # Normalize skills if sent as string or list
        if isinstance(skills, str):
            skills = [s.strip() for s in skills.split(",") if s.strip()]

        if not full_name:
            full_name = "Aspiring Professional"

        # Skills are only required for the Bachelor's / career-analysis path.
        # Matric and FSc students are not expected to have professional skills yet.
        if education not in ("Matric", "FSc / Intermediate") and not skills:
            return jsonify({"status": "error", "message": "Please add at least one skill with a skill level."}), 400

        profile_data = {
            # Start with all payload fields to preserve education-specific data
            # (e.g. Matric: matric_group, percentage, marks, favourite_subject, etc.)
            **payload,
            # Override and normalize common fields
            "full_name": full_name,
            "age_range": payload.get("age_range", "18-24"),
            "education": education or "Undergraduate",
            "degree": payload.get("degree", "").strip() or "General Studies",
            "skills": skills,
            "experience": payload.get("experience", "Beginner"),
            "interests": payload.get("interests", ["Technology"]),
            "career_goal": payload.get("career_goal", "").strip() or "Build a rewarding career",
            "preferred_industry": payload.get("preferred_industry", "").strip() or "Technology",
            "answers": answers,
            "questions": questions
        }

        # Branch: Matric and FSc students get study-path / degree recommendations
        # instead of career/skill-gap analysis (they don't have professional skills yet)
        if profile_data.get("education") == "Matric":
            analysis_result = analyze_matric_study_path(profile_data, questions, answers)
        elif profile_data.get("education") == "FSc / Intermediate":
            analysis_result = analyze_fsc_study_path(profile_data, questions, answers)
        else:
            # Step 1: Generate the Career Interest & Work Preference profile with AI
            preference_scores = generate_ai_preference_profile(profile_data, questions, answers)

            # Step 2: Generate all recommendations, analysis, and roadmaps with AI
            analysis_result = analyze_career_with_gemini(profile_data, preference_scores)

        # Step 3: Cache in server store for smooth UI navigation
        uid = get_session_id()
        GLOBAL_RESULTS_CACHE[uid] = {
            "analysis_results": analysis_result,
            "user_profile": profile_data
        }

        return jsonify({
            "status": "success",
            "data": analysis_result
        })

    except Exception as e:
        app.logger.error(f"Error in api_analyze_career: {e}", exc_info=True)
        return jsonify({
            "status": "error",
            "message": "An unexpected error occurred while analyzing your career profile. Please try again."
        }), 500


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "app": "AI Career Guide",
        "version": "1.0.0"
    })


@app.errorhandler(404)
def page_not_found(e):
    return render_template(
        "index.html",
        error_msg="The page you requested was not found. Returning to home."
    ), 404


@app.errorhandler(500)
def internal_server_error(e):
    return render_template(
        "index.html",
        error_msg="A temporary server error occurred. Please try again."
    ), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_DEBUG", "True").lower() in ("true", "1", "t")
    print("[*] AI Career Guide - AI MODE")
    print("[*] Gemini AI is required for personalized questions and career guidance")

    # Validate Gemini API connectivity before accepting requests
    # In debug mode, only run in the child process to save API quota
    if not debug_mode or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        validate_gemini_startup()
    else:
        print("[*] Skipping startup check in reloader process (will run in server process)")

    print(f"[*] AI Career Guide server starting on http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug_mode)

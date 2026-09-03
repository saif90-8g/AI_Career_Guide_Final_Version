/**
 * AI Career Guide - Frontend Application Controller
 * Handles multi-step form state, dynamic skill tags, pre-calculation preview,
 * multi-stage AI loading animation, and API integrations.
 */

// ── Field-to-Industry map ──────────────────────────────────────────────────
const FIELD_INDUSTRIES = {
    "Computer Engineering":  ["Artificial Intelligence & ML", "Software & Web Engineering", "Cybersecurity & Cloud", "Data Science & Analytics", "Robotics & Embedded Systems", "Product Design & UX", "Fintech & Business Systems"],
    "Software Engineering":  ["Software & Web Engineering", "Artificial Intelligence & ML", "Cloud & DevOps", "Fintech & Business Systems", "Cybersecurity & Cloud", "Product Design & UX", "Data Science & Analytics"],
    "Electrical Engineering":["Power Systems & Energy", "Electronics & Semiconductor", "Robotics & Automation", "Telecommunications", "Embedded Systems & IoT", "Renewable Energy", "Defense & Aerospace Electronics"],
    "Mechanical Engineering":["Manufacturing & Production", "Automotive & Transportation", "Aerospace & Defense", "Energy & Oil & Gas", "HVAC & Building Services", "Robotics & Automation", "Biomedical Devices"],
    "Civil Engineering":     ["Structural & Building Construction", "Transportation & Highways", "Water Resources & Environmental", "Geotechnical & Foundation", "Urban Planning & Development", "Project & Construction Management", "Infrastructure & Smart Cities"]
};

// ── Field-to-QuickSkills map ───────────────────────────────────────────────
const FIELD_SKILLS = {
    "Computer Engineering":  ["Python", "C++", "Java", "JavaScript", "SQL", "Problem Solving", "Data Analysis", "Leadership"],
    "Software Engineering":  ["JavaScript", "Python", "React", "Node.js", "Git", "SQL", "REST APIs", "Problem Solving"],
    "Electrical Engineering":["Circuit Design", "MATLAB", "PLC Programming", "Embedded C", "PCB Design", "AutoCAD Electrical", "Power Systems", "Signal Processing"],
    "Mechanical Engineering":["AutoCAD", "SolidWorks", "MATLAB", "Thermodynamics", "FEA / ANSYS", "Fluid Mechanics", "GD&T", "Manufacturing Processes"],
    "Civil Engineering":     ["AutoCAD", "SAP2000", "ETABS", "Surveying", "Concrete Design", "Revit / BIM", "Project Management", "Soil Mechanics"]
};

// State tracking
let currentStep = 0;
let selectedEducation = '';
let userSkills = [];
let step3RadarChartInstance = null;
let currentPreferenceScores = null;
let generatedQuestions = [];
let dynamicQuestionRequest = null;

/**
 * Prefetch queue — stores promises/resolved questions for upcoming questions.
 * Key: question_number (1-based), Value: Promise<questionObject>
 */
let prefetchQueue = {};

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", function() {
    initSkillInput();
    initFormInteractions();
    initPercentageValidation();
});

/**
 * Initializes the interactive skill tag input and chip system.
 */
function initSkillInput() {
    const skillInput = document.getElementById("skillTextInput");
    if (!skillInput) return;

    skillInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            const val = skillInput.value.trim().replace(/,/g, "");
            if (val) {
                addSkillTag(val);
                skillInput.value = "";
            }
        }
    });

    skillInput.addEventListener("blur", function() {
        const val = skillInput.value.trim().replace(/,/g, "");
        if (val) {
            addSkillTag(val);
            skillInput.value = "";
        }
    });
}

function addSkillTag(skillName) {
    const cleanSkill = skillName.trim();
    if (!cleanSkill) return;
    const levelSelect = document.getElementById("skillLevel");
    const level = levelSelect ? levelSelect.value : "Beginner";

    // Check duplicate
    if (userSkills.some(s => s.name.toLowerCase() === cleanSkill.toLowerCase())) {
        return;
    }

    userSkills.push({ name: cleanSkill, level: level });
    renderSkillBadges();
    
    // Hide validation warning if present
    const valMsg = document.getElementById("skillsValidationMsg");
    if (valMsg) valMsg.classList.add("d-none");
}

function removeSkillTag(skillName) {
    userSkills = userSkills.filter(s => s.name.toLowerCase() !== skillName.toLowerCase());
    renderSkillBadges();
}

function renderSkillBadges() {
    const container = document.getElementById("activeSkillBadges");
    const countBadge = document.getElementById("skillCountBadge");
    if (!container) return;

    container.innerHTML = "";
    userSkills.forEach(skill => {
        const badge = document.createElement("span");
        badge.className = "skill-tag-badge";
        badge.innerHTML = `
            <span>${escapeHtml(skill.name)} <small class="opacity-75">(${escapeHtml(skill.level)})</small></span>
            <i class="fa-solid fa-xmark remove-tag" onclick="removeSkillTag('${escapeHtml(skill.name)}')"></i>
        `;
        container.appendChild(badge);
    });

    if (countBadge) {
        countBadge.innerText = `${userSkills.length} skill${userSkills.length === 1 ? '' : 's'} added`;
    }
}

/**
 * Attaches radio button selection highlights
 */
function initFormInteractions() {
    const radios = document.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => {
        radio.addEventListener("change", function() {
            const groupName = this.name;
            document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
                const parent = r.closest(".custom-radio-card");
                if (parent) {
                    if (r.checked) {
                        parent.classList.add("border-primary", "bg-primary-subtle");
                    } else {
                        parent.classList.remove("border-primary", "bg-primary-subtle");
                    }
                }
            });
        });
    });
}

/**
 * Step 0: Education level card selection handler.
 */
function selectEducation(level) {
    selectedEducation = level;

    // Update card visual state using data-level attribute
    document.querySelectorAll('.education-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.level === level);
    });

    // Hide validation message
    const msg = document.getElementById('eduSelectionMsg');
    if (msg) msg.classList.add('d-none');
}

/**
 * Updates visible fields in Step 1 based on the selected education level.
 */
function onEducationChange() {
    // Use selectedEducation (from Step 0 card) as the primary source
    const level = selectedEducation;

    // Show/hide Matric-specific fields
    document.querySelectorAll('.edu-matric-field').forEach(el => {
        el.classList.toggle('d-none', level !== 'Matric');
    });

    // Show/hide FSc-specific fields
    document.querySelectorAll('.edu-fsc-field').forEach(el => {
        el.classList.toggle('d-none', level !== 'FSc / Intermediate');
    });

    // Show/hide Bachelor's-specific fields (engineering, degree, industry, education level)
    document.querySelectorAll('.edu-bachelors-field').forEach(el => {
        el.classList.toggle('d-none', level !== 'Bachelors');
    });

    // Show/hide fields not relevant for Matric or FSc paths
    // (experience, career goal, skills are only for Bachelor's / career-analysis path)
    document.querySelectorAll('.edu-non-matric-field').forEach(el => {
        el.classList.toggle('d-none', level === 'Matric' || level === 'FSc / Intermediate');
    });

    // For Matric/FSc paths, populate default industries since no engineering field is selected
    if (level === 'Matric' || level === 'FSc / Intermediate') {
        const industrySelect = document.getElementById('preferredIndustry');
        if (industrySelect && industrySelect.options.length <= 1) {
            const defaults = ["Technology & Software", "Healthcare & Medical", "Business & Finance", "Science & Research", "Creative Arts & Media", "Engineering & Manufacturing"];
            industrySelect.innerHTML = '<option value="" disabled selected>Select your preferred industry...</option>';
            defaults.forEach(ind => {
                const opt = document.createElement('option');
                opt.value = ind;
                opt.textContent = ind;
                industrySelect.appendChild(opt);
            });
        }
    }
}

/**
 * Attaches real-time validation to percentage fields so values outside 0-100
 * are flagged immediately with a clear message.
 */
function initPercentageValidation() {
    const percentageFields = [
        'matricPercentage', 'matricPhysics', 'matricChemistry', 'matricMaths', 'matricOptionalSubject',
        'fscPercentage', 'fscPhysics', 'fscChemistry', 'fscOptionalSubject'
    ];
    percentageFields.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function() {
            validatePercentageField(id, false);
        });
        el.addEventListener('blur', function() {
            validatePercentageField(id, false);
        });
    });
}

/**
 * Validates a single percentage input. Marks the field invalid if a value is
 * present and is not a number between 0 and 100.
 * Returns { valid: boolean, empty: boolean }.
 */
function validatePercentageField(id, required) {
    const el = document.getElementById(id);
    if (!el) return { valid: true, empty: true };
    const raw = el.value ? el.value.toString().trim() : '';
    const empty = raw === '';

    if (empty) {
        if (required) {
            el.classList.add('is-invalid');
        } else {
            el.classList.remove('is-invalid');
        }
        return { valid: !required, empty: true };
    }

    const val = parseFloat(raw);
    if (isNaN(val) || val < 0 || val > 100) {
        el.classList.add('is-invalid');
        const feedback = el.parentElement.querySelector('.invalid-feedback') || el.nextElementSibling;
        if (feedback && feedback.classList.contains('invalid-feedback')) {
            feedback.textContent = 'Please enter a valid percentage between 0 and 100.';
        }
        return { valid: false, empty: false };
    }

    el.classList.remove('is-invalid');
    return { valid: true, empty: false };
}

/**
 * Step navigation and form validation
 */
function goToStep(step) {
    if (step === 1) {
        if (!validateStep0()) return;
        onEducationChange();
    } else if (step === 2) {
        if (!validateStep1()) return;
        if (generatedQuestions.length === 0) {
            initializeDynamicQuestions();
        }
    } else if (step === 3) {
        if (!validateStep2()) return;
        prepareStep3Review();
    }

    currentStep = step;

    // Toggle container visibility
    document.getElementById("step0Container").classList.toggle("d-none", step !== 0);
    document.getElementById("step1Container").classList.toggle("d-none", step !== 1);
    document.getElementById("step2Container").classList.toggle("d-none", step !== 2);
    document.getElementById("step3Container").classList.toggle("d-none", step !== 3);

    // Update headings and progress bar
    const heading = document.getElementById("stepHeading");
    const badge = document.getElementById("stepCounterBadge");
    const bar = document.getElementById("stepperProgressBar");

    if (step === 0) {
        if (heading) heading.innerText = "Step 1 \u2014 Education Level";
        if (badge) badge.innerText = "Step 1 of 4";
        if (bar) bar.style.width = "25%";
        setLabelActive("stepLabel1");
    } else if (step === 1) {
        if (heading) heading.innerText = "Step 2 \u2014 Basic Profile";
        if (badge) badge.innerText = "Step 2 of 4";
        if (bar) bar.style.width = "50%";
        setLabelActive("stepLabel2");
    } else if (step === 2) {
        if (heading) heading.innerText = "Step 3 \u2014 Career Interest Assessment";
        if (badge) badge.innerText = "Step 3 of 4";
        if (bar) bar.style.width = "75%";
        setLabelActive("stepLabel3");
    } else if (step === 3) {
        if (heading) heading.innerText = "Step 4 \u2014 Review & AI Analysis";
        if (badge) badge.innerText = "Step 4 of 4";
        if (bar) bar.style.width = "100%";
        setLabelActive("stepLabel4");
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setLabelActive(activeId) {
    ["stepLabel1", "stepLabel2", "stepLabel3", "stepLabel4"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === activeId) {
                el.className = "text-primary fw-bold";
            } else {
                el.className = "text-secondary";
            }
        }
    });
}

/**
 * Validates Step 0: Education level must be selected.
 */
function validateStep0() {
    if (!selectedEducation) {
        const msg = document.getElementById('eduSelectionMsg');
        if (msg) msg.classList.remove('d-none');
        return false;
    }
    const msg = document.getElementById('eduSelectionMsg');
    if (msg) msg.classList.add('d-none');
    return true;
}

function validateStep1() {
    let isValid = true;
    const level = selectedEducation;

    // Always-required fields
    ['fullName', 'ageRange'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (!el.value || !el.value.trim()) {
                el.classList.add('is-invalid');
                isValid = false;
            } else {
                el.classList.remove('is-invalid');
            }
        }
    });

    // Non-Matric paths (excluding FSc) also require experience, career goal, and skills
    // FSc students don't need professional skills/experience yet
    if (level !== 'Matric' && level !== 'FSc / Intermediate') {
        ['experienceLevel', 'careerGoal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (!el.value || !el.value.trim()) {
                    el.classList.add('is-invalid');
                    isValid = false;
                } else {
                    el.classList.remove('is-invalid');
                }
            }
        });

        const valMsg = document.getElementById('skillsValidationMsg');
        if (userSkills.length === 0) {
            if (valMsg) valMsg.classList.remove('d-none');
            isValid = false;
        } else {
            if (valMsg) valMsg.classList.add('d-none');
        }
    }

    // Matric path: school info, marks, favourite/strong subjects, group, interests, work type, aim
    if (level === 'Matric') {
        ['matricGender', 'matricSchool', 'matricPercentage',
         'matricPhysics', 'matricChemistry', 'matricMaths',
         'matricOptionalSubject', 'matricFavSubject', 'matricLeastFavSubject',
         'matricGroup', 'matricStrongestSubject',
         'matricSubjectsEnjoy', 'matricInterests',
         'matricAimInLife'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (!el.value || !el.value.toString().trim()) {
                    el.classList.add('is-invalid');
                    isValid = false;
                } else {
                    el.classList.remove('is-invalid');
                }
            }
        });

        // Matric subject percentages and overall percentage must be 0-100
        ['matricPercentage', 'matricPhysics', 'matricChemistry', 'matricMaths', 'matricOptionalSubject'].forEach(id => {
            const result = validatePercentageField(id, true);
            if (!result.valid) isValid = false;
        });

        // Work type checkboxes
        const workTypes = getCheckedValues('matricWorkType');
        const workTypeMsg = document.getElementById('matricWorkTypeValidationMsg');
        if (workTypes.length === 0) {
            if (workTypeMsg) workTypeMsg.classList.remove('d-none');
            highlightCheckboxGroup('matricWorkType', false);
            isValid = false;
        } else {
            if (workTypeMsg) workTypeMsg.classList.add('d-none');
            highlightCheckboxGroup('matricWorkType', true);
        }
    }

    // FSc path: college name and group
    if (level === 'FSc / Intermediate') {
        ['fscCollege', 'fscGroup'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (!el.value || !el.value.trim()) {
                    el.classList.add('is-invalid');
                    isValid = false;
                } else {
                    el.classList.remove('is-invalid');
                }
            }
        });

        // FSc percentage fields must be 0-100 when filled
        ['fscPercentage', 'fscPhysics', 'fscChemistry', 'fscOptionalSubject'].forEach(id => {
            const result = validatePercentageField(id, false);
            if (!result.valid) isValid = false;
        });
    }

    // Bachelor's path: engineering, education level, degree, industry
    if (level === 'Bachelors') {
        ['engineeringField', 'educationLevel', 'degreeField', 'preferredIndustry'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (!el.value || !el.value.trim()) {
                    el.classList.add('is-invalid');
                    isValid = false;
                } else {
                    el.classList.remove('is-invalid');
                }
            }
        });
    }

    return isValid;
}

function validateStep2() {
    const allAnswered = generatedQuestions.length === 10 && generatedQuestions.every(q => {
        return !!document.querySelector(`input[name="${q.id}"]:checked`);
    });
    const valMsg = document.getElementById("step2ValidationMsg");
    if (!allAnswered) {
        if (valMsg) valMsg.classList.remove("d-none");
        return false;
    }
    if (valMsg) valMsg.classList.add("d-none");
    return true;
}

/**
 * Gathers user answers and builds preview calculation for Step 3
 */
async function prepareStep3Review() {
    const genericSummary = document.getElementById("genericSummaryCard");
    const matricSummary = document.getElementById("matricSummaryCard");
    const reviewTitle = document.getElementById("step3ReviewTitle");
    const reviewDesc = document.getElementById("step3ReviewDescription");
    const visualProfile = document.getElementById("step3VisualProfile");
    const matricMsg = document.getElementById("matricPreviewMessage");
    const submitBtn = document.getElementById("submitBtn");

    if (selectedEducation === 'Matric') {
        if (genericSummary) genericSummary.classList.add("d-none");
        if (matricSummary) matricSummary.classList.remove("d-none");
        const fscSummary = document.getElementById("fscSummaryCard");
        if (fscSummary) fscSummary.classList.add("d-none");
        if (reviewTitle) reviewTitle.innerText = "Review Your Matric Profile";
        if (reviewDesc) reviewDesc.innerText = "Check your details below. The AI will recommend the best intermediate study path for you.";

        document.getElementById("matricSummaryName").innerText = document.getElementById("fullName").value || "-";
        document.getElementById("matricSummaryGroup").innerText = document.getElementById("matricGroup").value || "-";
        document.getElementById("matricSummaryMarks").innerText = (document.getElementById("matricPercentage").value || "-") + "%";
        document.getElementById("matricSummaryFav").innerText = document.getElementById("matricFavSubject").value || "-";
        document.getElementById("matricSummaryStrongest").innerText = document.getElementById("matricStrongestSubject").value || "-";
        document.getElementById("matricSummaryInterests").innerText = document.getElementById("matricInterests").value || "-";

        if (visualProfile) visualProfile.classList.add("d-none");
        if (matricMsg) matricMsg.classList.remove("d-none");
        const fscMsg = document.getElementById("fscPreviewMessage");
        if (fscMsg) fscMsg.classList.add("d-none");
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles me-2"></i> Generate Study Path Recommendations';
        }
        return;
    }

    if (selectedEducation === 'FSc / Intermediate') {
        if (genericSummary) genericSummary.classList.add("d-none");
        if (matricSummary) matricSummary.classList.add("d-none");
        const fscSummary = document.getElementById("fscSummaryCard");
        if (fscSummary) fscSummary.classList.remove("d-none");
        if (reviewTitle) reviewTitle.innerText = "Review Your FSc / Intermediate Profile";
        if (reviewDesc) reviewDesc.innerText = "Check your details below. The AI will recommend the best degree program for you.";

        document.getElementById("fscSummaryName").innerText = document.getElementById("fullName").value || "-";
        document.getElementById("fscSummaryCollege").innerText = document.getElementById("fscCollege").value || "-";
        document.getElementById("fscSummaryGroup").innerText = document.getElementById("fscGroup").value || "-";
        const fscPct = document.getElementById("fscPercentage");
        document.getElementById("fscSummaryMarks").innerText = (fscPct && fscPct.value) ? fscPct.value + "%" : "Not provided";
        document.getElementById("fscSummaryFav").innerText = (document.getElementById("fscFavSubject") || {}).value || "-";
        document.getElementById("fscSummaryStrongest").innerText = (document.getElementById("fscStrongestSubject") || {}).value || "-";
        document.getElementById("fscSummaryInterests").innerText = (document.getElementById("fscInterests") || {}).value || "-";

        if (visualProfile) visualProfile.classList.add("d-none");
        if (matricMsg) matricMsg.classList.add("d-none");
        const fscMsg = document.getElementById("fscPreviewMessage");
        if (fscMsg) fscMsg.classList.remove("d-none");
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles me-2"></i> Generate Degree Recommendations';
        }
        return;
    }

    // Non-Matric paths
    if (genericSummary) genericSummary.classList.remove("d-none");
    if (matricSummary) matricSummary.classList.add("d-none");
    if (reviewTitle) reviewTitle.innerText = "Your Career Interest Profile";
    if (reviewDesc) reviewDesc.innerText = "Below is the calculated preference distribution derived from your answers. Ready for AI Analysis!";
    if (visualProfile) visualProfile.classList.remove("d-none");
    if (matricMsg) matricMsg.classList.add("d-none");
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles me-2"></i> Generate AI Career Recommendations';
    }

    // Populate generic profile summary
    document.getElementById("summaryName").innerText = document.getElementById("fullName").value || "-";
    if (selectedEducation === 'FSc / Intermediate') {
        const college = document.getElementById('fscCollege').value;
        const group = document.getElementById('fscGroup').value;
        document.getElementById("summaryEdu").innerText = `FSc / Intermediate \u2014 ${college} (${group})`;
    } else {
        const eduEl = document.getElementById('educationLevel');
        const degEl = document.getElementById('degreeField');
        document.getElementById("summaryEdu").innerText = `${eduEl ? eduEl.value : '-'} (${degEl ? degEl.value : '-'})`;
    }
    document.getElementById("summaryExp").innerText = document.getElementById("experienceLevel").value || "-";
    const industryEl = document.getElementById("preferredIndustry");
    document.getElementById("summaryInd").innerText = (industryEl && industryEl.value) ? industryEl.value : "Not specified";
    document.getElementById("summaryGoal").innerText = document.getElementById("careerGoal").value || "-";
    document.getElementById("summarySkills").innerText = userSkills.map(s => `${s.name} (${s.level})`).join(", ") || "-";

    // Gather answers
    const answers = getAnswersObject();

    try {
        const res = await fetch("/api/calculate-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers: answers, questions: generatedQuestions, profile: getDynamicProfilePayload() })
        });
        const data = await res.json();
        if (data.status === "success") {
            currentPreferenceScores = data.career_profile;
            renderStep3Charts(currentPreferenceScores);
        }
    } catch (e) {
        console.error("Error computing preference preview:", e);
        const barContainer = document.getElementById("step3BarBreakdown");
        if (barContainer) {
            barContainer.innerHTML = '<div class="alert alert-warning small rounded-3 mb-0">' +
                '<i class="fa-solid fa-triangle-exclamation me-2"></i>' +
                'Unable to load preference preview. Your full analysis will still be processed.' +
                '</div>';
        }
    }
}

function getAnswersObject() {
    const answers = {};
    generatedQuestions.forEach(q => {
        const sel = document.querySelector(`input[name="${q.id}"]:checked`);
        if (sel) answers[q.id] = sel.value;
    });
    return answers;
}

function getCheckedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(cb => cb.value);
}

function highlightCheckboxGroup(name, isValid) {
    const cards = document.querySelectorAll(`input[name="${name}"]`);
    cards.forEach(cb => {
        const card = cb.closest('.custom-radio-card');
        if (card) {
            if (isValid) {
                card.classList.remove('border-danger');
            } else {
                card.classList.add('border-danger');
            }
        }
    });
}

function getDynamicProfilePayload() {
    const level = selectedEducation;
    const industryEl = document.getElementById('preferredIndustry');
    const engineeringEl = document.getElementById('engineeringField');
    const degreeEl = document.getElementById('degreeField');
    const industry = (industryEl && industryEl.value) ? industryEl.value : 'Technology';
    const engineering = (engineeringEl && engineeringEl.value) ? engineeringEl.value : '';

    // Build education and degree description based on the selected guidance path
    let education, degreeDesc;

    if (level === 'Matric') {
        education = 'Matric';
        const school = document.getElementById('matricSchool');
        const gender = document.getElementById('matricGender');
        const percentage = document.getElementById('matricPercentage');
        const physics = document.getElementById('matricPhysics');
        const chemistry = document.getElementById('matricChemistry');
        const maths = document.getElementById('matricMaths');
        const optSubject = document.getElementById('matricOptionalSubject');
        const favSubject = document.getElementById('matricFavSubject');
        const leastFav = document.getElementById('matricLeastFavSubject');
        const subjectsEnjoy = document.getElementById('matricSubjectsEnjoy');
        const interests = document.getElementById('matricInterests');
        const workTypes = getCheckedValues('matricWorkType');
        const group = document.getElementById('matricGroup');
        const strongestSubject = document.getElementById('matricStrongestSubject');
        const aimInLife = document.getElementById('matricAimInLife');
        const primaryWorkType = workTypes.length ? workTypes[0] : 'General';

        degreeDesc = `Matric \u2014 ${percentage ? percentage.value + '%' : 'N/A'}`;

        // Build detailed Matric profile payload
        return {
            full_name: document.getElementById("fullName").value.trim(),
            engineering_field: '',
            age_range: document.getElementById("ageRange").value,
            education: 'Matric',
            degree: degreeDesc,
            experience: 'Student',
            preferred_industry: primaryWorkType,
            career_goal: aimInLife ? aimInLife.value.trim() : '',
            skills: [],
            interests: [primaryWorkType],
            gender: gender ? gender.value : '',
            school: school ? school.value.trim() : '',
            percentage: percentage ? percentage.value : '',
            marks: {
                physics: physics ? physics.value : '',
                chemistry: chemistry ? chemistry.value : '',
                maths: maths ? maths.value : '',
                optional: optSubject ? optSubject.value : ''
            },
            favourite_subject: favSubject ? favSubject.value : '',
            least_favourite_subject: leastFav ? leastFav.value : '',
            strongest_subject: strongestSubject ? strongestSubject.value : '',
            subjects_enjoy: subjectsEnjoy ? subjectsEnjoy.value.trim() : '',
            interests_hobbies: interests ? interests.value.trim() : '',
            work_type_preferences: workTypes,
            matric_group: group ? group.value : '',
            aim_in_life: aimInLife ? aimInLife.value.trim() : ''
        };
    } else if (level === 'FSc / Intermediate') {
        education = 'FSc / Intermediate';
        const group = document.getElementById('fscGroup');
        degreeDesc = (group && group.value) ? `FSc / Intermediate \u2014 ${group.value}` : 'FSc / Intermediate';
        const fscPercentage = document.getElementById('fscPercentage');
        const fscPhysics = document.getElementById('fscPhysics');
        const fscChemistry = document.getElementById('fscChemistry');
        const fscOptional = document.getElementById('fscOptionalSubject');
        const fscFavSubject = document.getElementById('fscFavSubject');
        const fscStrongestSubject = document.getElementById('fscStrongestSubject');
        const fscSubjectsEnjoy = document.getElementById('fscSubjectsEnjoy');
        const fscInterests = document.getElementById('fscInterests');
        const fscWorkTypes = getCheckedValues('fscWorkType');
        const fscAimInLife = document.getElementById('fscAimInLife');
        const primaryWorkType = fscWorkTypes.length ? fscWorkTypes[0] : 'General';
        const expEl = document.getElementById('experienceLevel');

        return {
            full_name: document.getElementById("fullName").value.trim(),
            engineering_field: '',
            age_range: document.getElementById("ageRange").value,
            education: 'FSc / Intermediate',
            degree: degreeDesc,
            experience: (expEl && expEl.value) ? expEl.value : 'Student',
            preferred_industry: primaryWorkType,
            career_goal: fscAimInLife ? fscAimInLife.value.trim() : '',
            skills: [],
            interests: [primaryWorkType],
            fsc_group: group ? group.value : '',
            college: document.getElementById('fscCollege').value.trim(),
            percentage: fscPercentage ? fscPercentage.value : '',
            marks: {
                physics: fscPhysics ? fscPhysics.value : '',
                chemistry: fscChemistry ? fscChemistry.value : '',
                optional: fscOptional ? fscOptional.value : ''
            },
            favourite_subject: fscFavSubject ? fscFavSubject.value : '',
            strongest_subject: fscStrongestSubject ? fscStrongestSubject.value : '',
            subjects_enjoy: fscSubjectsEnjoy ? fscSubjectsEnjoy.value.trim() : '',
            interests_hobbies: fscInterests ? fscInterests.value.trim() : '',
            work_type_preferences: fscWorkTypes,
            aim_in_life: fscAimInLife ? fscAimInLife.value.trim() : ''
        };
    } else {
        // Bachelor's path
        const eduEl = document.getElementById('educationLevel');
        education = (eduEl && eduEl.value) ? eduEl.value : "Undergraduate / Bachelor's";
        degreeDesc = (degreeEl && degreeEl.value) ? degreeEl.value.trim() : education;
    }

    return {
        full_name: document.getElementById("fullName").value.trim(),
        engineering_field: engineering,
        age_range: document.getElementById("ageRange").value,
        education: education,
        degree: degreeDesc,
        experience: document.getElementById("experienceLevel").value,
        preferred_industry: industry,
        career_goal: document.getElementById("careerGoal").value.trim(),
        skills: userSkills,
        interests: [industry]
    };
}

/**
 * Updates the Industry dropdown and Quick-add skill buttons when the
 * Engineering Field selector changes.
 */
function onFieldChange() {
    const field = document.getElementById("engineeringField").value;
    const industrySelect = document.getElementById("preferredIndustry");
    const skillsContainer = document.getElementById("quickSkillButtons");

    // Repopulate industry dropdown
    if (industrySelect) {
        industrySelect.innerHTML = '<option value="" disabled selected>Select your preferred industry...</option>';
        const industries = FIELD_INDUSTRIES[field] || [];
        industries.forEach(ind => {
            const opt = document.createElement("option");
            opt.value = ind;
            opt.textContent = ind;
            industrySelect.appendChild(opt);
        });
        industrySelect.classList.remove("is-invalid");
    }

    // Repopulate quick-add skill buttons
    if (skillsContainer) {
        skillsContainer.innerHTML = "";
        const skills = FIELD_SKILLS[field] || [];
        skills.forEach(skill => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn-sm btn-outline-secondary rounded-pill py-0 px-2 quick-skill-btn";
            btn.textContent = "+ " + skill;
            btn.onclick = () => addSkillTag(skill);
            skillsContainer.appendChild(btn);
        });
    }
}

async function initializeDynamicQuestions() {
    const wrapper = document.getElementById("questionsWrapper");
    if (!wrapper) return;
    generatedQuestions = [];
    prefetchQueue = {};
    wrapper.innerHTML = "";
    // Fetch Q1 and immediately prefetch Q2 in parallel
    await requestNextDynamicQuestion();
}

/**
 * Fires a background fetch for question `number` and stores the promise
 * in prefetchQueue so it resolves independently of UI flow.
 */
function prefetchQuestion(number) {
    if (number > 10 || prefetchQueue[number]) return;

    // Capture current state at prefetch time for accurate context
    const snapshotQuestions = generatedQuestions.slice();
    const snapshotAnswers   = getAnswersObject();
    const snapshotProfile   = getDynamicProfilePayload();

    prefetchQueue[number] = fetch("/api/generate-question", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
            question_number:    number,
            profile:            snapshotProfile,
            previous_questions: snapshotQuestions,
            previous_answers:   snapshotAnswers
        })
    })
    .then(res => res.json())
    .then(result => {
        if (result.status !== "success") throw new Error(result.message || "Unable to generate question.");
        return result.question;
    })
    .catch(err => {
        // Remove from queue so it can be retried
        delete prefetchQueue[number];
        throw err;
    });
}

async function requestNextDynamicQuestion() {
    const nextNumber = generatedQuestions.length + 1;
    if (nextNumber > 10 || dynamicQuestionRequest) return;

    const loading = document.getElementById("dynamicQuestionsLoading");
    dynamicQuestionRequest = true;

    // Show spinner only if the question is NOT already prefetched/ready
    const alreadyPrefetched = !!prefetchQueue[nextNumber];
    if (!alreadyPrefetched && loading) loading.classList.remove("d-none");

    try {
        let question;

        if (prefetchQueue[nextNumber]) {
            // Question was prefetched — await the already-running promise (instant if done)
            question = await prefetchQueue[nextNumber];
        } else {
            // No prefetch available — fetch now (first question or after a retry)
            prefetchQueue[nextNumber] = fetch("/api/generate-question", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                    question_number:    nextNumber,
                    profile:            getDynamicProfilePayload(),
                    previous_questions: generatedQuestions,
                    previous_answers:   getAnswersObject()
                })
            })
            .then(res => res.json())
            .then(result => {
                if (result.status !== "success") throw new Error(result.message || "Unable to generate question.");
                return result.question;
            });

            question = await prefetchQueue[nextNumber];
        }

        generatedQuestions.push(question);
        renderDynamicQuestion(question);

        // Immediately start prefetching the NEXT question in background
        const upcoming = nextNumber + 1;
        if (upcoming <= 10) {
            prefetchQuestion(upcoming);
        }

    } catch (e) {
        console.error("Dynamic question generation error:", e);
        const wrapper = document.getElementById("questionsWrapper");
        if (wrapper) {
            const errorDiv = document.createElement("div");
            errorDiv.className = "alert alert-warning d-flex align-items-center justify-content-between rounded-4 p-4";
            errorDiv.id = "questionErrorBanner";
            errorDiv.innerHTML =
                '<div class="d-flex align-items-center gap-3">' +
                    '<i class="fa-solid fa-triangle-exclamation text-warning fs-5"></i>' +
                    '<div>' +
                        '<strong class="d-block">AI is preparing your questions...</strong>' +
                        '<small class="text-secondary">' + escapeHtml(e.message) + '</small>' +
                    '</div>' +
                '</div>' +
                '<button class="btn btn-sm btn-outline-warning rounded-pill px-3 fw-semibold" onclick="retryQuestionGeneration()">' +
                    '<i class="fa-solid fa-rotate-right me-1"></i> Retry' +
                '</button>';
            wrapper.appendChild(errorDiv);
        }
    } finally {
        dynamicQuestionRequest = null;
        if (loading) loading.classList.add("d-none");
    }
}

function retryQuestionGeneration() {
    const banner = document.getElementById("questionErrorBanner");
    if (banner) banner.remove();
    requestNextDynamicQuestion();
}

function renderDynamicQuestion(question) {
    const wrapper = document.getElementById("questionsWrapper");
    if (!wrapper) return;
    const card = document.createElement("div");
    card.className = "question-card p-4 rounded-4 border bg-light bg-opacity-50";
    card.innerHTML = `<h6 class="fw-bold text-dark mb-3"><span class="badge bg-primary me-2">Question ${generatedQuestions.length} of 10</span> ${escapeHtml(question.question)}</h6><div class="d-flex flex-column gap-2">${question.options.map(option => `<label class="custom-radio-card p-3 rounded-3 border bg-white d-flex align-items-center gap-3"><input type="radio" name="${escapeHtml(question.id)}" value="${escapeHtml(option.value)}" class="form-check-input mt-0" required><span>${escapeHtml(option.label)}</span></label>`).join("")}</div>`;
    wrapper.appendChild(card);
    card.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener("change", function() {
            card.querySelectorAll(".custom-radio-card").forEach(parent => parent.classList.remove("border-primary", "bg-primary-subtle"));
            const parent = this.closest(".custom-radio-card");
            if (parent) parent.classList.add("border-primary", "bg-primary-subtle");
            // Show the next question immediately (prefetched) then start prefetching the one after
            if (generatedQuestions.length < 10) requestNextDynamicQuestion();
        });
    });
}


/**
 * Renders the radar and horizontal bar charts on Step 3
 */
function renderStep3Charts(scores) {
    const barContainer = document.getElementById("step3BarBreakdown");
    if (barContainer) {
        barContainer.innerHTML = `
            <div>
                <div class="d-flex justify-content-between small fw-bold mb-1">
                    <span><i class="fa-solid fa-microchip text-primary me-2"></i>Technical</span>
                    <span class="text-primary">${scores.technical ?? 0}%</span>
                </div>
                <div class="progress" style="height: 6px;"><div class="progress-bar bg-primary" style="width: ${scores.technical ?? 0}%"></div></div>
            </div>
            <div>
                <div class="d-flex justify-content-between small fw-bold mb-1">
                    <span><i class="fa-solid fa-square-root-variable text-info me-2"></i>Analytical</span>
                    <span class="text-info">${scores.analytical ?? 0}%</span>
                </div>
                <div class="progress" style="height: 6px;"><div class="progress-bar bg-info" style="width: ${scores.analytical ?? 0}%"></div></div>
            </div>
            <div>
                <div class="d-flex justify-content-between small fw-bold mb-1">
                    <span><i class="fa-solid fa-book-open-reader text-success me-2"></i>Research</span>
                    <span class="text-success">${scores.research ?? 0}%</span>
                </div>
                <div class="progress" style="height: 6px;"><div class="progress-bar bg-success" style="width: ${scores.research ?? 0}%"></div></div>
            </div>
            <div>
                <div class="d-flex justify-content-between small fw-bold mb-1">
                    <span><i class="fa-solid fa-people-roof text-warning me-2"></i>Leadership</span>
                    <span class="text-warning">${scores.leadership ?? 0}%</span>
                </div>
                <div class="progress" style="height: 6px;"><div class="progress-bar bg-warning" style="width: ${scores.leadership ?? 0}%"></div></div>
            </div>
            <div>
                <div class="d-flex justify-content-between small fw-bold mb-1">
                    <span><i class="fa-solid fa-palette text-danger me-2"></i>Creative</span>
                    <span class="text-danger">${scores.creative ?? 0}%</span>
                </div>
                <div class="progress" style="height: 6px;"><div class="progress-bar bg-danger" style="width: ${scores.creative ?? 0}%"></div></div>
            </div>
            <div>
                <div class="d-flex justify-content-between small fw-bold mb-1">
                    <span><i class="fa-solid fa-handshake-angle text-primary me-2"></i>Social</span>
                    <span class="text-primary">${scores.social ?? 0}%</span>
                </div>
                <div class="progress" style="height: 6px;"><div class="progress-bar bg-primary bg-opacity-75" style="width: ${scores.social ?? 0}%"></div></div>
            </div>
            <div>
                <div class="d-flex justify-content-between small fw-bold mb-1">
                    <span><i class="fa-solid fa-wrench text-secondary me-2"></i>Practical</span>
                    <span class="text-secondary">${scores.practical ?? 0}%</span>
                </div>
                <div class="progress" style="height: 6px;"><div class="progress-bar bg-secondary" style="width: ${scores.practical ?? 0}%"></div></div>
            </div>
        `;
    }

    const radarCanvas = document.getElementById("step3RadarChart");
    if (radarCanvas) {
        if (step3RadarChartInstance) {
            step3RadarChartInstance.destroy();
        }
        step3RadarChartInstance = new Chart(radarCanvas, {
            type: 'radar',
            data: {
                labels: ['Analytical', 'Technical', 'Creative', 'Social', 'Leadership', 'Research', 'Practical'],
                datasets: [{
                    label: 'Score (%)',
                    data: [
                        scores.analytical ?? 0,
                        scores.technical ?? 0,
                        scores.creative ?? 0,
                        scores.social ?? 0,
                        scores.leadership ?? 0,
                        scores.research ?? 0,
                        scores.practical ?? 0
                    ],
                    fill: true,
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    borderColor: 'rgb(16, 185, 129)',
                    pointBackgroundColor: 'rgb(16, 185, 129)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        suggestedMin: 20,
                        suggestedMax: 100,
                        ticks: { display: false }
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}

/**
 * Multi-stage Loading Overlay & Submission (Section 18)
 */
async function submitForAIAnalysis() {
    const payload = getDynamicProfilePayload();
    payload.answers = getAnswersObject();
    payload.questions = generatedQuestions;

    // Show loading overlay
    const overlay = document.getElementById("aiLoadingOverlay");
    const progressBar = document.getElementById("loadingProgressBar");
    const stageTitle = document.getElementById("loadingStageTitle");
    const stageSubtitle = document.getElementById("loadingStageSubtitle");

    if (overlay) overlay.classList.remove("d-none");

    const isMatricPath = selectedEducation === 'Matric';
    const isFscPath = selectedEducation === 'FSc / Intermediate';
    const matricStage1 = "Reading your Matric profile...";
    const matricStage2 = "Matching your interests to study paths...";
    const matricStage3 = "Building your personalized study roadmap...";
    const fscStage1 = "Reading your FSc / Intermediate profile...";
    const fscStage2 = "Matching your interests to degree programs...";
    const fscStage3 = "Building your personalized degree roadmap...";
    const defaultStage1 = "Analyzing your profile...";
    const defaultStage2 = "Matching your interests and skills...";
    const defaultStage3 = "Building your personalized career roadmap...";

    // Determine which stage text to use
    let stage1, stage2, stage3, subtitle1, subtitle2, subtitle3;
    if (isMatricPath) {
        stage1 = matricStage1; stage2 = matricStage2; stage3 = matricStage3;
        subtitle1 = "Looking at your subjects, marks, interests, and study preferences";
        subtitle2 = "Finding the best intermediate and degree options for you";
        subtitle3 = "Creating a simple education roadmap from Matric to your future career";
    } else if (isFscPath) {
        stage1 = fscStage1; stage2 = fscStage2; stage3 = fscStage3;
        subtitle1 = "Looking at your FSc group, marks, interests, and preferences";
        subtitle2 = "Finding the best degree programs for your profile";
        subtitle3 = "Creating a roadmap from FSc to your future career";
    } else {
        stage1 = defaultStage1; stage2 = defaultStage2; stage3 = defaultStage3;
        subtitle1 = "Evaluating academic background, skillset baseline, and career ambitions";
        subtitle2 = "Cross-referencing domain requirements and calculating aptitude synergy";
        subtitle3 = "Curating targeted milestone topics, portfolio projects, and gap closure sequence";
    }

    // Update checklist text for Matric path
    const item1Text = document.querySelector('#loadingItem1 .loading-item-text');
    const item2Text = document.querySelector('#loadingItem2 .loading-item-text');
    const item3Text = document.querySelector('#loadingItem3 .loading-item-text');
    if (item1Text) item1Text.innerText = stage1;
    if (item2Text) item2Text.innerText = stage2;
    if (item3Text) item3Text.innerText = stage3;

    // Stage 1
    if (stageTitle) stageTitle.innerText = stage1;
    if (stageSubtitle) stageSubtitle.innerText = subtitle1;
    if (progressBar) progressBar.style.width = "30%";
    updateLoadingItem(1, "running");

    // Stage transitions timers for smooth UX
    setTimeout(() => {
        if (stageTitle) stageTitle.innerText = stage2;
        if (stageSubtitle) stageSubtitle.innerText = subtitle2;
        if (progressBar) progressBar.style.width = "65%";
        updateLoadingItem(1, "done");
        updateLoadingItem(2, "running");
    }, 1200);

    setTimeout(() => {
        if (stageTitle) stageTitle.innerText = stage3;
        if (stageSubtitle) stageSubtitle.innerText = subtitle3;
        if (progressBar) progressBar.style.width = "90%";
        updateLoadingItem(2, "done");
        updateLoadingItem(3, "running");
    }, 2400);

    try {
        const response = await fetch("/api/analyze-career", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok && result.status === "success") {
            setTimeout(() => {
                if (progressBar) progressBar.style.width = "100%";
                updateLoadingItem(3, "done");
                window.location.href = "/results";
            }, 3200);
        } else {
            throw new Error(result.message || "Failed to analyze profile.");
        }
    } catch (err) {
        console.error("Analysis submission error:", err);
        if (overlay) overlay.classList.add("d-none");
        const btn = document.getElementById("submitBtn");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-right me-2"></i> Retry AI Analysis';
            btn.classList.add("btn-warning");
            btn.classList.remove("btn-primary");
        }
        const wrapper = document.getElementById("step3Container");
        if (wrapper) {
            let errBanner = document.getElementById("analysisErrorBanner");
            if (!errBanner) {
                errBanner = document.createElement("div");
                errBanner.id = "analysisErrorBanner";
                errBanner.className = "alert alert-danger d-flex align-items-center gap-3 mt-3";
                wrapper.querySelector(".d-flex.justify-content-between.mt-5").before(errBanner);
            }
            errBanner.innerHTML =
                '<i class="fa-solid fa-circle-exclamation fs-5"></i>' +
                '<div>' +
                    '<strong>AI Analysis Error:</strong> ' + escapeHtml(err.message) +
                    '<br><small class="text-secondary">Please wait a moment and click Retry.</small>' +
                '</div>';
        }
    }
}

function updateLoadingItem(itemNum, state) {
    const item = document.getElementById(`loadingItem${itemNum}`);
    if (!item) return;

    const icon = item.querySelector(".loading-item-icon");
    const text = item.querySelector(".loading-item-text");

    if (state === "running") {
        item.classList.remove("text-opacity-50");
        if (icon) icon.className = "fa-solid fa-spinner fa-spin text-primary loading-item-icon";
        if (text) text.classList.add("text-white");
    } else if (state === "done") {
        if (icon) icon.className = "fa-solid fa-circle-check text-success loading-item-icon";
        if (text) text.classList.remove("text-white");
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

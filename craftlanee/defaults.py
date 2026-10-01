"""Default letter / MOU content (rich HTML). The founder can override every one in Settings,
and edit each individual document before generating it. Placeholders in {braces} are filled
from the employee record."""
import re

from .utils import fmt_date

# Company-wide work policy, pre-filled into offer and joining letters (set in Settings, editable per letter).
DEFAULT_WORK_HOURS = "9:30 AM to 6:30 PM"
DEFAULT_WORK_DAYS = "Monday to Friday"
DEFAULT_PROBATION = "3 months"
DEFAULT_NOTICE = "30 days"

DEFAULT_OFFER_INTRO = (
    "<p>Further to your application and the subsequent discussions you had with us, we are pleased to offer "
    "you the position of <b>{designation}</b>{in_department} at <b>{company}</b> (the \"Company\").</p>"
    "<p>We were impressed by your skills, experience and approach, and we are confident that you will make a "
    "valuable contribution to our team. This letter sets out the principal terms and conditions of your "
    "employment. Your date of joining will be <b>{joining_date}</b>.</p>"
)

DEFAULT_INTERNSHIP_INTRO = (
    "<p>We are pleased to offer you an internship as <b>{designation}</b>{in_department} at <b>{company}</b> "
    "(the \"Company\").</p>"
    "<p>This internship is designed to give you practical, hands-on experience working alongside our team on "
    "live projects, under the guidance of an assigned mentor. Your internship will commence on "
    "<b>{joining_date}</b>. The key details and the terms of your internship are set out below.</p>"
)

DEFAULT_OFFER_TERMS = (
    "<ol>"
    "<li><b>Place of work.</b> Your place of work will be as stated in this letter. Depending on business "
    "needs, the Company may require you to work from another office, a client site or remotely, with "
    "reasonable notice.</li>"
    "<li><b>Reporting.</b> You will report to the person named in this letter, or to any other person the "
    "Company designates from time to time, and will carry out the duties assigned to you diligently and to the "
    "best of your ability.</li>"
    "<li><b>Working hours and schedule.</b> Your working hours and working days will be as stated in this "
    "letter. You may occasionally be required to work additional hours or on non-working days to meet "
    "business needs. Attendance is to be recorded through the Company's systems.</li>"
    "<li><b>Probation and confirmation.</b> You will be on probation for the period stated in this letter, "
    "which the Company may extend if required. Your employment will be confirmed in writing on successful "
    "completion of probation.</li>"
    "<li><b>Compensation.</b> Your salary will be paid monthly, on or before the 7th of the following month, "
    "subject to statutory deductions such as income tax (TDS) and contributions applicable under law. Your "
    "compensation is confidential and must not be discussed with other employees.</li>"
    "<li><b>Leave and holidays.</b> You will be entitled to leave as per the Company's leave policy in force "
    "from time to time. The list of public holidays is published at the beginning of each calendar year.</li>"
    "<li><b>Performance reviews.</b> Your performance will be reviewed at the end of your probation and "
    "periodically thereafter, normally once a year. Increments, bonuses and promotions are at the sole "
    "discretion of the Company and are based on performance, conduct and business results.</li>"
    "<li><b>Duties and exclusivity.</b> During your employment you shall devote your full working time and "
    "attention to the Company's business and shall not take up any other employment, business or paid "
    "assignment without the Company's prior written consent. You shall avoid any situation that creates a "
    "conflict of interest with the Company.</li>"
    "<li><b>Policies, procedures and code of conduct.</b> You shall comply with all policies, procedures and "
    "the code of conduct of the Company as amended from time to time, including those on attendance, "
    "information security, acceptable use of IT systems, prevention of sexual harassment and anti-bribery. "
    "Any breach may result in disciplinary action, up to and including termination of employment.</li>"
    "<li><b>Confidentiality and non-disclosure.</b> You shall not, during or after your employment, disclose "
    "to anyone, or use for any purpose other than your work, any confidential information of the Company, its "
    "clients or partners, including business plans, client details, pricing, source code, designs and "
    "financial information. This obligation continues after your employment ends.</li>"
    "<li><b>Intellectual property.</b> All work, code, designs, documents, inventions and other materials you "
    "create in the course of your employment shall be the exclusive property of the Company, and you agree to "
    "sign any documents needed to confirm this.</li>"
    "<li><b>Company property and data.</b> Any equipment, accounts, documents and data provided to you remain "
    "the property of the Company, must be used only for work, and must be returned in good condition on or "
    "before your last working day.</li>"
    "<li><b>Non-solicitation.</b> For twelve (12) months after your employment ends, you shall not directly or "
    "indirectly solicit any client of the Company with whom you dealt, or induce any employee of the Company "
    "to leave.</li>"
    "<li><b>Notice period and termination.</b> After confirmation, either party may end the employment by "
    "giving the notice period stated in this letter in writing, or salary in lieu of notice. During probation "
    "the notice period is seven (7) days. The Company may terminate employment without notice in the event of "
    "misconduct or a breach of these terms or of Company policy.</li>"
    "<li><b>Background verification.</b> This offer is subject to satisfactory verification of your identity, "
    "educational and employment credentials and references. You agree to submit copies of the documents the "
    "Company requests on or before your date of joining.</li>"
    "<li><b>Governing law.</b> This letter shall be governed by the laws of India, and the courts at the "
    "place of the Company's registered office shall have exclusive jurisdiction.</li>"
    "<li><b>Entire agreement.</b> This letter, together with the Company's policies, constitutes the entire "
    "agreement between you and the Company and supersedes all prior discussions and representations.</li>"
    "</ol>"
)

DEFAULT_INTERNSHIP_TERMS = (
    "<ol>"
    "<li><b>Nature of internship.</b> This is an internship for learning and practical training. It is not an "
    "offer of employment, and any future employment will be at the sole discretion of the Company.</li>"
    "<li><b>Place of work and reporting.</b> You will work at the place stated in this letter and report to "
    "your mentor, or to any other person the Company designates. The Company may require you to work remotely "
    "or from another location when needed.</li>"
    "<li><b>Working hours and attendance.</b> Your working hours and working days will be as stated in this "
    "letter. You are expected to be punctual, record your attendance and inform your mentor in advance of any "
    "absence.</li>"
    "<li><b>Remuneration.</b> Your stipend or percentage-based compensation, if any, is as stated in this "
    "letter and is paid monthly, subject to satisfactory attendance and performance. Percentage-based "
    "compensation is calculated on products the Company confirms as completed and paid for.</li>"
    "<li><b>Learning and performance reviews.</b> Your mentor will set your goals, review your work "
    "periodically and give you feedback. A final evaluation will be carried out at the end of the "
    "internship.</li>"
    "<li><b>Policies, procedures and code of conduct.</b> You shall follow all policies, procedures and the "
    "code of conduct of the Company, including those on information security, acceptable use of IT systems "
    "and respectful behaviour at the workplace. Any breach may lead to termination of the internship.</li>"
    "<li><b>Confidentiality and non-disclosure.</b> You shall keep all information about the Company, its "
    "clients and projects strictly confidential, during and after the internship, and shall not share it on "
    "social media, in portfolios or with any third party without written permission.</li>"
    "<li><b>Intellectual property.</b> All work you produce during the internship, including code, designs and "
    "documents, belongs exclusively to the Company.</li>"
    "<li><b>Company property and data.</b> Any equipment, accounts and data provided to you must be used only "
    "for internship work and returned at the end of the internship.</li>"
    "<li><b>Certificate.</b> On successful completion of the internship, you will receive an internship "
    "certificate and, where merited, a letter of recommendation.</li>"
    "<li><b>Termination.</b> Either party may end the internship with seven (7) days' written notice. The "
    "Company may end it immediately in case of misconduct or a breach of these terms.</li>"
    "<li><b>Governing law.</b> This letter shall be governed by the laws of India.</li>"
    "</ol>"
)

DEFAULT_JOINING_BODY = (
    "<p>With reference to your offer letter, we are pleased to confirm that you have joined <b>{company}</b> "
    "as <b>{designation}</b>{in_department} with effect from <b>{joining_date}</b>.</p>"
    "<p>Your Employee ID is <b>{emp_code}</b>; please quote it in all official communication. You will report "
    "to <b>{reporting_person}</b>. Your place of work, working hours and other details of your employment are "
    "set out below.</p>"
    "<p>Your employment continues to be governed by the terms of your offer letter and by the policies, "
    "procedures and code of conduct of the Company as amended from time to time, including your obligations "
    "of confidentiality and non-disclosure. Please complete the submission of your joining documents and your "
    "acknowledgement of Company policies, if not already done.</p>"
    "<p>We welcome you to the team and wish you a rewarding career with us.</p>"
)

DEFAULT_RELIEVING_BODY = (
    "<p>This is to certify that <b>{name}</b> (Employee ID: {emp_code}) was associated with <b>{company}</b> "
    "as <b>{designation}</b>{in_department} from <b>{joining_date}</b> to <b>{last_working_day}</b>.</p>"
    "<p>We confirm that {name} has been relieved of all duties and responsibilities with effect from the close "
    "of business hours on <b>{last_working_day}</b>, that all Company assets have been returned and that the "
    "full and final settlement has been processed.</p>"
    "<p>The obligations of confidentiality and non-disclosure towards the Company, its clients and partners "
    "continue to apply after the end of this association.</p>"
    "<p>During the tenure with us, {name} was found to be sincere, hardworking and professional. We thank "
    "{name} for the contributions made to the organisation and wish every success in all future "
    "endeavours.</p>"
)

DEFAULT_MOU_TERMS = (
    "<ol>"
    "<li><b>Confidentiality.</b> Each Party shall keep confidential all information received from the other "
    "Party in connection with this MOU and shall not disclose it to any third party without prior written "
    "consent, during the term of this MOU and for two (2) years after it ends.</li>"
    "<li><b>Intellectual property.</b> Each Party retains ownership of its existing intellectual property. "
    "Ownership of anything created jointly under this MOU shall be agreed in writing.</li>"
    "<li><b>Non-exclusivity.</b> This MOU is non-exclusive; either Party may enter into similar arrangements "
    "with others.</li>"
    "<li><b>Independent parties.</b> Nothing in this MOU creates a partnership, joint venture, agency or "
    "employment relationship between the Parties.</li>"
    "<li><b>Termination.</b> Either Party may terminate this MOU by giving thirty (30) days' written notice to "
    "the other Party.</li>"
    "<li><b>Amendments.</b> Any amendment to this MOU shall be valid only if made in writing and signed by "
    "authorised representatives of both Parties.</li>"
    "<li><b>Dispute resolution.</b> The Parties shall attempt to resolve any dispute amicably through mutual "
    "discussion. Unresolved disputes shall be subject to the jurisdiction of the courts at the First Party's "
    "registered office.</li>"
    "<li><b>Governing law.</b> This MOU shall be governed by and construed in accordance with the laws of India.</li>"
    "</ol>"
)


# ------------------------------------------------------------------ earlier versions
# A setting that still holds one of these (saved but never edited) is upgraded to the current default on
# startup by upgrade_saved_defaults(); text the founder edited is never touched.

_V1_OFFER_INTRO = (
    "<p>We are delighted to offer you the position of <b>{designation}</b> in the {department} team at "
    "<b>{company}</b>. Throughout our conversations we were impressed by your skills, attitude and "
    "experience, and we are confident you will make a meaningful contribution to our team.</p>"
    "<p>This letter sets out the principal terms of your employment. Your date of joining will be "
    "<b>{joining_date}</b>.</p>"
)

_V1_INTERNSHIP_INTRO = (
    "<p>We are pleased to offer you an internship as <b>{designation}</b> with the {department} team at "
    "<b>{company}</b>. This internship is designed to give you real, hands-on experience working "
    "alongside our team on live projects.</p>"
    "<p>Your internship will commence on <b>{joining_date}</b>. The key details are set out below.</p>"
)

_V1_OFFER_TERMS = (
    "<ol>"
    "<li><b>Probation.</b> You will be on probation for three (3) months from your date of joining. On "
    "successful completion, your employment will be confirmed in writing.</li>"
    "<li><b>Compensation.</b> Your salary will be paid monthly, on or before the 7th of the following month, "
    "subject to statutory deductions and company policy.</li>"
    "<li><b>Working hours.</b> Standard working hours are 9:30 AM to 6:30 PM, Monday to Friday. You may "
    "occasionally be required to work additional hours to meet business needs.</li>"
    "<li><b>Leave.</b> You will be entitled to leave as per the company leave policy in force from time to time.</li>"
    "<li><b>Confidentiality.</b> You shall not disclose any confidential information of the company, its "
    "clients or partners, during or after your employment.</li>"
    "<li><b>Intellectual property.</b> All work, code, designs and materials created during your employment "
    "shall be the exclusive property of the company.</li>"
    "<li><b>Notice period.</b> After confirmation, either party may terminate employment with thirty (30) "
    "days' written notice or salary in lieu thereof. During probation, the notice period is seven (7) days.</li>"
    "<li><b>Code of conduct.</b> You will abide by the rules, policies and code of conduct of the company as "
    "amended from time to time.</li>"
    "<li><b>Verification.</b> This offer is subject to satisfactory verification of your documents, "
    "credentials and references.</li>"
    "</ol>"
)

_V1_INTERNSHIP_TERMS = (
    "<ol>"
    "<li><b>Nature of engagement.</b> This is an internship and does not constitute an offer of permanent "
    "employment. Any future employment will be at the sole discretion of the company.</li>"
    "<li><b>Stipend.</b> The stipend, if any, will be paid monthly and is subject to satisfactory attendance "
    "and performance.</li>"
    "<li><b>Working hours & attendance.</b> You are expected to follow the working hours communicated by your "
    "mentor and to inform them in advance of any absence.</li>"
    "<li><b>Confidentiality.</b> You shall keep all company, client and project information strictly confidential.</li>"
    "<li><b>Intellectual property.</b> All work produced during the internship belongs exclusively to the company.</li>"
    "<li><b>Certificate.</b> On successful completion, you will receive an internship certificate and, where "
    "applicable, a letter of recommendation.</li>"
    "<li><b>Termination.</b> Either party may end the internship with seven (7) days' written notice.</li>"
    "</ol>"
)

_V1_JOINING_BODY = (
    "<p>We are pleased to confirm that you have joined <b>{company}</b> as <b>{designation}</b> in the "
    "{department} department with effect from <b>{joining_date}</b>.</p>"
    "<p>You will report to <b>{reporting_person}</b>. Your Employee ID is <b>{emp_code}</b>; please quote it "
    "in all official communication.</p>"
    "<p>Your employment is governed by the terms of your offer letter and the policies of the company as "
    "amended from time to time. We are confident that you will contribute meaningfully to the growth of the "
    "organisation, and we wish you a rewarding career with us.</p>"
)

_V1_RELIEVING_BODY = (
    "<p>This is to certify that <b>{name}</b> (Employee ID: {emp_code}) was associated with <b>{company}</b> "
    "as <b>{designation}</b> in the {department} department from <b>{joining_date}</b> to "
    "<b>{last_working_day}</b>.</p>"
    "<p>With reference to the resignation submitted, we confirm that {name} has been relieved of all duties "
    "and responsibilities with effect from the close of business hours on <b>{last_working_day}</b>. All company "
    "assets have been returned and the full and final settlement has been processed.</p>"
    "<p>During the tenure with us, {name} was found to be sincere, hardworking and professional. We thank "
    "{name} for the contributions made to the organisation and wish every success in all future endeavours.</p>"
)

_V1_MOU_TERMS = (
    "<ol>"
    "<li><b>Confidentiality.</b> Each Party shall keep confidential all information received from the other "
    "Party and shall not disclose it to any third party without prior written consent.</li>"
    "<li><b>Non-exclusivity.</b> This MOU is non-exclusive; either Party may enter into similar arrangements "
    "with others.</li>"
    "<li><b>Termination.</b> Either Party may terminate this MOU by giving thirty (30) days' written notice to "
    "the other Party.</li>"
    "<li><b>Amendments.</b> Any amendment to this MOU shall be valid only if made in writing and signed by "
    "authorised representatives of both Parties.</li>"
    "<li><b>Dispute resolution.</b> The Parties shall attempt to resolve any dispute amicably through mutual "
    "discussion. Unresolved disputes shall be subject to the jurisdiction of the courts at the First Party's "
    "registered office.</li>"
    "<li><b>Governing law.</b> This MOU shall be governed by and construed in accordance with the laws of India.</li>"
    "</ol>"
)


class _Safe(dict):
    def __missing__(self, key):
        return "{" + key + "}"


# Phrases that read wrongly when the employee has no department ("with the  team", "in the  department").
_EMPTY_DEPT = re.compile(r"\s+(?:in|with|of) the\s+(?:team|department)\b", re.I)


def fill_template(template, emp, settings, **extra):
    manager = emp.manager.full_name if getattr(emp, "manager", None) else None
    dept = (emp.department or "").strip()
    values = _Safe(
        name=emp.full_name, company=settings.company_name or "CraftLanee",
        designation=emp.roles_label or emp.designation or "the offered role",
        department=dept, in_department=f" in the {dept} team" if dept else "",
        joining_date=fmt_date(emp.joining_date, "%d %B %Y") if emp.joining_date else "the agreed date",
        reporting_person=manager or emp.reporting_person or settings.founder_name or "the Founder",
        emp_code=emp.emp_code,
        last_working_day=fmt_date(emp.end_date, "%d %B %Y") if getattr(emp, "end_date", None) else "the last working day",
    )
    values.update(extra)
    try:
        text = template.format_map(values)
    except (ValueError, IndexError):
        return template
    return text if dept else _EMPTY_DEPT.sub("", text)


def _plain(html):
    text = re.sub(r"<[^>]+>", " ", html or "").replace("&amp;", "&").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


# setting -> (current default, earlier defaults it replaces)
_UPGRADES = {
    "offer_terms": (DEFAULT_OFFER_TERMS, (_V1_OFFER_TERMS,)),
    "internship_terms": (DEFAULT_INTERNSHIP_TERMS, (_V1_INTERNSHIP_TERMS,)),
    "joining_body": (DEFAULT_JOINING_BODY, (_V1_JOINING_BODY,)),
    "relieving_body": (DEFAULT_RELIEVING_BODY, (_V1_RELIEVING_BODY,)),
    "mou_terms": (DEFAULT_MOU_TERMS, (_V1_MOU_TERMS,)),
}


def is_default(field, html):
    """True when `html` reads the same as the current built-in default for that setting."""
    entry = _UPGRADES.get(field)
    return bool(entry and html) and _plain(html) == _plain(entry[0])


def upgrade_saved_defaults(settings):
    """Clear saved letter texts that are just an earlier default, so the current default applies.

    Compares the visible text only (the editor may re-format the HTML). Returns the fields changed.
    """
    changed = []
    for field, (_current, older) in _UPGRADES.items():
        saved = getattr(settings, field, None)
        if saved and _plain(saved) in {_plain(o) for o in older}:
            setattr(settings, field, None)
            changed.append(field)
    return changed

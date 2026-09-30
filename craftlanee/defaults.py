"""Default letter / MOU content (rich HTML). The founder can override every one in Settings,
and edit each individual document before generating it. Placeholders in {braces} are filled
from the employee record."""
from .utils import fmt_date

DEFAULT_OFFER_INTRO = (
    "<p>We are delighted to offer you the position of <b>{designation}</b> in the {department} team at "
    "<b>{company}</b>. Throughout our conversations we were impressed by your skills, attitude and "
    "experience, and we are confident you will make a meaningful contribution to our team.</p>"
    "<p>This letter sets out the principal terms of your employment. Your date of joining will be "
    "<b>{joining_date}</b>.</p>"
)

DEFAULT_INTERNSHIP_INTRO = (
    "<p>We are pleased to offer you an internship as <b>{designation}</b> with the {department} team at "
    "<b>{company}</b>. This internship is designed to give you real, hands-on experience working "
    "alongside our team on live projects.</p>"
    "<p>Your internship will commence on <b>{joining_date}</b>. The key details are set out below.</p>"
)

DEFAULT_OFFER_TERMS = (
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

DEFAULT_INTERNSHIP_TERMS = (
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

DEFAULT_JOINING_BODY = (
    "<p>We are pleased to confirm that you have joined <b>{company}</b> as <b>{designation}</b> in the "
    "{department} department with effect from <b>{joining_date}</b>.</p>"
    "<p>You will report to <b>{reporting_person}</b>. Your Employee ID is <b>{emp_code}</b>; please quote it "
    "in all official communication.</p>"
    "<p>Your employment is governed by the terms of your offer letter and the policies of the company as "
    "amended from time to time. We are confident that you will contribute meaningfully to the growth of the "
    "organisation, and we wish you a rewarding career with us.</p>"
)

DEFAULT_RELIEVING_BODY = (
    "<p>This is to certify that <b>{name}</b> (Employee ID: {emp_code}) was associated with <b>{company}</b> "
    "as <b>{designation}</b> in the {department} department from <b>{joining_date}</b> to "
    "<b>{last_working_day}</b>.</p>"
    "<p>With reference to the resignation submitted, we confirm that {name} has been relieved of all duties "
    "and responsibilities with effect from the close of business hours on <b>{last_working_day}</b>. All company "
    "assets have been returned and the full and final settlement has been processed.</p>"
    "<p>During the tenure with us, {name} was found to be sincere, hardworking and professional. We thank "
    "{name} for the contributions made to the organisation and wish every success in all future endeavours.</p>"
)

DEFAULT_MOU_TERMS = (
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


def fill_template(template, emp, settings, **extra):
    manager = emp.manager.full_name if getattr(emp, "manager", None) else None
    values = _Safe(
        name=emp.full_name, company=settings.company_name or "CraftLanee",
        designation=emp.roles_label or emp.designation or "the offered role",
        department=emp.department or "",
        joining_date=fmt_date(emp.joining_date, "%d %B %Y") if emp.joining_date else "the agreed date",
        reporting_person=manager or emp.reporting_person or settings.founder_name or "the Founder",
        emp_code=emp.emp_code,
        last_working_day=fmt_date(emp.end_date, "%d %B %Y") if getattr(emp, "end_date", None) else "the last working day",
    )
    values.update(extra)
    try:
        return template.format_map(values)
    except (ValueError, IndexError):
        return template

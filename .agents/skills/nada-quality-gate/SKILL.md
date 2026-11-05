---
name: nada-quality-gate
description: Audit and test web applications end-to-end before declaring work complete.
---

# Workflow
1. Determine acceptance criteria and actual available test tools.
2. Run relevant lint/typecheck/unit/integration/build checks where feasible.
3. Test critical user journeys and role boundaries including unauthorized access attempts.
4. Check localization, RTL/LTR, responsive views, empty/error/loading states and accessibility.
5. Review data integrity, concurrency, duplicate submissions, secrets and logs.
6. Clearly label each check PASS, FAIL, or NOT RUN with evidence.
7. Never mark a project ready if a blocking issue remains; list reproducible fixes.
8. Never deploy or alter production without explicit approval.

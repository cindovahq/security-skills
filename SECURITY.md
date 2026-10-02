# Security Policy

## Reporting a vulnerability in this repository

Please **do not** open a public issue for security problems in this repository (for example, a skill that could lead an agent to take a destructive action, leak secrets, or execute untrusted content).

Report privately via either:

- GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting), or
- Email: **security@cindova.com**

Include the affected skill and version, the agent you used, steps to reproduce, and the impact. We aim to acknowledge reports within 3 business days and to provide a remediation plan within 14 days.

## Scope

In scope: the skill content, scripts and CI configuration in this repository.

Out of scope: vulnerabilities in third-party agents or tools (report those to their vendors), and findings in the deliberately vulnerable fixtures under `tests/fixtures/` (they are intentionally insecure and never deployed).

## Using these skills safely

- Use the skills only on code and systems you own or are authorized to assess.
- Review an agent's proposed changes before applying them. These skills improve accuracy, but they don't guarantee correctness.
- Verify framework- and version-specific recommendations against official documentation before relying on them in production.

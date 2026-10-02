# Dependencies, CI/CD and Supply Chain

## Contents
- Dependency vulnerabilities
- Dependency hygiene
- CI/CD pipelines (GitHub Actions focus)
- Containers
- Infrastructure as code
- Verification

## Dependency vulnerabilities

Use the ecosystem's audit tool on **lock files**:

| Ecosystem | Command |
|---|---|
| npm / pnpm / yarn | `npm audit --omit=dev`, `pnpm audit --prod`, `yarn npm audit` |
| Composer | `composer audit --locked` |
| Python | `pip-audit -r requirements.txt` / `pip-audit` in the env, `uv pip audit` where available |
| Ruby | `bundle audit check --update` |
| Go | `govulncheck ./...` (reports only **reachable** vulns) |
| Rust | `cargo audit` |
| Java | OWASP Dependency-Check, `mvn org.owasp:dependency-check-maven:check`, Gradle plugin |
| .NET | `dotnet list package --vulnerable --include-transitive` |
| Any | `osv-scanner --lockfile=...`, Trivy (`trivy fs .`), GitHub Dependabot alerts |

If tools can't run, read lock-file versions and check https://osv.dev or https://github.com/advisories.

**Rate by reachability:** is the vulnerable function/feature used, and is it exposed? Use the advisory severity for reachable issues. Downgrade unreachable ones (dev-only, build-time, or an unused code path) and say why. **"Outdated" ≠ "vulnerable".** Report outdated packages only when they block security fixes or are end-of-life.

**End-of-life runtimes and frameworks** (Node, Python, PHP, Java, .NET, framework majors past security support) → Medium by default, higher with known unpatched advisories.

## Dependency hygiene

- Lock files committed for applications. CI installs from the lock (`npm ci`, `pnpm install --frozen-lockfile`, `composer install`, `pip install --require-hashes`, `bundle install --frozen`).
- Dev/debug packages not installed in production images.
- Typosquatting and dependency confusion: unusual package names, private package names that could resolve from public registries (scoped/namespaced packages and registry config pinning scopes to private registries).
- Install scripts: `postinstall` in dependencies runs at install time. Consider `--ignore-scripts` in CI where feasible. Composer `allow-plugins` should be explicit, not `true`.
- Git/URL dependencies and unpinned branches (`#main`, `dev-master`) → reproducibility and integrity risk.
- Abandoned packages on security-critical paths (auth, crypto, sanitization, JWT, uploads).
- Front-end: third-party scripts from CDNs without SRI, and tag managers that let marketing inject arbitrary JS.

## CI/CD pipelines (GitHub Actions focus)

High-impact findings, because pipelines hold deploy credentials:

- **`pull_request_target` / `workflow_run` with checkout of untrusted PR code** (`ref: ${{ github.event.pull_request.head.sha }}`) followed by build/test steps → fork PRs run code with secrets and a write token → **Critical**.
- **Script injection:** untrusted context interpolated into `run:` steps: `${{ github.event.issue.title }}`, `...pull_request.title`, `...head_ref`, `...comment.body`, `...review.body`, commit messages. Pass via `env:` and quote as `"$VAR"`.
- **Unpinned third-party actions** (`uses: someone/action@v1` or `@main`): pin to a full commit SHA for third-party actions. A compromised tag can exfiltrate secrets, as in the 2025 `tj-actions/changed-files` incident.
- **Over-privileged `GITHUB_TOKEN`:** set top-level `permissions: contents: read` and grant more per job only as needed.
- **Long-lived cloud keys in secrets:** prefer OIDC federation (`id-token: write` + cloud role with a trust policy restricted to the repo, branch and environment). Check the trust policy's `sub` condition isn't wildcarded.
- **Self-hosted runners** on public repos (fork PRs can run on your infrastructure).
- **Artifacts and caches** poisoned by untrusted workflows and then consumed by privileged ones.
- Secrets echoed in logs (`set -x`, debug output), or written to artifacts.
- Deploy workflows without environment protection rules / required reviewers for production.
- GitLab/Jenkins equivalents: protected variables on unprotected branches, `CI_JOB_TOKEN` scope, script injection via MR titles, Jenkins Groovy sandbox escapes, credentials in job configs.

Tools: `zizmor` (GitHub Actions static analysis), `actionlint`, OpenSSF Scorecard.

## Containers

- Runs as root (no `USER`), unnecessary capabilities, `--privileged`, a mounted Docker socket (`/var/run/docker.sock` → host root).
- Secrets in image layers (`COPY .env`, `ARG`/`ENV` with secrets; they persist in history even if deleted later). Use build secrets (`--mount=type=secret`).
- Base images: `latest` tags, EOL distributions, large attack surface. Prefer pinned digests and slim/distroless images.
- `.dockerignore` missing → `.git`, `.env`, and local credentials copied into the image.
- Exposed debug ports. Health endpoints leaking info.

## Infrastructure as code

Terraform / CloudFormation / CDK / Pulumi / Kubernetes / Helm:
- Public storage buckets (S3 ACLs/policies, GCS `allUsers`, Azure public blob access), unless intentionally public content.
- Security groups / firewall rules `0.0.0.0/0` to admin ports (22, 3389) and databases (3306, 5432, 6379, 27017, 9200).
- IAM wildcards (`Action: "*"`, `Resource: "*"`), `iam:PassRole` broadly, cross-account trust to `*`.
- Unencrypted databases/volumes/snapshots. Public snapshots/AMIs.
- IMDSv1 allowed (`http_tokens = "optional"`).
- Kubernetes: `privileged: true`, `hostNetwork`/`hostPID`/`hostPath`, `allowPrivilegeEscalation`, missing resource limits, `cluster-admin` bindings to service accounts, secrets in ConfigMaps, no NetworkPolicies.
- Terraform state with secrets in unprotected backends. `*.tfvars` committed.

Tools: Checkov, tfsec/Trivy config, KICS, kube-score, kubescape.

## Verification

- Re-run the audit tools after upgrades; confirm the advisory no longer matches.
- CI: re-run `zizmor`/`actionlint`. Check SHA pinning and `permissions:` blocks. Confirm untrusted contexts are no longer interpolated in `run:`.
- Images: `docker history --no-trunc` shows no secrets; `trivy image` passes the agreed threshold; the container runs as non-root (`docker run --rm image id`).
- IaC: scanner passes, or exceptions are documented with justification.

References: OWASP A03:2025 Software Supply Chain Failures; OWASP CI/CD Top 10; GitHub "Security hardening for GitHub Actions"; SLSA; OpenSSF Scorecard; CIS Docker/Kubernetes Benchmarks; CWE-1104, CWE-1357, CWE-829, CWE-494, CWE-250, CWE-732.

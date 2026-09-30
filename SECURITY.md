# Security policy

Portfolio Viewer holds people's financial records, so we take vulnerabilities seriously.

## Supported versions

Security fixes go into the latest release. Please update before reporting, if you can.

## Reporting a vulnerability

Report privately through GitHub:
1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.

If that button is missing, open an issue titled "Security contact request" and write nothing else in it:
no details, no proof of concept. We will answer with a private channel. Please do not put a vulnerability
in a public issue, discussion or pull request.

Please include:
- the version (shown at the bottom of every page and at `/api/health`) and how it is deployed,
- the steps to reproduce, or a proof of concept,
- what an attacker could do, and what access they need beforehand (none, any account, an administrator,
  a paired TV).

We confirm your report within 7 days. We tell you what we plan to do, and we agree a publication date with
you once a fix is released. We credit you in the release notes unless you prefer not to be named.

## Scope

In scope:
- this repository's code: the web app, the worker, the Android app, and the Docker Compose setup as
  shipped.

Out of scope:
- vulnerabilities in third-party services, such as the price providers;
- instances that were modified or configured against the self-hosting guide, for example exposed without
  TLS.

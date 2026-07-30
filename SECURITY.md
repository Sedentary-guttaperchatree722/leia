# Security policy

Leia is a local command-line tool that handles OAuth credentials, downloads
media selected by the user, and uploads it to the user's Yoto account. A flaw
that exposes credentials, weakens OAuth protections, crosses account
boundaries, or causes unintended commands or uploads is a serious bug. Please
report it early; we will work with you on a fix.

## Reporting a vulnerability

When this repository is public, use GitHub private vulnerability reporting.
Open the repository's **Security** tab and choose **Report a vulnerability**.
The report stays private to you and the maintainers and provides a private fork
for developing and reviewing a fix.

Until that reporting channel is available, do not disclose a security finding
in a public issue, pull request, discussion, or on social media.

## What to include

The more of this you can provide, the faster a fix can land.

- What the flaw is and what an attacker gains from it.
- The component involved: the CLI, OAuth loopback callback, local credential or
  cache storage, media download path, Yoto API client, upload flow, release
  process, or GitHub Actions workflow.
- A reproduction. A minimal proof of concept is especially useful.
- The version, commit, and operating system you tested.
- Anything you know about the affected users, accounts, or data.

## What happens next

| Stage | Target |
| --- | --- |
| We acknowledge your report | 3 working days |
| We confirm or reject it, with reasoning | 10 working days |
| Fix shipped for a critical finding | 30 days |
| Public advisory | On release of the fix, or 90 days, whichever is first |

If a finding is critical and actively exploitable, we will move faster than
these targets and keep you informed. Confirmed findings are documented in a
GitHub Security Advisory. Credit is given by the name and link you choose; you
may remain anonymous. There is no paid bounty program.

## Scope

**In scope.** Everything in this repository, including the Leia CLI, OAuth
flow, credential and cache storage, Yoto API integration, media download and
upload paths, dependencies as used by Leia, GitHub Actions workflows, and
published release assets.

Findings we consider especially valuable include:

- Exposing, stealing, or reusing OAuth credentials or refresh tokens.
- Bypassing OAuth callback state checks or redirect handling.
- Causing data or media from one Yoto account to be used with another account.
- Command injection, path traversal, or unsafe handling of media URLs, names,
  or downloaded files.
- Uploading unintended content, or making an apparently successful upload
  target the wrong Yoto account or card.
- Tampering with a published release asset, its integrity information, or the
  CI workflow that produces it.

**Out of scope.** Reports that require compromise of the reporter's own device,
Yoto account, GitHub account, or network first; social engineering; physical
attacks; volumetric denial of service; generic scanner output without a working
proof of concept; and vulnerabilities in third-party services or tools without
evidence that Leia's use of them introduces the issue.

## Safe harbour

Good-faith research under this policy is authorised. Please:

- Test only with your own Yoto account, content, and devices.
- Access only the minimum data needed to demonstrate the issue, then delete it.
  If you encounter someone else's data, stop and report it.
- Avoid disrupting Yoto services, other users, or the availability of Leia's
  dependencies. Do not use spam, high-volume, or destructive testing.
- Give us the reporting window above before making the finding public.

We will not pursue legal action for research that stays within these bounds.

## Verifying a release

GitHub displays a SHA-256 digest for each published release asset. Compare that
digest with the value shown on the release page after downloading an asset. A
SHA-256 digest detects an accidental or altered download; it is not a substitute
for a signed provenance record.

## Supported versions

Security fixes are made on `main` and released in the current `0.1.x` line.
Older prerelease-era tags are not maintained separately.

<!--
Sync Impact Report
===================
Version change: (template, unratified) → 1.0.0
Rationale for bump: Initial ratification of the constitution. No prior governed version existed
(file previously held only unfilled template placeholders), so this is treated as the project's
first MAJOR.MINOR.PATCH baseline per convention (1.0.0), not an incremental amendment.

Modified principles: n/a (initial adoption)

Added sections:
  - Core Principles I–V (Security & Privacy by Default; Minimal MVP Scope; Explicit User Consent
    & Transparency; Technology & Architecture Agnosticism; Observability & Testability of Outcomes)
  - Data Handling & Retention (Section 2)
  - Spec-Driven Development Workflow (Section 3)
  - Governance (amendment procedure, versioning policy, compliance review)

Removed sections: n/a (initial adoption)

Templates requiring follow-up:
  - .specify/templates/plan-template.md — no changes required; its Constitution Check gate reads
    this file at runtime.
  - .specify/templates/spec-template.md — no changes required.
  - .specify/templates/tasks-template.md — no changes required.
  - .specify/templates/checklist-template.md — no changes required.

Deferred placeholders / TODOs: none. All template placeholders have been filled.

Basis for content: Derived from the values already made explicit in
specs/001-prompt-model-tester/spec.md (API key handling, MVP scope boundaries, user consent
before sending data, provider/architecture neutrality, and testable requirements), since this is
the only concrete feature work in the repository at ratification time. Future amendments should
re-derive or revise principles as the project's real practices diverge from this starting point.
-->

# Speckit Test Constitution

## Core Principles

### I. Security & Privacy by Default (NON-NEGOTIABLE)

Credentials (API keys and equivalents) MUST NEVER be persisted to a database, file, log, or
browser storage, at any point, under any failure mode. A credential MUST be held only in
volatile, in-memory state for the duration of the single operation it was supplied for, and MUST
be cleared from that memory as soon as the operation completes, fails, or is aborted. No request
MUST be sent to an external provider except as the direct, explicit result of a user-initiated
action — never as a side effect of configuration, navigation, or an automatic retry the user did
not trigger.

**Rationale**: This project's core value proposition (fast, low-friction testing against
third-party model providers) only works if users trust it with their credentials. A single
leaked key — to a log file, a browser storage entry, or an unexpected network call — breaks that
trust irreversibly and is categorically worse than any feature regression.

### II. Minimal MVP Scope (YAGNI)

Build only what the current, approved spec requires for its stated single-user MVP. Do not add
user accounts, authentication of the tool's own users, multi-user collaboration, persistent
libraries of prompts or datasets, or other speculative capabilities unless a spec explicitly
scopes them in. When a capability is absent from the current spec, assume it is out of scope and
flag it for `/speckit-specify` rather than building it preemptively.

**Rationale**: The founding spec explicitly bounds this project to a small, single-person MVP.
Preemptively building for imagined future scale (teams, saved libraries, accounts) adds
complexity and surface area the project has not yet decided it needs.

### III. Explicit User Consent & Transparency

Before any prompt or input data leaves the application to a third-party model or judge provider,
the user MUST be clearly informed what will be sent and to which provider. Failures — invalid
input files, missing or unmapped fields, provider/API errors, aborted runs — MUST be surfaced as
specific, human-readable messages tied to their cause. Silent failures, silently skipped rows,
and raw technical exceptions shown to the user are all violations of this principle.

**Rationale**: Users are pasting their own API keys and sending their own data to third-party
providers; they must always know what is about to happen and why something failed, without
having to guess or inspect logs that this project also must not create.

### IV. Technology & Architecture Agnosticism

Specifications and plans MUST describe required behavior and constraints — not mandate a
specific model provider, programming language, framework, or system architecture — unless a
concrete, documented reason requires it. Whatever architecture is chosen during planning (e.g.
fully client-side vs. a thin server-side relay) MUST still satisfy every behavioral constraint
defined in this constitution and in the active feature specs, especially Principle I.

**Rationale**: Locking in implementation choices inside specs narrows future options for no
benefit when the behavior can be achieved multiple ways; the founding spec was deliberately
written to leave provider and architecture open.

### V. Observability & Testability of Outcomes

Every functional requirement MUST be independently verifiable through explicit acceptance
scenarios (Given/When/Then) and every feature MUST define measurable, technology-agnostic
success criteria. For any operation that takes meaningfully long (e.g. a multi-row batch run),
progress and per-item status MUST be visible to the user as it happens, not only once the whole
operation finishes.

**Rationale**: A tool whose purpose is to help users evaluate prompts and models must itself be
evaluable — vague or unverifiable requirements make it impossible to know whether the tool is
behaving correctly, and silent long-running operations undermine the fast-iteration value the
tool exists to provide.

## Data Handling & Retention

The system MUST NOT persist prompts, input data (manual or CSV-derived), results, or credentials
beyond the current working session, except when the user explicitly chooses to export results to
a file. Retaining multiple completed runs in session memory so the user can compare them (e.g.
after changing a model, parameter, or prompt) is permitted and expected, but that retained state
MUST NOT survive an application reload or close. Exported files MUST NEVER contain credentials.

## Spec-Driven Development Workflow

Every feature begins with `/speckit-specify` before any planning or implementation work starts.
A spec MUST pass its requirements quality checklist — in particular, no unresolved
`[NEEDS CLARIFICATION]` marker affecting scope, security, or privacy — before proceeding to
`/speckit-plan`. Plans MUST include an explicit check against this constitution's principles; any
deviation MUST be documented and justified (e.g. in the plan's complexity/justification tracking)
rather than silently introduced. Constitution amendments apply going forward and do not
retroactively invalidate already-approved specs, but any new or revised spec and plan MUST comply
with the current version of this document.

## Governance

This constitution supersedes any ad hoc practice or prior informal convention when the two
conflict. Amendments MUST be captured as a new version of this file together with a Sync Impact
Report (as an HTML comment at the top of the amended file) describing what changed and why; that
report is scratch material for the amendment review and is expected to be removed once the
amendment is reviewed and committed. Versioning follows semantic versioning:

- **MAJOR**: Backward-incompatible principle removals or redefinitions.
- **MINOR**: A new principle or section added, or materially expanded guidance.
- **PATCH**: Clarifications, wording fixes, or other non-semantic refinements.

Compliance with this constitution MUST be checked whenever a spec or plan is created or reviewed.
Any complexity or deviation introduced during planning that conflicts with a principle here MUST
be explicitly justified in that plan; unjustified deviations MUST be resolved before implementation
proceeds.

**Version**: 1.0.0 | **Ratified**: 2026-10-31 | **Last Amended**: 2026-10-31

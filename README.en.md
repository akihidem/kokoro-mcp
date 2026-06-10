# kokoro-mcp

> Zero-dependency loader / MCP server that signs, verifies, and serves `kokoro.md` — with the **akashi trust layer** (Ed25519 detached signatures + a revocation registry).
> A proposed reference implementation for [KOKORO SPEC](https://github.com/akihidem/KOKORO) §13.4 (reference CLI) and §3.1 `signature_hash`.

**Raw clinical findings stay with the psychologist. Only the signed translation circulates. Revoked documents never reach the AI.**

[日本語 README](./README.md)

## What is this?

KOKORO is a specification for translating a licensed psychologist's clinical formulation into `kokoro.md` — a user-owned, vendor-neutral Markdown "user manual" that general-purpose AIs (ChatGPT / Claude / Gemini / Copilot) read for personalization, **without raw assessment data ever entering the AI context**.

kokoro-mcp covers the **consumption side** — the last mile before the AI:

```
psychologist's records (never circulated)
   │  translation + informed consent (SPEC §10.1)
   ▼
kokoro.md ── sign ──▶ kokoro.md.akashi.json  (Ed25519 detached sidecar)
   │                        │
   │              akashi registry (publishes ONLY key ids / document hashes / status)
   ▼                        ▼
kokoro-mcp  (verifies: signature, tampering, expiry, revocation, SPEC §10.3 distribution bans)
   │
   ├─ serve   … MCP server for Claude Code / any MCP client
   └─ render  … stdout injection for SessionStart hooks
```

- **Fail-closed**: no consent (`consent_obtained: false`), unapproved AI drafts (`reviewed_by: ai_drafted_unreviewed`), tampering, or revocation → the content is not served
- **Revocation = enforced right to deletion**: one `revoke-doc` entry stops every conforming loader from serving an already-distributed `kokoro.md` (a technical reinforcement of the SPEC §10.2 30-day withdrawal duty)
- **The registry leaks nothing**: it contains only hashes and statuses — no clinical content, no personal data, by construction
- **Why this matters**: vendor memory accumulates *inferred* profiles of you. A signed `kokoro.md` makes *consented, professionally approved self-disclosure* technically distinguishable from an inferred shadow profile

## Install

```bash
npm install -g github:akihidem/kokoro-mcp   # or the release tarball / npm (alpha) once published
```

Zero runtime dependencies — Node 20+ standard library only.

## Quick start

```bash
kokoro-mcp keygen --alias K.M.        # psychologist's signing key
kokoro-mcp init ~/.kokoro/kokoro.md   # skeleton (fail-closed: consent_obtained: false)
kokoro-mcp lint ~/.kokoro/kokoro.md   # SPEC §3.1 / §7 / §9 / §10.3 machine checks
kokoro-mcp sign ~/.kokoro/kokoro.md --key ~/.kokoro/keys/akashi-XXXX.private.pem
kokoro-mcp verify ~/.kokoro/kokoro.md
kokoro-mcp status ~/.kokoro/kokoro.md
# → kokoro.md | v0.1.0 | mode=clinical | signature: verified (key 3fa1…) | distribution: OK
```

## As an MCP server

```json
{
  "mcpServers": {
    "kokoro": {
      "command": "kokoro-mcp",
      "args": ["serve", "--file", "/home/you/.kokoro/kokoro.md"]
    }
  }
}
```

| Tool | Returns |
|---|---|
| `get_kokoro_context` | the verified `kokoro.md` (with a verification banner) |
| `get_safety_profile` | **Safety Interop Profile** — only the "boundaries" and "DO/DON'T" sections; minimal disclosure |
| `check_kokoro_status` | verification state as JSON (no content) |

Resources: `kokoro://context` / `kokoro://safety` / `kokoro://status`. SessionStart-hook usage: [docs/claude-code.md](./docs/claude-code.md) (Japanese).

## Distribution policies

| | `--policy clinical` (default) | `--policy self` |
|---|---|---|
| Intended for | psychologist-issued clinical files | self-authored personal files |
| §3.1 schema | required | warnings only |
| `consent_obtained: true` | required (§10.3) | not required (consent is inherent) |
| `ai_drafted_unreviewed` | **banned** | **banned** (both policies) |

`--allow-unsigned` only permits the *absence* of a signature. Failed verification, expiry, and revocation are never served, under any policy.

## Trust layer spec

See [docs/SPEC-AKASHI.md](./docs/SPEC-AKASHI.md) (Japanese; English translation planned): canonical form, sidecar schema, registry schema, verification algorithm, threat model, and the upstream proposal to KOKORO SPEC.

## Tests

```bash
npm test   # node --test — 47 cases: canonicalization / signing / revocation / §10.3 / lint / CLI e2e / MCP protocol e2e
```

## License

Code: MIT. `docs/SPEC-AKASHI.md` is intended for upstreaming into KOKORO SPEC (CC BY-SA 4.0).

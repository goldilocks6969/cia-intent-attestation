# Architecture

## Problem

_TODO: describe the gap between what a user authorizes and what actually gets charged, and why intent needs to be cryptographically attested._

## Flow Diagram

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant S as Shared (@cia/shared)
    participant B as Backend
    participant P as Payment provider
    U->>S: build Intent
    S-->>U: canonical JSON + SHA-256 hash
    U->>B: WebAuthn assertion over hash
    B->>S: verifyConstraints(intent, proposedTxn)
    S-->>B: hardPass / softMatch / reasons
    B->>P: create order (only if hardPass)
```

## Components

- **frontend** — _TODO_
- **backend** — _TODO_
- **packages/shared** — _TODO_

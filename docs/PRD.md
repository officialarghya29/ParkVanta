# ParkVanta — Product Requirements Document

**Product:** ParkVanta · **Tagline:** Smart Access. Smarter Parking.
**Category:** PropTech · Smart Mobility · AI · IoT
**Owner:** Arghya Bose · **Status:** MVP implemented (Stages 0–12 core, 15 partial)

---

## 1. Problem

Residential societies manage visitors with paper registers and phone calls. The consequences are operational,
not cosmetic:

| Failure | Impact |
| :--- | :--- |
| Unverifiable visitor entry | Anyone can claim an invitation; guards have no authority to check |
| No parking destination | Visitors occupy resident bays; residents escalate to the gate |
| Unknown slot availability | Guards walk the basement to find a free bay |
| No entry/exit record | Disputes, overstays and security incidents are untraceable |
| Manual communication | Approvals depend on a resident answering the intercom |

Existing tools stop at visitor approval. **Parking is the hard part**, and ParkVanta makes it a first-class domain.

## 2. Product promise

> Every visitor has a verifiable visit, every approved vehicle has an authorized parking destination, and every
> occupied slot has a traceable lifecycle.

## 3. Users and jobs to be done

| Persona | Job | Success signal |
| :--- | :--- | :--- |
| **Resident** | Invite a guest and know where they will park | Invitation approved in under 30 seconds, slot shown |
| **Security guard** | Decide entry in seconds without leaving the gate | Scan → verdict → authorization in under 60 seconds |
| **Visitor** | Enter without installing an app | Web pass opens, QR scans first time |
| **Society admin** | See capacity, overstays and gate decisions | Live dashboard backed by database state |

## 4. Scope — implemented

- Multi-tenant identity: organizations → properties → towers → apartments → residents.
- Roles: super admin, society admin, property manager, security guard, resident. Enforced server-side.
- Invitations with visitor identity, vehicle binding, visit window and purpose.
- Resident approval, rejection and cancellation, with parking allocation on approval.
- Single-use QR pass: CSPRNG token, SHA-256 hash at rest, expiration window, revocation, replay rejection.
- Parking zones and slots with category, vehicle compatibility and five-state lifecycle.
- Transactional allocation (`FOR UPDATE SKIP LOCKED` + partial unique indexes).
- Gate console: verify, authorize, confirm entry, confirm exit, manual override with mandatory reason.
- Occupancy and overstay tracking; expiry sweeps for passes, reservations and pending invitations.
- Resident, guard, visitor and admin web surfaces (responsive PWA).
- Database-backed analytics: capacity, utilisation, traffic trends, overstays, rejection and override counts.
- Audit log for every security-critical transition.

## 5. Scope — explicitly deferred

| Item | Reason |
| :--- | :--- |
| Facial recognition | Permanently out of scope |
| Payments / billing | Subscription model not yet defined |
| Automatic boom barrier control | Requires hardware integration and policy approval |
| Number-plate recognition | Offline evaluation protocol implemented; model not deployed |
| Native iOS/Android apps | PWA validated first |
| Visitor SMS / WhatsApp delivery | Email uses the outbox worker; SMS/WhatsApp providers are not implemented |

## 6. Acceptance criteria (verified by tests)

1. A resident creates an invitation and receives a slot on approval. ✅
2. A single-use pass cannot authorize two entries, including concurrent scans. ✅
3. Two concurrent allocations never claim the same slot. ✅
4. Vehicle plate mismatch denies entry. ✅
5. A cancelled invitation revokes the pass and releases the slot. ✅
6. A resident cannot approve another resident's invitation. ✅
7. Cross-organization reads are rejected. ✅
8. Exit releases occupancy and returns the slot to `AVAILABLE`; repeated exit is rejected. ✅
9. Every gate decision produces an audit event. ✅

## 7. Non-goals for v1

- Replacing the society's accounting or billing systems.
- Visitor identity verification beyond the resident's assertion and the guard's check.
- Open public parking marketplaces.

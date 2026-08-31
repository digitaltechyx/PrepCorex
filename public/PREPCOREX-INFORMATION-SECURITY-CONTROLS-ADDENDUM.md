# PrepCorex Information Security Controls Addendum

**Document type:** Supporting evidence for partner / marketplace security reviews  
**Company:** Prep Services FBA LLC  
**Platform:** PrepCorex  
**Version:** 1.0  
**Effective date:** August 22, 2026  
**Classification:** Internal / Partner Evidence  
**Related policy:** Schedule D — Privacy, Data Processing & Information Security Policy  

This Addendum supplements Schedule D. It describes operational security controls used for PrepCorex production systems and company endpoints. It is intended as verifiable evidence for marketplace partner reviews (including TikTok Shop Partner Center).

---

## 1. Purpose

This document summarizes how Prep Services FBA LLC protects PrepCorex, seller integration data (including TikTok Shop tokens and order data), and related personal/business data through administrative, technical, and operational controls.

---

## 2. Scope

Applies to:

- PrepCorex production applications and APIs
- Cloud hosting and data stores used by PrepCorex
- Company-managed endpoints used to administer production systems
- Seller integration credentials and synchronized marketplace order/inventory data

---

## 3. Security baseline for daily operations

Prep Services FBA enforces the following baseline controls:

| Control | Implementation |
|---|---|
| Password complexity | Strong unique passwords required for company and cloud admin accounts |
| Screen lock | Workstations lock on inactivity; users must re-authenticate |
| Least privilege | Production access limited to authorized engineering/ops/admin roles |
| Multi-factor authentication (MFA) | MFA enabled where available on Google / Firebase / hosting / critical admin accounts |
| Clear-desk / credential hygiene | Production secrets are not stored in source control; credentials are not shared in chat or tickets |
| Account offboarding | Access is removed when personnel leave or change roles |

---

## 4. Access control and least privilege

- Seller TikTok Shop tokens, connection records, and order sync data are stored **per user** in Firebase.
- API routes that access seller data require **server-side authentication** (Firebase Auth / admin verification).
- PrepCorex uses **role-based access** (client, warehouse, admin/sub-admin, and feature permissions).
- Clients can access only their own account data.
- Admin/ops access is limited to authorized PrepCorex personnel for support and warehouse operations.
- Secrets (API keys, client secrets, tokens) are stored in **environment variables / secret stores**, not in the client application bundle.

---

## 5. Network segregation and threat protection

Production infrastructure uses managed cloud platforms with isolation between environments and services:

| Layer | Control |
|---|---|
| Application hosting | Vercel (or equivalent) with HTTPS-only public endpoints |
| Data platform | Google Cloud / Firebase with project-level isolation |
| Environments | Separate configuration for development and production |
| Transport security | TLS/HTTPS for all public PrepCorex traffic |
| Platform protections | Cloud provider firewalling / edge protections for public services |
| Secrets | Server-only environment variables; restricted deployment access |
| Monitoring | Production application error monitoring and operational review of failed auth / integration events |

Internal admin tools and seller portals are not exposed without authentication.

---

## 6. Endpoint protection (anti-malware)

Company endpoints used for production administration:

- Run current supported OS versions (Windows / macOS)
- Use **OS-native anti-malware / security** (Windows Defender / macOS security features)
- Keep automatic security updates enabled
- Restrict local storage of production secrets; prefer password managers and cloud secret configuration

---

## 7. Data classification and encryption

| Classification | Examples | Handling |
|---|---|---|
| Confidential | OAuth tokens, client secrets, refresh tokens, payment-related secrets | Server-only; never logged in full; rotated/revoked on disconnect or incident |
| Restricted operational | Seller orders, inventory mappings, shipment records | Access by account owner and authorized ops roles only |
| Internal | System logs, configuration (non-secret) | Limited to engineering/ops |
| Public | Marketing site content, published policies | Publicly available |

**In transit:** All public PrepCorex traffic uses TLS/HTTPS.  
**At rest:** Seller and operational data is stored in Firebase / Google Cloud with provider default encryption at rest.  
**Passwords:** Stored using platform authentication encryption/hashing controls (not plaintext).

---

## 8. Vulnerability and threat management

Prep Services FBA maintains a practical vulnerability process:

1. Keep application dependencies reasonably up to date
2. Review and prioritize critical / high CVEs affecting production packages
3. Restrict production secrets and rotate credentials when exposure is suspected
4. Monitor production application errors and investigate security-relevant failures
5. Apply hosting/platform security patches provided by Vercel and Google Cloud/Firebase
6. Limit production deploy rights to authorized personnel

Formal penetration testing and ISO/SOC certification are **not claimed** in this Addendum unless separately obtained and documented.

---

## 9. Incident response

### 9.1 Roles

| Role | Responsibility |
|---|---|
| Engineering / Ops lead | Triage, containment, technical investigation |
| Operations / Support | Seller communication and ticket handling |
| Management | Escalation, external notifications, business decisions |

### 9.2 Process

1. **Detect** — monitoring, seller report, or staff report  
2. **Triage** — classify severity and affected systems/data  
3. **Contain** — revoke tokens, rotate secrets, disable compromised access, isolate affected integration if needed  
4. **Investigate** — determine scope, root cause, and data impact  
5. **Remediate** — patch, restore, re-enable services safely  
6. **Notify** — inform affected sellers and, when required, marketplace partners (including TikTok Shop) and regulators  
7. **Review** — document lessons learned and improve controls  

### 9.3 Marketplace / seller notification

If a suspected or confirmed incident may affect TikTok Shop seller data or PrepCorex integration credentials, Prep Services FBA will notify:

- Affected sellers through PrepCorex / registered account email
- TikTok Shop Partner support / designated partner channels when required by partner terms
- Contact path for privacy/security: `privacy@prepservicesfba.com` or `support@prepservicesfba.com`

---

## 10. Data subject / seller assistance

Upon verified request from a seller or TikTok Shop (as applicable), Prep Services FBA will assist to:

- Provide relevant account/integration data the seller is entitled to receive
- Update inaccurate account information
- Delete or disconnect integration credentials and related sync data where legally and contractually permitted

Legal, tax, invoicing, and fraud-prevention records may be retained as required by law or legitimate business need, consistent with Schedule D.

---

## 11. End of contractual relationship

At the end of the contractual relationship, or upon verified account closure / deletion request:

1. Marketplace connections (including TikTok Shop) are disconnected and tokens revoked/removed where technically feasible
2. Seller integration credentials are deleted from PrepCorex
3. Operational personal data is deleted or anonymized within a commercially reasonable period
4. Records required for legal, tax, accounting, dispute, or audit purposes may be retained for the required period, then deleted or archived securely

---

## 12. Third-party processors

PrepCorex relies on vetted processors such as:

- Google Cloud / Firebase (data platform)
- Vercel (application hosting)
- Marketplace platforms (TikTok Shop, Shopify, Amazon, eBay, etc.) under their own terms
- Payment / shipping providers as configured by the business

Processor use is limited to providing PrepCorex and warehouse services.

---

## 13. Certifications

As of the effective date of this Addendum, Prep Services FBA LLC does **not** claim ISO 27001, ISO 27701, SOC 2 Type II, or ePrivacy certification unless a current certificate is separately provided.

---

## 14. Relationship to Schedule D

If there is any conflict between this Addendum and Schedule D for partner-evidence purposes, **Schedule D remains the client-facing contractual privacy/security schedule**, and this Addendum provides additional operational detail for security reviewers.

---

## 15. Contact

**Prep Services FBA LLC**  
New Jersey, USA  

- General support: support@prepservicesfba.com  
- Privacy / security requests: privacy@prepservicesfba.com (or support@prepservicesfba.com)  
- Website: https://www.prepservicesfba.com  
- PrepCorex: https://prepcorex.com  

---

## Document control

| Field | Value |
|---|---|
| Document | PrepCorex Information Security Controls Addendum |
| Version | 1.0 |
| Effective date | August 22, 2026 |
| Owner | Operations / Engineering |
| Approved by | Prep Services FBA LLC |
| Status | Active |

**Revision history**

| Version | Date | Changes |
|---|---|---|
| 1.0 | August 22, 2026 | Initial release for marketplace partner security evidence |

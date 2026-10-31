# Hosting options for eeasy-logistics (research, 2026-10-31)

Status: research input for owner rulings Q-10 (hosting provider) and Q-12 (container registry). This document records public facts only. It makes no recommendation.

Scope: the requirements in `docs/architecture/platform.md` §1, §2 and §10, `docs/architecture/data.md` §13.4 and the roadmap register rows Q-10 and Q-12 in `docs/roadmap.md` §4.

Method and limits:

- Sources were public pages fetched with WebFetch or WebSearch, plus public price endpoints queried with curl (AWS Price List offer files for `me-south-1`, Azure Retail Prices API). Source IDs are in §8. Every source was accessed 2026-10-31.
- "Not stated" means the consulted public source does not say. "Not checked" means this run did not look. "To confirm" means the owner or a sales or support contact must check.
- Prices are USD list prices for the stated footprint. They exclude taxes, VAT, support plans, egress, backups beyond the instance, and any Multi-AZ or high-availability uplift unless stated.
- Where a provider has no Gulf region, or its Gulf region was not confirmed, prices are shown for the nearest documented region and labelled as such.

## 1. Requirements checklist (from the architecture docs)

| # | Requirement | Source in repo |
|---|---|---|
| R1 | Saudi or Bahraini region, managed PostgreSQL preferred | platform §10.1, roadmap Q-10 |
| R2 | Managed PostgreSQL 16 with PostGIS and `citext` | platform §2, data §13.4 |
| R3 | Create four database roles, triggers and RLS policies without a superuser | data §13.4, roadmap Q-10 |
| R4 | Redis 7 | platform §2 |
| R5 | S3-compatible object storage with versioning and lifecycle | platform §2, §3 (signed URLs) |
| R6 | Container hosting for stateless api, worker, web; VROOM now and OSRM later; private network only for VROOM | platform §2 |
| R7 | Private networking | roadmap OPS-1 |
| R8 | Secret store | roadmap OPS-1 |
| R9 | Daily backups with WAL archiving to a second region | platform §6 (to be cross-checked) |
| R10 | Cloudflare in front (provider-independent) | roadmap OPS-1, platform §8 |
| R11 | Container registry (GitHub Container Registry proposed) | platform §10.3, roadmap Q-12 |

Notes on the checklist: R9 is cited from the roadmap's stated goal and was not re-read from doc 6 §6 in this run. R10 is provider-independent and is not compared below.

## 2. Comparison table

Legend: "Yes (docs)" means a public provider page in §8 says so. "Not stated" means the consulted page does not say. "Not checked" means not looked at in this run.

| Provider | Gulf region(s) | Managed PG 16 + PostGIS / citext | Non-superuser can create triggers / RLS (docs) | Managed Redis | Object storage (S3-compatible) | Container hosting | Secret store | Registry | Est. monthly USD, small footprint |
|---|---|---|---|---|---|---|---|---|---|
| AWS | me-south-1 Bahrain (confirmed in price files); Saudi region due Dec 2026 (third-party report, not an AWS page) | RDS PostgreSQL 16 listed: PostGIS 3.4.6, citext 1.6 (S1) | Not stated (S1, S2, S3). Account is in `rds_superuser` (S2) | Yes: ElastiCache Redis node `cache.t3.medium` priced in me-south-1 (S5). Redis 7 not checked | S3 Standard priced in me-south-1 (S5). Versioning, lifecycle, signed URLs: not checked | ECS Fargate priced in me-south-1 (S5). Other services not checked | Not checked | Not checked (ECR not checked; GHCR option in §5) | ~$274 (§3) |
| Google Cloud | me-central2 Dammam (Cloud SQL listed, S6, updated 2026-10-26; Cloud Run listed Tier 2 pricing, S9, updated 2026-10-30) | Cloud SQL PostgreSQL 16 listed: PostGIS 3.5.2, citext 1.6 (S7). Dammam row on S6 | Not stated. `cloudsqlsuperuser` is "limited superuser" that can create event triggers; RLS not mentioned (S8) | Memorystore not confirmed in Dammam; page returned 404 (S22 attempt) | Not checked | Cloud Run location confirmed (S9); not priced | Not checked | Not checked (Artifact Registry) | Not computed |
| Oracle Cloud | me-jeddah-1 Jeddah; me-riyadh-1 Riyadh | Jeddah: per-tenancy cap of two OCI Database with PostgreSQL systems (S10). Riyadh PostgreSQL not confirmed (S11) | Not checked | Not checked | Not checked | Not checked | Not checked | Not checked | Not computed |
| Microsoft Azure | Saudi Arabia East: Microsoft says customer workloads from Q4 2026 (S15). UAE North used as priced proxy only | Flexible Server PG 16 listed: PostGIS 3.6.1, citext 1.6 (S13). Saudi-specific PG availability not confirmed | Not stated. Server admin is NOSUPERUSER with CREATEDB and CREATEROLE, and is in `azure_pg_admin` (S14). Triggers and RLS not stated | Not checked | Not checked | Not checked | Not checked | Not checked | Partial: B2ms compute ~$115 in UAE North (S16); storage and rest not computed |
| Hetzner (self-run PostgreSQL) | None in Gulf. Locations: Falkenstein, Nuremberg, Helsinki, Ashburn, Hillsboro, Singapore (S17) | Not applicable (no managed PG found in consulted pages). Self-run PG 16 would need PostGIS and citext installed by the team | Not applicable (self-run; permissions are PostgreSQL's own) | Not applicable (self-run) | Object Storage in Falkenstein, Helsinki, Nuremberg only (S19) | Cloud servers (no managed container service seen) | Not checked | Not checked | Not computed |
| DigitalOcean (managed PG, self-run option) | Managed DB regions not confirmed. Bangalore and Frankfurt appear only for Droplets in third-party data | PostgreSQL 14–18 Standard lists PostGIS and citext; Advanced lists citext for 16–18 (S20). PG 16 PostGIS version not listed on the consulted page | Not stated (S20) | Valkey managed node $15/mo (1 GiB) and $30/mo (2 GiB) (S21) | Not checked | Not checked | Not checked | Not checked | Not computed; closest plan is 2 vCPU/4 GiB PG at $60.90 (S21), not the required footprint |
| Saudi-local: sccc by stc / STC Cloud | Riyadh and Jeddah Tier IV data centres per STC Cloud (S23) | Managed PostgreSQL not confirmed. Databases listed as a category (S23) | Not checked | Not checked | Not checked | Not checked | Not checked | Not checked | Not stated |
| Saudi-local: Sahara Net | Dammam and Riyadh per third-party listing; Sahara states data stays in the Kingdom (S25) | Catalog says managed database services are available; roadmap put a managed MySQL/PostgreSQL relational service at H1 2026; current status not confirmed (S25) | Not checked | Not checked | Not checked | Managed Kubernetes listed as available (S25) | Not checked | Not checked | Not stated |
| Saudi-local: Mobily Cloud | Dammam, Jeddah (older coverage); Riyadh planned (S24) | Managed PostgreSQL not confirmed | Not checked | Not checked | Not checked | Not checked | Not checked | Not checked | Not stated |

## 3. Price basis

Method for the AWS number: list prices read from the AWS Price List offer file for `me-south-1` (S5), monthly = hourly × 730 h.

| Item | Unit list price (USD) | Monthly (USD) | Basis |
|---|---|---|---|
| RDS for PostgreSQL `db.m6g.large` (2 vCPU, 8 GiB), Single-AZ | $0.193/hour | 140.89 | S5 |
| RDS gp3 storage, PostgreSQL, 100 GB | $0.14/GB-month | 14.00 | S5 |
| ElastiCache Redis `cache.t3.medium` node (2 vCPU, ~3 GiB) | $0.095/node-hour | 69.35 | S5 |
| Fargate x86, 2 tasks of 0.5 vCPU and 1 GB | vCPU $0.0526/h, memory $0.0058/GB-h | 46.87 | S5 |
| S3 Standard, 100 GB, first 50 TB tier | $0.025/GB-month | 2.50 | S5 |
| Total | | 273.61 | |

AWS exclusions: Multi-AZ instance (not computed), automated backup and snapshot storage beyond the allocation, load balancer, data transfer, Secrets Manager, container registry, cross-region replication for WAL, and any support plan. The Redis size priced is `cache.t3.medium`; smaller Redis node types were not priced in this run, so the Redis line may be overstated. The Fargate CPU and memory were priced at the x86 rate.

Azure figure (partial): UAE North, Azure Retail Prices API (S16). Burstable `B2ms` vCore at $0.158/hour, 730 hours = $115.34/month. Storage rate for the flexible-server general storage meter was not isolated; the Premium SSD v2 meter found ($0.138/GiB-month) is not the same product and is not used. Azure Saudi East returned only Extended Support meters from the Retail API, not compute, on the query date.

Not computed: Google Cloud (Cloud Billing Catalog needs an API key; the public pricing page was truncated), Oracle (no public price fetch), Hetzner (dedicated plan not identified on the page), DigitalOcean (no 2 vCPU/8 GiB plan on the page), Saudi-local providers (prices on request or not published in consulted pages).

Hetzner reference points (EUR, excl. VAT, from S18): shared "Cost-Optimized" from €5.99/month, "Regular Performance" from €6.49/month, dedicated "General Purpose" vCPU from €43.49/month. Object Storage was listed at €4.99/month for 1 TB in a 2024 launch report (S19); a 2026 comparison site lists $7.24/month. These two figures disagree and the official page was not fully read, so treat them as unconfirmed.

DigitalOcean reference points (USD, S21): PostgreSQL 2 vCPU/4 GiB $60.90/month; 4 vCPU/8 GiB $122.10/month; Valkey 1 GiB $15/month; Valkey 2 GiB $30/month. No 2 vCPU/8 GiB managed PostgreSQL plan was listed on the page.

## 4. Provider notes

### AWS
- Region: me-south-1 (Bahrain) has RDS, ElastiCache, S3 and ECS Fargate price entries in the public offer files (S5). A Saudi Arabia region is reported for December 2026 with three Availability Zones (S4, a third-party report from around September 2026; not an AWS page). AWS did not say whether the region's name will be `me-west`; not stated.
- PostgreSQL: RDS PostgreSQL 16 lists PostGIS 3.4.6 and citext 1.6 (S1).
- Roles: the first RDS account is a member of `rds_superuser` (S2). S2 and S3 do not say whether a non-superuser role can create triggers or RLS policies on tables it owns. To confirm.
- Not checked: Secrets Manager, ECR, private networking details, S3 versioning and lifecycle, WAL archiving to a second region.

### Google Cloud
- Region: Cloud SQL lists me-central2 Dammam (S6, updated 2026-10-26). Cloud Run lists me-central2 under Tier 2 pricing (S9, updated 2026-10-30).
- PostgreSQL: Cloud SQL PostgreSQL 16 lists PostGIS 3.5.2 and citext 1.6 (S7). Extensions need the `cloudsqlsuperuser` role (S7).
- Roles: S8 says `cloudsqlsuperuser` is a limited superuser role that can create event triggers, and does not mention RLS. Whether a non-superuser can create ordinary triggers and RLS policies is not stated. To confirm.
- Memorystore for Redis in me-central2: not confirmed. The Memorystore locations page returned HTTP 404 in this run (S22).
- Not checked: Cloud Storage features, Secret Manager, Artifact Registry in Dammam.

### Oracle Cloud
- Jeddah (me-jeddah-1) opened in 2020 (S12). Riyadh (me-riyadh-1) opened in 2024 (S11). Oracle's Riyadh launch note does not list PostgreSQL among its services; the list may not be complete.
- Oracle's PostgreSQL known-issues page states the per-tenancy limit in me-jeddah-1 is two database systems, with an increase being worked on (S10).
- Not checked: roles, triggers, RLS, Redis, object storage, containers, secrets, pricing. No Oracle pricing page was fetched.

### Microsoft Azure
- Saudi region: Microsoft says customers can run cloud workloads from its Saudi Arabia East datacentre region from Q4 2026 (S15). Third-party reporting names November 2026; Microsoft's page says only the quarter. The Retail Prices API returned only Extended Support meters for `saudiarabiaeast` on 2026-10-31 (S16).
- PostgreSQL: Flexible Server PostgreSQL 16 lists PostGIS 3.6.1 and citext 1.6 (S13). Regional availability of Flexible Server in Saudi Arabia East was not confirmed.
- Roles: the server admin is NOSUPERUSER with CREATEDB and CREATEROLE, and is a member of `azure_pg_admin`. The docs say only Microsoft holds the superuser role (`azuresu`) (S14). Triggers and RLS creation for `azure_pg_admin` members are not stated. To confirm.
- Not checked: Redis, Blob storage, Container Apps, Key Vault, ACR in Saudi East.

### Hetzner (self-run PostgreSQL option)
- Locations: Falkenstein, Nuremberg, Helsinki, Ashburn, Hillsboro, Singapore (S17). No Gulf location.
- Object Storage: available in Falkenstein, Helsinki and Nuremberg only (S19).
- Managed PostgreSQL: none found in the pages consulted. The team would run PostgreSQL 16 with PostGIS and citext itself, and manage backups and WAL archiving. This meets the database-conditions requirement in principle, because the team controls roles and extensions, but residency is outside the Gulf.
- Not checked: Hetzner's current VPS configuration for the footprint, private network features, secrets.

### DigitalOcean (managed PG option)
- Extensions: PostGIS and citext are listed for Standard PostgreSQL 14–18; citext is listed for Advanced 16–18 (S20). The page does not state whether `doadmin` is a superuser, and does not say whether non-admin users can create triggers or RLS (S20).
- Regions: the managed DB region list was not confirmed. The page is the pricing page only (S21).
- Not checked: Spaces (object storage) features, App Platform, container registry, secrets.

### Saudi-local providers
- sccc by stc (formerly Saudi Cloud Computing Company) and STC Cloud: Tier IV data centres in Riyadh and Jeddah, built and operated by Saudi engineers (S23). Database services are listed as a category. A managed PostgreSQL service was not confirmed in consulted sources.
- Sahara Net: data centres in Dammam and Riyadh per a third-party listing (S25). Its cloud catalog lists database administration and managed Kubernetes as available. A managed MySQL/PostgreSQL relational service was on its roadmap for H1 2026; current status not confirmed (S25). Claims Tier II and III certificates, ISO 27001 and PCI-DSS hosting (self-reported, S25).
- Mobily: data centre references in Dammam, Jeddah and a planned Riyadh site (S24). Public coverage is older; managed PostgreSQL not confirmed.

## 5. Registry option (Q-12)

- GitHub Container Registry: container image storage and bandwidth are currently free. GitHub says it will give at least one month's notice before that changes (S26). Private-package allowances: Free 500 MB storage and 1 GB transfer; Pro 2 GB and 10 GB; Team 2 GB and 10 GB; Enterprise Cloud 50 GB and 100 GB (S26). The page does not give separate container-image allowances.
- Provider registries: AWS ECR, Google Artifact Registry and Azure Container Registry were not priced or checked in this run. The owner should check whether the chosen provider's pull path from its own container service needs an in-region registry for pull speed and egress; not stated in consulted sources.

## 6. Residency and compliance notes

- Saudi regulatory context: a Vision 2030 analysis says NCA cloud rules mandate data residency for certain data classes, particularly government and Saudi national personal data (S27, third-party analysis). The repository's data classes are not classified here. To confirm with the owner and counsel.
- Sahara Net states that customer data is not replicated outside the Kingdom unless the customer configures it (S25, self-reported).
- Azure and AWS Saudi regions are not yet open for general use in the sources reviewed (Azure Q4 2026, AWS December 2026 per third-party reporting). A Saudi residency requirement therefore points to providers with a live Saudi region on the date of the decision, or to the Bahrain region and a residency waiver. Not decided here.
- Cloudflare: no provider-specific check made. The roadmap places Cloudflare in front of all options (roadmap OPS-1).

## 7. Facts the owner needs for Q-10 and Q-12

Which options meet every stated requirement on the evidence gathered in this run:

- Strict reading of R1 to R11: none is confirmed to meet every requirement from public pages in this run. Each candidate has at least one open item marked "not stated", "not checked" or "to confirm".
- The closest on the database requirements (R1, R2): AWS Bahrain (RDS PostgreSQL 16 with PostGIS and citext) and Azure (Flexible Server PostgreSQL 16 with PostGIS and citext in the Azure extension list, region Saudi East pending). Google Cloud Cloud SQL (Dammam) also lists PostgreSQL 16 with PostGIS and citext.
- Open on R3 for all managed options: triggers and RLS creation for non-superuser roles is not stated in AWS, Google or Azure docs consulted. Owner should ask each provider for written confirmation, or test on a sandbox instance: `CREATE TRIGGER` and `CREATE POLICY` as the application role, `CREATE ROLE` for four roles, `CREATE EXTENSION postgis` and `citext`.
- R4 Redis 7: AWS Bahrain has an ElastiCache Redis node price (S5); engine version 7 not checked. Google Memorystore Dammam not confirmed. Azure, Oracle, DigitalOcean (Valkey not Redis) and Saudi-local not checked.
- R6 containers for api, worker, web, VROOM, OSRM: AWS Fargate priced in Bahrain (S5); Google Cloud Run listed in Dammam (S9). Others not checked.
- R9 backups with WAL archiving to a second region: not checked for any provider.
- Q-12: GitHub Container Registry is free for container storage and bandwidth at the time of the research, with a one-month notice clause (S26). Provider registries not checked.

Summary for the owner:

- Providers with a Gulf region that is live and has a documented PostgreSQL 16 with PostGIS and citext option: AWS (Bahrain) and Google Cloud (Dammam, Cloud SQL). Azure Saudi East is not live for customers until Q4 2026 per Microsoft (S15).
- Providers not in a Gulf region: Hetzner and DigitalOcean. Both are priced and documented here for self-run or managed options outside the Gulf.
- Oracle: Jeddah has a PostgreSQL system cap of two per tenancy; Riyadh PostgreSQL not confirmed.
- Saudi-local: no confirmed managed PostgreSQL 16 with PostGIS in consulted sources. Sahara Net's managed relational service status is open.
- None of the options has confirmed triggers and RLS for non-superuser roles in public docs. This is the single most important item to close with the provider before ruling on Q-10.

## 8. Sources (all accessed 2026-10-31)

- S1 https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html (PostGIS 3.4.6 and citext 1.6 for PG 16)
- S2 https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.html (first account in rds_superuser)
- S3 https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.html (no superuser account on RDS)
- S4 https://w.media/aws-saudi-arabia-cloud-region-set-for-december-2026-launch/ (third-party report on AWS Saudi region timing)
- S5 https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/me-south-1/index.json and the same path for AmazonElastiCache, AmazonS3, AmazonECS (me-south-1 list prices; retrieved by curl)
- S6 https://docs.cloud.google.com/sql/docs/postgres/locations (me-central2 Dammam, updated 2026-10-26)
- S7 https://docs.cloud.google.com/sql/docs/postgres/extensions (PostGIS and citext on PG 16; cloudsqlsuperuser needed for extensions)
- S8 https://docs.cloud.google.com/sql/docs/postgres/users (cloudsqlsuperuser is limited superuser; event triggers listed; no RLS mention)
- S9 https://docs.cloud.google.com/run/docs/locations (me-central2 Tier 2 pricing, updated 2026-10-30)
- S10 https://docs.cloud.oracle.com/iaas/Content/postgresql/known-issues.htm (me-jeddah-1 cap of two PostgreSQL systems per tenancy)
- S11 https://docs.oracle.com/iaas/releasenotes/changes/45cb2bf5-290f-40fb-af89-b7b9455f35fe/index.htm (me-riyadh-1 launch)
- S12 https://docs.cloud.oracle.com/en-us/iaas/releasenotes/changes/b38848ee-ecd2-4c36-9491-95628f16dffd (me-jeddah-1 launch)
- S13 https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions (postgis 3.6.1 and citext 1.6 on PG 16; updated 2026-07-10)
- S14 https://learn.microsoft.com/en-us/azure/postgresql/security/security-manage-database-users (admin NOSUPERUSER, CREATEDB, CREATEROLE; azure_pg_admin)
- S15 https://news.microsoft.com/source/emea/2026/02/microsoft-confirms-saudi-arabia-datacenter-region-available-for-customers-to-run-cloud-workloads-from-q4-2026/ (Saudi region Q4 2026)
- S16 https://prices.azure.com/api/retail/prices (queried with armRegionName uaenorth and saudiarabiaeast, serviceName Azure Database for PostgreSQL; B2ms $0.158/hour in uaenorth)
- S17 https://docs.hetzner.com/cloud/general/locations/ (six cloud locations; none in the Gulf)
- S18 https://www.hetzner.com/cloud/ (plan starting prices, excl. VAT)
- S19 https://www.hetzner.com/storage/object-storage/pricing/ (object storage locations; price figures from a 2024 report and a 2026 comparison site disagree, not used as firm)
- S20 https://docs.digitalocean.com/products/databases/postgresql/details/supported-extensions/ (PostGIS and citext in Standard and Advanced editions)
- S21 https://www.digitalocean.com/pricing/managed-databases (managed PostgreSQL and Valkey plan prices)
- S22 https://docs.cloud.google.com/memorystore/docs/redis/locations (HTTP 404 in this run; Memorystore Dammam not confirmed)
- S23 https://www.azeusconvene.com/en-sa/stc-cloud-option (STC Cloud Tier IV data centres in Riyadh and Jeddah; third-party page quoting STC) and https://sharikatmubasher.com/media-hub/news/21504091/stc-launches-new-identity-for-sccc-by-stc-to-boost-cloud-capabilities (sccc by stc, databases listed)
- S24 https://www.intelligentcio.com/me/?p=2171 (Mobily business cloud, older coverage) and https://w.media/mobily-partners-with-tencent-cloud-to-provide-cloud-solutions-services-in-saudi-arabia/ (Mobily Tencent Cloud MoU)
- S25 https://sahara.com/cloud-service-catalog/ , https://sahara.com/cloud-roadmap/ , https://sahara.com/trust-center/ (Sahara Net; self-reported)
- S26 https://docs.github.com/en/billing/concepts/product-billing/github-packages (container registry free for now; allowances by plan)
- S27 https://vision2030.pages.dev/sectors/technology/cloud-computing/ (third-party analysis of NCA residency rules; not an official source)

## 9. Not verified (summary)

- Azure Saudi Arabia East: Flexible Server availability, PostgreSQL extension list for that region, and any compute or storage price beyond the UAE North proxy.
- Google Cloud: Dammam list prices (Cloud SQL, Memorystore, Cloud Storage, Secret Manager, Artifact Registry).
- Oracle: all pricing; Riyadh PostgreSQL; roles, triggers, RLS, Redis, storage, containers, secrets.
- Hetzner and DigitalOcean: exact plan prices for the footprint, managed DB regions (DigitalOcean), Redis versions, object storage features.
- Saudi-local providers: managed PostgreSQL availability and pricing; Sahara Net roadmap status.
- AWS: Secrets Manager and ECR prices, S3 versioning and lifecycle features, WAL archiving behaviour, Multi-AZ price, Redis 7 engine version, and triggers or RLS for non-superuser roles.
- Every provider: private networking details, secret store features, cross-region backup for WAL archiving.

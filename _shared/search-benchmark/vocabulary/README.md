# Search calibration vocabulary

A synthetic corpus and labeled query set for `docs/specs/search-calibration.md`.
Everything is invented: people, organizations (Bluefen Systems, Halden & Crewe
Brokers, Brisbeck & Moss, Ventrella Data Consulting), project codenames (Kestrel,
Larkspur), ticket ids and error codes. Emails use the reserved `.example` TLD and
phone numbers use `+00 555 …`. Real places (Lisbon, Kyoto, Iceland, Berlin) and
generic tech vocabulary are used as ordinary vocabulary.

## Files

| File | What it is |
|---|---|
| `corpus.json` | 158 documents: `{key, title, content}`; content starts with `# <title>` |
| `queries.json` | 147 queries: `{id, category, text, relevant: {key: grade}, group?}` |
| `floors.json` | Per-embedder floors the live floor test asserts; written by `search_benchmark.ts --write-floors` |

The two JSON files are the source of truth; edit them directly. Their integrity
(labels point at real documents, negatives carry no labels, groups share a grade-2
document, exact titles are verbatim, identifiers occur in their documents, nothing
real) is checked by `_shared/__tests__/search-calibration-vocabulary.test.ts`.
How the benchmark uses them: `docs/specs/search-calibration.md`.

## Corpus

The corpus grew in two passes. The first 60 documents (below) were enough to
choose a formula but not to tell candidates apart: 10 of 12 answerable
categories scored 0.9 to 1.0 under every formula. The second pass (see
*Distractors* further down) added 98 documents built to compete with the
labeled answers, which brought the spread down to where a regression shows.

### First pass

60 documents, 6 per domain: engineering how-tos, incidents/postmortems, meeting
notes, contact cards, product specs, company policies, recipes, travel logs,
personal finance/insurance, research/reading summaries.

Sizes: 45 normal (600 to 2,500 chars), 5 long with H2/H3 sections
(`eng-k8s-node-upgrade`, `eng-postgres-backups`, `inc-checkout-timeouts`,
`spec-kestrel-offline-sync`, `trv-iceland-ring-road`, 4,000 to 4,800 chars),
5 very short (`inc-ops-219-retry-budget`, `rec-cold-brew`, `trv-passport-renewal`,
`fin-emergency-fund`, `res-caffeine-half-life`, 200 to 300 chars), and the 5
remaining contact cards at 500 to 590 chars (slightly under 600, which is realistic
for a contact card).

Built-in difficulty:

- **Near-duplicate distractors:** backup runbook vs backup-failure incident vs
  replication-lag doc; node upgrade vs cluster autoscaler; Kestrel sync vs Kestrel
  push notifications vs Kestrel kickoff; PTO vs parental leave; sourdough vs
  focaccia; car cover vs home contents insurance; expense vs travel policy.
- **Answer only in the body:** API key rotation (in the security policy), per diem
  (expense policy), the rental-car waiver (Iceland log, car cover), the 02:00 backup
  time (also in the incident and the k8s runbook), the no-claims discount (call notes).
- **Paraphrase-only targets:** the car cover doc never says "insurance",
  "insurer" or "automobile"; the PTO policy never says "vacation" or "allowance";
  the curry never says "garbanzo" or "stew"; the pension doc never says
  "retirement" or "saving"; the mortgage doc never says "home loan" or "extra";
  the Kyoto log never says "inn", "traditional" or "Japanese"; the sleep summary
  never says "overnight", "learning" or "retention"; the TLS postmortem never says
  "SSL" or "lapsed". The vocabulary test checks that no paraphrase query shares a
  word with its target.
- **Acronyms defined once then used:** k8s, PDB, PITR, CI, PTO, MFA, SSO, IdP, JIT,
  HLC, CDW, HYSA, ERC, RRF, TTL.
- **Name forms:** contact cards titled by full name with the nickname in the body
  (Liz, Bob, Kate, Alex, Tom) and one the other way round (`Nick Ventrella` title,
  "Nicholas" in the body). Meeting notes list full names as attendees and use short
  names in the text. Name distractors: "Elizabeth Corwynne" (Lisbon host), "my
  sister Kate" (lemon tart), "Katherine Fenwright" as product owner on the sync spec.
- **Shared vocabulary across domains:** "policy" (company vs car), "schedule",
  "broker", "waiver", "rotate" (API keys, storage credentials), "pipeline",
  "Dutch oven" (bread and short ribs), caffeine vs cold brew.
- **Inflections** present in documents: deploy/deployment/deploying,
  rollback/rolling back, upgrade/upgrading, drain/drains, expire/expired/expiry.

Seven documents are never labeled and act as pure distractors:
`eng-k8s-cluster-autoscaler`, `rec-cold-brew`, `res-caffeine-half-life`,
`res-habit-formation`, `spec-bulk-csv-export`, `trv-berlin-infra-summit`,
`trv-carry-on-packing-list`.

## Queries

The table below is the first pass (132). The second added 15 (see *Distractors*): 147 in all, 13 of them negatives.

| Category | Count |
|---|---|
| exact_title | 10 |
| distinctive_keyword | 10 |
| multi_word_topic | 11 |
| paraphrase | 11 |
| abbreviation | 10 |
| short_name | 10 |
| misspelling | 10 |
| word_order | 10 |
| inflection | 10 |
| question | 10 |
| identifier | 10 |
| long_query | 10 |
| negative | 10 |
| **total** | **132** |

120 labeled queries have exactly one grade-2 document; 2 have two
(`Kestrel`: kickoff + sync spec; `Jen Okereke-Lund`: both meetings she attends).
48 queries carry grade-1 labels.

Queries by domain of their grade-2 document: engineering 21, incident 16,
contact 16, policy 13, spec 12, recipe 11, finance 11, travel 9, research 8,
meeting 7. Name-shaped queries (short_name plus the name-valued exact_title,
misspelling and word_order queries) total 17 of 122 non-negative queries, about 14%.

Negatives (10): Terraform, dog vaccination, sushi rice, health insurance
deductible, Kafka, GraphQL, Paris restaurants, an unknown person's phone number,
`OPS-999`, cat sitter contact details. Several share an incidental word with the
corpus ("insurance", "deductible", "schedule", "ratio", "phone", "contact",
"OPS-") so they are tempting; none is fully matched by any document.

## Variant groups (28; 4 are name groups = 14%)

| Group | Grade-2 doc | Shapes |
|---|---|---|
| g01 | eng-k8s-node-upgrade | expansion / acronym (k8s) / typo / inflected |
| g02 | eng-postgres-backups | exact title / typo / reordered / inflected |
| g03 | pol-pto | exact title / paraphrase / acronym / question |
| g04 | contact-elizabeth-marrowby | full name / nickname / typo / reordered (name) |
| g05 | contact-alexandra-quillon | full name / nickname / reordered (name) |
| g06 | contact-robert-tavistrom | full name / nickname / question (name) |
| g07 | contact-nick-ventrella | nickname title / full name (name) |
| g08 | eng-deploy-rollback | inflected / inflected / question |
| g09 | inc-checkout-timeouts | error code / ticket id / question / reordered |
| g10 | inc-expired-tls-certificate | paraphrase / inflected / error code |
| g11 | fin-car-cover-renewal | exact title / paraphrase |
| g12 | rec-chickpea-spinach-curry | exact title / paraphrase / typo / reordered |
| g13 | rec-weeknight-sourdough | keyword / typo / long query |
| g14 | spec-kestrel-offline-sync | topic / typo / reordered / long query |
| g15 | spec-sso-saml | expansion / acronym |
| g16 | eng-ci-pipeline-speed | expansion / acronym |
| g17 | pol-expense-reimbursement | paraphrase / typo / inflected |
| g18 | fin-mortgage-overpayment | paraphrase / acronym (ERC) / typo |
| g19 | trv-iceland-ring-road | expansion / acronym (CDW) |
| g20 | trv-iceland-ring-road | correct / typo |
| g21 | fin-pension-contributions | keyword topic / paraphrase |
| g22 | inc-internal-dns-failure | keyword / question / ticket id / error code |
| g23 | inc-build-runner-disk-full | ticket id / error code + message / long query |
| g24 | res-cache-invalidation | keyword / inflected |
| g25 | res-sleep-memory-consolidation | exact title / paraphrase |
| g26 | fin-emergency-fund | acronym (HYSA) / question |
| g27 | spec-api-rate-limiting | topic / status code |
| g28 | res-sparse-vs-dense-retrieval | expansion / acronym (RRF) |

Grade-1 labels are not always identical across a group (for example, a question
may carry an extra grade-1 doc that answers that specific phrasing). Group
consistency should be measured on the shared grade-2 doc and the top-5 overlap,
as the spec says.

## Distractors (second pass, 98 documents, 15 queries)

Written to make the right answer harder to find, never to answer an existing
query better than its labeled document. The original 60 documents are
unchanged. Clusters:

- **Look-alikes of labeled targets on another subject:** a Redis runbook whose
  title copies the PostgreSQL one, a Postgres major-version upgrade, an ingress
  migration that mentions drains and PodDisruptionBudgets in passing, a chickpea
  salad, a beef stew, a Tokyo trip with a ryokan, the North Coast 500 for the
  Iceland ring road, a search-metrics note that mentions reciprocal rank fusion.
- **Rare terms in more documents:** Kestrel now appears in 13 documents (was 6),
  Quillon 7 (5), Marrowby 6 (4), levain and "attention residue" 3 each (1).
- **Name collisions:** other people called Liz/Elizabeth, Bob/Robert, Kate, Alex,
  Nick, Tom and Jen, and shared surnames (a Marrowby who services a boiler, a
  Quillon who quotes for joinery).
- **Identifier neighbours:** OPS-218 and OPS-222 beside OPS-217/219 (OPS-222
  splits E4012), E4013/E4014, E4032/E4035, E5004, E7101, E2208. A few documents
  name a queried code only to contrast it; those are left unlabeled on purpose.
- **A new home domain** (7 documents) for cross-domain vocabulary.

New queries: surname-only (Ventrella, Brisbeck), short names with context, a
short name whose answer is one of the new collision cards, three new identifiers,
an exact title, a paraphrase, and three negatives (OPS-240, E4015, a solar-panel
quote). Existing queries gained grade-1 labels only where a new document
genuinely answers part of them (for example, the Kestrel-centered specs for
"Kestrel", the April incident review for the DNS queries).

Removed in review: a card for a person whose name was one letter from a negative
query's (it turned that negative into a misspelling test), and a sentence written
only to put "Alex" into an unrelated card.

## Labeling decisions

Reviewed 2026-09-30. Resolved in review: the backup-failure incident is a 2 for
q095 (it states the time outright); passing mentions now carry grade 1 (Alexandra
Quillon in the checkout postmortem for the Quillon queries, Katherine Fenwright on
the sync spec for the Kate queries, the broker's card for q032, the checkout
postmortem's rollback for q084). The notes below are the original caveats, kept
because they explain the remaining judgment calls.

### Original caveats (least certain first)

1. **q095 "what time does the nightly database backup run"**: runbook = 2; the
   backup-failure incident and the k8s runbook = 1 because both state "02:00 UTC".
   One could argue the incident deserves 2 (it answers the question outright).
2. **q060 "Jen Okereke-Lund"**: no contact card exists, so both meetings she
   attends are graded 2. A ranker that puts either first is right; Hit@1 is fine,
   but nDCG treats them as equals by construction.
3. **q011 "Kestrel"**: kickoff and sync spec both 2, push notifications and Kate's
   card 1. The 1:1 and the budget review also mention Kestrel and are unlabeled.
4. **Name queries (g04 to g07, Kate, Tom)**: grade 1 is given to meeting notes that
   name the person in the attendee list. Documents that mention them in passing
   are unlabeled: Alexandra Quillon as incident commander in the checkout
   postmortem, Katherine Fenwright as product owner of the sync spec, "Tom" in the
   pension notes. A strict judge might grade those 1.
5. **q032 "automobile insurance" / q005 "Robert Tavistrom"**: the broker's card
   (which says he handles the car policy) is unlabeled for the paraphrase; the
   home contents doc (which does contain "insurance" and mentions bundling with the
   car policy) is unlabeled too, and is the intended trap.
6. **q084 "rolled back deployment"**: only the deploy/rollback how-to is labeled;
   the checkout postmortem describes an actual rollback and is unlabeled.
7. **q126 "health insurance deductible"** (negative): the car cover, home contents
   and tax docs are topically nearby ("excess", "insurance", "deductible"). None
   answers it, but a judge could call the home contents doc marginally related.
8. **q014 "PodDisruptionBudget"**, **q050 "PDB drain stuck"**: the platform weekly
   notes get 1 because they describe a stuck drain caused by a PDB.

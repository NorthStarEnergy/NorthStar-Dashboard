# Source clarification: Cogen and International Falls

User-confirmed after the initial analysis: Cogen data arrives in three PDFs. International Falls data also arrives by email. The receiving mailbox is the user's work email. Mail provider, sender/subjects and whether each PDF maps to one generator remain unconfirmed.

This supersedes the initial source hypothesis for Cogen: first inspect the three report formats and map their actual fields to Daily_Input!B60:B62 (energy active counters) and D60:D62 (current power). Verify generator identity, report date/time, units, scaling and whether all three PDFs belong to the same reporting period. OCR is needed only if the PDFs lack usable text. No sample reports were inspected yet.

For International Falls, inspect one actual email to establish whether the values appear in the body, an attachment or a linked report. The existing workbook PCA/Boise PDF link remains a reference, not proof of the current email format or an equivalent source. Candidate input fields remain Daily_Input!E37:E41, with F37:F41 conversion formulas preserved; confirm that the email supplies those same five metrics.

Proposed collection: read-only access to an identified mailbox/folder or incoming-file folder; allowlisted senders/report types; duplicate detection by message/attachment identity and file hash; extraction with report-date, metric and unit validation; daily draft with source provenance and explicit missing/stale/incomplete status. Avoid requiring a full three-report set for unrelated metrics; require completeness only where the confirmed report mapping needs it. Poll on a configurable interval and provide refresh on demand. Preserve original reporting timestamps rather than treating email arrival time as observation time.

Still needed: work-mail provider/access method, sender/subject identifiers, representative PDFs and an International Falls email, and the source for unit operating hours. No PDFs or emails were ingested, workbook modified, mailbox accessed or new collector enabled by this clarification.

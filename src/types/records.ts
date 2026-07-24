/**
 * Structured record shapes returned by the tools. Fields are optional because
 * the web UI does not always expose every field, and different Copper accounts
 * configure different columns. Tools return whatever they can reliably extract.
 */

export type ParentType = "person" | "company" | "opportunity" | "lead";

export interface PersonSummary {
  /** Copper record id (stable numeric id from the record URL when available). */
  id: string | null;
  name: string | null;
  title: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  owner: string | null;
  tags: string[];
  /** Absolute URL to the record in the Copper web app. */
  recordUrl: string | null;
}

export interface PersonDetail extends PersonSummary {
  emails: string[];
  phones: string[];
  /** Recent activities visible on the record, newest first. */
  activities: ActivitySummary[];
}

export interface CompanySummary {
  id: string | null;
  name: string | null;
  emailDomain: string | null;
  phone: string | null;
  owner: string | null;
  tags: string[];
  recordUrl: string | null;
}

export interface OpportunitySummary {
  id: string | null;
  name: string | null;
  companyName: string | null;
  pipeline: string | null;
  stage: string | null;
  status: string | null;
  owner: string | null;
  value: string | null;
  closeDate: string | null;
  recordUrl: string | null;
}

export interface OpportunityDetail extends OpportunitySummary {
  primaryContact: string | null;
  tags: string[];
  activities: ActivitySummary[];
}

export interface PipelineSummary {
  id: string | null;
  name: string | null;
  stages: string[];
}

export interface ActivitySummary {
  id: string | null;
  type: string | null;
  details: string | null;
  date: string | null;
  author: string | null;
}

export interface TaskSummary {
  id: string | null;
  title: string | null;
  dueDate: string | null;
  status: string | null;
  relatedTo: string | null;
  recordUrl: string | null;
}

/** Preview returned by a write tool when confirm is not yet true. */
export interface WritePreview {
  action: string;
  willSubmit: false;
  summary: Record<string, unknown>;
  note: string;
}

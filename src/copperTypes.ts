/** Minimal shapes for the Copper API responses we read. Partial by design —
 *  Copper records carry many more fields; we only type what the tools surface. */

export interface CopperEmail {
  email: string;
  category?: string;
}

export interface CopperPhone {
  number: string;
  category?: string;
}

export interface CopperPerson {
  id: number;
  name: string;
  emails?: CopperEmail[];
  phone_numbers?: CopperPhone[];
  company_name?: string | null;
  title?: string | null;
}

export interface CopperCompany {
  id: number;
  name: string;
  email_domain?: string | null;
  phone_numbers?: CopperPhone[];
}

export interface CopperOpportunity {
  id: number;
  name: string;
  monetary_value?: number | null;
  pipeline_id?: number | null;
  pipeline_stage_id?: number | null;
  close_date?: string | null;
  company_name?: string | null;
  assignee_id?: number | null;
  primary_contact_id?: number | null;
  [key: string]: unknown;
}

export interface CopperPipelineStage {
  id: number;
  name: string;
  win_probability?: number | null;
}

export interface CopperPipeline {
  id: number;
  name: string;
  stages?: CopperPipelineStage[];
}

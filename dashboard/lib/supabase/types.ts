export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.1";
  };
  public: {
    Tables: {
      application_events: {
        Row: {
          application_id: string;
          created_at: string | null;
          event_type: string;
          id: string;
          metadata: Json | null;
          new_value: string | null;
          old_value: string | null;
        };
        Insert: {
          application_id: string;
          created_at?: string | null;
          event_type: string;
          id?: string;
          metadata?: Json | null;
          new_value?: string | null;
          old_value?: string | null;
        };
        Update: {
          application_id?: string;
          created_at?: string | null;
          event_type?: string;
          id?: string;
          metadata?: Json | null;
          new_value?: string | null;
          old_value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          applied_at: string | null;
          auto_applied: boolean | null;
          cover_letter: string | null;
          created_at: string | null;
          deadline_label: string | null;
          id: string;
          is_dismissed: boolean | null;
          is_favorite: boolean | null;
          job_id: string;
          next_deadline: string | null;
          notes: string | null;
          status: string;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          applied_at?: string | null;
          auto_applied?: boolean | null;
          cover_letter?: string | null;
          created_at?: string | null;
          deadline_label?: string | null;
          id?: string;
          is_dismissed?: boolean | null;
          is_favorite?: boolean | null;
          job_id: string;
          next_deadline?: string | null;
          notes?: string | null;
          status?: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          applied_at?: string | null;
          auto_applied?: boolean | null;
          cover_letter?: string | null;
          created_at?: string | null;
          deadline_label?: string | null;
          id?: string;
          is_dismissed?: boolean | null;
          is_favorite?: boolean | null;
          job_id?: string;
          next_deadline?: string | null;
          notes?: string | null;
          status?: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      auto_apply_queue: {
        Row: {
          cover_letter_draft: string | null;
          created_at: string | null;
          error_message: string | null;
          form_data: Json | null;
          id: string;
          job_id: string;
          status: string;
          submitted_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          cover_letter_draft?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          form_data?: Json | null;
          id?: string;
          job_id: string;
          status?: string;
          submitted_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          cover_letter_draft?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          form_data?: Json | null;
          id?: string;
          job_id?: string;
          status?: string;
          submitted_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "auto_apply_queue_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      crawl_runs: {
        Row: {
          created_at: string | null;
          duplicates_skipped: number | null;
          errors: number | null;
          finished_at: string | null;
          id: string;
          log_output: string | null;
          new_jobs_added: number | null;
          source_stats: Json | null;
          started_at: string | null;
          status: string;
          total_jobs_found: number | null;
        };
        Insert: {
          created_at?: string | null;
          duplicates_skipped?: number | null;
          errors?: number | null;
          finished_at?: string | null;
          id?: string;
          log_output?: string | null;
          new_jobs_added?: number | null;
          source_stats?: Json | null;
          started_at?: string | null;
          status?: string;
          total_jobs_found?: number | null;
        };
        Update: {
          created_at?: string | null;
          duplicates_skipped?: number | null;
          errors?: number | null;
          finished_at?: string | null;
          id?: string;
          log_output?: string | null;
          new_jobs_added?: number | null;
          source_stats?: Json | null;
          started_at?: string | null;
          status?: string;
          total_jobs_found?: number | null;
        };
        Relationships: [];
      };
      job_sources: {
        Row: {
          base_url: string | null;
          config: Json | null;
          created_at: string | null;
          enabled: boolean | null;
          id: string;
          last_crawled_at: string | null;
          name: string;
          priority: number | null;
          source_type: string;
          updated_at: string | null;
        };
        Insert: {
          base_url?: string | null;
          config?: Json | null;
          created_at?: string | null;
          enabled?: boolean | null;
          id?: string;
          last_crawled_at?: string | null;
          name: string;
          priority?: number | null;
          source_type: string;
          updated_at?: string | null;
        };
        Update: {
          base_url?: string | null;
          config?: Json | null;
          created_at?: string | null;
          enabled?: boolean | null;
          id?: string;
          last_crawled_at?: string | null;
          name?: string;
          priority?: number | null;
          source_type?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          company: string | null;
          crawl_run_id: string | null;
          created_at: string | null;
          description_html: string | null;
          description_text: string | null;
          easy_apply: boolean | null;
          external_id: string | null;
          id: string;
          is_active: boolean | null;
          is_remote: boolean | null;
          keywords: string[] | null;
          location: string | null;
          posted_date: string | null;
          raw_data: Json | null;
          relevance_score: number | null;
          salary_max: number | null;
          salary_min: number | null;
          salary_text: string | null;
          score_reasoning: string | null;
          source_id: string | null;
          title: string;
          updated_at: string | null;
          url: string | null;
          url_hash: string | null;
        };
        Insert: {
          company?: string | null;
          crawl_run_id?: string | null;
          created_at?: string | null;
          description_html?: string | null;
          description_text?: string | null;
          easy_apply?: boolean | null;
          external_id?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_remote?: boolean | null;
          keywords?: string[] | null;
          location?: string | null;
          posted_date?: string | null;
          raw_data?: Json | null;
          relevance_score?: number | null;
          salary_max?: number | null;
          salary_min?: number | null;
          salary_text?: string | null;
          score_reasoning?: string | null;
          source_id?: string | null;
          title: string;
          updated_at?: string | null;
          url?: string | null;
          url_hash?: string | null;
        };
        Update: {
          company?: string | null;
          crawl_run_id?: string | null;
          created_at?: string | null;
          description_html?: string | null;
          description_text?: string | null;
          easy_apply?: boolean | null;
          external_id?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_remote?: boolean | null;
          keywords?: string[] | null;
          location?: string | null;
          posted_date?: string | null;
          raw_data?: Json | null;
          relevance_score?: number | null;
          salary_max?: number | null;
          salary_min?: number | null;
          salary_text?: string | null;
          score_reasoning?: string | null;
          source_id?: string | null;
          title?: string;
          updated_at?: string | null;
          url?: string | null;
          url_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_crawl_run_id_fkey";
            columns: ["crawl_run_id"];
            isOneToOne: false;
            referencedRelation: "crawl_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "job_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      resumes: {
        Row: {
          created_at: string | null;
          file_name: string;
          file_path: string | null;
          id: string;
          is_active: boolean | null;
          parsed_data: Json | null;
          preferences: Json | null;
          raw_text: string | null;
          skills: string[] | null;
          target_titles: string[] | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          file_name: string;
          file_path?: string | null;
          id?: string;
          is_active?: boolean | null;
          parsed_data?: Json | null;
          preferences?: Json | null;
          raw_text?: string | null;
          skills?: string[] | null;
          target_titles?: string[] | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          file_name?: string;
          file_path?: string | null;
          id?: string;
          is_active?: boolean | null;
          parsed_data?: Json | null;
          preferences?: Json | null;
          raw_text?: string | null;
          skills?: string[] | null;
          target_titles?: string[] | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      search_profiles: {
        Row: {
          created_at: string | null;
          id: string;
          is_active: boolean | null;
          job_titles: string[] | null;
          keywords: string[] | null;
          locations: string[] | null;
          min_relevance_score: number | null;
          min_salary: number | null;
          name: string;
          negative_keywords: string[] | null;
          remote_only: boolean | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          job_titles?: string[] | null;
          keywords?: string[] | null;
          locations?: string[] | null;
          min_relevance_score?: number | null;
          min_salary?: number | null;
          name: string;
          negative_keywords?: string[] | null;
          remote_only?: boolean | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          job_titles?: string[] | null;
          keywords?: string[] | null;
          locations?: string[] | null;
          min_relevance_score?: number | null;
          min_salary?: number | null;
          name?: string;
          negative_keywords?: string[] | null;
          remote_only?: boolean | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type InsertTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type UpdateTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

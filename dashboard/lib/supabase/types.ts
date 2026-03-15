export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_schedules: {
        Row: {
          budget_minutes: number
          created_at: string | null
          days_of_week: number[]
          dry_run: boolean
          enabled: boolean
          hour: number
          id: string
          last_run_at: string | null
          minute: number
          name: string
          next_run_at: string | null
          timezone: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          budget_minutes?: number
          created_at?: string | null
          days_of_week?: number[]
          dry_run?: boolean
          enabled?: boolean
          hour?: number
          id?: string
          last_run_at?: string | null
          minute?: number
          name?: string
          next_run_at?: string | null
          timezone?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          budget_minutes?: number
          created_at?: string | null
          days_of_week?: number[]
          dry_run?: boolean
          enabled?: boolean
          hour?: number
          id?: string
          last_run_at?: string | null
          minute?: number
          name?: string
          next_run_at?: string | null
          timezone?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      application_attempts: {
        Row: {
          applied_at: string | null
          auto_apply_queue_id: string | null
          created_at: string | null
          duration_seconds: number | null
          error_log: string | null
          id: string
          job_id: string | null
          notes: string | null
          platform: string
          screening_answers: Json | null
          screenshot_path: string | null
          screenshot_paths: string[] | null
          status: string
          steps_completed: Json | null
          user_id: string | null
        }
        Insert: {
          applied_at?: string | null
          auto_apply_queue_id?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          error_log?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          platform: string
          screening_answers?: Json | null
          screenshot_path?: string | null
          screenshot_paths?: string[] | null
          status?: string
          steps_completed?: Json | null
          user_id?: string | null
        }
        Update: {
          applied_at?: string | null
          auto_apply_queue_id?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          error_log?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          platform?: string
          screening_answers?: Json | null
          screenshot_path?: string | null
          screenshot_paths?: string[] | null
          status?: string
          steps_completed?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      application_events: {
        Row: {
          application_id: string
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
          user_id: string | null
        }
        Insert: {
          application_id: string
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          user_id?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          applied_at: string | null
          auto_applied: boolean | null
          cover_letter: string | null
          created_at: string | null
          deadline_label: string | null
          id: string
          is_dismissed: boolean | null
          is_favorite: boolean | null
          job_id: string
          next_deadline: string | null
          notes: string | null
          status: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          applied_at?: string | null
          auto_applied?: boolean | null
          cover_letter?: string | null
          created_at?: string | null
          deadline_label?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_favorite?: boolean | null
          job_id: string
          next_deadline?: string | null
          notes?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          applied_at?: string | null
          auto_applied?: boolean | null
          cover_letter?: string | null
          created_at?: string | null
          deadline_label?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_favorite?: boolean | null
          job_id?: string
          next_deadline?: string | null
          notes?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_apply_logs: {
        Row: {
          action: string | null
          created_at: string | null
          detail: string | null
          id: string
          job_id: string | null
          level: string | null
          queue_item_id: string | null
          screenshot_path: string | null
          step_number: number | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          detail?: string | null
          id?: string
          job_id?: string | null
          level?: string | null
          queue_item_id?: string | null
          screenshot_path?: string | null
          step_number?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          detail?: string | null
          id?: string
          job_id?: string | null
          level?: string | null
          queue_item_id?: string | null
          screenshot_path?: string | null
          step_number?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      auto_apply_queue: {
        Row: {
          cover_letter_draft: string | null
          created_at: string | null
          error_message: string | null
          form_data: Json | null
          id: string
          job_id: string
          status: string
          submitted_at: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          cover_letter_draft?: string | null
          created_at?: string | null
          error_message?: string | null
          form_data?: Json | null
          id?: string
          job_id: string
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          cover_letter_draft?: string | null
          created_at?: string | null
          error_message?: string | null
          form_data?: Json | null
          id?: string
          job_id?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_apply_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_sessions: {
        Row: {
          cookies: Json | null
          created_at: string | null
          id: string
          is_valid: boolean | null
          last_used_at: string | null
          platform: string
          storage_state: Json | null
          updated_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          cookies?: Json | null
          created_at?: string | null
          id?: string
          is_valid?: boolean | null
          last_used_at?: string | null
          platform: string
          storage_state?: Json | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          cookies?: Json | null
          created_at?: string | null
          id?: string
          is_valid?: boolean | null
          last_used_at?: string | null
          platform?: string
          storage_state?: Json | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      crawl_runs: {
        Row: {
          created_at: string | null
          duplicates_skipped: number | null
          errors: number | null
          finished_at: string | null
          id: string
          log_output: string | null
          new_jobs_added: number | null
          source_stats: Json | null
          started_at: string | null
          status: string
          total_jobs_found: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          duplicates_skipped?: number | null
          errors?: number | null
          finished_at?: string | null
          id?: string
          log_output?: string | null
          new_jobs_added?: number | null
          source_stats?: Json | null
          started_at?: string | null
          status?: string
          total_jobs_found?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          duplicates_skipped?: number | null
          errors?: number | null
          finished_at?: string | null
          id?: string
          log_output?: string | null
          new_jobs_added?: number | null
          source_stats?: Json | null
          started_at?: string | null
          status?: string
          total_jobs_found?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      discovery_prompts: {
        Row: {
          conversation: Json
          created_at: string | null
          id: string
          is_active: boolean
          last_run_at: string | null
          name: string
          preferences: Json
          schedule: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          conversation?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name?: string
          preferences?: Json
          schedule?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          conversation?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name?: string
          preferences?: Json
          schedule?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      job_feedback: {
        Row: {
          created_at: string | null
          id: string
          job_id: string
          metadata: Json | null
          signal_type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_id: string
          metadata?: Json | null
          signal_type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          job_id?: string
          metadata?: Json | null
          signal_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_feedback_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sources: {
        Row: {
          base_url: string | null
          config: Json | null
          created_at: string | null
          enabled: boolean | null
          id: string
          last_crawled_at: string | null
          name: string
          priority: number | null
          source_type: string
          updated_at: string | null
        }
        Insert: {
          base_url?: string | null
          config?: Json | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_crawled_at?: string | null
          name: string
          priority?: number | null
          source_type: string
          updated_at?: string | null
        }
        Update: {
          base_url?: string | null
          config?: Json | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_crawled_at?: string | null
          name?: string
          priority?: number | null
          source_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          company: string | null
          crawl_run_id: string | null
          created_at: string | null
          description_html: string | null
          description_text: string | null
          easy_apply: boolean | null
          external_id: string | null
          id: string
          is_active: boolean | null
          is_remote: boolean | null
          keywords: string[] | null
          location: string | null
          match_confidence: number | null
          posted_date: string | null
          raw_data: Json | null
          relevance_score: number | null
          salary_max: number | null
          salary_min: number | null
          salary_text: string | null
          score_reasoning: string | null
          source_id: string | null
          target_company_id: string | null
          title: string
          updated_at: string | null
          url: string | null
          url_hash: string | null
          user_id: string | null
        }
        Insert: {
          company?: string | null
          crawl_run_id?: string | null
          created_at?: string | null
          description_html?: string | null
          description_text?: string | null
          easy_apply?: boolean | null
          external_id?: string | null
          id?: string
          is_active?: boolean | null
          is_remote?: boolean | null
          keywords?: string[] | null
          location?: string | null
          match_confidence?: number | null
          posted_date?: string | null
          raw_data?: Json | null
          relevance_score?: number | null
          salary_max?: number | null
          salary_min?: number | null
          salary_text?: string | null
          score_reasoning?: string | null
          source_id?: string | null
          target_company_id?: string | null
          title: string
          updated_at?: string | null
          url?: string | null
          url_hash?: string | null
          user_id?: string | null
        }
        Update: {
          company?: string | null
          crawl_run_id?: string | null
          created_at?: string | null
          description_html?: string | null
          description_text?: string | null
          easy_apply?: boolean | null
          external_id?: string | null
          id?: string
          is_active?: boolean | null
          is_remote?: boolean | null
          keywords?: string[] | null
          location?: string | null
          match_confidence?: number | null
          posted_date?: string | null
          raw_data?: Json | null
          relevance_score?: number | null
          salary_max?: number | null
          salary_min?: number | null
          salary_text?: string | null
          score_reasoning?: string | null
          source_id?: string | null
          target_company_id?: string | null
          title?: string
          updated_at?: string | null
          url?: string | null
          url_hash?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_crawl_run_id_fkey"
            columns: ["crawl_run_id"]
            isOneToOne: false
            referencedRelation: "crawl_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_target_company_id_fkey"
            columns: ["target_company_id"]
            isOneToOne: false
            referencedRelation: "target_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_answers: {
        Row: {
          category: string
          created_at: string | null
          field_key: string
          field_label: string
          id: string
          updated_at: string | null
          user_id: string | null
          value: string
        }
        Insert: {
          category?: string
          created_at?: string | null
          field_key: string
          field_label: string
          id?: string
          updated_at?: string | null
          user_id?: string | null
          value: string
        }
        Update: {
          category?: string
          created_at?: string | null
          field_key?: string
          field_label?: string
          id?: string
          updated_at?: string | null
          user_id?: string | null
          value?: string
        }
        Relationships: []
      }
      resumes: {
        Row: {
          created_at: string | null
          file_name: string
          file_path: string | null
          id: string
          is_active: boolean | null
          parsed_data: Json | null
          preferences: Json | null
          raw_text: string | null
          skills: string[] | null
          target_titles: string[] | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_path?: string | null
          id?: string
          is_active?: boolean | null
          parsed_data?: Json | null
          preferences?: Json | null
          raw_text?: string | null
          skills?: string[] | null
          target_titles?: string[] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_path?: string | null
          id?: string
          is_active?: boolean | null
          parsed_data?: Json | null
          preferences?: Json | null
          raw_text?: string | null
          skills?: string[] | null
          target_titles?: string[] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      search_profiles: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          job_titles: string[] | null
          keywords: string[] | null
          locations: string[] | null
          min_relevance_score: number | null
          min_salary: number | null
          name: string
          negative_keywords: string[] | null
          remote_only: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          job_titles?: string[] | null
          keywords?: string[] | null
          locations?: string[] | null
          min_relevance_score?: number | null
          min_salary?: number | null
          name: string
          negative_keywords?: string[] | null
          remote_only?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          job_titles?: string[] | null
          keywords?: string[] | null
          locations?: string[] | null
          min_relevance_score?: number | null
          min_salary?: number | null
          name?: string
          negative_keywords?: string[] | null
          remote_only?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      search_suggestions: {
        Row: {
          created_at: string | null
          field: string
          id: string
          reasoning: string | null
          status: string | null
          suggestion_type: string
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string | null
          field: string
          id?: string
          reasoning?: string | null
          status?: string | null
          suggestion_type: string
          user_id: string
          value: string
        }
        Update: {
          created_at?: string | null
          field?: string
          id?: string
          reasoning?: string | null
          status?: string | null
          suggestion_type?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      target_companies: {
        Row: {
          ats_type: string | null
          avg_match_confidence: number | null
          careers_url: string | null
          crawl_error: string | null
          crawl_status: string | null
          created_at: string | null
          discovery_source: string | null
          distance_tier: string | null
          enabled: boolean | null
          id: string
          industry: string | null
          jobs_found: number | null
          last_crawled_at: string | null
          location: string | null
          matched_jobs_count: number | null
          name: string
          priority: number | null
          user_id: string
          watched: boolean
        }
        Insert: {
          ats_type?: string | null
          avg_match_confidence?: number | null
          careers_url?: string | null
          crawl_error?: string | null
          crawl_status?: string | null
          created_at?: string | null
          discovery_source?: string | null
          distance_tier?: string | null
          enabled?: boolean | null
          id?: string
          industry?: string | null
          jobs_found?: number | null
          last_crawled_at?: string | null
          location?: string | null
          matched_jobs_count?: number | null
          name: string
          priority?: number | null
          user_id: string
          watched?: boolean
        }
        Update: {
          ats_type?: string | null
          avg_match_confidence?: number | null
          careers_url?: string | null
          crawl_error?: string | null
          crawl_status?: string | null
          created_at?: string | null
          discovery_source?: string | null
          distance_tier?: string | null
          enabled?: boolean | null
          id?: string
          industry?: string | null
          jobs_found?: number | null
          last_crawled_at?: string | null
          location?: string | null
          matched_jobs_count?: number | null
          name?: string
          priority?: number | null
          user_id?: string
          watched?: boolean
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          accepts_remote: boolean | null
          avg_applied_score: number | null
          avoided_companies: string[] | null
          avoided_keywords: string[] | null
          avoided_titles: string[] | null
          id: string
          last_computed_at: string | null
          min_applied_score: number | null
          preferred_companies: string[] | null
          preferred_industries: string[] | null
          preferred_keywords: string[] | null
          preferred_locations: string[] | null
          preferred_titles: string[] | null
          scoring_hints: Json | null
          total_applied: number | null
          total_dismissed: number | null
          user_id: string
        }
        Insert: {
          accepts_remote?: boolean | null
          avg_applied_score?: number | null
          avoided_companies?: string[] | null
          avoided_keywords?: string[] | null
          avoided_titles?: string[] | null
          id?: string
          last_computed_at?: string | null
          min_applied_score?: number | null
          preferred_companies?: string[] | null
          preferred_industries?: string[] | null
          preferred_keywords?: string[] | null
          preferred_locations?: string[] | null
          preferred_titles?: string[] | null
          scoring_hints?: Json | null
          total_applied?: number | null
          total_dismissed?: number | null
          user_id: string
        }
        Update: {
          accepts_remote?: boolean | null
          avg_applied_score?: number | null
          avoided_companies?: string[] | null
          avoided_keywords?: string[] | null
          avoided_titles?: string[] | null
          id?: string
          last_computed_at?: string | null
          min_applied_score?: number | null
          preferred_companies?: string[] | null
          preferred_industries?: string[] | null
          preferred_keywords?: string[] | null
          preferred_locations?: string[] | null
          preferred_titles?: string[] | null
          scoring_hints?: Json | null
          total_applied?: number | null
          total_dismissed?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_profile: {
        Row: {
          ats_email: string | null
          ats_password: string | null
          city: string | null
          country: string | null
          created_at: string | null
          desired_salary: string | null
          education_level: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          linkedin_url: string | null
          phone: string | null
          screening_defaults: Json | null
          state: string | null
          updated_at: string | null
          user_id: string | null
          website_url: string | null
          willing_to_relocate: boolean | null
          work_authorization: string | null
          years_experience: number | null
        }
        Insert: {
          ats_email?: string | null
          ats_password?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          desired_salary?: string | null
          education_level?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          linkedin_url?: string | null
          phone?: string | null
          screening_defaults?: Json | null
          state?: string | null
          updated_at?: string | null
          user_id?: string | null
          website_url?: string | null
          willing_to_relocate?: boolean | null
          work_authorization?: string | null
          years_experience?: number | null
        }
        Update: {
          ats_email?: string | null
          ats_password?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          desired_salary?: string | null
          education_level?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          linkedin_url?: string | null
          phone?: string | null
          screening_defaults?: Json | null
          state?: string | null
          updated_at?: string | null
          user_id?: string | null
          website_url?: string | null
          willing_to_relocate?: boolean | null
          work_authorization?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      requesting_user_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

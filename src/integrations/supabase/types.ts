export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      daily_time_reports: {
        Row: {
          approval_status: Database["public"]["Enums"]["dtr_approval_status"]
          approved_at: string | null
          approved_by: string | null
          correction_notes: string | null
          created_at: string
          cutoff_id: string | null
          employee_id: string
          hours_worked: number
          id: string
          is_absent: boolean
          is_leave: boolean
          is_undertime: boolean
          late_minutes: number
          leave_type: string | null
          locked_at: string | null
          notes: string | null
          ot_approved_at: string | null
          ot_approved_by: string | null
          ot_approved_hours: number
          ot_review_notes: string | null
          ot_status: Database["public"]["Enums"]["ot_approval_status"]
          overtime_hours: number
          rejection_reason: string | null
          shift_label: string | null
          time_in: string | null
          time_out: string | null
          undertime_minutes: number
          updated_at: string
          work_date: string
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["dtr_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          correction_notes?: string | null
          created_at?: string
          cutoff_id?: string | null
          employee_id: string
          hours_worked?: number
          id?: string
          is_absent?: boolean
          is_leave?: boolean
          is_undertime?: boolean
          late_minutes?: number
          leave_type?: string | null
          locked_at?: string | null
          notes?: string | null
          ot_approved_at?: string | null
          ot_approved_by?: string | null
          ot_approved_hours?: number
          ot_review_notes?: string | null
          ot_status?: Database["public"]["Enums"]["ot_approval_status"]
          overtime_hours?: number
          rejection_reason?: string | null
          shift_label?: string | null
          time_in?: string | null
          time_out?: string | null
          undertime_minutes?: number
          updated_at?: string
          work_date: string
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["dtr_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          correction_notes?: string | null
          created_at?: string
          cutoff_id?: string | null
          employee_id?: string
          hours_worked?: number
          id?: string
          is_absent?: boolean
          is_leave?: boolean
          is_undertime?: boolean
          late_minutes?: number
          leave_type?: string | null
          locked_at?: string | null
          notes?: string | null
          ot_approved_at?: string | null
          ot_approved_by?: string | null
          ot_approved_hours?: number
          ot_review_notes?: string | null
          ot_status?: Database["public"]["Enums"]["ot_approval_status"]
          overtime_hours?: number
          rejection_reason?: string | null
          shift_label?: string | null
          time_in?: string | null
          time_out?: string | null
          undertime_minutes?: number
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_time_reports_cutoff_id_fkey"
            columns: ["cutoff_id"]
            isOneToOne: false
            referencedRelation: "payroll_cutoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dtr_employee_profile_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dtr_approval_logs: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          action_by: string
          action_date: string
          dtr_cutoff_submission_id: string
          id: string
          notes: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          action_by: string
          action_date?: string
          dtr_cutoff_submission_id: string
          id?: string
          notes?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          action_by?: string
          action_date?: string
          dtr_cutoff_submission_id?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dtr_approval_logs_dtr_cutoff_submission_id_fkey"
            columns: ["dtr_cutoff_submission_id"]
            isOneToOne: false
            referencedRelation: "dtr_cutoff_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      dtr_cutoff_submissions: {
        Row: {
          absent_count: number
          approval_status: Database["public"]["Enums"]["dtr_approval_status"]
          approved_at: string | null
          approved_by: string | null
          correction_notes: string | null
          created_at: string
          cutoff_id: string
          employee_id: string
          id: string
          late_count: number
          leave_days: number
          locked_at: string | null
          missing_dtr_count: number
          overtime_hours: number
          rejection_reason: string | null
          submitted_at: string | null
          total_days_submitted: number
          total_hours: number
          updated_at: string
        }
        Insert: {
          absent_count?: number
          approval_status?: Database["public"]["Enums"]["dtr_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          correction_notes?: string | null
          created_at?: string
          cutoff_id: string
          employee_id: string
          id?: string
          late_count?: number
          leave_days?: number
          locked_at?: string | null
          missing_dtr_count?: number
          overtime_hours?: number
          rejection_reason?: string | null
          submitted_at?: string | null
          total_days_submitted?: number
          total_hours?: number
          updated_at?: string
        }
        Update: {
          absent_count?: number
          approval_status?: Database["public"]["Enums"]["dtr_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          correction_notes?: string | null
          created_at?: string
          cutoff_id?: string
          employee_id?: string
          id?: string
          late_count?: number
          leave_days?: number
          locked_at?: string | null
          missing_dtr_count?: number
          overtime_hours?: number
          rejection_reason?: string | null
          submitted_at?: string | null
          total_days_submitted?: number
          total_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dtr_cutoff_submissions_cutoff_id_fkey"
            columns: ["cutoff_id"]
            isOneToOne: false
            referencedRelation: "payroll_cutoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subs_employee_profile_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_nodes: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          is_dept_head: boolean
          parent_id: string | null
          position_x: number
          position_y: number
          team_label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          is_dept_head?: boolean
          parent_id?: string | null
          position_x?: number
          position_y?: number
          team_label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          is_dept_head?: boolean
          parent_id?: string | null
          position_x?: number
          position_y?: number
          team_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_nodes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "org_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      ot_approval_requests: {
        Row: {
          created_at: string
          dh_approver_id: string | null
          dh_decided_at: string | null
          dh_notes: string | null
          dtr_id: string
          employee_id: string
          id: string
          is_approver_id: string | null
          is_decided_at: string | null
          is_notes: string | null
          requested_hours: number
          status: string
          step: string
          work_date: string
        }
        Insert: {
          created_at?: string
          dh_approver_id?: string | null
          dh_decided_at?: string | null
          dh_notes?: string | null
          dtr_id: string
          employee_id: string
          id?: string
          is_approver_id?: string | null
          is_decided_at?: string | null
          is_notes?: string | null
          requested_hours: number
          status?: string
          step?: string
          work_date: string
        }
        Update: {
          created_at?: string
          dh_approver_id?: string | null
          dh_decided_at?: string | null
          dh_notes?: string | null
          dtr_id?: string
          employee_id?: string
          id?: string
          is_approver_id?: string | null
          is_decided_at?: string | null
          is_notes?: string | null
          requested_hours?: number
          status?: string
          step?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ot_approval_requests_dtr_id_fkey"
            columns: ["dtr_id"]
            isOneToOne: false
            referencedRelation: "daily_time_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_approval_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          employee_id: string
          end_date: string
          id: string
          leave_type: string
          reason: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["leave_request_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          end_date: string
          id?: string
          leave_type: string
          reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["leave_request_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["leave_request_status"]
          updated_at?: string
        }
        Relationships: []
      }
      payroll_cutoffs: {
        Row: {
          created_at: string
          cutoff_name: string
          end_date: string
          id: string
          payout_date: string | null
          start_date: string
          status: Database["public"]["Enums"]["cutoff_status"]
        }
        Insert: {
          created_at?: string
          cutoff_name: string
          end_date: string
          id?: string
          payout_date?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["cutoff_status"]
        }
        Update: {
          created_at?: string
          cutoff_name?: string
          end_date?: string
          id?: string
          payout_date?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["cutoff_status"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          department: string
          email: string | null
          employee_code: string | null
          full_name: string
          id: string
          position: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          department?: string
          email?: string | null
          employee_code?: string | null
          full_name?: string
          id: string
          position?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string
          email?: string | null
          employee_code?: string | null
          full_name?: string
          id?: string
          position?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      find_cutoff_for_date: { Args: { _d: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_hr_or_admin: { Args: { _user_id: string }; Returns: boolean }
      recalc_cutoff_submission: {
        Args: { _cutoff: string; _employee: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "employee" | "hr" | "admin"
      approval_action:
        | "submitted"
        | "approved"
        | "rejected"
        | "needs_correction"
        | "unlocked"
        | "resubmitted"
      cutoff_status: "open" | "closed" | "paid"
      dtr_approval_status:
        | "draft"
        | "submitted"
        | "pending_approval"
        | "approved"
        | "rejected"
        | "needs_correction"
      leave_request_status: "pending" | "approved" | "rejected" | "cancelled"
      ot_approval_status: "pending" | "approved" | "rejected"
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

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["employee", "hr", "admin"],
      approval_action: [
        "submitted",
        "approved",
        "rejected",
        "needs_correction",
        "unlocked",
        "resubmitted",
      ],
      cutoff_status: ["open", "closed", "paid"],
      dtr_approval_status: [
        "draft",
        "submitted",
        "pending_approval",
        "approved",
        "rejected",
        "needs_correction",
      ],
      leave_request_status: ["pending", "approved", "rejected", "cancelled"],
      ot_approval_status: ["pending", "approved", "rejected"],
    },
  },
} as const

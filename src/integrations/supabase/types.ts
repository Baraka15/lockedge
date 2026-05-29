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
      agent_commands: {
        Row: {
          command: string
          created_at: string
          created_by: string | null
          executed_at: string | null
          id: string
          payload: Json
          status: string
        }
        Insert: {
          command: string
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          id?: string
          payload?: Json
          status?: string
        }
        Update: {
          command?: string
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          id?: string
          payload?: Json
          status?: string
        }
        Relationships: []
      }
      agent_status: {
        Row: {
          agent_id: string
          last_heartbeat: string
          metadata: Json
          status: string
          version: string | null
        }
        Insert: {
          agent_id?: string
          last_heartbeat?: string
          metadata?: Json
          status: string
          version?: string | null
        }
        Update: {
          agent_id?: string
          last_heartbeat?: string
          metadata?: Json
          status?: string
          version?: string | null
        }
        Relationships: []
      }
      arbs: {
        Row: {
          created_at: string
          dedup_key: string
          detected_at: string
          event_name: string
          expires_at: string
          id: string
          is_acknowledged: boolean
          market_type: string
          outcomes: Json
          required_total_stake: number
          total_arb_percent: number
        }
        Insert: {
          created_at?: string
          dedup_key: string
          detected_at?: string
          event_name: string
          expires_at?: string
          id?: string
          is_acknowledged?: boolean
          market_type: string
          outcomes: Json
          required_total_stake: number
          total_arb_percent: number
        }
        Update: {
          created_at?: string
          dedup_key?: string
          detected_at?: string
          event_name?: string
          expires_at?: string
          id?: string
          is_acknowledged?: boolean
          market_type?: string
          outcomes?: Json
          required_total_stake?: number
          total_arb_percent?: number
        }
        Relationships: []
      }
      balances: {
        Row: {
          account_label: string
          balance: number
          bookmaker: string
          last_updated: string
          pending_returns: number
        }
        Insert: {
          account_label: string
          balance?: number
          bookmaker: string
          last_updated?: string
          pending_returns?: number
        }
        Update: {
          account_label?: string
          balance?: number
          bookmaker?: string
          last_updated?: string
          pending_returns?: number
        }
        Relationships: []
      }
      bet_logs: {
        Row: {
          account_label: string
          arb_id: string | null
          bet_type: string
          bookmaker: string
          details: Json
          id: string
          logged_at: string
          odds: number | null
          outcome: string
          result: string | null
          stake: number | null
        }
        Insert: {
          account_label: string
          arb_id?: string | null
          bet_type: string
          bookmaker: string
          details?: Json
          id?: string
          logged_at?: string
          odds?: number | null
          outcome: string
          result?: string | null
          stake?: number | null
        }
        Update: {
          account_label?: string
          arb_id?: string | null
          bet_type?: string
          bookmaker?: string
          details?: Json
          id?: string
          logged_at?: string
          odds?: number | null
          outcome?: string
          result?: string | null
          stake?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bet_logs_arb_id_fkey"
            columns: ["arb_id"]
            isOneToOne: false
            referencedRelation: "arbs"
            referencedColumns: ["id"]
          },
        ]
      }
      bookmaker_accounts: {
        Row: {
          bookmaker: string
          created_at: string
          id: string
          is_active: boolean
          label: string | null
        }
        Insert: {
          bookmaker: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
        }
        Update: {
          bookmaker?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
        }
        Relationships: []
      }
      engine_runs: {
        Row: {
          arbs_detected: number
          duration_ms: number
          error: string | null
          id: number
          providers: string[]
          ran_at: string
        }
        Insert: {
          arbs_detected?: number
          duration_ms?: number
          error?: string | null
          id?: number
          providers?: string[]
          ran_at?: string
        }
        Update: {
          arbs_detected?: number
          duration_ms?: number
          error?: string | null
          id?: number
          providers?: string[]
          ran_at?: string
        }
        Relationships: []
      }
      master_fixtures: {
        Row: {
          away_team: string
          created_at: string
          event_date: string
          external_ids: Json
          home_team: string
          id: string
          sport: string
        }
        Insert: {
          away_team: string
          created_at?: string
          event_date: string
          external_ids?: Json
          home_team: string
          id?: string
          sport: string
        }
        Update: {
          away_team?: string
          created_at?: string
          event_date?: string
          external_ids?: Json
          home_team?: string
          id?: string
          sport?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

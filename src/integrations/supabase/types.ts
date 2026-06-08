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
      bet_sessions: {
        Row: {
          arb_id: string | null
          created_at: string
          failed_legs: number
          hedge_details: Json | null
          id: string
          notes: string | null
          placed_legs: number
          status: string
          total_legs: number
          updated_at: string
        }
        Insert: {
          arb_id?: string | null
          created_at?: string
          failed_legs?: number
          hedge_details?: Json | null
          id?: string
          notes?: string | null
          placed_legs?: number
          status?: string
          total_legs?: number
          updated_at?: string
        }
        Update: {
          arb_id?: string | null
          created_at?: string
          failed_legs?: number
          hedge_details?: Json | null
          id?: string
          notes?: string | null
          placed_legs?: number
          status?: string
          total_legs?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_sessions_arb_id_fkey"
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
      live_events: {
        Row: {
          bookmaker_count: number
          event_date: string
          event_key: string
          event_name: string
          market_type: string
          outcomes: Json
          sport: string
          updated_at: string
        }
        Insert: {
          bookmaker_count?: number
          event_date: string
          event_key: string
          event_name: string
          market_type: string
          outcomes?: Json
          sport: string
          updated_at?: string
        }
        Update: {
          bookmaker_count?: number
          event_date?: string
          event_key?: string
          event_name?: string
          market_type?: string
          outcomes?: Json
          sport?: string
          updated_at?: string
        }
        Relationships: []
      }
      master_fixtures: {
        Row: {
          away_team: string
          commenced_at: string | null
          created_at: string
          event_date: string
          external_ids: Json
          home_team: string
          id: string
          is_completed: boolean
          sport: string
        }
        Insert: {
          away_team: string
          commenced_at?: string | null
          created_at?: string
          event_date: string
          external_ids?: Json
          home_team: string
          id?: string
          is_completed?: boolean
          sport: string
        }
        Update: {
          away_team?: string
          commenced_at?: string | null
          created_at?: string
          event_date?: string
          external_ids?: Json
          home_team?: string
          id?: string
          is_completed?: boolean
          sport?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          error: string | null
          id: string
          kind: string
          payload: Json | null
          sent_at: string | null
          status: string
          title: string | null
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          payload?: Json | null
          sent_at?: string | null
          status?: string
          title?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          payload?: Json | null
          sent_at?: string | null
          status?: string
          title?: string | null
        }
        Relationships: []
      }
      risk_settings: {
        Row: {
          account_label: string
          auto_stake_enabled: boolean
          bankroll: number
          kelly_fraction: number
          max_odds_drift_pct: number
          max_stake_abs: number
          max_stake_pct: number
          min_edge_pct: number
          min_stake_abs: number
          notify_enabled: boolean
          notify_min_edge_pct: number
          telegram_chat_id: string | null
          updated_at: string
        }
        Insert: {
          account_label: string
          auto_stake_enabled?: boolean
          bankroll?: number
          kelly_fraction?: number
          max_odds_drift_pct?: number
          max_stake_abs?: number
          max_stake_pct?: number
          min_edge_pct?: number
          min_stake_abs?: number
          notify_enabled?: boolean
          notify_min_edge_pct?: number
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Update: {
          account_label?: string
          auto_stake_enabled?: boolean
          bankroll?: number
          kelly_fraction?: number
          max_odds_drift_pct?: number
          max_stake_abs?: number
          max_stake_pct?: number
          min_edge_pct?: number
          min_stake_abs?: number
          notify_enabled?: boolean
          notify_min_edge_pct?: number
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      settlements: {
        Row: {
          arb_id: string | null
          away_score: number | null
          created_at: string
          event_name: string | null
          home_score: number | null
          id: string
          match_date: string | null
          profit: number
          settled_at: string
          total_returned: number
          total_staked: number
          winning_outcome: string | null
        }
        Insert: {
          arb_id?: string | null
          away_score?: number | null
          created_at?: string
          event_name?: string | null
          home_score?: number | null
          id?: string
          match_date?: string | null
          profit?: number
          settled_at?: string
          total_returned?: number
          total_staked?: number
          winning_outcome?: string | null
        }
        Update: {
          arb_id?: string | null
          away_score?: number | null
          created_at?: string
          event_name?: string | null
          home_score?: number | null
          id?: string
          match_date?: string | null
          profit?: number
          settled_at?: string
          total_returned?: number
          total_staked?: number
          winning_outcome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_arb_id_fkey"
            columns: ["arb_id"]
            isOneToOne: false
            referencedRelation: "arbs"
            referencedColumns: ["id"]
          },
        ]
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

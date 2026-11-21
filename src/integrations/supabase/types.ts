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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          agent_id: string
          broker: string
          created_at: string
          currency: string
          cushion: number
          equity: number
          floor: number
          high_water_mark: number
          id: string
          owner_id: string
          realized_pnl: number
          starting_equity: number
          unrealized_pnl: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          broker?: string
          created_at?: string
          currency?: string
          cushion: number
          equity: number
          floor: number
          high_water_mark: number
          id?: string
          owner_id?: string
          realized_pnl?: number
          starting_equity: number
          unrealized_pnl?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          broker?: string
          created_at?: string
          currency?: string
          cushion?: number
          equity?: number
          floor?: number
          high_water_mark?: number
          id?: string
          owner_id?: string
          realized_pnl?: number
          starting_equity?: number
          unrealized_pnl?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          book_sources: string[]
          budget_pct: number
          code: string
          created_at: string
          description: string
          edge_source: string
          id: string
          market: string
          name: string
          owner_id: string
          params: Json
          status: string
          updated_at: string
        }
        Insert: {
          book_sources?: string[]
          budget_pct?: number
          code: string
          created_at?: string
          description?: string
          edge_source?: string
          id?: string
          market: string
          name: string
          owner_id?: string
          params?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          book_sources?: string[]
          budget_pct?: number
          code?: string
          created_at?: string
          description?: string
          edge_source?: string
          id?: string
          market?: string
          name?: string
          owner_id?: string
          params?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor: string
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          owner_id: string
          ts: string
          updated_at: string
        }
        Insert: {
          action: string
          actor: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          owner_id?: string
          ts?: string
          updated_at?: string
        }
        Update: {
          action?: string
          actor?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          owner_id?: string
          ts?: string
          updated_at?: string
        }
        Relationships: []
      }
      equity_snapshots: {
        Row: {
          account_id: string | null
          created_at: string
          cushion: number
          equity: number
          gold_exposure: number
          high_water_mark: number
          id: string
          open_risk: number
          owner_id: string
          ts: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          cushion: number
          equity: number
          gold_exposure: number
          high_water_mark: number
          id?: string
          open_risk: number
          owner_id?: string
          ts: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          cushion?: number
          equity?: number
          gold_exposure?: number
          high_water_mark?: number
          id?: string
          open_risk?: number
          owner_id?: string
          ts?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equity_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_events: {
        Row: {
          agent_code: string
          check: string
          client_order_id: string
          created_at: string
          detail: Json
          id: string
          occurred_at: string
          order_id: string | null
          owner_id: string
          result: string
          seq: number
          updated_at: string
        }
        Insert: {
          agent_code: string
          check: string
          client_order_id: string
          created_at?: string
          detail?: Json
          id?: string
          occurred_at: string
          order_id?: string | null
          owner_id?: string
          result: string
          seq: number
          updated_at?: string
        }
        Update: {
          agent_code?: string
          check?: string
          client_order_id?: string
          created_at?: string
          detail?: Json
          id?: string
          occurred_at?: string
          order_id?: string | null
          owner_id?: string
          result?: string
          seq?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      monte_carlo_runs: {
        Row: {
          agent_id: string | null
          avg_loss_pct: number
          avg_win_pct: number
          created_at: string
          finished_at: string | null
          id: string
          median_max_dd_pct: number | null
          n_runs: number
          n_trades: number
          owner_id: string
          p_losing_month: number | null
          p95_max_dd_pct: number | null
          p99_max_dd_pct: number | null
          results: Json
          seed: number
          tail_scenario: string
          updated_at: string
          win_rate: number
        }
        Insert: {
          agent_id?: string | null
          avg_loss_pct: number
          avg_win_pct: number
          created_at?: string
          finished_at?: string | null
          id?: string
          median_max_dd_pct?: number | null
          n_runs: number
          n_trades: number
          owner_id?: string
          p_losing_month?: number | null
          p95_max_dd_pct?: number | null
          p99_max_dd_pct?: number | null
          results?: Json
          seed: number
          tail_scenario: string
          updated_at?: string
          win_rate: number
        }
        Update: {
          agent_id?: string | null
          avg_loss_pct?: number
          avg_win_pct?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          median_max_dd_pct?: number | null
          n_runs?: number
          n_trades?: number
          owner_id?: string
          p_losing_month?: number | null
          p95_max_dd_pct?: number | null
          p99_max_dd_pct?: number | null
          results?: Json
          seed?: number
          tail_scenario?: string
          updated_at?: string
          win_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "monte_carlo_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_settings: {
        Row: {
          created_at: string
          density: string
          id: string
          kill_armed: boolean
          kill_policy: string
          live_adapter: Json
          mt5_token_hash: string | null
          overseer_use_llm: boolean
          owner_id: string
          risk_limits: Json
          sim_seed: number
          theme: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          density?: string
          id?: string
          kill_armed?: boolean
          kill_policy?: string
          live_adapter?: Json
          mt5_token_hash?: string | null
          overseer_use_llm?: boolean
          owner_id?: string
          risk_limits?: Json
          sim_seed?: number
          theme?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          density?: string
          id?: string
          kill_armed?: boolean
          kill_policy?: string
          live_adapter?: Json
          mt5_token_hash?: string | null
          overseer_use_llm?: boolean
          owner_id?: string
          risk_limits?: Json
          sim_seed?: number
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          account_id: string
          agent_id: string
          arrival_mid: number | null
          client_order_id: string
          created_at: string
          decision_px: number | null
          expires_at: string | null
          fill_px: number | null
          filled_at: string | null
          filled_qty: number | null
          horizon_px: number | null
          id: string
          limit_px: number | null
          owner_id: string
          qty: number
          reject_reason: string | null
          side: string
          spread_at_submit: number | null
          state: string
          stop_px: number | null
          submitted_at: string
          symbol: string
          target_px: number | null
          tif: string
          type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          agent_id: string
          arrival_mid?: number | null
          client_order_id: string
          created_at?: string
          decision_px?: number | null
          expires_at?: string | null
          fill_px?: number | null
          filled_at?: string | null
          filled_qty?: number | null
          horizon_px?: number | null
          id?: string
          limit_px?: number | null
          owner_id?: string
          qty: number
          reject_reason?: string | null
          side: string
          spread_at_submit?: number | null
          state: string
          stop_px?: number | null
          submitted_at: string
          symbol: string
          target_px?: number | null
          tif?: string
          type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          agent_id?: string
          arrival_mid?: number | null
          client_order_id?: string
          created_at?: string
          decision_px?: number | null
          expires_at?: string | null
          fill_px?: number | null
          filled_at?: string | null
          filled_qty?: number | null
          horizon_px?: number | null
          id?: string
          limit_px?: number | null
          owner_id?: string
          qty?: number
          reject_reason?: string | null
          side?: string
          spread_at_submit?: number | null
          state?: string
          stop_px?: number | null
          submitted_at?: string
          symbol?: string
          target_px?: number | null
          tif?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      overseer_decisions: {
        Row: {
          agent_id: string | null
          applied: boolean
          audit_id: string | null
          created_at: string
          decision: Json
          id: string
          input: Json
          model: string
          owner_id: string
          ts: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          applied?: boolean
          audit_id?: string | null
          created_at?: string
          decision: Json
          id?: string
          input: Json
          model: string
          owner_id?: string
          ts?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          applied?: boolean
          audit_id?: string | null
          created_at?: string
          decision?: Json
          id?: string
          input?: Json
          model?: string
          owner_id?: string
          ts?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "overseer_decisions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          account_id: string
          agent_id: string
          created_at: string
          entry_px: number
          id: string
          opened_at: string
          owner_id: string
          qty: number
          risk_at_stop: number
          side: string
          status: string
          stop_px: number
          symbol: string
          target_px: number | null
          time_stop_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          agent_id: string
          created_at?: string
          entry_px: number
          id?: string
          opened_at: string
          owner_id?: string
          qty: number
          risk_at_stop: number
          side: string
          status?: string
          stop_px: number
          symbol: string
          target_px?: number | null
          time_stop_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          agent_id?: string
          created_at?: string
          entry_px?: number
          id?: string
          opened_at?: string
          owner_id?: string
          qty?: number
          risk_at_stop?: number
          side?: string
          status?: string
          stop_px?: number
          symbol?: string
          target_px?: number | null
          time_stop_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      price_data: {
        Row: {
          ask: number
          bid: number
          created_at: string
          dataset: string
          id: string
          owner_id: string
          symbol: string
          ts: string
          updated_at: string
        }
        Insert: {
          ask: number
          bid: number
          created_at?: string
          dataset: string
          id?: string
          owner_id?: string
          symbol?: string
          ts: string
          updated_at?: string
        }
        Update: {
          ask?: number
          bid?: number
          created_at?: string
          dataset?: string
          id?: string
          owner_id?: string
          symbol?: string
          ts?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_cards: {
        Row: {
          agent_id: string
          alpha_vs_gold: number | null
          best_month_pct: number | null
          budget_after_pct: number | null
          cost_split: Json
          created_at: string
          dd_duration_days: number | null
          dd_recovery_days: number | null
          id: string
          kurtosis: number | null
          max_dd_pct: number | null
          owner_id: string
          pct_positive_months: number | null
          period_end: string
          period_start: string
          return_pct: number | null
          skew: number | null
          updated_at: string
          var_95_pct: number | null
          volatility_pct: number | null
          worst_month_pct: number | null
          z_score: number | null
        }
        Insert: {
          agent_id: string
          alpha_vs_gold?: number | null
          best_month_pct?: number | null
          budget_after_pct?: number | null
          cost_split?: Json
          created_at?: string
          dd_duration_days?: number | null
          dd_recovery_days?: number | null
          id?: string
          kurtosis?: number | null
          max_dd_pct?: number | null
          owner_id?: string
          pct_positive_months?: number | null
          period_end: string
          period_start: string
          return_pct?: number | null
          skew?: number | null
          updated_at?: string
          var_95_pct?: number | null
          volatility_pct?: number | null
          worst_month_pct?: number | null
          z_score?: number | null
        }
        Update: {
          agent_id?: string
          alpha_vs_gold?: number | null
          best_month_pct?: number | null
          budget_after_pct?: number | null
          cost_split?: Json
          created_at?: string
          dd_duration_days?: number | null
          dd_recovery_days?: number | null
          id?: string
          kurtosis?: number | null
          max_dd_pct?: number | null
          owner_id?: string
          pct_positive_months?: number | null
          period_end?: string
          period_start?: string
          return_pct?: number | null
          skew?: number | null
          updated_at?: string
          var_95_pct?: number | null
          volatility_pct?: number | null
          worst_month_pct?: number | null
          z_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_cards_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          account_id: string
          agent_id: string
          arrival_mid: number | null
          client_order_id: string | null
          closed_at: string
          commission_cost: number
          created_at: string
          decision_px: number | null
          delay_cost: number
          entry_px: number
          execution_cost: number
          exit_px: number
          exit_reason: string
          gross_pnl: number
          hold_seconds: number
          horizon_px: number | null
          id: string
          mae_px: number | null
          mfe_px: number | null
          missed_fill_cost: number
          net_pnl: number
          opened_at: string
          order_id: string | null
          owner_id: string
          qty: number
          r_multiple: number
          side: string
          slippage_cost: number
          spread_cost: number
          stop_px: number
          swap_cost: number
          symbol: string
          target_px: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          agent_id: string
          arrival_mid?: number | null
          client_order_id?: string | null
          closed_at: string
          commission_cost: number
          created_at?: string
          decision_px?: number | null
          delay_cost?: number
          entry_px: number
          execution_cost?: number
          exit_px: number
          exit_reason: string
          gross_pnl: number
          hold_seconds: number
          horizon_px?: number | null
          id?: string
          mae_px?: number | null
          mfe_px?: number | null
          missed_fill_cost?: number
          net_pnl: number
          opened_at: string
          order_id?: string | null
          owner_id?: string
          qty: number
          r_multiple: number
          side: string
          slippage_cost: number
          spread_cost: number
          stop_px: number
          swap_cost: number
          symbol: string
          target_px?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          agent_id?: string
          arrival_mid?: number | null
          client_order_id?: string | null
          closed_at?: string
          commission_cost?: number
          created_at?: string
          decision_px?: number | null
          delay_cost?: number
          entry_px?: number
          execution_cost?: number
          exit_px?: number
          exit_reason?: string
          gross_pnl?: number
          hold_seconds?: number
          horizon_px?: number | null
          id?: string
          mae_px?: number | null
          mfe_px?: number | null
          missed_fill_cost?: number
          net_pnl?: number
          opened_at?: string
          order_id?: string | null
          owner_id?: string
          qty?: number
          r_multiple?: number
          side?: string
          slippage_cost?: number
          spread_cost?: number
          stop_px?: number
          swap_cost?: number
          symbol?: string
          target_px?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_steps: {
        Row: {
          agent_id: string
          artifact_hash: string | null
          created_at: string
          evidence: Json
          id: string
          name: string
          owner_id: string
          signed_at: string | null
          signed_by: string | null
          status: string
          step: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          artifact_hash?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          name: string
          owner_id?: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          step: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          artifact_hash?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          name?: string
          owner_id?: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          step?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_steps_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_my_workspace: { Args: never; Returns: undefined }
      reset_my_workspace: { Args: { _seed: number }; Returns: undefined }
      seed_operator_workspace: {
        Args: { _seed?: number; _uid: string }
        Returns: undefined
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

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
		PostgrestVersion: '14.5'
	}
	public: {
		Tables: {
			friend_requests: {
				Row: {
					created_at: string
					id: string
					receiver_id: string
					sender_id: string
					status: Database['public']['Enums']['friend_request_status']
					updated_at: string
				}
				Insert: {
					created_at?: string
					id?: string
					receiver_id: string
					sender_id: string
					status?: Database['public']['Enums']['friend_request_status']
					updated_at?: string
				}
				Update: {
					created_at?: string
					id?: string
					receiver_id?: string
					sender_id?: string
					status?: Database['public']['Enums']['friend_request_status']
					updated_at?: string
				}
				Relationships: [
					{
						foreignKeyName: 'friend_requests_receiver_profiles_fkey'
						columns: ['receiver_id']
						isOneToOne: false
						referencedRelation: 'profiles'
						referencedColumns: ['id']
					},
					{
						foreignKeyName: 'friend_requests_sender_profiles_fkey'
						columns: ['sender_id']
						isOneToOne: false
						referencedRelation: 'profiles'
						referencedColumns: ['id']
					},
				]
			}
			friends: {
				Row: {
					time_added: string
					user_id_a: string
					user_id_b: string
				}
				Insert: {
					time_added?: string
					user_id_a: string
					user_id_b: string
				}
				Update: {
					time_added?: string
					user_id_a?: string
					user_id_b?: string
				}
				Relationships: [
					{
						foreignKeyName: 'friends_user_id_a_profiles_fkey'
						columns: ['user_id_a']
						isOneToOne: false
						referencedRelation: 'profiles'
						referencedColumns: ['id']
					},
					{
						foreignKeyName: 'friends_user_id_b_profiles_fkey'
						columns: ['user_id_b']
						isOneToOne: false
						referencedRelation: 'profiles'
						referencedColumns: ['id']
					},
				]
			}
			game_requests: {
				Row: {
					created_at: string
					id: string
					invited: Json
					proposer: string
				}
				Insert: {
					created_at?: string
					id?: string
					invited: Json
					proposer: string
				}
				Update: {
					created_at?: string
					id?: string
					invited?: Json
					proposer?: string
				}
				Relationships: [
					{
						foreignKeyName: 'game_requests_proposer_profiles_fkey'
						columns: ['proposer']
						isOneToOne: false
						referencedRelation: 'profiles'
						referencedColumns: ['id']
					},
				]
			}
			game_states: {
				Row: {
					edges: Json
					game_id: string
					hexes: Json
					phase: Json
					players: Json
					updated_at: string
					variant: string
					vertices: Json
				}
				Insert: {
					edges?: Json
					game_id: string
					hexes: Json
					phase: Json
					players: Json
					updated_at?: string
					variant: string
					vertices?: Json
				}
				Update: {
					edges?: Json
					game_id?: string
					hexes?: Json
					phase?: Json
					players?: Json
					updated_at?: string
					variant?: string
					vertices?: Json
				}
				Relationships: [
					{
						foreignKeyName: 'game_states_game_id_fkey'
						columns: ['game_id']
						isOneToOne: true
						referencedRelation: 'games'
						referencedColumns: ['id']
					},
				]
			}
			games: {
				Row: {
					created_at: string
					current_turn: number | null
					events: Json[]
					id: string
					participants: string[]
					player_order: string[]
					status: string
					winner: number | null
				}
				Insert: {
					created_at?: string
					current_turn?: number | null
					events?: Json[]
					id?: string
					participants: string[]
					player_order?: string[]
					status?: string
					winner?: number | null
				}
				Update: {
					created_at?: string
					current_turn?: number | null
					events?: Json[]
					id?: string
					participants?: string[]
					player_order?: string[]
					status?: string
					winner?: number | null
				}
				Relationships: []
			}
			profiles: {
				Row: {
					avatar_path: string | null
					created_at: string
					dev: boolean
					id: string
					updated_at: string
					username: string
				}
				Insert: {
					avatar_path?: string | null
					created_at?: string
					dev?: boolean
					id: string
					updated_at?: string
					username: string
				}
				Update: {
					avatar_path?: string | null
					created_at?: string
					dev?: boolean
					id?: string
					updated_at?: string
					username?: string
				}
				Relationships: []
			}
		}
		Views: {
			[_ in never]: never
		}
		Functions: {
			accept_friend_request: {
				Args: { request_id: string }
				Returns: undefined
			}
			propose_game: {
				Args: { invited_user_ids: string[] }
				Returns: string
			}
		}
		Enums: {
			friend_request_status: 'pending' | 'accepted' | 'rejected'
		}
		CompositeTypes: {
			[_ in never]: never
		}
	}
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals
}
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
			Row: infer R
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
				DefaultSchema['Views'])
		? (DefaultSchema['Tables'] &
				DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R
			}
			? R
			: never
		: never

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema['Tables']
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Insert: infer I
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
		? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I
			}
			? I
			: never
		: never

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema['Tables']
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Update: infer U
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
		? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U
			}
			? U
			: never
		: never

export type Enums<
	DefaultSchemaEnumNameOrOptions extends
		| keyof DefaultSchema['Enums']
		| { schema: keyof DatabaseWithoutInternals },
	EnumName extends DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
		: never = never,
> = DefaultSchemaEnumNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals
}
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
		? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
		: never

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		| keyof DefaultSchema['CompositeTypes']
		| { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
		: never = never,
> = PublicCompositeTypeNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals
}
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
		? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
		: never

export const Constants = {
	public: {
		Enums: {
			friend_request_status: ['pending', 'accepted', 'rejected'],
		},
	},
} as const

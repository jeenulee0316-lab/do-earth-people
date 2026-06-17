// ════════════════════════════════════════════════════════════════
// 🗂️ Supabase 데이터베이스 타입 (전역)
// ────────────────────────────────────────────────────────────────
// 📚 비전공자 팀원을 위한 1분 설명:
//   이 파일은 우리 Supabase DB의 "표(테이블) 모양"을 TypeScript에게
//   알려주는 설명서예요. 여기에 컬럼을 정확히 적어두면,
//   supabase.from('items')... 같은 코드를 쓸 때 에디터가 컬럼 이름을
//   자동완성해 주고, 오타나 잘못된 타입을 미리 잡아줍니다.
//
//   ⚠️ DB(SQL Editor)에서 테이블/컬럼을 바꾸면, 이 파일도 똑같이
//      맞춰서 고쳐줘야 타입이 어긋나지 않아요.
//
//   각 테이블은 보통 세 가지 모양을 가집니다:
//     - Row    : 조회(select)했을 때 돌아오는 한 줄의 모양
//     - Insert : 새로 넣을 때(insert) 넣어야/넣을 수 있는 값들
//     - Update : 일부만 고칠 때(update) 바꿀 수 있는 값들
// ════════════════════════════════════════════════════════════════

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      // ── 🎁 Welcome Kit(웰컴 키트) 패키지 테이블 ──────────────────
      //   운영팀이 여러 물품을 하나의 "키트"로 묶어 큐레이션하는 단위.
      kits: {
        Row: {
          id: string
          name: string
          description: string | null
          thumbnail_url: string | null
          status: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          thumbnail_url?: string | null
          status?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          thumbnail_url?: string | null
          status?: string | null
          created_at?: string
        }
        Relationships: []
      }

      // ── 📦 물품(items) 테이블 ───────────────────────────────────
      //   순환되는 개별 물품. 이제 kit_id로 특정 웰컴 키트에 묶일 수 있어요.
      items: {
        Row: {
          id: string
          owner_id: string
          receiver_id: string | null
          title: string
          description: string | null
          category: string
          condition: string | null
          location: string | null
          price: number | null
          image_urls: string[] | null
          status: string
          // 🎁 이 물품이 속한 웰컴 키트의 id. 키트에 안 묶인 단품이면 null.
          kit_id: string | null
          pickup_date: string | null
          pickup_time_slot: string | null
          verification_code: string | null
          created_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          receiver_id?: string | null
          title: string
          description?: string | null
          category: string
          condition?: string | null
          location?: string | null
          price?: number | null
          image_urls?: string[] | null
          status?: string
          kit_id?: string | null
          pickup_date?: string | null
          pickup_time_slot?: string | null
          verification_code?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          receiver_id?: string | null
          title?: string
          description?: string | null
          category?: string
          condition?: string | null
          location?: string | null
          price?: number | null
          image_urls?: string[] | null
          status?: string
          kit_id?: string | null
          pickup_date?: string | null
          pickup_time_slot?: string | null
          verification_code?: string | null
          created_at?: string
        }
        // 🔗 items.kit_id → kits.id (외래 키 관계)
        Relationships: [
          {
            foreignKeyName: 'items_kit_id_fkey'
            columns: ['kit_id']
            isOneToOne: false
            referencedRelation: 'kits'
            referencedColumns: ['id']
          },
        ]
      }

      // ── 🔖 예약(reservations) 테이블 ────────────────────────────
      //   "어떤 물품이 이미 예약됐는가"를 items.id ← reservations.item_id 로 연결.
      reservations: {
        Row: {
          id: string
          item_id: string
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          item_id: string
          user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          item_id?: string
          user_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reservations_item_id_fkey'
            columns: ['item_id']
            isOneToOne: false
            referencedRelation: 'items'
            referencedColumns: ['id']
          },
        ]
      }

      // ── 👤 프로필(profiles) 테이블 ──────────────────────────────
      //   가입 시 DB 트리거로 자동 생성. 닉네임 등 사용자 부가 정보.
      profiles: {
        Row: {
          id: string
          nickname: string | null
          created_at: string
        }
        Insert: {
          id: string
          nickname?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          nickname?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

// ── 편의 타입 별칭 ───────────────────────────────────────────────
// 컴포넌트에서 `Tables<'kits'>` 처럼 짧게 한 줄의 모양을 가져다 쓰세요.
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

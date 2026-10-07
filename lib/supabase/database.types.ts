// Hand-written to match models-spec.md exactly — there's no `supabase gen types`
// step in this project (see plan.md's Phase 0 note on skipping the CLI entirely),
// so this is the one place that has to be kept in sync by hand whenever the schema
// changes. Passed as createClient<Database>()'s generic (lib/supabase/adminClient.ts)
// so every table read/write across the app is checked against real column names
// instead of silently collapsing to `never` (supabase-js's default-generic quirk).
//
// jsonb columns are typed as `Json` here, same as `supabase gen types` would do —
// callers cast to the real app-level shape (AnnotationRange[], TocSection[], etc.,
// both defined in api-spec.md) on read, and rely on structural compatibility with
// `Json` on write. Nothing here should leak into JSON API responses verbatim; that
// snake_case -> camelCase translation is the route handler's job (api-spec.md's
// Conventions).
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string; updated_at: string };

export type Database = {
  public: {
    Tables: {
      readers: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          pseudonym: string;
          city: string | null;
          country: string | null;
          interests: Json;
          survey_read_material_ids: Json;
          age_range: "13_17" | "18_24" | "25_34" | "35_44" | "45_54" | "55_64" | "65_plus" | null;
          gender_identity: string | null;
          onboarding_status: "pending_survey" | "pending_welcome" | "active";
          avatar_color: string | null;
          avatar_url: string | null;
          email_announcements: boolean;
          upload_approved: boolean;
          joined_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          pseudonym: string;
          city?: string | null;
          country?: string | null;
          interests?: Json;
          survey_read_material_ids?: Json;
          age_range?: "13_17" | "18_24" | "25_34" | "35_44" | "45_54" | "55_64" | "65_plus" | null;
          gender_identity?: string | null;
          onboarding_status?: "pending_survey" | "pending_welcome" | "active";
          avatar_color?: string | null;
          avatar_url?: string | null;
          email_announcements?: boolean;
          upload_approved?: boolean;
          joined_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["readers"]["Insert"]>;
        Relationships: [];
      };
      pending_materials: {
        Row: {
          id: string;
          submission_type: "upload" | "suggestion" | "external_url";
          title: string;
          author: string | null;
          reader_id: string | null;
          source_url: string | null;
          storage_path: string | null;
          original_filename: string | null;
          mime_type: string | null;
          file_size_bytes: number | null;
          status: "pending" | "approved";
          material_id: string | null;
        } & Timestamps;
        Insert: {
          id?: string;
          submission_type: "upload" | "suggestion" | "external_url";
          title: string;
          author?: string | null;
          reader_id?: string | null;
          source_url?: string | null;
          storage_path?: string | null;
          original_filename?: string | null;
          mime_type?: string | null;
          file_size_bytes?: number | null;
          status?: "pending" | "approved";
          material_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["pending_materials"]["Insert"]>;
        Relationships: [];
      };
      materials: {
        Row: {
          id: string;
          slug: string;
          material_type: string;
          title: string;
          author: string;
          description: string | null;
          cover_url: string | null;
          thumbnail_url: string | null;
          /** { googleBooksId, isbn, coverUrl, thumbnailUrl, description } — see
           * scripts/generate-material-google-metadata.ts and lib/materials/providerMeta.ts. */
          google_meta_data: Json | null;
          /** { coverUrl, thumbnailUrl, description } — see
           * scripts/generate-material-openlibrary-metadata.ts. */
          openlibrary_meta_data: Json | null;
          /** Which of cover_url/thumbnail_url ("own"), openlibrary_meta_data, or
           * google_meta_data resolveBookCoverSrc/resolveBookThumbnailSrc
           * (lib/materials/image.ts) tries first — see migrations/20260829_materials_cover_source.sql. */
          cover_source: "own" | "openlibrary" | "google";
          language: string | null;
          published_year: number | null;
          page_count_estimate: number | null;
          categories: Json;
          narrator_count: number;
          toc: Json;
          toc_titles: string;
          spine: Json;
          json_storage_path: string | null;
          /** Readability-extracted article HTML for a `material_type: "webpage"`
           * row — see migrations/20260929_article_html_storage_path.sql. */
          article_html_storage_path: string | null;
          status: "draft" | "published";
          uploaded_by: string | null;
          visibility: "personal" | "public";
          source_url: string | null;
          search_vector: string | null;
          /** Appreciation ("heart") count from the shared public.reactions
           * table (target_type = 'material') — see
           * migrations/20260930_material_reactions.sql. Maintained by a
           * DB trigger, same pattern as posts.reaction_count. */
          reaction_count: number;
          /** Bytes of the primary stored object (source file, else parsed JSON,
           * else article HTML) — migrations/20261005_admin_dashboard.sql. */
          file_size_bytes: number | null;
        } & Timestamps;
        Insert: {
          id?: string;
          slug: string;
          material_type?: string;
          title: string;
          author: string;
          description?: string | null;
          cover_url?: string | null;
          thumbnail_url?: string | null;
          google_meta_data?: Json | null;
          openlibrary_meta_data?: Json | null;
          cover_source?: "own" | "openlibrary" | "google";
          language?: string | null;
          published_year?: number | null;
          page_count_estimate?: number | null;
          categories?: Json;
          narrator_count?: number;
          toc?: Json;
          toc_titles?: string;
          spine?: Json;
          json_storage_path?: string | null;
          article_html_storage_path?: string | null;
          status?: "draft" | "published";
          uploaded_by?: string | null;
          visibility?: "personal" | "public";
          source_url?: string | null;
          reaction_count?: number;
          file_size_bytes?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["materials"]["Insert"]>;
        Relationships: [];
      };
      highlights: {
        Row: {
          id: string;
          reader_id: string;
          material_id: string;
          ranges: Json;
        } & Timestamps;
        Insert: {
          id?: string;
          reader_id: string;
          material_id: string;
          ranges: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["highlights"]["Insert"]>;
        Relationships: [];
      };
      // One row per (reader, material) — replaces readers.current_reading (a jsonb
      // map) as of migrations/20260831_reader_activities.sql. "activities", not
      // "reading_positions": `mode` means this covers listening too.
      //
      // `locator` is format-agnostic (migrations/20261001_reader_activities_locator
      // .sql): typed `Json` here, same as every other jsonb column, and narrowed to
      // the real `Locator` union by lib/reader/locator.ts's own `isLocator` at the
      // read boundary rather than cast.
      reader_activities: {
        Row: {
          reader_id: string;
          material_id: string;
          locator: Json;
          mode: "read" | "listen";
          audio_time_ms: number | null;
          progress_percent: number;
          // Explicit completion — never inferable from progress_percent (see
          // migrations/20261002_reader_activities_finished_at.sql) and never written by the
          // position-save path.
          finished_at: string | null;
          updated_at: string;
        };
        Insert: {
          reader_id: string;
          material_id: string;
          locator: Json;
          mode: "read" | "listen";
          audio_time_ms?: number | null;
          progress_percent: number;
          finished_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reader_activities"]["Insert"]>;
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          reader_id: string;
          material_id: string;
          parent_id: string | null;
          replying_to_id: string | null;
          ranges: Json;
          content_kind: "text" | "voice";
          content_text: string | null;
          content_audio_url: string | null;
          content_audio_duration_ms: number | null;
          visibility: "public" | "private";
          reaction_count: number;
        } & Timestamps;
        Insert: {
          id?: string;
          reader_id: string;
          material_id: string;
          parent_id?: string | null;
          replying_to_id?: string | null;
          ranges: Json;
          content_kind: "text" | "voice";
          content_text?: string | null;
          content_audio_url?: string | null;
          content_audio_duration_ms?: number | null;
          visibility?: "public" | "private";
          reaction_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notes"]["Insert"]>;
        Relationships: [];
      };
      note_reactions: {
        Row: { note_id: string; reader_id: string; created_at: string };
        Insert: { note_id: string; reader_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["note_reactions"]["Insert"]>;
        Relationships: [];
      };
      topics: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          cover_url: string | null;
          source: "curated" | "user_created" | "legacy_migration";
          created_by: string | null;
          status: "active" | "pending" | "archived";
          follower_count: number;
          post_count: number;
        } & Timestamps;
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          cover_url?: string | null;
          source?: "curated" | "user_created" | "legacy_migration";
          created_by?: string | null;
          status?: "active" | "pending" | "archived";
          follower_count?: number;
          post_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["topics"]["Insert"]>;
        Relationships: [];
      };
      material_topics: {
        Row: { material_id: string; topic_id: string; created_at: string };
        Insert: { material_id: string; topic_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["material_topics"]["Insert"]>;
        Relationships: [];
      };
      // A post's topics beyond its required posts.topic_id "default" — see
      // migrations/20260927_post_topics.sql. created_at ordering is what
      // makes the first-inserted row the reader's chosen default.
      post_topics: {
        Row: { post_id: string; topic_id: string; created_at: string };
        Insert: { post_id: string; topic_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["post_topics"]["Insert"]>;
        Relationships: [];
      };
      // followable_type is constrained to 'topic' today (follows_topic_only,
      // migrations/20260919_topics_and_posts.sql) even though the column
      // already allows 'reader' for a future member-to-member follow graph.
      follows: {
        Row: {
          id: string;
          follower_id: string;
          followable_type: "topic" | "reader";
          followable_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          follower_id: string;
          followable_type: "topic" | "reader";
          followable_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["follows"]["Insert"]>;
        Relationships: [];
      };
      posts: {
        Row: {
          id: string;
          reader_id: string;
          topic_id: string;
          material_id: string | null;
          ranges: Json | null;
          parent_id: string | null;
          replying_to_id: string | null;
          thread_type: "note" | "discussion";
          kind: "citation" | "text" | "link" | "video" | "book_share" | "voice";
          content: Json;
          visibility: "public" | "private";
          reaction_count: number;
          reply_count: number;
        } & Timestamps;
        Insert: {
          id?: string;
          reader_id: string;
          topic_id: string;
          material_id?: string | null;
          ranges?: Json | null;
          parent_id?: string | null;
          replying_to_id?: string | null;
          thread_type?: "note" | "discussion";
          kind: "citation" | "text" | "link" | "video" | "book_share" | "voice";
          content: Json;
          visibility?: "public" | "private";
          reaction_count?: number;
          reply_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["posts"]["Insert"]>;
        Relationships: [];
      };
      reactions: {
        Row: { target_type: "post" | "material"; target_id: string; reader_id: string; created_at: string };
        Insert: {
          target_type: "post" | "material";
          target_id: string;
          reader_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reactions"]["Insert"]>;
        Relationships: [];
      };
      /** migrations/20261003_bookmarks.sql — reactions' private twin (same
       * polymorphic key shape). No Update: a bookmark has no mutable
       * column, it exists or it doesn't. */
      bookmarks: {
        Row: { target_type: "post" | "material"; target_id: string; reader_id: string; created_at: string };
        Insert: {
          target_type: "post" | "material";
          target_id: string;
          reader_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["bookmarks"]["Insert"]>;
        Relationships: [];
      };
      /** migrations/20261004_reader_active_days.sql — one row per reader per
       * UTC day they were active (`day` is a `date`, "YYYY-MM-DD"). */
      reader_active_days: {
        Row: { day: string; reader_id: string; read: boolean };
        Insert: { day: string; reader_id: string; read?: boolean };
        Update: Partial<Database["public"]["Tables"]["reader_active_days"]["Insert"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          reader_id: string | null;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          reader_id?: string | null;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
        Relationships: [];
      };
      push_broadcasts: {
        Row: {
          id: string;
          title: string;
          body: string;
          url: string;
          recipient_count: number;
          failure_count: number;
          channels: ("push" | "email")[];
          email_recipient_count: number;
          email_failure_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          body: string;
          url: string;
          recipient_count: number;
          failure_count?: number;
          channels?: ("push" | "email")[];
          email_recipient_count?: number;
          email_failure_count?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_broadcasts"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          reader_id: string;
          kind: "reaction" | "reply" | "broadcast" | "digest" | "material_reaction";
          title: string;
          body: string;
          url: string;
          read_at: string | null;
          // topic_id/digest_count/latest_post_id: migrations/20260919_topics_and_posts.sql.
          // digest_count/latest_post_id only meaningful for kind = 'digest'.
          topic_id: string | null;
          digest_count: number;
          latest_post_id: string | null;
          // actor_reader_id/snippet: migrations/20260919_notifications_actor_snippet.sql.
          // The actor is a live FK (its pseudonym is joined at read time);
          // snippet is the frozen text the notification was about.
          actor_reader_id: string | null;
          snippet: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          reader_id: string;
          kind: "reaction" | "reply" | "broadcast" | "digest" | "material_reaction";
          title: string;
          body: string;
          url: string;
          read_at?: string | null;
          topic_id?: string | null;
          digest_count?: number;
          latest_post_id?: string | null;
          actor_reader_id?: string | null;
          snippet?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      /** Reading Room — migrations/20261011_rooms.sql … 20261015_room_membership.sql.
       * Written only through the room SQL functions below (start_room,
       * join_room, leave_room, end_room), never inserted directly. */
      rooms: {
        Row: {
          id: string;
          group_id: string | null;
          session_id: string | null;
          material_id: string;
          /** Null shows as "<book title> reading room" (lib/room/title.ts). */
          title: string | null;
          started_by: string;
          status: "live" | "ended";
          started_at: string;
          ended_at: string | null;
          full_seconds: number;
          full_since: string | null;
          max_members: number;
        };
        Insert: {
          id?: string;
          group_id?: string | null;
          session_id?: string | null;
          material_id: string;
          title?: string | null;
          started_by: string;
          status?: "live" | "ended";
          started_at?: string;
          ended_at?: string | null;
          full_seconds?: number;
          full_since?: string | null;
          max_members?: number;
        };
        Update: Partial<Database["public"]["Tables"]["rooms"]["Insert"]>;
        Relationships: [];
      };
      room_members: {
        Row: { room_id: string; reader_id: string; joined_at: string; left_at: string | null; last_seen_at: string };
        Insert: { room_id: string; reader_id: string; joined_at?: string; left_at?: string | null; last_seen_at?: string };
        Update: Partial<Database["public"]["Tables"]["room_members"]["Insert"]>;
        Relationships: [];
      };
    };
    // Required by supabase-js's GenericSchema shape even with no views —
    // omitting it collapses the whole schema (and every table's row type) to
    // `never` rather than erroring loudly, which is its own trap.
    Views: Record<string, never>;
    Functions: {
      /** migrations/20261005_admin_dashboard.sql — shape in lib/metrics/dashboard.ts. */
      admin_dashboard_metrics: { Args: Record<string, never>; Returns: Json };
      /** Reading Room (migrations/20261012…20261015). Null when the book can't host a room. */
      start_room: { Args: { material: string; reader: string; room_title: string | null }; Returns: string | null };
      join_room: {
        Args: { room: string; reader: string };
        Returns: "joined" | "not_found" | "ended" | "forbidden" | "full";
      };
      leave_room: { Args: { room: string; reader: string }; Returns: undefined };
      end_room: { Args: { room: string }; Returns: boolean };
      room_moderator_ids: { Args: { room: string }; Returns: string[] };
      /** Members in the room now (left_at null, seen within 75 s). */
      room_active_count: { Args: { room: string }; Returns: number };
      is_room_moderator: { Args: { room: string; reader: string }; Returns: boolean };
      can_join_room: { Args: { room: string; reader: string }; Returns: boolean };
      /** Called by the reader in the room (authenticated). False: aged out or ended, rejoin. */
      room_heartbeat: { Args: { room: string }; Returns: boolean };
    };
  };
};

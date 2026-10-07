import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import type { Database } from "@/lib/supabase/database.types";
import type { ReaderProfile } from "@/lib/api/types";
import { toAvatar } from "@/lib/avatar/avatar";
import { isAdminReader } from "@/lib/auth/session";

type ReaderRow = Database["public"]["Tables"]["readers"]["Row"];

/** snake_case DB row -> camelCase ReaderProfile (api-spec.md's Conventions). */
export function toReaderProfile(row: ReaderRow): ReaderProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    pseudonym: row.pseudonym,
    city: row.city,
    country: row.country,
    interests: (row.interests as string[] | null) ?? [],
    surveyReadMaterialIds: (row.survey_read_material_ids as string[] | null) ?? [],
    ageRange: row.age_range,
    genderIdentity: row.gender_identity,
    onboardingStatus: row.onboarding_status,
    avatar: toAvatar(row),
    emailAnnouncements: row.email_announcements,
    canUpload: canUpload(row),
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  };
}

export async function getReaderRow(readerId: string): Promise<ReaderRow | null> {
  const { data, error } = await getSupabaseAdminClient().from("readers").select("*").eq("id", readerId).maybeSingle();
  if (error || !data) return null;
  return data;
}

/** Book uploads (private or public) are for admin-approved readers only —
 * see migrations/20261010_reader_upload_approved.sql. Admins always can. */
export function canUpload(row: Pick<ReaderRow, "email" | "upload_approved">): boolean {
  return row.upload_approved || isAdminReader(row);
}

/** canUpload for a request's signed-in reader, read fresh from the row. */
export async function readerCanUpload(reader: { readerId: string; email: string | null }): Promise<boolean> {
  if (isAdminReader(reader)) return true;
  const { data } = await getSupabaseAdminClient().from("readers").select("upload_approved").eq("id", reader.readerId).maybeSingle();
  return data?.upload_approved === true;
}

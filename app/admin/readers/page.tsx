import type { Metadata } from "next";
import ReadersAdminView from "./ReadersAdminView";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Readers admin",
  robots: { index: false, follow: false },
};

export default async function AdminReadersPage() {
  const admin = getSupabaseAdminClient();
  const [{ data: readers, error }, { data: uploads }] = await Promise.all([
    admin.from("readers").select("id, pseudonym, full_name, email, upload_approved, joined_at").order("joined_at", { ascending: false }),
    admin.from("materials").select("uploaded_by").not("uploaded_by", "is", null),
  ]);

  if (error) throw new Error(`Could not load readers: ${error.message}`);

  const uploadCounts = new Map<string, number>();
  for (const { uploaded_by } of uploads ?? []) uploadCounts.set(uploaded_by!, (uploadCounts.get(uploaded_by!) ?? 0) + 1);

  return (
    <ReadersAdminView
      readers={(readers ?? []).map((r) => ({
        id: r.id,
        pseudonym: r.pseudonym,
        fullName: r.full_name,
        email: r.email,
        uploadApproved: r.upload_approved,
        joinedAt: r.joined_at,
        uploads: uploadCounts.get(r.id) ?? 0,
      }))}
    />
  );
}

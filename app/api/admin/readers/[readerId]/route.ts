import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";

const UpdateReaderSchema = z.object({ uploadApproved: z.boolean() });

/** Approve or unapprove a reader for book uploads (/admin/readers). */
export async function PATCH(request: Request, { params }: { params: Promise<{ readerId: string }> }) {
  const { readerId } = await params;
  const parsed = UpdateReaderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please try again." }, { status: 400 });

  const { data, error } = await getSupabaseAdminClient()
    .from("readers")
    .update({ upload_approved: parsed.data.uploadApproved })
    .eq("id", readerId)
    .select("id, upload_approved")
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "We could not update this reader. Please try again." }, { status: 500 });
  return NextResponse.json({ item: data });
}

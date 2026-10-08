"use client";

import Link from "next/link";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import RoomAvatar from "@/app/components/room/RoomAvatar";
import { pseudonymToSlug } from "@/lib/reader/profileSlug";
import { useFollowTap, useRoom } from "@/lib/room/hooks";
import type { Note } from "@/lib/api/types";

/** The avatar circle alone, split out of AuthorRow so a caller can place it
 * beside just the name/time row — the quote/body/reactions below run the
 * full card width rather than staying indented under it. One size
 * everywhere — a reply is still the same person saying the same kind of
 * thing as a top-level note, so it gets no smaller a portrait. While you're
 * in the room on this book and they are too, a tap follows them (spec §1.6)
 * instead of opening their profile. */
export default function AuthorAvatar({ author }: { author: Note["author"] }) {
  const { tap, followingId } = useFollowTap();
  const member = useRoom((s) => s.roster.find((p) => p.readerId === author.readerId));
  const follow = tap(author.readerId);

  if (follow && member) {
    return <RoomAvatar member={member} size={32} pressed={followingId === author.readerId} onClick={follow} />;
  }
  return (
    <Link href={`/@${pseudonymToSlug(author.pseudonym)}`} className="flex flex-none no-underline">
      <ReaderAvatar pseudonym={author.pseudonym} avatar={author.avatar} size={32} />
    </Link>
  );
}

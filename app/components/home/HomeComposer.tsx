"use client";

import { useEffect, useState } from "react";
import { useProfile } from "@/lib/auth/useProfile";
import ReaderAvatar from "@/app/components/shared/ReaderAvatar";
import { useTopics } from "@/lib/community/useTopics";
import TopicPickerTrigger, { TopicChips } from "@/app/components/home/TopicPicker";
import ComposerBox, { ComposerLinks } from "@/app/components/reader/notes/ComposerBox";
import { errorMessage } from "@/lib/api/client";
import { useCreateNote } from "@/lib/community/useNoteMutations";

// One composer, one draft: Home only ever has this instance.
const DRAFT_STORAGE_KEY = "ominira-home-draft";

/**
 * Home's composer: the shared ComposerBox, right in the feed (no modal).
 * Posts through `POST /api/community/notes` as a `discussion` with no
 * ranges. Links in the text preview as you write; topic tags are optional,
 * and opening Home on a topic (`defaultTopicId`) starts with it picked.
 * Files and voice are left out for now.
 */
export default function HomeComposer({ defaultTopicId = null }: { defaultTopicId?: string | null }) {
  const { data: profile } = useProfile();
  const { data: topics } = useTopics();
  const createPost = useCreateNote(null);

  const [text, setText] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [topicIds, setTopicIds] = useState<string[]>(defaultTopicId ? [defaultTopicId] : []);
  // A new draft takes the topic you're browsing.
  const [browsing, setBrowsing] = useState(defaultTopicId);
  if (browsing !== defaultTopicId) {
    setBrowsing(defaultTopicId);
    if (!text) setTopicIds(defaultTopicId ? [defaultTopicId] : []);
  }

  useEffect(() => {
    try {
      if (text) window.localStorage.setItem(DRAFT_STORAGE_KEY, text);
      else window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // Best-effort — a private-browsing quota error shouldn't block typing.
    }
  }, [text]);

  function reset() {
    setText("");
    setTopicIds(defaultTopicId ? [defaultTopicId] : []);
    createPost.reset();
  }

  const canPost = !createPost.isPending && text.trim().length > 0;
  async function handlePost() {
    if (!canPost) return;
    try {
      await createPost.mutateAsync({ ranges: [], content: { kind: "text", text }, topicIds, threadType: "discussion" });
      reset();
    } catch {
      // Shown below; the draft stays for a retry.
    }
  }

  return (
    <ComposerBox
      avatar={<ReaderAvatar pseudonym={profile?.pseudonym ?? "Reader"} avatar={profile?.avatar} size={32} />}
      value={text}
      onChange={setText}
      placeholder="Share a note…"
      tools={<TopicPickerTrigger topics={topics ?? []} selectedIds={topicIds} onChange={setTopicIds} />}
      canPost={canPost}
      postLabel={createPost.isPending ? "Posting…" : "Post"}
      onPost={() => void handlePost()}
      onCancel={text ? reset : undefined}
      footer={
        createPost.isError && (
          <p className="m-0 text-[12px] font-medium text-red-600">
            {errorMessage(createPost.error) ?? "Could not post — check your connection and try again."}
          </p>
        )
      }
    >
      <ComposerLinks text={text} />
      {topicIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <TopicChips topics={topics ?? []} selectedIds={topicIds} onChange={setTopicIds} />
        </div>
      )}
    </ComposerBox>
  );
}

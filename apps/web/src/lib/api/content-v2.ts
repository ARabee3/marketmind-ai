import type {
  ContentCtaLibraryEntryInput,
  ContentCtaLibraryEntryV2,
  ContentCycleWorkspaceV2,
  ContentEditorialProfileUpsertRequest,
  ContentEditorialProfileV2,
  ContentMediaLibraryEntryV2,
  ContentPackWorkspaceV2,
  ContentWeekPlanV2,
  OwnerContentDirectEditRequest,
  OwnerContentDirectEditResponse,
} from "@marketmind/contracts";
import { apiRequest, type ApiRequestOptions } from "@/lib/api/client";

export type ContentV2ApiError = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
};

async function request<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const res = await apiRequest(path, init);

  if (!res.ok) {
    let code = "api_error";
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.code ?? body?.error?.code ?? code;
      message = body?.message ?? body?.error?.message ?? message;
    } catch {
      // ignore JSON parse failure
    }
    const err: ContentV2ApiError = { status: res.status, code, message };
    throw err;
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Cycle workspace aggregate
// ---------------------------------------------------------------------------

export function getCycleWorkspaceV2(
  cycleId: string,
  signal?: AbortSignal,
): Promise<ContentCycleWorkspaceV2> {
  return request<ContentCycleWorkspaceV2>(
    `/content-cycles/${encodeURIComponent(cycleId)}/workspace`,
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Editorial profile
// ---------------------------------------------------------------------------

export function getEditorialProfileV2(
  cycleId: string,
  signal?: AbortSignal,
): Promise<{ editorial_profile: ContentEditorialProfileV2 | null }> {
  return request(
    `/content-cycles/${encodeURIComponent(cycleId)}/editorial-profile`,
    {
      signal,
    },
  );
}

export function upsertEditorialProfileV2(
  cycleId: string,
  payload: ContentEditorialProfileUpsertRequest,
  signal?: AbortSignal,
): Promise<{ editorial_profile: ContentEditorialProfileV2 }> {
  return request(
    `/content-cycles/${encodeURIComponent(cycleId)}/editorial-profile`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      signal,
    },
  );
}

// ---------------------------------------------------------------------------
// CTA library
// ---------------------------------------------------------------------------

export function listCtaEntriesV2(
  cycleId: string,
  signal?: AbortSignal,
): Promise<{ entries: readonly ContentCtaLibraryEntryV2[] }> {
  return request(`/content-cycles/${encodeURIComponent(cycleId)}/cta-library`, {
    signal,
  });
}

export function createCtaEntryV2(
  cycleId: string,
  payload: ContentCtaLibraryEntryInput,
  signal?: AbortSignal,
): Promise<{ entry: ContentCtaLibraryEntryV2 }> {
  return request(`/content-cycles/${encodeURIComponent(cycleId)}/cta-library`, {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export function updateCtaEntryV2(
  cycleId: string,
  entryId: string,
  changes: Partial<ContentCtaLibraryEntryInput>,
  signal?: AbortSignal,
): Promise<{ entry: ContentCtaLibraryEntryV2 }> {
  return request(
    `/content-cycles/${encodeURIComponent(cycleId)}/cta-library/${encodeURIComponent(entryId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(changes),
      signal,
    },
  );
}

export function deactivateCtaEntryV2(
  cycleId: string,
  entryId: string,
  signal?: AbortSignal,
): Promise<{ entry: ContentCtaLibraryEntryV2 }> {
  return request(
    `/content-cycles/${encodeURIComponent(cycleId)}/cta-library/${encodeURIComponent(entryId)}/deactivate`,
    { method: "POST", signal },
  );
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export function listMediaV2(
  cycleId: string,
  signal?: AbortSignal,
): Promise<{ entries: readonly ContentMediaLibraryEntryV2[] }> {
  return request(`/content-cycles/${encodeURIComponent(cycleId)}/media`, {
    signal,
  });
}

export function uploadMediaV2(
  cycleId: string,
  file: File,
  signal?: AbortSignal,
): Promise<{ media: ContentMediaLibraryEntryV2 }> {
  const form = new FormData();
  form.append("file", file, file.name);
  return request(`/content-cycles/${encodeURIComponent(cycleId)}/media`, {
    method: "POST",
    body: form,
    signal,
  });
}

export function revokeMediaV2(
  cycleId: string,
  mediaId: string,
  signal?: AbortSignal,
): Promise<{ revoked: boolean }> {
  return request(
    `/content-cycles/${encodeURIComponent(cycleId)}/media/${encodeURIComponent(mediaId)}/revoke`,
    { method: "POST", signal },
  );
}

// ---------------------------------------------------------------------------
// Week plans
// ---------------------------------------------------------------------------

export function getWeekPlanV2(
  cycleId: string,
  weekNumber: number,
  signal?: AbortSignal,
): Promise<{ week_plan: ContentWeekPlanV2 | null }> {
  return request(
    `/content-cycles/${encodeURIComponent(cycleId)}/weeks/${weekNumber}/plan`,
    { signal },
  );
}

export function planWeekV2(
  cycleId: string,
  weekNumber: number,
  signal?: AbortSignal,
): Promise<{ week_plan: ContentWeekPlanV2 }> {
  return request(
    `/content-cycles/${encodeURIComponent(cycleId)}/weeks/${weekNumber}/plan`,
    { method: "POST", signal },
  );
}

export function createOrReplaceWeekPlanV2(
  cycleId: string,
  weekNumber: number,
  payload: {
    post_plans: readonly {
      position: number;
      purpose: string;
      intended_audience: string | null;
      channel: string;
      format: string;
      cta_library_entry_id: string | null;
      owner_instructions: string | null;
      visual_direction: string | null;
      selected_media_ids: readonly string[];
    }[];
  },
  signal?: AbortSignal,
): Promise<{ week_plan: ContentWeekPlanV2 }> {
  return request(
    `/content-cycles/${encodeURIComponent(cycleId)}/weeks/${weekNumber}/plan`,
    { method: "PUT", body: JSON.stringify(payload), signal },
  );
}

// ---------------------------------------------------------------------------
// Pack workspace + owner direct edit
// ---------------------------------------------------------------------------

export function getPackWorkspaceV2(
  packId: string,
  signal?: AbortSignal,
): Promise<ContentPackWorkspaceV2> {
  return request(`/content-packs/${encodeURIComponent(packId)}/workspace`, {
    signal,
  });
}

export function directEditV2(
  packId: string,
  itemId: string,
  payload: OwnerContentDirectEditRequest,
  signal?: AbortSignal,
): Promise<OwnerContentDirectEditResponse> {
  return request(
    `/content-packs/${encodeURIComponent(packId)}/items/${encodeURIComponent(itemId)}/edits`,
    { method: "POST", body: JSON.stringify(payload), signal },
  );
}

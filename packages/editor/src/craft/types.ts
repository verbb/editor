export interface MentionSearchResult {
    id: number;
    type: string;
    label: string;
    /** Optional: a role or activity line under the name. */
    description?: string;
    /** Optional: an avatar. */
    imageUrl?: string;
}

export interface ElementSearchResult extends MentionSearchResult {
    url: string;
}

export interface AssetUploadResult {
    id: number;
    filename: string;
    url: string | null;
    kind: string;
    temporary?: boolean;
    mimeType?: string;
    size?: number;
}

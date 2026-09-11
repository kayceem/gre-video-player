export interface MountainItem {
    title: string;
    slug: string;
    pronunciation: string | null;
    tooltip: string;
    description: string;
    plus_only: boolean;
    finalized: boolean;
    unlisted: boolean;
    colors: Record<string, string>;
}

export interface MountainCategory {
    title: string;
    slug: string;
    description: string;
    mountain_contents: MountainItem[];
}

export interface MountainData {
    title: string;
    slug: string;
    description: string;
    mountain_categories: MountainCategory[];
}

export type MountainSource = "verbal" | "quant" | "quant-overwhelmed";
export type ItemStatus = "G" | "R" | null;
export type SortOption = "default" | "alphabetical" | "status";
export type FilterOption = "all" | "known" | "forgot" | "new" | "forgot-new";

export type VideoItem = {
  title: string;
  file: string;
  watched: boolean;
  resume_position: number;
  updated_at?: string | null;
};

export type Category = {
  title: string;
  videos: VideoItem[];
};

export type Playlist = {
  title: string;
  categories: Category[];
};
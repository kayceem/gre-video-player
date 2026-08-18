# import json
# from pathlib import Path

# # ===== CONFIG =====
# JSON_FILE = "info.json"          # input JSON file
# ROOT_DIR = Path("GRE Quant")       # root folder containing videos
# OUTPUT_M3U = "course.m3u"
# # ==================

# with open(JSON_FILE, "r", encoding="utf-8") as f:
#     data = json.load(f)

# lines = ["#EXTM3U"]

# for category in data.get("categories", []):
#     folder_name = category["title"]

#     for content in category.get("contents", []):
#         file_name = content["title"] + ".mp4"
#         video_path = ROOT_DIR / folder_name / file_name

#         # Optional EXTINF entry (useful for players like VLC)
#         lines.append(f"#EXTINF:-1,{file_name}")
#         lines.append(str(video_path))

# with open(OUTPUT_M3U, "w", encoding="utf-8") as f:
#     f.write("\n".join(lines))

# print(f"Playlist written to {OUTPUT_M3U}")

import json
from pathlib import Path

# ===== CONFIG =====
INPUT_JSON = "info.json"     # original JSON (your big one)
OUTPUT_JSON = "playlist.json"         # output for webpage
VIDEO_ROOT = ""                       # relative to videos/ in webpage
# ==================

with open(INPUT_JSON, "r", encoding="utf-8") as f:
    data = json.load(f)

playlist = {
    "title": data.get("title", "Course"),
    "categories": []
}

for category in data.get("categories", []):
    cat_entry = {
        "title": category["title"],
        "contents": []
    }

    for content in category.get("contents", []):
        file_path = Path(category["title"]) / f"{content['title']}.mp4"

        cat_entry["contents"].append({
            "title": content["title"],
            "file": str(file_path)
        })

    playlist["categories"].append(cat_entry)

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(playlist, f, indent=2, ensure_ascii=False)

print(f"Generated {OUTPUT_JSON}")

#!/usr/bin/env bash
# post-process-videos.sh — Convert, trim, and stitch Playwright demo recordings.
#
# Prerequisites:
#   - ffmpeg installed (brew install ffmpeg / apt-get install ffmpeg)
#   - Playwright demo videos in test-results/
#
# Usage:
#   ./scripts/post-process-videos.sh                   # convert all demos
#   ./scripts/post-process-videos.sh stitch            # also stitch into one video
#   ./scripts/post-process-videos.sh trim 5 120        # trim each clip to 5–120 s
#
# Outputs land in demo-output/ (created automatically).

set -euo pipefail

RESULTS_DIR="${RESULTS_DIR:-test-results}"
OUTPUT_DIR="${OUTPUT_DIR:-demo-output}"
LOGO="${LOGO:-public/travo_logo.png}"

mkdir -p "$OUTPUT_DIR"

command -v ffmpeg >/dev/null 2>&1 || { echo "ERROR: ffmpeg not found. Install it and retry." >&2; exit 1; }

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[post-process] $*"; }

# Convert a single .webm to .mp4, scaling to 1920×1080 if needed.
convert_to_mp4() {
  local src="$1"
  local dst="$2"
  log "Converting: $src → $dst"
  ffmpeg -y -i "$src" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 -crf 18 -preset slow \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    "$dst" 2>/dev/null
}

# Trim a clip between START_SEC and END_SEC.
trim_clip() {
  local src="$1"
  local dst="$2"
  local start="${3:-0}"
  local end="${4:-}"
  local args=(-y -i "$src" -ss "$start")
  [[ -n "$end" ]] && args+=(-to "$end")
  args+=(-c:v libx264 -crf 18 -preset slow -c:a aac -movflags +faststart "$dst")
  log "Trimming: $src (${start}s → ${end:-end})"
  ffmpeg "${args[@]}" 2>/dev/null
}

# Add a branded lower-third text overlay (title + subtitle).
add_title_overlay() {
  local src="$1"
  local dst="$2"
  local title="${3:-Tavro}"
  local subtitle="${4:-}"
  log "Adding title overlay: \"$title\""
  ffmpeg -y -i "$src" \
    -vf "drawtext=text='${title}':fontsize=48:fontcolor=white:x=80:y=h-120:shadowcolor=black:shadowx=2:shadowy=2, \
         drawtext=text='${subtitle}':fontsize=28:fontcolor=#cccccc:x=80:y=h-68:shadowcolor=black:shadowx=1:shadowy=1" \
    -c:v libx264 -crf 18 -preset slow \
    -c:a aac -movflags +faststart \
    "$dst" 2>/dev/null
}

# Stitch a list of .mp4 clips into one video with 1-second black transitions.
stitch_videos() {
  local list_file="$OUTPUT_DIR/concat-list.txt"
  local output="$OUTPUT_DIR/full-demo.mp4"
  : > "$list_file"

  for f in "$OUTPUT_DIR"/[0-9][0-9]-*.mp4; do
    [[ -f "$f" ]] || continue
    echo "file '$(realpath "$f")'" >> "$list_file"
  done

  if [[ ! -s "$list_file" ]]; then
    log "No numbered MP4 clips found in $OUTPUT_DIR — skipping stitch."
    return
  fi

  log "Stitching clips into $output"
  ffmpeg -y -f concat -safe 0 -i "$list_file" \
    -c:v libx264 -crf 18 -preset slow \
    -c:a aac -movflags +faststart \
    "$output" 2>/dev/null

  log "Full demo saved to: $output"
}

# ── Main ──────────────────────────────────────────────────────────────────────

ACTION="${1:-convert}"
TRIM_START="${2:-0}"
TRIM_END="${3:-}"

# Map demo number to a human title / subtitle for overlays
declare -A DEMO_TITLES=(
  ["01"]="Agent Catalog"
  ["02"]="Create AI Use Case"
  ["03"]="AI Agent Playground"
  ["04"]="Blueprint Setup"
  ["05"]="Compliance & Audit"
  ["06"]="Full Product Tour"
)
declare -A DEMO_SUBTITLES=(
  ["01"]="Browse and search your AI agent library"
  ["02"]="Define and launch a new AI use case"
  ["03"]="Chat with your agents in real time"
  ["04"]="Map your organisation's AI context"
  ["05"]="Track regulations and audit compliance"
  ["06"]="End-to-end Tavro platform walkthrough"
)

log "Scanning $RESULTS_DIR for demo videos…"

# Playwright stores videos at:
# test-results/demo-chrome/<test-name>/video.webm
while IFS= read -r -d '' webm; do
  # Extract the demo number from the parent directory name (e.g. "03-agent-playground")
  dir_name="$(basename "$(dirname "$webm")")"
  num="${dir_name:0:2}"

  out_base="$OUTPUT_DIR/${dir_name}"

  # Step 1: Convert to MP4
  mp4="${out_base}.mp4"
  convert_to_mp4 "$webm" "$mp4"

  # Step 2: Trim if requested
  if [[ "$ACTION" == "trim" ]]; then
    trimmed="${out_base}-trimmed.mp4"
    trim_clip "$mp4" "$trimmed" "$TRIM_START" "$TRIM_END"
    mp4="$trimmed"
  fi

  # Step 3: Add title overlay
  titled="${out_base}-titled.mp4"
  title="${DEMO_TITLES[$num]:-Tavro}"
  subtitle="${DEMO_SUBTITLES[$num]:-}"
  add_title_overlay "$mp4" "$titled" "$title" "$subtitle"

  # Final — rename titled version to the numbered name used by stitch
  cp "$titled" "$OUTPUT_DIR/${num}-$(basename "$out_base").mp4"

  log "Done: $OUTPUT_DIR/${num}-$(basename "$out_base").mp4"
done < <(find "$RESULTS_DIR" -name "video.webm" -print0 | sort -z)

# Step 4: Stitch into one video if requested
if [[ "$ACTION" == "stitch" ]]; then
  stitch_videos
fi

log "All done. Check $OUTPUT_DIR/"

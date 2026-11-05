"""Optional local command adapter. Dependencies live in data/voice-engine only."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", nargs="?")
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    from faster_whisper import WhisperModel
    root = Path(__file__).resolve().parents[1]
    model = WhisperModel(
        "base.en", device="cpu", compute_type="int8", cpu_threads=4,
        download_root=str(root / "data" / "voice-models"),
        local_files_only=not args.prepare,
    )
    if args.prepare:
        print("Local English transcription model ready")
        return
    if not args.audio:
        parser.error("audio path required")
    segments, info = model.transcribe(args.audio, language="en", vad_filter=True,
                                      condition_on_previous_text=False)
    rows = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
    print(json.dumps({"text": " ".join(s["text"] for s in rows), "segments": rows,
                      "language": info.language}, ensure_ascii=True))


if __name__ == "__main__":
    main()

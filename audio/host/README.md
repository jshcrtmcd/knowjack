# Pre-recorded host lines (optional)

Drop audio files in this folder and list them in `manifest.json`, keyed by the line key and the line's
index in the `LINES` object in `js/host.js`:

```json
{
  "welcome":     { "0": "welcome-0.mp3", "1": "welcome-1.mp3" },
  "correctFast": { "0": "correctFast-0.mp3" }
}
```

When the host picks a line that has a clip, the clip plays instead of the browser's synthesized voice.
Lines without a clip fall back to the synthesized voice, so you can record a few at a time.
Lines with placeholders like `{answer}` change every time, so either record them without the variable
part or leave them to the synthesized voice.

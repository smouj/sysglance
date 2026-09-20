# Desktop profiles

Profiles are planned as local, versioned snapshots of settings that SysGlance already owns:

```text
profile
├── theme / accent / wallpaper
├── taskbar position / auto-hide (with explicit Explorer restart)
├── layout / anchor / visible and collapsed sections
└── future monitor placement and refresh preferences
```

The current release does not expose save/apply/import/export profiles yet. Before implementation, each shell mutation needs a reversible snapshot and a per-setting backup/verify path. Profiles must never contain passwords, document contents or arbitrary commands.

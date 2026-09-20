# Desktop profiles

Profiles are local, versioned snapshots of settings that SysGlance already owns:

```text
profile
├── theme / accent / wallpaper
├── taskbar position / auto-hide (with explicit Explorer restart)
├── layout / anchor / visible and collapsed sections
└── selected display and refresh preferences
```

The current release exposes save, apply, duplicate, rename, delete, import and
export through a local versioned store. Applying a profile changes only the
validated SysGlance configuration, including the selected display. Shell state
is retained as `shellPending` and is not written to the registry automatically;
the UI can undo the last profile apply for SysGlance-owned settings. A future
rollback-capable shell transaction must be implemented before applying shell
fields.

Profiles never contain passwords, document contents or arbitrary commands.

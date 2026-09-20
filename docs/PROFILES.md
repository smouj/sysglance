# Desktop profiles

Profiles are local, versioned snapshots of settings that SysGlance already owns:

```text
profile
├── theme / accent / wallpaper
├── taskbar position / auto-hide (with explicit Explorer restart)
├── layout / anchor / visible and collapsed sections
├── configurable toggle / lock / palette shortcuts
├── selected display and refresh preferences
└── bounded snapshots for the six known home-folder desktop.ini files
```

The current release exposes save, apply, duplicate, rename, delete, import and
export through a local versioned store. Applying a profile changes only the
validated SysGlance configuration, including the selected display. Shell state
is retained as `shellPending` and is not written to the registry automatically;
the UI can undo the last profile apply for SysGlance-owned settings. Direct shell
mutations have a bounded journal-backed undo action. A separate explicit
“Apply shell settings” action now runs taskbar, wallpaper, accent, theme and
known-folder desktop.ini changes as one rollback-capable transaction. Folder
snapshots are exact bytes, limited to the six folders SysGlance already offers,
and are never applied by the normal config-only Apply action.

Profiles never contain passwords, document contents or arbitrary commands.

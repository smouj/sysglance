# SysGlance — informe final de auditoría comercial

Fecha de corte: 20 de septiembre de 2026  
Plataforma observada: Windows 10 Pro 10.0.19045, x64, Intel Core i7-6700,
8 hilos lógicos, 16 GiB RAM.  
Estado: baseline comercial auditada; no es todavía un release candidate de
distribución pública.

## Resultado ejecutivo

SysGlance evolucionó de un overlay de métricas a un Windows Desktop Control
Center local-first con siete áreas conectadas: monitoring, control del sistema,
customization del escritorio, perfiles, histórico, alertas y layouts HUD.

La arquitectura conserva Electron y separa el coste de las métricas: CPU/RAM
rápidos en proceso, hardware/procesos en una cadencia lenta, identidad estática
cacheada y diagnósticos bajo demanda. El renderer no tiene Node, filesystem ni
IPC genérico.

La funcionalidad local está implementada y verificada en el host Windows 10.
Las afirmaciones de soporte para Windows 11, hardware multi-monitor, DPI,
sleep/resume, instalación limpia y CI remoto permanecen explícitamente sin
verificar.

## Arquitectura entregada

```text
renderer sandboxed
    │ contextBridge con wrappers nombrados
    ▼
main process
    ├── Metric Engine: static / fast / slow / on-demand
    ├── HistoryStore: ring buffers locales, 24 h, downsample ≤240 puntos
    ├── AlertEngine: threshold + duration + cooldown + recovery
    ├── Health evaluator: estados objetivos NORMAL/WARNING/CRITICAL/UNKNOWN
    ├── Display topology: work area, escala, refresco, rotación, primario
    ├── Profiles + journal + rollback transaccional
    ├── Diagnostics/support bundle sanitizados
    └── Windows shell IPC → reg.exe / helper C# one-shot
```

No hay cuenta, servidor obligatorio, nube, IA, publicidad ni telemetría. El
gate `npm run verify:privacy` comprueba que no existen primitivas HTTP,
clientes analíticos ni dependencias runtime directas innecesarias.

## Funciones implementadas

- Métricas CPU, RAM, GPU, temperatura, almacenamiento, red, batería y procesos.
- Polling no solapado con backpressure, costes y llamadas de proveedor visibles.
- Histórico local de CPU/RAM/GPU/temperatura/red con ventanas 1m/5m/30m/1h/6h/24h.
- Sparklines acotadas y resúmenes de latest/average/peak sobre la ventana completa.
- Alertas locales de CPU, RAM, GPU, disco y procesos con recuperación y cooldown;
  las alertas activas aparecen en System status.
- System Status objetivo, sin puntuaciones alarmistas.
- Procesos con filtro, PID, ruta, copiar PID/ruta, abrir ubicación y end-task confirmado.
- Inspector de CPU, OS, BIOS, baseboard, memoria, almacenamiento, GPU, red,
  batería y displays; exportación JSON, copia y support bundle sanitizado.
- Storage con usado/total/libre/filesystem/tipo y temperatura opcional; análisis
  de carpetas solo bajo petición y con límites.
- Red con tasas actuales, picos, sesión, adaptador, IPv4, gateway, DNS y link speed
  bajo consulta explícita.
- Taskbar, auto-hide, tema, accent, wallpaper, galería, Start y folder icons,
  con journal y rollback donde corresponde.
- Perfiles locales save/apply/duplicate/rename/import/export/delete/undo.
- Sidebar, Dock y Corner; command palette local con navegación de teclado y ARIA.
- Hotkeys toggle/lock/palette persistentes con rechazo de duplicados y estado visible cuando Windows no puede registrar un acelerador ocupado.
- Selección de display con work area, resolución, escala, Hz, rotación, primario y
  estado HDR honesto (`HDR unavailable` cuando Electron no lo expone).
- Acciones allow-listed: Settings, red, display, apps, Task Manager, Services,
  lock, sleep y restart con confirmación cuando son destructivas.
- Logs estructurados locales con rotación, diagnósticos y bundle ZIP redacted.

## Bugs y regresiones corregidos

- Registro Shell IPC duplicado detectado por self-test.
- `System Idle Process` eliminado del ranking visible de procesos.
- Identidad de red retirada del loop lento y convertida en bridge cacheado bajo demanda.
- I/O de disco mantenido nullable en vez de fabricar valores.
- Paths, clipboard, PID, wallpaper y controles shell revalidados en main process.
- La galería de wallpapers dejó de aceptar rutas arbitrarias: lista, preview y Explorer quedan limitados a `Pictures\\Wallpaper`, con canonicalización para evitar escapes por junction/symlink.
- Los handlers de folder icons también dejaron de aceptar directorios absolutos arbitrarios: solo resuelven las seis carpetas ofrecidas y revalidan el undo persistido.
- Aplicación de perfiles shell convertida en transacción con rollback.
- Histórico separado entre resumen completo y serie renderizada para evitar coste
  creciente en la ventana de 24 horas.
- Instalador por usuario y uninstaller empaquetado corregidos y comprobados.
- UI de alertas, metadata de Storage, metadata de displays y navegación de palette
  añadidas después de auditar el comportamiento real.

## Evidencia ejecutada

| Gate | Resultado |
|---|---|
| `npm ci` | PASS; 285 paquetes instalados. |
| `npm audit --audit-level=high` | PASS; 0 vulnerabilidades reportadas. |
| `npm run verify` | PASS; 37 sintaxis, 36 config, 28 shell, 43 shell extendido, 17 histórico/alertas, 10 métricas, 7 diagnostics, 7 journal, 4 transaction, 5 profile-shell, 14 profiles, 8 processes, 10 displays, 6 install, 20 actions, 4 logging, 4 privacy e IPC único. |
| `npm run self-test` | PASS con Electron 44.4.3, ventana real, preload, tiers, inspector, displays, alert surface y rechazo de paths hostiles. |
| `npm run bench -- --iterations=3 --new` | PASS; fast 0.69 ms mediana, slow 3149.01 ms mediana, 166.33 ms CPU/ciclo, 19.33 procesos hijos/ciclo. |
| `npm run bench:runtime` (PowerShell env: 2 iterations) | PASS; ready-to-show 1195.85 ms, fast 0.78 ms mediana, slow 3639.49 ms mediana, IPC 0.98 ms mediana, renderer patch 4.63 ms mediana, 385.0 MB RSS agregado y 4 procesos Electron. |
| `npm run screenshot` | PASS; sidebar, settings, dock, mini, shell y minimum-size capturados y revisados. |
| `npm run build:win -- --config.directories.output=dist-verify` | PASS con electron-builder 26.15.3. |
| `npm run verify:install` | PASS 6/6; helper 6144 bytes, uninstaller 600 bytes. |
| `npm run verify:portable` | PASS 3/3; portable executable and native helper were found in `dist-portable`. |
| `npm run verify:release` | PASS local; versioned PE artifacts, helper, uninstaller and SHA-256 evidence are checked. Release tags fail closed unless Authenticode is valid for all packaged PE files. |

## Rendimiento observado

- Startup visible: 1,474 ms en el host auditado; segunda medición 1,512 ms.
- RSS combinado después de warm-up: 393.3 MB; main 96.1 MB, renderer 144.2 MB,
  GPU 108.8 MB, utility 44.2 MB.
- CPU agregado en una muestra de 30.3 s: 2,203 ms, equivalente a 7.27% de un
  núcleo; incluye bursts reales del proveedor cada 7 s.
- Fast tier: 0 procesos hijos; slow tier: 19.33 hijos/ciclo, principalmente
  PowerShell de `systeminformation`.

Estas cifras son baselines del host, no garantías de release. El coste de RAM y
el CPU idle observado siguen por encima del objetivo ideal `~0 %` y son deuda de
optimización.

## Compatibilidad y distribución

| Área | Estado |
|---|---|
| Windows 10 Pro actual | VERIFIED. |
| Windows 11 x64 | NOT VERIFIED. |
| DPI 100/125/150/175/200 | NOT VERIFIED; solo se verificó exposición de escala y layout en el host. |
| 1 monitor | VERIFIED. |
| 2/3 monitores físicos | NOT VERIFIED. |
| display disconnect/reconnect | NOT VERIFIED físicamente; fallback primario probado por código/gate. |
| lock/unlock | PARTIAL; acción allow-listed, transición física no ejecutada. |
| sleep/resume | NOT VERIFIED. |
| Explorer restart | PARTIAL; dry-run y UI, sin reinicio destructivo. |
| GPU reset / network hot-plug | NOT VERIFIED. |
| unpacked + NSIS + portable | VERIFIED en `dist-verify` y `dist-portable`. |
| instalación/desinstalación limpia | NOT VERIFIED; había una instalación existente y no se sobrescribió. |
| GitHub Actions remoto | NOT VERIFIED en este checkout; el workflow está preparado. |
| firma de código / auto-update seguro | NOT IMPLEMENTED. |

El instalador actual mide 111,920,748 bytes y tiene SHA-256
`9B4016EDF13B51358A78F737B51A1ED3B968D76432BB4F14CB8BAB1496961A10`.
El portable mide 100,605,729 bytes y tiene SHA-256
`07B0E13A33687281DEE987F4BCFD7632DCE92C113C0AD4DD7804DA749A8195AF`.

## Riesgos y deuda restante

1. Hace falta una matriz física Windows 10/11 con 5 escalas, 1–3 monitores,
   desconexión, sleep/resume, cambio de red y reset de GPU.
2. La instalación existente impidió verificar residuos de uninstall en una
   máquina limpia; debe usarse una VM o runner aislado.
3. `systeminformation` no entrega GPU/Disk por proceso en el host auditado;
   SysGlance no inventa esos valores. Se requiere un proveedor Windows específico
   si esa información pasa a ser requisito de producto.
4. Electron no expone HDR en el objeto Display observado; se informa como
   unavailable hasta disponer de una API fiable.
5. El producto no tiene certificado de firma ni actualización segura; no debe
   publicarse como release comercial firmado todavía.
6. La ruta Microsoft Store/MSIX está documentada como opcional, pero sigue sin
   implementación hasta validar identidad, firma, shell boundary y upgrades en
   máquina limpia.
7. El CI remoto no se observó verde porque los commits locales están por delante
   de `origin/main` y no se hizo push automático.
8. El support bundle está sanitizado localmente, pero falta validar el flujo de
   retención/revisión del equipo de soporte.

## Siguiente milestone recomendado

Ejecutar el plan M10/M12 en una VM y hardware Windows separado: CI remoto verde,
instalación/uninstall limpio, firma de artefactos, matriz DPI/multi-monitor y
sleep/resume. Después medir una segunda iteración de optimización de RSS/CPU y
decidir si el proveedor de procesos necesita una capa nativa opcional.

## Referencias

- [`COMMERCIAL_BASELINE.md`](COMMERCIAL_BASELINE.md)
- [`PERFORMANCE_BASELINE.md`](PERFORMANCE_BASELINE.md)
- [`COMPATIBILITY_MATRIX.md`](COMPATIBILITY_MATRIX.md)
- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`RELEASE.md`](RELEASE.md)
- [`CODE_SIGNING.md`](CODE_SIGNING.md)
